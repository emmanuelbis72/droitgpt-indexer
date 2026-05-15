// bp/core/grantsDb.js
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalOpportunityKey, classifyOpportunityType, getOpportunityFreshness } from "./grantsDiscovery.js";

const DATA_DIR = process.env.GRANTS_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.GRANTS_DB_PATH || path.join(DATA_DIR, "grants-db.json");

const DEFAULT_DB = {
  version: 1,
  opportunities: [],
  watchConfigs: [],
  companyProfile: null,
  applications: [],
  runs: [],
  alerts: [],
  meta: { createdAt: null, updatedAt: null },
};

let writeQueue = Promise.resolve();

export async function initGrantsDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    const now = new Date().toISOString();
    await fs.writeFile(DB_PATH, JSON.stringify({ ...DEFAULT_DB, meta: { createdAt: now, updatedAt: now } }, null, 2));
  }
}

export async function readGrantsDb() {
  await initGrantsDb();
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    const db = JSON.parse(raw);
    return normalizeDb(db);
  } catch {
    return normalizeDb(DEFAULT_DB);
  }
}

export async function updateGrantsDb(mutator) {
  writeQueue = writeQueue.then(async () => {
    const db = await readGrantsDb();
    const next = (await mutator(db)) || db;
    next.meta = {
      ...(next.meta || {}),
      updatedAt: new Date().toISOString(),
      createdAt: next.meta?.createdAt || new Date().toISOString(),
    };
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(normalizeDb(next), null, 2));
    return normalizeDb(next);
  });
  return writeQueue;
}

export async function upsertOpportunities(opportunities = [], options = {}) {
  const now = new Date().toISOString();
  const enriched = Boolean(options.enriched);
  let inserted = 0;
  let updated = 0;

  const db = await updateGrantsDb((cur) => {
    for (const raw of opportunities || []) {
      const fingerprint = canonicalOpportunityKey(raw);
      const existingIndex = cur.opportunities.findIndex(
        (x) => x.fingerprint === fingerprint || x.id === raw.id || areDbDuplicates(x, raw)
      );
      const base = normalizeOpportunityRecord(raw, { now, fingerprint });
      if (existingIndex >= 0) {
        const existing = cur.opportunities[existingIndex];
        cur.opportunities[existingIndex] = {
          ...existing,
          ...base,
          id: existing.id,
          fingerprint: existing.fingerprint || fingerprint,
          aliases: mergeAliases(existing.aliases, raw.aliases, raw),
          firstSeenAt: existing.firstSeenAt || now,
          lastSeenAt: now,
          user: existing.user || defaultUserState(),
          enrichment: enriched ? raw.enrichment || existing.enrichment || null : existing.enrichment || raw.enrichment || null,
          raw: raw.raw || existing.raw || null,
        };
        updated += 1;
      } else {
        cur.opportunities.push({
          ...base,
          id: raw.id || `grant_${crypto.randomUUID()}`,
          fingerprint,
          firstSeenAt: now,
          lastSeenAt: now,
          user: defaultUserState(),
          enrichment: raw.enrichment || null,
        });
        inserted += 1;
      }
    }
    return cur;
  });

  return { db, inserted, updated };
}

