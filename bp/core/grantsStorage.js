// bp/core/grantsStorage.js
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_GRANT_SOURCES, normalizeGrantStatus, normalizeGrantType } from "./grantsSources.js";
import { clean, cleanUrl, verifyOpportunity } from "./grantsVerifier.js";

const DATA_DIR = process.env.GRANTS_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.GRANTS_PROD_DB_PATH || path.join(DATA_DIR, "grants-prod-db.json");

const VECTOR_SIZE = 384;
const OPPORTUNITIES_COLLECTION = process.env.QDRANT_GRANTS_COLLECTION || "grants_opportunities";
const SOURCES_COLLECTION = process.env.QDRANT_GRANTS_SOURCES_COLLECTION || "grants_sources";
const JOBS_COLLECTION = process.env.QDRANT_GRANTS_JOBS_COLLECTION || "grants_jobs";
const QDRANT_SCROLL_LIMIT = clampInt(process.env.QDRANT_GRANTS_SCROLL_LIMIT, 100, 50000, 10000);

const DEFAULT_DB = {
  version: 1,
  opportunities: [],
  sources: DEFAULT_GRANT_SOURCES.map(sourceRecord),
  jobs: [],
  meta: { createdAt: null, updatedAt: null },
};

let writeQueue = Promise.resolve();
let qdrantInitPromise = null;
let qdrantDisabled = false;

export async function initGrantsStorage() {
  if (isQdrantConfigured()) {
    const ready = await initQdrantStorage();
    if (ready) return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    const now = new Date().toISOString();
    await fs.writeFile(DB_PATH, JSON.stringify({ ...DEFAULT_DB, meta: { createdAt: now, updatedAt: now } }, null, 2));
  }
}

export async function listOpportunities(filters = {}) {
  if (isQdrantConfigured()) return qdrantListOpportunities(filters);

  const db = await readDb();
  const rows = filterAndSortOpportunities(db.opportunities, filters);
  const limit = clampInt(filters.limit, 1, 100, 30);
  const offset = clampInt(filters.offset, 0, 10000, 0);
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

export async function getOpportunity(id) {
  if (isQdrantConfigured()) return qdrantGetOpportunity(id);

  const db = await readDb();
  return db.opportunities.find((opp) => opp.id === id) || null;
}

export async function saveOpportunity(input = {}) {
  if (isQdrantConfigured()) return qdrantSaveOpportunity(input);

  const verified = verifyOpportunity(input);
  if (!verified.sourceUrl) {
    return { saved: null, skipped: true, reason: "SOURCE_URL_REQUIRED" };
  }

  let saved = null;
  await updateDb((db) => {
    const normalizedUrl = normalizeUrlKey(verified.sourceUrl);
    const idx = db.opportunities.findIndex((opp) => normalizeUrlKey(opp.sourceUrl) === normalizedUrl || opp.id === verified.id);
    if (idx >= 0) {
      saved = {
        ...db.opportunities[idx],
        ...verified,
        id: db.opportunities[idx].id,
        createdAt: db.opportunities[idx].createdAt || verified.createdAt,
        updatedAt: new Date().toISOString(),
      };
      db.opportunities[idx] = saved;
    } else {
      saved = verified;
      db.opportunities.unshift(saved);
    }
    return db;
  });

  return { saved, skipped: false };
}

export async function saveOpportunities(items = []) {
  const saved = [];
  const skipped = [];
  for (const item of items) {
    const result = await saveOpportunity(item);
    if (result.saved) saved.push(result.saved);
    else skipped.push({ item, reason: result.reason });
  }
  return { saved, skipped };
}

export async function listSources() {
  if (isQdrantConfigured()) return qdrantListSources();

  const db = await readDb();
  return db.sources;
}

export async function addSource(input = {}) {
  if (isQdrantConfigured()) return qdrantAddSource(input);

  const now = new Date().toISOString();
  const record = sourceRecord({
    name: input.name,
    url: input.url || input.baseUrl,
    baseUrl: input.baseUrl || input.url,
    category: input.type || input.category,
    region: input.region,
    preferredLanguage: input.preferredLanguage || "en",
    active: input.active !== false,
    createdAt: now,
  });

  if (!record.name || !record.url) throw new Error("SOURCE_NAME_AND_URL_REQUIRED");

  let saved = null;
  await updateDb((db) => {
    const idx = db.sources.findIndex((s) => normalizeUrlKey(s.url) === normalizeUrlKey(record.url));
    if (idx >= 0) {
      saved = { ...db.sources[idx], ...record, id: db.sources[idx].id, updatedAt: now };
      db.sources[idx] = saved;
    } else {
      saved = record;
      db.sources.push(saved);
    }
    return db;
  });
  return saved;
}

export async function updateOpportunityStatus(id, status) {
  if (isQdrantConfigured()) return qdrantUpdateOpportunityStatus(id, status);

  const safeStatus = normalizeGrantStatus(status);
  let updated = null;
  await updateDb((db) => {
    const idx = db.opportunities.findIndex((opp) => opp.id === id);
    if (idx < 0) return db;
    updated = { ...db.opportunities[idx], status: safeStatus, updatedAt: new Date().toISOString() };
    db.opportunities[idx] = updated;
    return db;
  });
  return updated;
}

export async function createJob({ query, params }) {
  if (isQdrantConfigured()) return qdrantCreateJob({ query, params });

  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    status: "queued",
    query: clean(query, 500),
    params: params || {},
    result: null,
    error: null,
    createdAt: now,
    startedAt: null,
    doneAt: null,
  };
  await updateDb((db) => {
    db.jobs.unshift(job);
    db.jobs = db.jobs.slice(0, 200);
    return db;
  });
  return job;
}

