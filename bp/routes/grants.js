// bp/routes/grants.js
import express from "express";
import { generateApplicationAdvice, matchOpportunityToUserProfile } from "../core/grantsAi.js";
import { crawlConfiguredSources } from "../core/grantsCrawler.js";
import { searchIndexedOpportunities } from "../core/grantsIndexer.js";
import { searchAndIndexOpportunities } from "../core/grantsSearch.js";
import {
  addSource,
  createJob,
  getJob,
  getOpportunity,
  initGrantsStorage,
  listOpportunities,
  listSources,
  patchJob,
  updateOpportunityStatus,
} from "../core/grantsStorage.js";
import { GRANT_STATUSES, GRANT_TYPES, normalizeGrantStatus } from "../core/grantsSources.js";

const router = express.Router();

router.use(async (_req, _res, next) => {
  try {
    await initGrantsStorage();
    next();
  } catch (e) {
    next(e);
  }
});

router.get("/health", (_req, res) => {
  res.json({ ok: true, module: "grants", message: "Grants module operational" });
});

router.get("/opportunities", async (req, res, next) => {
  try {
    const data = await listOpportunities(req.query);
    if (req.query.status) return res.json({ ok: true, ...data });
    const rows = data.rows.filter(isCurrentOpportunity);
    res.json({ ok: true, ...data, rows, total: rows.length });
  } catch (e) {
    next(e);
  }
});

router.get("/opportunities/semantic", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = clampInt(req.query.limit, 1, 50, 12);
    if (!q) return res.status(400).json({ ok: false, error: "QUERY_REQUIRED" });

    const semantic = await searchIndexedOpportunities(q, { limit });
    if (!semantic.ok) {
      const fallback = await listOpportunities({ ...req.query, limit });
      fallback.rows = fallback.rows.filter(isCurrentOpportunity);
      fallback.total = fallback.rows.length;
      return res.json({ ok: true, semantic: false, reason: semantic.reason || semantic.error || "QDRANT_NOT_AVAILABLE", ...fallback });
    }

    const rows = [];
    for (const hit of semantic.results || []) {
      const id = hit?.payload?.id;
      const opportunity = id ? await getOpportunity(id) : null;
      if (isCurrentOpportunity(opportunity)) {
        rows.push({ ...opportunity, semanticScore: hit.score });
      }
    }
    res.json({ ok: true, semantic: true, rows, total: rows.length, limit, offset: 0 });
  } catch (e) {
    next(e);
  }
});

router.get("/opportunities/:id", async (req, res, next) => {
  try {
    const opportunity = await getOpportunity(req.params.id);
    if (!opportunity) return res.status(404).json({ ok: false, error: "OPPORTUNITY_NOT_FOUND" });
    res.json({ ok: true, opportunity });
  } catch (e) {
    next(e);
  }
});

router.patch("/opportunities/:id/status", async (req, res, next) => {
  try {
    const requested = String(req.body?.status || "").trim().toLowerCase();
    if (!GRANT_STATUSES.includes(requested)) {
      return res.status(400).json({ ok: false, error: "INVALID_STATUS", allowed: GRANT_STATUSES });
    }
    const status = normalizeGrantStatus(requested);
    const opportunity = await updateOpportunityStatus(req.params.id, status);
    if (!opportunity) return res.status(404).json({ ok: false, error: "OPPORTUNITY_NOT_FOUND" });
    res.json({ ok: true, opportunity });
  } catch (e) {
    next(e);
  }
});

router.post("/opportunities/:id/advice", async (req, res, next) => {
  try {
    const opportunity = await getOpportunity(req.params.id);
    if (!opportunity) return res.status(404).json({ ok: false, error: "OPPORTUNITY_NOT_FOUND" });
    const advice = await generateApplicationAdvice({ opportunity, userContext: req.body?.userContext || req.body || {} });
    res.json({ ok: true, advice });
  } catch (e) {
    next(e);
  }
});

router.post("/opportunities/:id/match", async (req, res, next) => {
  try {
    const opportunity = await getOpportunity(req.params.id);
    if (!opportunity) return res.status(404).json({ ok: false, error: "OPPORTUNITY_NOT_FOUND" });
    const match = await matchOpportunityToUserProfile({ opportunity, userProfile: req.body?.userProfile || req.body || {} });
    res.json({ ok: true, match });
  } catch (e) {
    next(e);
  }
});