export async function listOpportunities(filters = {}) {
  const db = await readGrantsDb();
  const q = String(filters.q || "").toLowerCase().trim();
  const source = String(filters.source || "").toLowerCase().trim();
  const status = String(filters.status || "").toLowerCase().trim();
  const favorite = filters.favorite === "1" || filters.favorite === true;
  const userStatus = String(filters.userStatus || "").toLowerCase().trim();
  const opportunityType = String(filters.opportunityType || filters.type || "").toLowerCase().trim();
  const onlyActive = filters.onlyActive !== "0" && filters.onlyActive !== false;
  const includeSearchLinks = filters.includeSearchLinks === "1" || filters.includeSearchLinks === true;
  const limit = clampInt(filters.limit, 1, 200, 100);

  const rows = db.opportunities
    .map(decorateOpportunityRecord)
    .filter((opp) => {
      if (q) {
        const hay = [opp.title, opp.donor, opp.description, opp.category, opp.enrichment?.summaryText]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (source && String(opp.source || "").toLowerCase() !== source) return false;
      if (status && String(opp.status || "").toLowerCase() !== status) return false;
      if (favorite && !opp.user?.favorite) return false;
      if (userStatus && String(opp.user?.status || "").toLowerCase() !== userStatus) return false;
      if (opportunityType && opp.opportunityType !== opportunityType) return false;
      if (!includeSearchLinks && String(opp.status || "") === "search_link") return false;
      if (onlyActive && !opp.freshness?.active) return false;
      return true;
    })
    .sort((a, b) => {
      const as = Number(a.match?.score || 0);
      const bs = Number(b.match?.score || 0);
      if (bs !== as) return bs - as;
      return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
    })
    .slice(0, limit);

  return { rows, total: rows.length, dbTotal: db.opportunities.length };
}

export async function getOpportunity(id) {
  const db = await readGrantsDb();
  return db.opportunities.find((x) => x.id === id || x.fingerprint === id) || null;
}

export async function updateOpportunityUserState(id, patch = {}) {
  let updated = null;
  await updateGrantsDb((db) => {
    const idx = db.opportunities.findIndex((x) => x.id === id || x.fingerprint === id);
    if (idx < 0) return db;
    const existing = db.opportunities[idx];
    db.opportunities[idx] = {
      ...existing,
      user: {
        ...defaultUserState(),
        ...(existing.user || {}),
        ...sanitizeUserPatch(patch),
        updatedAt: new Date().toISOString(),
      },
    };
    updated = db.opportunities[idx];
    return db;
  });
  return updated;
}

export async function saveWatchConfig(input = {}) {
  const now = new Date().toISOString();
  const id = input.id || `watch_${crypto.randomUUID()}`;
  let saved = null;
  await updateGrantsDb((db) => {
    const idx = db.watchConfigs.findIndex((x) => x.id === id);
    const record = {
      id,
      name: String(input.name || "Grant watch").trim().slice(0, 120),
      enabled: input.enabled !== false,
      intervalHours: clampInt(input.intervalHours, 1, 24 * 14, 24),
      query: input.query || {},
      alerts: {
        email: Boolean(input.alerts?.email),
        emailTo: String(input.alerts?.emailTo || "").trim().slice(0, 240),
        slack: Boolean(input.alerts?.slack),
        whatsapp: Boolean(input.alerts?.whatsapp),
      },
      createdAt: idx >= 0 ? db.watchConfigs[idx].createdAt : now,
      updatedAt: now,
      lastRunAt: idx >= 0 ? db.watchConfigs[idx].lastRunAt || null : null,
      nextRunAt: computeNextRunAt(now, input.intervalHours),
    };
    if (idx >= 0) db.watchConfigs[idx] = { ...db.watchConfigs[idx], ...record };
    else db.watchConfigs.push(record);
    saved = record;
    return db;
  });
  return saved;
}

export async function listWatchConfigs() {
  const db = await readGrantsDb();
  return db.watchConfigs;
}

export async function markWatchRun(configId, run = {}) {
  await updateGrantsDb((db) => {
    const now = new Date().toISOString();
    const idx = db.watchConfigs.findIndex((x) => x.id === configId);
    if (idx >= 0) {
      db.watchConfigs[idx].lastRunAt = now;
      db.watchConfigs[idx].nextRunAt = computeNextRunAt(now, db.watchConfigs[idx].intervalHours);
    }
    db.runs.unshift({
      id: `run_${crypto.randomUUID()}`,
      configId,
      at: now,
      ...run,
    });
    db.runs = db.runs.slice(0, 200);
    return db;
  });
}

export async function recordAlert(alert = {}) {
  await updateGrantsDb((db) => {
    db.alerts.unshift({
      id: `alert_${crypto.randomUUID()}`,
      at: new Date().toISOString(),
      ...alert,
    });
    db.alerts = db.alerts.slice(0, 300);
    return db;
  });
}

export function computeNextRunAt(fromIso, intervalHours = 24) {
  const from = new Date(fromIso || Date.now());
  from.setHours(from.getHours() + clampInt(intervalHours, 1, 24 * 14, 24));
  return from.toISOString();
}

function normalizeDb(db) {
  return {
    ...DEFAULT_DB,
    ...(db || {}),
    opportunities: Array.isArray(db?.opportunities) ? db.opportunities : [],
    watchConfigs: Array.isArray(db?.watchConfigs) ? db.watchConfigs : [],
    companyProfile: db?.companyProfile || null,
    applications: Array.isArray(db?.applications) ? db.applications : [],
    runs: Array.isArray(db?.runs) ? db.runs : [],
    alerts: Array.isArray(db?.alerts) ? db.alerts : [],
    meta: db?.meta || DEFAULT_DB.meta,
  };
}

export async function getCompanyProfile() {
  const db = await readGrantsDb();
  return db.companyProfile || defaultCompanyProfile();
}

export async function saveCompanyProfile(profile = {}) {
  const now = new Date().toISOString();
  let saved = null;
  await updateGrantsDb((db) => {
    saved = {
      ...defaultCompanyProfile(),
      ...(db.companyProfile || {}),
      ...sanitizeCompanyProfile(profile),
      updatedAt: now,
      createdAt: db.companyProfile?.createdAt || now,
    };
    db.companyProfile = saved;
    return db;
  });
  return saved;
}

export async function saveApplicationDraft({ opportunityId, questions = [], answers = [], meta = {} }) {
  const now = new Date().toISOString();
  let saved = null;
  await updateGrantsDb((db) => {
    const id = `app_${crypto.randomUUID()}`;
    saved = {
      id,
      opportunityId,
      questions,
      answers,
      meta,
      createdAt: now,
      updatedAt: now,
    };
    db.applications.unshift(saved);
    db.applications = db.applications.slice(0, 200);
    return db;
  });
  return saved;
}

function decorateOpportunityRecord(opp = {}) {
  const opportunityType = opp.opportunityType || classifyOpportunityType(opp);
  return {
    ...opp,
    opportunityType,
    audienceCategory: opp.audienceCategory || opportunityType,
    categoryLabel: opp.categoryLabel || labelForOpportunityType(opportunityType),
    freshness: getOpportunityFreshness(opp),
  };
}

function normalizeOpportunityRecord(raw, { now, fingerprint }) {
  return {
    id: raw.id || `grant_${crypto.randomUUID()}`,
    fingerprint,
    source: raw.source || "",
    title: raw.title || "Untitled opportunity",
    donor: raw.donor || "",
    opportunityNumber: raw.opportunityNumber || "",
    status: raw.status || "",
    postedDate: raw.postedDate || "",
    closeDate: raw.closeDate || "",
    category: raw.category || "",
    eligibility: raw.eligibility || "",
    description: raw.description || "",
    url: raw.url || "",
    opportunityType: raw.opportunityType || classifyOpportunityType(raw),
    audienceCategory: raw.audienceCategory || raw.opportunityType || classifyOpportunityType(raw),
    categoryLabel: raw.categoryLabel || labelForOpportunityType(raw.opportunityType || classifyOpportunityType(raw)),
    freshness: raw.freshness || getOpportunityFreshness(raw),
    match: raw.match || { score: 0, reasons: [] },
    language: raw.language || raw.enrichment?.language || "unknown",
    lastSeenAt: now,
    raw: raw.raw || null,
  };
}

function labelForOpportunityType(type) {
  if (type === "scholarship") return "Bourses";
  if (type === "entrepreneur") return "Entrepreneurs";
  return "ONG / appels a projets";
}

function defaultUserState() {
  return {
    favorite: false,
    status: "a_analyser",
    notes: "",
    updatedAt: null,
  };
}

function defaultCompanyProfile() {
  return {
    name: "",
    legalStatus: "",
    country: "",
    city: "",
    registrationNumber: "",
    yearFounded: "",
    website: "",
    contactName: "",
    contactEmail: "",
    phone: "",
    mission: "",
    sectors: "",
    targetGroups: "",
    geographicFocus: "",
    pastProjects: "",
    team: "",
    partners: "",
    annualBudget: "",
    financialSystems: "",
    safeguarding: "",
    monitoringEvaluation: "",
    impactEvidence: "",
    bankInfo: "",
    documentsReady: "",
    languagePreference: "fr",
    createdAt: null,
    updatedAt: null,
  };
}

function sanitizeCompanyProfile(profile) {
  const base = defaultCompanyProfile();
  const out = {};
  for (const key of Object.keys(base)) {
    if (key === "createdAt" || key === "updatedAt") continue;
    out[key] = String(profile?.[key] ?? "").trim().slice(0, 6000);
  }
  out.languagePreference = ["fr", "en"].includes(out.languagePreference) ? out.languagePreference : "fr";
  return out;
}

function sanitizeUserPatch(patch) {
  const allowedStatuses = new Set(["a_analyser", "candidat", "rejete", "soumis", "archive"]);
  const out = {};
  if ("favorite" in patch) out.favorite = Boolean(patch.favorite);
  if ("status" in patch) {
    const s = String(patch.status || "").toLowerCase().trim();
    if (allowedStatuses.has(s)) out.status = s;
  }
  if ("notes" in patch) out.notes = String(patch.notes || "").slice(0, 2000);
  return out;
}

function areDbDuplicates(existing = {}, incoming = {}) {
  const existingNumber = comparable(existing.opportunityNumber);
  const incomingNumber = comparable(incoming.opportunityNumber);
  if (existingNumber && incomingNumber && existingNumber === incomingNumber) return true;

  const existingUrl = urlKey(existing.url);
  const incomingUrl = urlKey(incoming.url);
  if (existingUrl && incomingUrl && existingUrl === incomingUrl) return true;

  const existingTitle = comparableTitle(existing.title);
  const incomingTitle = comparableTitle(incoming.title);
  if (!existingTitle || !incomingTitle) return false;

  const titleSim = jaccard(existingTitle, incomingTitle);
  const sameDeadline =
    comparable(existing.closeDate) &&
    comparable(incoming.closeDate) &&
    comparable(existing.closeDate) === comparable(incoming.closeDate);
  const donorSim = jaccard(comparableTitle(existing.donor), comparableTitle(incoming.donor));

  return titleSim >= 0.9 || (titleSim >= 0.78 && sameDeadline) || (titleSim >= 0.82 && donorSim >= 0.6);
}

function mergeAliases(existingAliases, incomingAliases, raw) {
  const aliases = Array.isArray(existingAliases) ? [...existingAliases] : [];
  const incoming = Array.isArray(incomingAliases) ? incomingAliases : [];
  for (const alias of [
    ...incoming,
    { id: raw.id, source: raw.source, url: raw.url, title: raw.title, donor: raw.donor },
  ]) {
    const key = `${alias?.source || ""}|${alias?.id || ""}|${alias?.url || ""}`;
    if (!aliases.some((x) => `${x?.source || ""}|${x?.id || ""}|${x?.url || ""}` === key)) aliases.push(alias);
  }
  return aliases.slice(0, 20);
}

function comparable(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function comparableTitle(text) {
  return comparable(text)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\u017f]+/gi, " ")
    .replace(/\b(the|and|for|with|from|grant|grants|funding|programme|program|call|opportunity|project|le|la|les|des|pour|avec|appel|projet|subvention)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function urlKey(url) {
  try {
    const u = new URL(String(url || ""));
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    return `${u.host}${u.pathname}${u.search}`.toLowerCase();
  } catch {
    return comparable(url);
  }
}

function jaccard(a, b) {
  const aa = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const bb = new Set(String(b || "").split(/\s+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