export async function patchJob(id, patch) {
  if (isQdrantConfigured()) return qdrantPatchJob(id, patch);

  let updated = null;
  await updateDb((db) => {
    const idx = db.jobs.findIndex((job) => job.id === id);
    if (idx < 0) return db;
    updated = { ...db.jobs[idx], ...patch };
    db.jobs[idx] = updated;
    return db;
  });
  return updated;
}

export async function getJob(id) {
  if (isQdrantConfigured()) return qdrantGetJob(id);

  const db = await readDb();
  return db.jobs.find((job) => job.id === id) || null;
}

async function initQdrantStorage() {
  if (qdrantDisabled) return false;
  if (!qdrantInitPromise) {
    qdrantInitPromise = (async () => {
      await ensureQdrantCollection(OPPORTUNITIES_COLLECTION);
      await ensureQdrantCollection(SOURCES_COLLECTION);
      await ensureQdrantCollection(JOBS_COLLECTION);
      await seedDefaultQdrantSources();
      return true;
    })().catch((error) => {
      qdrantDisabled = true;
      console.warn("[GRANTS] Qdrant storage disabled, falling back to JSON:", String(error?.message || error));
      return false;
    });
  }
  return qdrantInitPromise;
}

async function qdrantListOpportunities(filters = {}) {
  if (!(await initQdrantStorage())) return listOpportunities(filters);
  const points = await qdrantScrollAll(OPPORTUNITIES_COLLECTION, { limit: QDRANT_SCROLL_LIMIT });
  const opportunities = points.map((point) => opportunityFromPayload(point.payload)).filter(Boolean);
  const rows = filterAndSortOpportunities(opportunities, filters);
  const limit = clampInt(filters.limit, 1, 100, 30);
  const offset = clampInt(filters.offset, 0, 10000, 0);
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

async function qdrantGetOpportunity(id) {
  if (!(await initQdrantStorage())) return getOpportunity(id);
  const point = await qdrantRetrievePoint(OPPORTUNITIES_COLLECTION, id);
  return point ? opportunityFromPayload(point.payload) : null;
}

async function qdrantSaveOpportunity(input = {}) {
  if (!(await initQdrantStorage())) return saveOpportunity(input);
  const verified = verifyOpportunity(input);
  if (!verified.sourceUrl) return { saved: null, skipped: true, reason: "SOURCE_URL_REQUIRED" };

  const existing = await qdrantRetrievePoint(OPPORTUNITIES_COLLECTION, verified.id);
  const previous = existing ? opportunityFromPayload(existing.payload) : null;
  const saved = {
    ...(previous || {}),
    ...verified,
    id: previous?.id || verified.id,
    createdAt: previous?.createdAt || verified.createdAt,
    updatedAt: new Date().toISOString(),
    recordKind: "opportunity",
  };

  await qdrantUpsert(OPPORTUNITIES_COLLECTION, saved.id, qdrantVectorForOpportunity(saved), opportunityPayload(saved));
  return { saved, skipped: false };
}

async function qdrantListSources() {
  if (!(await initQdrantStorage())) return listSources();
  const points = await qdrantScrollAll(SOURCES_COLLECTION, { limit: 2000 });
  return points.map((point) => sourceFromPayload(point.payload)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

async function qdrantAddSource(input = {}) {
  if (!(await initQdrantStorage())) return addSource(input);
  const record = sourceRecord({
    name: input.name,
    url: input.url || input.baseUrl,
    baseUrl: input.baseUrl || input.url,
    category: input.type || input.category,
    region: input.region,
    preferredLanguage: input.preferredLanguage || "en",
    active: input.active !== false,
  });
  if (!record.name || !record.url) throw new Error("SOURCE_NAME_AND_URL_REQUIRED");

  const existing = await qdrantRetrievePoint(SOURCES_COLLECTION, record.id);
  const previous = existing ? sourceFromPayload(existing.payload) : null;
  const saved = {
    ...(previous || {}),
    ...record,
    id: previous?.id || record.id,
    createdAt: previous?.createdAt || record.createdAt,
    updatedAt: new Date().toISOString(),
    recordKind: "source",
  };
  await qdrantUpsert(SOURCES_COLLECTION, saved.id, hashVector(`${saved.name} ${saved.url} ${saved.type} ${saved.region}`), sourcePayload(saved));
  return saved;
}

async function qdrantUpdateOpportunityStatus(id, status) {
  if (!(await initQdrantStorage())) return updateOpportunityStatus(id, status);
  const opportunity = await qdrantGetOpportunity(id);
  if (!opportunity) return null;
  const updated = { ...opportunity, status: normalizeGrantStatus(status), updatedAt: new Date().toISOString(), recordKind: "opportunity" };
  await qdrantUpsert(OPPORTUNITIES_COLLECTION, updated.id, qdrantVectorForOpportunity(updated), opportunityPayload(updated));
  return updated;
}

async function qdrantCreateJob({ query, params }) {
  if (!(await initQdrantStorage())) return createJob({ query, params });
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    status: "queued",
    query: clean(query, 500),
    params: params || {},
    result: null,
    error: null,
    createdAt: now,
    startedAt: null,
    doneAt: null,
    recordKind: "job",
  };
  await qdrantUpsert(JOBS_COLLECTION, job.id, hashVector(`${job.query} ${job.status}`), jobPayload(job));
  return job;
}

async function qdrantPatchJob(id, patch = {}) {
  if (!(await initQdrantStorage())) return patchJob(id, patch);
  const current = await qdrantGetJob(id);
  if (!current) return null;
  const updated = { ...current, ...patch, result: compactJobResult(patch.result ?? current.result), recordKind: "job" };
  await qdrantUpsert(JOBS_COLLECTION, updated.id, hashVector(`${updated.query} ${updated.status}`), jobPayload(updated));
  return updated;
}

async function qdrantGetJob(id) {
  if (!(await initQdrantStorage())) return getJob(id);
  const point = await qdrantRetrievePoint(JOBS_COLLECTION, id);
  return point ? jobFromPayload(point.payload) : null;
}

async function seedDefaultQdrantSources() {
  for (const source of DEFAULT_GRANT_SOURCES.map(sourceRecord)) {
    const existing = await qdrantRetrievePoint(SOURCES_COLLECTION, source.id);
    if (existing) continue;
    await qdrantUpsert(SOURCES_COLLECTION, source.id, hashVector(`${source.name} ${source.url} ${source.type} ${source.region}`), sourcePayload({ ...source, recordKind: "source" }));
  }
}

async function ensureQdrantCollection(collection) {
  const response = await qdrantFetch(`/collections/${encodeURIComponent(collection)}`, { method: "GET" });
  if (response.ok) return;
  if (response.status !== 404) await throwQdrantError(response, `Qdrant collection check failed: ${collection}`);

  const create = await qdrantFetch(`/collections/${encodeURIComponent(collection)}`, {
    method: "PUT",
    body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: "Cosine" } }),
  });
  if (!create.ok) await throwQdrantError(create, `Qdrant collection create failed: ${collection}`);
}

