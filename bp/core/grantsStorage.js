// bp/core/grantsStorage.js
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_GRANT_SOURCES, normalizeGrantStatus, normalizeGrantType } from "./grantsSources.js";
import { clean, cleanUrl, verifyOpportunity } from "./grantsVerifier.js";

const DATA_DIR = process.env.GRANTS_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.GRANTS_PROD_DB_PATH || path.join(DATA_DIR, "grants-prod-db.json");

const DEFAULT_DB = {
  version: 1,
  opportunities: [],
  sources: DEFAULT_GRANT_SOURCES.map(sourceRecord),
  jobs: [],
  meta: { createdAt: null, updatedAt: null },
};

let writeQueue = Promise.resolve();
let pgPoolPromise;
let pgUnavailableWarned = false;

export async function initGrantsStorage() {
  const pg = await getPgPool();
  if (pg) {
    await initPgSchema(pg);
    await seedDefaultPgSources(pg);
    return;
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
  const pg = await getPgPool();
  if (pg) return pgListOpportunities(pg, filters);

  const db = await readDb();
  const q = clean(filters.q, 200).toLowerCase();
  const type = clean(filters.type, 80);
  const country = clean(filters.country, 100).toLowerCase();
  const region = clean(filters.region, 100).toLowerCase();
  const sector = clean(filters.sector, 100).toLowerCase();
  const status = clean(filters.status, 60);
  const source = clean(filters.source, 180).toLowerCase();
  const deadlineFrom = parseDate(filters.deadlineFrom);
  const deadlineTo = parseDate(filters.deadlineTo);
  const limit = clampInt(filters.limit, 1, 100, 30);
  const offset = clampInt(filters.offset, 0, 10000, 0);

  const rows = db.opportunities
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

  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

export async function getOpportunity(id) {
  const pg = await getPgPool();
  if (pg) return pgGetOpportunity(pg, id);

  const db = await readDb();
  return db.opportunities.find((opp) => opp.id === id) || null;
}

export async function saveOpportunity(input = {}) {
  const pg = await getPgPool();
  if (pg) return pgSaveOpportunity(pg, input);

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
  const pg = await getPgPool();
  if (pg) return pgListSources(pg);

  const db = await readDb();
  return db.sources;
}

export async function addSource(input = {}) {
  const pg = await getPgPool();
  if (pg) return pgAddSource(pg, input);

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
  const pg = await getPgPool();
  if (pg) return pgUpdateOpportunityStatus(pg, id, status);

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
  const pg = await getPgPool();
  if (pg) return pgCreateJob(pg, { query, params });

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
  const pg = await getPgPool();
  if (pg) return pgPatchJob(pg, id, patch);

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
  const pg = await getPgPool();
  if (pg) return pgGetJob(pg, id);

  const db = await readDb();
  return db.jobs.find((job) => job.id === id) || null;
}

async function getPgPool() {
  if (!process.env.DATABASE_URL) return null;
  if (pgPoolPromise !== undefined) return pgPoolPromise;

  pgPoolPromise = (async () => {
    try {
      const { Pool } = await import("pg");
      return new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: shouldUsePgSsl() ? { rejectUnauthorized: false } : undefined,
        max: 6,
        idleTimeoutMillis: 30000,
      });
    } catch (e) {
      if (!pgUnavailableWarned) {
        pgUnavailableWarned = true;
        console.warn("[GRANTS] PostgreSQL disabled; install package 'pg' to use DATABASE_URL.", String(e?.message || e));
      }
      return null;
    }
  })();

  return pgPoolPromise;
}

function shouldUsePgSsl() {
  if (String(process.env.PGSSLMODE || "").toLowerCase() === "disable") return false;
  return !/localhost|127\.0\.0\.1/i.test(process.env.DATABASE_URL || "");
}