router.post("/search", async (req, res, next) => {
  try {
    const params = normalizeSearchBody(req.body || {});
    if (!params.query) return res.status(400).json({ ok: false, error: "QUERY_REQUIRED" });

    const job = await createJob({ query: params.query, params });
    runJob(job.id, () => searchAndIndexOpportunities(params));
    res.status(202).json({ ok: true, jobId: job.id, status: "queued" });
  } catch (e) {
    next(e);
  }
});

router.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });
    res.json({ ok: true, job });
  } catch (e) {
    next(e);
  }
});

router.get("/jobs/:id/result", async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });
    if (job.status !== "done") {
      return res.status(202).json({ ok: true, jobId: job.id, status: job.status, result: null, error: job.error || null });
    }
    const opportunities = (job.result?.results || []).filter(isCurrentOpportunity);
    res.json({ ok: true, jobId: job.id, status: job.status, result: { ...(job.result || {}), results: opportunities, total: opportunities.length }, opportunities });
  } catch (e) {
    next(e);
  }
});

router.post("/crawl", async (req, res, next) => {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected) return res.status(503).json({ ok: false, error: "CRON_SECRET_NOT_CONFIGURED" });
    if (!hasValidCronSecret(req, expected)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const params = {
      maxSources: clampInt(req.body?.maxSources, 1, 40, 20),
      maxPerSource: clampInt(req.body?.maxPerSource, 1, 8, 3),
      query: req.body?.query || "grant funding scholarship call for proposals Africa francophone",
      sectors: normalizeList(req.body?.sectors),
      types: normalizeList(req.body?.types),
      region: req.body?.region,
      country: req.body?.country,
      language: req.body?.language || "fr",
    };

    const job = await createJob({ query: params.query, params: { ...params, mode: "crawl" } });
    runJob(job.id, () => crawlConfiguredSources(params));
    res.status(202).json({ ok: true, jobId: job.id, status: "queued" });
  } catch (e) {
    next(e);
  }
});

router.get("/sources", async (_req, res, next) => {
  try {
    const sources = await listSources();
    res.json({ ok: true, sources, total: sources.length });
  } catch (e) {
    next(e);
  }
});

router.post("/sources", async (req, res, next) => {
  try {
    const source = await addSource(req.body || {});
    res.status(201).json({ ok: true, source });
  } catch (e) {
    if (String(e?.message || e) === "SOURCE_NAME_AND_URL_REQUIRED") {
      return res.status(400).json({ ok: false, error: "SOURCE_NAME_AND_URL_REQUIRED" });
    }
    next(e);
  }
});

router.get("/meta", (_req, res) => {
  res.json({ ok: true, types: GRANT_TYPES, statuses: GRANT_STATUSES });
});

function runJob(jobId, worker) {
  setImmediate(async () => {
    const startedAt = new Date().toISOString();
    await patchJob(jobId, { status: "running", startedAt, error: null });
    try {
      const result = await worker();
      await patchJob(jobId, { status: "done", result, doneAt: new Date().toISOString() });
    } catch (e) {
      console.error("[GRANTS] error", { jobId, error: String(e?.message || e) });
      await patchJob(jobId, { status: "error", error: String(e?.message || e), doneAt: new Date().toISOString() });
    }
  });
}

function normalizeSearchBody(body = {}) {
  return {
    query: String(body.query || "").trim().slice(0, 500),
    country: cleanText(body.country, 120),
    region: cleanText(body.region, 120),
    sectors: normalizeList(body.sectors || body.sector),
    types: normalizeList(body.types || body.type),
    language: cleanText(body.language || "fr", 20),
    maxResults: clampInt(body.maxResults, 1, 25, 12),
    sites: normalizeSites(body.sites || body.customSites || body.sourceUrls || body.sources),
  };
}

function hasValidCronSecret(req, expected) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const candidates = [
    req.headers["x-cron-secret"],
    req.headers["x-grants-secret"],
    bearer,
    req.query?.secret,
    req.body?.secret,
  ].map((v) => String(v || ""));
  return candidates.some((value) => value && value === expected);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((v) => cleanText(v, 120)).filter(Boolean).slice(0, 20);
  return String(value || "")
    .split(/[,;|]/)
    .map((v) => cleanText(v, 120))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeSites(value) {
  if (Array.isArray(value)) return value.slice(0, 30);
  return String(value || "")
    .split(/\r?\n/)
    .map((v) => cleanText(v, 900))
    .filter(Boolean)
    .slice(0, 30);
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isCurrentOpportunity(opportunity = {}) {
  if (opportunity.status === "expired" || opportunity.status === "hidden") return false;
  if (!opportunity.deadline) return true;
  const deadline = new Date(opportunity.deadline);
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() >= Date.now();
}

export default router;