async function qdrantUpsert(collection, id, vector, payload) {
  const response = await qdrantFetch(`/collections/${encodeURIComponent(collection)}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points: [{ id, vector, payload }] }),
  });
  if (!response.ok) await throwQdrantError(response, `Qdrant upsert failed: ${collection}`);
}

async function qdrantRetrievePoint(collection, id) {
  if (!isUuid(id)) return null;
  const response = await qdrantFetch(`/collections/${encodeURIComponent(collection)}/points`, {
    method: "POST",
    body: JSON.stringify({ ids: [id], with_payload: true, with_vector: false }),
  });
  if (!response.ok) await throwQdrantError(response, `Qdrant retrieve failed: ${collection}`);
  const json = await response.json();
  return json?.result?.[0] || null;
}

async function qdrantScrollAll(collection, { limit = 10000 } = {}) {
  const out = [];
  let offset = null;
  while (out.length < limit) {
    const response = await qdrantFetch(`/collections/${encodeURIComponent(collection)}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        limit: Math.min(256, limit - out.length),
        with_payload: true,
        with_vector: false,
        ...(offset ? { offset } : {}),
      }),
    });
    if (!response.ok) await throwQdrantError(response, `Qdrant scroll failed: ${collection}`);
    const json = await response.json();
    const points = Array.isArray(json?.result?.points) ? json.result.points : [];
    out.push(...points);
    offset = json?.result?.next_page_offset || null;
    if (!offset || !points.length) break;
  }
  return out;
}