async function initPgSchema(pg) {
  await pg.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS opportunities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      organization TEXT,
      type TEXT,
      summary TEXT,
      description TEXT,
      eligibility TEXT,
      countries JSONB DEFAULT '[]'::jsonb,
      region TEXT,
      sectors JSONB DEFAULT '[]'::jsonb,
      amount TEXT,
      currency TEXT,
      deadline TIMESTAMPTZ,
      deadline_text TEXT,
      application_url TEXT,
      source_url TEXT NOT NULL UNIQUE,
      source_name TEXT,
      language TEXT,
      status TEXT NOT NULL DEFAULT 'draft_review',
      reliability_score INT DEFAULT 0,
      verification_notes TEXT,
      raw_content TEXT,
      extracted_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT opportunities_status_check CHECK (status IN ('open', 'expired', 'unknown', 'draft_review', 'hidden')),
      CONSTRAINT opportunities_type_check CHECK (type IS NULL OR type IN ('grant', 'scholarship', 'call_for_projects', 'competition', 'accelerator', 'fellowship', 'ngo_funding', 'other')),
      CONSTRAINT opportunities_reliability_score_check CHECK (reliability_score BETWEEN 0 AND 100)
    );

    CREATE INDEX IF NOT EXISTS opportunities_status_idx ON opportunities (status);
    CREATE INDEX IF NOT EXISTS opportunities_type_idx ON opportunities (type);
    CREATE INDEX IF NOT EXISTS opportunities_deadline_idx ON opportunities (deadline);
    CREATE INDEX IF NOT EXISTS opportunities_source_name_idx ON opportunities (source_name);
    CREATE INDEX IF NOT EXISTS opportunities_countries_gin_idx ON opportunities USING gin (countries);
    CREATE INDEX IF NOT EXISTS opportunities_sectors_gin_idx ON opportunities USING gin (sectors);

    CREATE TABLE IF NOT EXISTS grant_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      type TEXT,
      region TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT grant_sources_type_check CHECK (type IS NULL OR type IN ('grant', 'scholarship', 'call_for_projects', 'competition', 'accelerator', 'fellowship', 'ngo_funding', 'other'))
    );

    CREATE INDEX IF NOT EXISTS grant_sources_active_idx ON grant_sources (active);

    CREATE TABLE IF NOT EXISTS grant_search_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'queued',
      query TEXT,
      params JSONB DEFAULT '{}'::jsonb,
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      started_at TIMESTAMPTZ,
      done_at TIMESTAMPTZ,
      CONSTRAINT grant_search_jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'error'))
    );

    CREATE INDEX IF NOT EXISTS grant_search_jobs_status_idx ON grant_search_jobs (status);
    CREATE INDEX IF NOT EXISTS grant_search_jobs_created_at_idx ON grant_search_jobs (created_at DESC);
  `);
}

async function seedDefaultPgSources(pg) {
  for (const source of DEFAULT_GRANT_SOURCES.map(sourceRecord)) {
    await pg.query(
      `INSERT INTO grant_sources (id, name, url, type, region, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (url) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         region = EXCLUDED.region,
         active = grant_sources.active,
         updated_at = now()`,
      [source.id, source.name, source.url, source.type, source.region, source.active, source.createdAt, source.updatedAt]
    );
  }
}

async function pgListOpportunities(pg, filters = {}) {
  await pg.query("UPDATE opportunities SET status = 'expired', updated_at = now() WHERE status = 'open' AND deadline IS NOT NULL AND deadline < now()");

  const where = [];
  const values = [];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const q = clean(filters.q, 200).toLowerCase();
  const type = clean(filters.type, 80);
  const country = clean(filters.country, 100).toLowerCase();
  const region = clean(filters.region, 100).toLowerCase();
  const sector = clean(filters.sector, 100).toLowerCase();
  const status = clean(filters.status, 60);
  const source = clean(filters.source, 180).toLowerCase();
  const deadlineFrom = parseDate(filters.deadlineFrom);
  const deadlineTo = parseDate(filters.deadlineTo);
  const limit = clampInt(filters.limit, 1, 100, 30);
  const offset = clampInt(filters.offset, 0, 10000, 0);

  if (q) {
    const p = add(`%${q}%`);
    where.push(`lower(concat_ws(' ', title, organization, summary, description, eligibility, source_name)) LIKE ${p}`);
  }
  if (type) where.push(`type = ${add(normalizeGrantType(type))}`);
  if (country) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(countries) c WHERE lower(c) LIKE ${add(`%${country}%`)})`);
  if (region) where.push(`lower(coalesce(region, '')) LIKE ${add(`%${region}%`)}`);
  if (sector) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(sectors) s WHERE lower(s) LIKE ${add(`%${sector}%`)})`);
  if (status) where.push(`status = ${add(normalizeGrantStatus(status))}`);
  if (source) where.push(`lower(coalesce(source_name, '')) LIKE ${add(`%${source}%`)}`);
  if (deadlineFrom) where.push(`deadline >= ${add(deadlineFrom.toISOString())}`);
  if (deadlineTo) where.push(`deadline <= ${add(endOfDay(deadlineTo).toISOString())}`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await pg.query(`SELECT count(*)::int AS total FROM opportunities ${whereSql}`, values);
  const rows = await pg.query(
    `SELECT * FROM opportunities
     ${whereSql}
     ORDER BY CASE status
       WHEN 'open' THEN 1
       WHEN 'unknown' THEN 2
       WHEN 'draft_review' THEN 3
       WHEN 'expired' THEN 4
       ELSE 5
     END, reliability_score DESC NULLS LAST, updated_at DESC
     LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    values
  );

  return { rows: rows.rows.map(opportunityFromPg), total: count.rows[0]?.total || 0, limit, offset };
}

