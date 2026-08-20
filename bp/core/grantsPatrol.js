import { crawlConfiguredSources, searchAndIndexOpportunities } from "./grantsSearch.js";

const DEFAULT_INTERVAL_MINUTES = 360; // 6h
const DEFAULT_INITIAL_DELAY_MS = 45_000;

const PATROL_PRESETS = [
  {
    key: "entrepreneurs",
    label: "Opportunites entrepreneuriales",
    query: "opportunites entrepreneurs startups PME incubateurs accelerateurs concours Afrique francophone RDC deadline",
    types: ["accelerator", "competition", "grant"],
    sectors: ["entrepreneurship", "digital", "innovation"],
  },
  {
    key: "tenders",
    label: "Appels d'offres et marches",
    query: "appels d'offres marches publics procurement tenders RFP RFQ organisations internationales Afrique RDC deadline",
    types: ["tender"],
    sectors: ["procurement", "business", "services"],
  },
  {
    key: "scholarships",
    label: "Bourses et fellowships",
    query: "bourses scholarships fellowships formations master phd Afrique francophone RDC date limite candidature",
    types: ["scholarship", "fellowship"],
    sectors: ["education", "research", "training"],
  },
  {
    key: "ngo",
    label: "Financements ONG et appels a projets",
    query: "financements ONG appels a projets subventions civil society Afrique francophone RDC deadline",
    types: ["ngo_funding", "call_for_projects", "grant"],
    sectors: ["education", "health", "climate", "agriculture", "governance"],
  },
];

let timer = null;
let running = false;
let lastRun = null;

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nowIso() {
  return new Date().toISOString();
}

function nextRunAt(intervalMs) {
  return new Date(Date.now() + intervalMs).toISOString();
}

function compactError(error) {
  return String(error?.message || error || "UNKNOWN_ERROR").slice(0, 500);
}

export function getGrantsPatrolStatus() {
  const intervalMinutes = clampInt(process.env.GRANTS_PATROL_INTERVAL_MINUTES, 30, 24 * 60, DEFAULT_INTERVAL_MINUTES);
  return {
    ok: true,
    enabled: envBool("GRANTS_AUTO_PATROL_ENABLED", true),
    running,
    intervalMinutes,
    nextRunAt: timer ? nextRunAt(intervalMinutes * 60_000) : null,
    exaConfigured: Boolean(process.env.EXA_API_KEY),
    autoWebSearch: envBool("GRANTS_PATROL_WEB_SEARCH_ENABLED", Boolean(process.env.EXA_API_KEY)),
    lastRun,
    presets: PATROL_PRESETS.map(({ key, label }) => ({ key, label })),
  };
}

export function startGrantsPatrolScheduler() {
  if (!envBool("GRANTS_AUTO_PATROL_ENABLED", true)) {
    console.log("[GRANTS] auto patrol disabled");
    return;
  }

  if (timer) return;

  const intervalMinutes = clampInt(process.env.GRANTS_PATROL_INTERVAL_MINUTES, 30, 24 * 60, DEFAULT_INTERVAL_MINUTES);
  const intervalMs = intervalMinutes * 60_000;
  const initialDelayMs = clampInt(process.env.GRANTS_PATROL_INITIAL_DELAY_MS, 5_000, 15 * 60_000, DEFAULT_INITIAL_DELAY_MS);

  setTimeout(() => {
    runGrantsPatrol({ trigger: "startup" }).catch((error) => {
      console.error("[GRANTS] startup patrol failed", compactError(error));
    });
  }, initialDelayMs).unref?.();

  timer = setInterval(() => {
    runGrantsPatrol({ trigger: "interval" }).catch((error) => {
      console.error("[GRANTS] scheduled patrol failed", compactError(error));
    });
  }, intervalMs);
  timer.unref?.();

  console.log("[GRANTS] auto patrol scheduled", { intervalMinutes, initialDelayMs });
}