async function qdrantFetch(pathname, options = {}) {
  const base = normalizeQdrantBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.QDRANT_TIMEOUT_MS || 15000));
  try {
    return await fetch(`${base}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function throwQdrantError(response, message) {
  const text = await response.text().catch(() => "");
  const hint = text.includes("404 page not found")
    ? " Check QDRANT_URL: use the Qdrant REST cluster endpoint, not the dashboard URL."
    : "";
  throw new Error(`${message}: HTTP ${response.status} ${text.slice(0, 300)}${hint}`);
}

function filterAndSortOpportunities(items = [], filters = {}) {
  const q = clean(filters.q, 200).toLowerCase();
  const type = clean(filters.type, 80);
  const country = clean(filters.country, 100).toLowerCase();
  const region = clean(filters.region, 100).toLowerCase();
  const sector = clean(filters.sector, 100).toLowerCase();
  const status = clean(filters.status, 60);
  const source = clean(filters.source, 180).toLowerCase();
  const deadlineFrom = parseDate(filters.deadlineFrom);
  const deadlineTo = parseDate(filters.deadlineTo);

  return items
    .map(refreshStatus)
    .filter((opp) => {
      if (q) {
        const hay = [opp.title, opp.organization, opp.summary, opp.description, opp.eligibility, opp.sourceName]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (type && opp.type !== normalizeGrantType(type)) return false;
      if (country && !opp.countries.some((c) => c.toLowerCase().includes(country) || country.includes(c.toLowerCase()))) return false;
      if (region && !String(opp.region || "").toLowerCase().includes(region)) return false;
      if (sector && !opp.sectors.some((s) => s.toLowerCase().includes(sector))) return false;
      if (status && opp.status !== normalizeGrantStatus(status)) return false;
      if (source && !String(opp.sourceName || "").toLowerCase().includes(source)) return false;
      const deadline = parseDate(opp.deadline);
      if (deadlineFrom && (!deadline || deadline < deadlineFrom)) return false;
      if (deadlineTo && (!deadline || deadline > endOfDay(deadlineTo))) return false;
      return true;
    })
    .sort((a, b) => {
      const as = statusRank(a.status);
      const bs = statusRank(b.status);
      if (as !== bs) return as - bs;
      return Number(b.reliabilityScore || 0) - Number(a.reliabilityScore || 0);
    });
}

function opportunityPayload(opp = {}) {
  return {
    ...opp,
    recordKind: "opportunity",
    countries: Array.isArray(opp.countries) ? opp.countries : [],
    sectors: Array.isArray(opp.sectors) ? opp.sectors : [],
    searchText: [opp.title, opp.organization, opp.summary, opp.description, opp.eligibility, (opp.countries || []).join(" "), (opp.sectors || []).join(" ")].filter(Boolean).join(" ").slice(0, 12000),
  };
}

function sourcePayload(source = {}) {
  return { ...source, recordKind: "source" };
}

function jobPayload(job = {}) {
  return { ...job, recordKind: "job", result: compactJobResult(job.result) };
}

function opportunityFromPayload(payload = {}) {
  if (!payload || payload.recordKind !== "opportunity") return null;
  return refreshStatus({
    id: payload.id,
    title: clean(payload.title, 300),
    organization: clean(payload.organization, 220),
    type: normalizeGrantType(payload.type),
    summary: clean(payload.summary, 900),
    description: clean(payload.description, 6000),
    eligibility: clean(payload.eligibility, 2500),
    countries: Array.isArray(payload.countries) ? payload.countries.map((x) => clean(x, 120)).filter(Boolean) : [],
    region: clean(payload.region, 120),
    sectors: Array.isArray(payload.sectors) ? payload.sectors.map((x) => clean(x, 120)).filter(Boolean) : [],
    amount: clean(payload.amount, 160),
    currency: clean(payload.currency, 24),
    deadline: clean(payload.deadline, 80) || null,
    deadlineText: clean(payload.deadlineText, 220),
    applicationUrl: cleanUrl(payload.applicationUrl),
    sourceUrl: cleanUrl(payload.sourceUrl),
    sourceName: clean(payload.sourceName, 180),
    language: clean(payload.language || "unknown", 20),
    status: normalizeGrantStatus(payload.status),
    reliabilityScore: clampInt(payload.reliabilityScore, 0, 100, 0),
    verificationNotes: clean(payload.verificationNotes, 1200),
    rawContent: clean(payload.rawContent, 18000),
    extractedAt: clean(payload.extractedAt, 80),
    lastCheckedAt: clean(payload.lastCheckedAt, 80),
    createdAt: clean(payload.createdAt, 80),
    updatedAt: clean(payload.updatedAt, 80),
  });
}

function sourceFromPayload(payload = {}) {
  if (!payload || payload.recordKind !== "source") return null;
  return sourceRecord(payload);
}

function jobFromPayload(payload = {}) {
  if (!payload || payload.recordKind !== "job") return null;
  return {
    id: payload.id,
    status: clean(payload.status || "queued", 30),
    query: clean(payload.query, 500),
    params: payload.params || {},
    result: payload.result || null,
    error: clean(payload.error, 1000) || null,
    createdAt: clean(payload.createdAt, 80),
    startedAt: clean(payload.startedAt, 80) || null,
    doneAt: clean(payload.doneAt, 80) || null,
  };
}

function compactJobResult(result) {
  if (!result || typeof result !== "object") return result || null;
  return {
    ...result,
    results: Array.isArray(result.results)
      ? result.results.map(({ rawContent, ...opp }) => opp)
      : result.results,
    skipped: Array.isArray(result.skipped) ? result.skipped.slice(0, 50) : result.skipped,
  };
}

function qdrantVectorForOpportunity(opportunity = {}) {
  return hashVector([
    opportunity.title,
    opportunity.summary,
    opportunity.description,
    opportunity.eligibility,
    (opportunity.countries || []).join(" "),
    (opportunity.sectors || []).join(" "),
    opportunity.organization,
    opportunity.sourceUrl,
    opportunity.deadline,
  ].filter(Boolean).join(" "));
}

function hashVector(text) {
  const vector = new Array(VECTOR_SIZE).fill(0);
  const tokens = String(text || "").toLowerCase().split(/[^a-z0-9\u00c0-\u017f]+/i).filter((x) => x.length >= 2);
  for (const token of tokens) {
    const hash = crypto.createHash("sha256").update(token).digest();
    const idx = hash.readUInt16BE(0) % VECTOR_SIZE;
    const sign = hash[2] % 2 === 0 ? 1 : -1;
    vector[idx] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function isQdrantConfigured() {
  return Boolean(process.env.QDRANT_URL) && !qdrantDisabled;
}

function normalizeQdrantBaseUrl() {
  const raw = String(process.env.QDRANT_URL || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

async function readDb() {
  await initGrantsStorage();
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return normalizeDb(DEFAULT_DB);
  }
}

async function updateDb(mutator) {
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    const next = (await mutator(db)) || db;
    next.meta = {
      ...(next.meta || {}),
      createdAt: next.meta?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(normalizeDb(next), null, 2));
    return next;
  });
  return writeQueue;
}

function normalizeDb(db) {
  return {
    ...DEFAULT_DB,
    ...(db || {}),
    opportunities: Array.isArray(db?.opportunities) ? db.opportunities.map(refreshStatus) : [],
    sources: mergeDefaultSources(Array.isArray(db?.sources) ? db.sources : []),
    jobs: Array.isArray(db?.jobs) ? db.jobs : [],
    meta: db?.meta || DEFAULT_DB.meta,
  };
}

function mergeDefaultSources(current) {
  const map = new Map();
  for (const source of DEFAULT_GRANT_SOURCES.map(sourceRecord)) map.set(normalizeUrlKey(source.url), source);
  for (const source of current.map(sourceRecord)) map.set(normalizeUrlKey(source.url), source);
  return [...map.values()];
}

function sourceRecord(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || stableUuid(input.url || input.baseUrl || input.name),
    name: clean(input.name, 180),
    url: cleanUrl(input.url || input.baseUrl),
    baseUrl: cleanUrl(input.baseUrl || input.url),
    type: normalizeGrantType(input.type || input.category),
    category: normalizeGrantType(input.category || input.type),
    region: clean(input.region || "global", 120),
    preferredLanguage: clean(input.preferredLanguage || "en", 20),
    active: input.active !== false,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function refreshStatus(opp) {
  if (!opp?.deadline) return opp;
  const deadline = parseDate(opp.deadline);
  if (deadline && deadline < new Date() && opp.status === "open") {
    return { ...opp, status: "expired" };
  }
  return opp;
}

function statusRank(status) {
  if (status === "open") return 1;
  if (status === "unknown") return 2;
  if (status === "draft_review") return 3;
  if (status === "expired") return 4;
  return 5;
}

function normalizeUrlKey(url) {
  try {
    const u = new URL(String(url || ""));
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    return `${u.host}${u.pathname}${u.search}`.toLowerCase();
  } catch {
    return String(url || "").toLowerCase().trim();
  }
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function stableUuid(seed) {
  const hex = crypto.createHash("sha256").update(String(seed || crypto.randomUUID())).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