async function pgGetOpportunity(pg, id) {
  if (!isUuid(id)) return null;
  const rows = await pg.query("SELECT * FROM opportunities WHERE id = $1", [id]);
  return rows.rows[0] ? opportunityFromPg(rows.rows[0]) : null;
}

async function pgSaveOpportunity(pg, input = {}) {
  const verified = verifyOpportunity(input);
  if (!verified.sourceUrl) return { saved: null, skipped: true, reason: "SOURCE_URL_REQUIRED" };

  const values = [
    verified.id,
    verified.title,
    verified.organization,
    verified.type,
    verified.summary,
    verified.description,
    verified.eligibility,
    JSON.stringify(verified.countries || []),
    verified.region,
    JSON.stringify(verified.sectors || []),
    verified.amount,
    verified.currency,
    verified.deadline,
    verified.deadlineText,
    verified.applicationUrl,
    verified.sourceUrl,
    verified.sourceName,
    verified.language,
    verified.status,
    verified.reliabilityScore,
    verified.verificationNotes,
    verified.rawContent,
    verified.extractedAt,
    verified.lastCheckedAt,
    verified.createdAt,
    verified.updatedAt,
  ];

  const rows = await pg.query(
    `INSERT INTO opportunities (
      id, title, organization, type, summary, description, eligibility, countries, region, sectors,
      amount, currency, deadline, deadline_text, application_url, source_url, source_name, language,
      status, reliability_score, verification_notes, raw_content, extracted_at, last_checked_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb,
      $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26
    )
    ON CONFLICT (source_url) DO UPDATE SET
      title = EXCLUDED.title,
      organization = EXCLUDED.organization,
      type = EXCLUDED.type,
      summary = EXCLUDED.summary,
      description = EXCLUDED.description,
      eligibility = EXCLUDED.eligibility,
      countries = EXCLUDED.countries,
      region = EXCLUDED.region,
      sectors = EXCLUDED.sectors,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      deadline = EXCLUDED.deadline,
      deadline_text = EXCLUDED.deadline_text,
      application_url = EXCLUDED.application_url,
      source_name = EXCLUDED.source_name,
      language = EXCLUDED.language,
      status = EXCLUDED.status,
      reliability_score = EXCLUDED.reliability_score,
      verification_notes = EXCLUDED.verification_notes,
      raw_content = EXCLUDED.raw_content,
      extracted_at = EXCLUDED.extracted_at,
      last_checked_at = EXCLUDED.last_checked_at,
      updated_at = now()
    RETURNING *`,
    values
  );

  return { saved: opportunityFromPg(rows.rows[0]), skipped: false };
}