export async function runGrantsPatrol(options = {}) {
  if (running) {
    return {
      ok: true,
      accepted: false,
      status: "running",
      message: "Une patrouille Grant est deja en cours.",
      lastRun,
    };
  }

  running = true;
  const startedAt = nowIso();
  const trigger = String(options.trigger || "manual");
  const maxSources = clampInt(options.maxSources || process.env.GRANTS_PATROL_MAX_SOURCES, 1, 60, 35);
  const maxPerSource = clampInt(options.maxPerSource || process.env.GRANTS_PATROL_MAX_PER_SOURCE, 1, 8, 3);
  const webMaxResults = clampInt(options.webMaxResults || process.env.GRANTS_PATROL_WEB_MAX_RESULTS, 1, 12, 5);
  const webCandidateLimit = clampInt(options.webCandidateLimit || process.env.GRANTS_PATROL_WEB_CANDIDATE_LIMIT, 10, 80, 35);
  const maxWebPresets = clampInt(options.maxWebPresets || process.env.GRANTS_PATROL_WEB_PRESETS, 0, PATROL_PRESETS.length, PATROL_PRESETS.length);
  const useWebSearch = envBool("GRANTS_PATROL_WEB_SEARCH_ENABLED", Boolean(process.env.EXA_API_KEY)) && Boolean(process.env.EXA_API_KEY);

  const run = {
    trigger,
    status: "running",
    startedAt,
    doneAt: null,
    crawl: null,
    webSearches: [],
    totals: {
      saved: 0,
      candidates: 0,
      extracted: 0,
      skippedInactive: 0,
      errors: 0,
    },
  };
  lastRun = run;

  try {
    console.log("[GRANTS] patrol started", { trigger, maxSources, maxPerSource, useWebSearch });
    const crawl = await crawlConfiguredSources({
      query: "grant funding scholarship tender procurement accelerator call for proposals Afrique Africa RDC deadline open apply",
      maxSources,
      maxPerSource,
      language: "fr",
    });
    run.crawl = summarizeResult(crawl);
    addTotals(run.totals, crawl);

    if (useWebSearch) {
      for (const preset of PATROL_PRESETS.slice(0, maxWebPresets)) {
        try {
          const result = await searchAndIndexOpportunities({
            query: preset.query,
            region: "Africa",
            country: "RDC",
            sectors: preset.sectors,
            types: preset.types,
            language: "fr",
            maxResults: webMaxResults,
            candidateLimit: webCandidateLimit,
          });
          run.webSearches.push({ key: preset.key, label: preset.label, ...summarizeResult(result) });
          addTotals(run.totals, result);
        } catch (error) {
          run.totals.errors += 1;
          run.webSearches.push({ key: preset.key, label: preset.label, ok: false, error: compactError(error) });
          console.warn("[GRANTS] patrol web search failed", { preset: preset.key, error: compactError(error) });
        }
      }
    }

    run.status = "done";
    run.doneAt = nowIso();
    console.log("[GRANTS] patrol done", run.totals);
    return { ok: true, accepted: true, ...run };
  } catch (error) {
    run.status = "error";
    run.error = compactError(error);
    run.doneAt = nowIso();
    run.totals.errors += 1;
    console.error("[GRANTS] patrol error", run.error);
    return { ok: false, accepted: true, ...run };
  } finally {
    running = false;
  }
}

function summarizeResult(result = {}) {
  return {
    ok: true,
    total: Number(result.total || result.results?.length || 0),
    candidates: Number(result.candidates || 0),
    extracted: Number(result.extracted || 0),
    skippedInactive: Number(result.skippedInactive || 0),
    skipped: Array.isArray(result.skipped) ? result.skipped.length : Number(result.skipped || 0),
    sourceStatus: Array.isArray(result.sourceStatus) ? result.sourceStatus.slice(0, 30) : undefined,
    warning: result.warning || undefined,
  };
}

function addTotals(totals, result = {}) {
  totals.saved += Number(result.total || result.results?.length || 0);
  totals.candidates += Number(result.candidates || 0);
  totals.extracted += Number(result.extracted || 0);
  totals.skippedInactive += Number(result.skippedInactive || 0);
}