async function pgListSources(pg) {
  const rows = await pg.query("SELECT * FROM grant_sources ORDER BY name ASC");
  return rows.rows.map(sourceFromPg);
}

async function pgAddSource(pg, input = {}) {
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

  const rows = await pg.query(
    `INSERT INTO grant_sources (id, name, url, type, region, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (url) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       region = EXCLUDED.region,
       active = EXCLUDED.active,
       updated_at = now()
     RETURNING *`,
    [record.id, record.name, record.url, record.type, record.region, record.active]
  );
  return sourceFromPg(rows.rows[0]);
}

async function pgUpdateOpportunityStatus(pg, id, status) {
  if (!isUuid(id)) return null;
  const rows = await pg.query(
    "UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, normalizeGrantStatus(status)]
  );
  return rows.rows[0] ? opportunityFromPg(rows.rows[0]) : null;
}

async function pgCreateJob(pg, { query, params }) {
  const id = crypto.randomUUID();
  const rows = await pg.query(
    `INSERT INTO grant_search_jobs (id, status, query, params, result, error, created_at)
     VALUES ($1, 'queued', $2, $3::jsonb, NULL, NULL, now())
     RETURNING *`,
    [id, clean(query, 500), JSON.stringify(params || {})]
  );
  return jobFromPg(rows.rows[0]);
}

async function pgPatchJob(pg, id, patch = {}) {
  if (!isUuid(id)) return null;
  const current = await pgGetJob(pg, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const rows = await pg.query(
    `UPDATE grant_search_jobs
     SET status = $2,
         query = $3,
         params = $4::jsonb,
         result = $5::jsonb,
         error = $6,
         started_at = $7,
         done_at = $8
     WHERE id = $1
     RETURNING *`,
    [
      id,
      next.status,
      next.query,
      JSON.stringify(next.params || {}),
      next.result ? JSON.stringify(next.result) : null,
      next.error || null,
      next.startedAt || null,
      next.doneAt || null,
    ]
  );
  return rows.rows[0] ? jobFromPg(rows.rows[0]) : null;
}

async function pgGetJob(pg, id) {
  if (!isUuid(id)) return null;
  const rows = await pg.query("SELECT * FROM grant_search_jobs WHERE id = $1", [id]);
  return rows.rows[0] ? jobFromPg(rows.rows[0]) : null;
}

function opportunityFromPg(row = {}) {
  return refreshStatus({
    id: row.id,
    title: row.title,
    organization: row.organization,
    type: row.type,
    summary: row.summary,
    description: row.description,
    eligibility: row.eligibility,
    countries: Array.isArray(row.countries) ? row.countries : [],
    region: row.region,
    sectors: Array.isArray(row.sectors) ? row.sectors : [],
    amount: row.amount,
    currency: row.currency,
    deadline: toIso(row.deadline),
    deadlineText: row.deadline_text,
    applicationUrl: row.application_url,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    language: row.language,
    status: row.status,
    reliabilityScore: row.reliability_score,
    verificationNotes: row.verification_notes,
    rawContent: row.raw_content,
    extractedAt: toIso(row.extracted_at),
    lastCheckedAt: toIso(row.last_checked_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function sourceFromPg(row = {}) {
  return sourceRecord({
    id: row.id,
    name: row.name,
    url: row.url,
    baseUrl: row.url,
    type: row.type,
    category: row.type,
    region: row.region,
    active: row.active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function jobFromPg(row = {}) {
  return {
    id: row.id,
    status: row.status,
    query: row.query,
    params: row.params || {},
    result: row.result || null,
    error: row.error || null,
    createdAt: toIso(row.created_at),
    startedAt: toIso(row.started_at),
    doneAt: toIso(row.done_at),
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
