// src/justiceLab/storage.js
// V5 ULTRA PRO (prod) : runs/stats + activeRunId + helpers session + guard localStorage
// Compatible JusticeLabPlay / Dashboard / Results / Journal / Audience / Appeal

const KEY_RUNS = "justiceLabRuns";
const KEY_STATS = "justiceLabStats";
const KEY_ACTIVE_RUN_ID = "justiceLabActiveRunId";
const MAX_RUNS = 60;

// fallback mémoire si localStorage indisponible
let MEM_RUNS = [];
let MEM_STATS = {};
let MEM_ACTIVE = "";

function lsAvailable() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const k = "__jl_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function lsGet(key) {
  if (!lsAvailable()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  if (!lsAvailable()) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key) {
  if (!lsAvailable()) return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nowISO() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

function normalizeRuns(runs) {
  const arr = Array.isArray(runs) ? runs : [];

  const sorted = arr
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const ta = new Date(b?.finishedAt || b?.startedAt || 0).getTime();
      const tb = new Date(a?.finishedAt || a?.startedAt || 0).getTime();
      return ta - tb;
    });

  const migrated = sorted.map((r) => {
    const x = { ...(r || {}) };

    // runId indispensable
    if (!x.runId) x.runId = `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // timestamps
    if (!x.startedAt) x.startedAt = nowISO();
    if (!("finishedAt" in x)) x.finishedAt = x.finishedAt || null;

    // step
    if (!x.step) x.step = "MODE";

    // answers
    if (!x.answers) x.answers = {};
    if (!x.answers.role) x.answers.role = "Juge";
    if (!("qualification" in x.answers)) x.answers.qualification = "";
    if (!("procedureChoice" in x.answers)) x.answers.procedureChoice = null;
    if (!("procedureJustification" in x.answers)) x.answers.procedureJustification = "";
    if (!("decisionMotivation" in x.answers)) x.answers.decisionMotivation = "";
    if (!("decisionDispositif" in x.answers)) x.answers.decisionDispositif = "";

    if (!x.answers.audience) x.answers.audience = { decisions: [], scene: null };
    if (!Array.isArray(x.answers.audience.decisions)) x.answers.audience.decisions = [];
    if (!("scene" in x.answers.audience)) x.answers.audience.scene = null;

    // state
    if (!x.state) x.state = {};
    // session multi / solo-ai
    if (!x.state.session || typeof x.state.session !== "object") {
      x.state.session = {
        mode: "SOLO_AI", // "SOLO_AI" | "COOP"
        roomId: null,
        participantId: null,
        displayName: "",
        isHost: false,
        version: 0,
        lastSyncAt: null,
      };
    } else {
      if (!x.state.session.mode) x.state.session.mode = "SOLO_AI";
      if (!("roomId" in x.state.session)) x.state.session.roomId = null;
      if (!("participantId" in x.state.session)) x.state.session.participantId = null;
      if (!("displayName" in x.state.session)) x.state.session.displayName = "";
      if (!("isHost" in x.state.session)) x.state.session.isHost = false;
      if (!("version" in x.state.session)) x.state.session.version = 0;
      if (!("lastSyncAt" in x.state.session)) x.state.session.lastSyncAt = null;
    }
    if (!Array.isArray(x.state.excludedPieceIds)) x.state.excludedPieceIds = [];
    if (!Array.isArray(x.state.admittedLatePieceIds)) x.state.admittedLatePieceIds = [];
    if (!Array.isArray(x.state.pendingTasks)) x.state.pendingTasks = [];
    if (!Array.isArray(x.state.auditLog)) x.state.auditLog = [];
    if (!x.state.riskModifiers) x.state.riskModifiers = { appealRiskPenalty: 0, dueProcessBonus: 0 };
    if (!("appealRiskPenalty" in x.state.riskModifiers)) x.state.riskModifiers.appealRiskPenalty = 0;
    if (!("dueProcessBonus" in x.state.riskModifiers)) x.state.riskModifiers.dueProcessBonus = 0;
    if (!(" _audienceMicro" in x.state)) {
      // typo-safe check below
    }
    if (!("_audienceMicro" in x.state)) x.state._audienceMicro = safeNum(x.state._audienceMicro);

    // scores
    if (!x.scores) x.scores = { qualification: 0, procedure: 0, audience: 0, droits: 0, motivation: 0 };
    if (!("qualification" in x.scores)) x.scores.qualification = 0;
    if (!("procedure" in x.scores)) x.scores.procedure = 0;
    if (!("audience" in x.scores)) x.scores.audience = 0;
    if (!("droits" in x.scores)) x.scores.droits = 0;
    if (!("motivation" in x.scores)) x.scores.motivation = 0;

    // meta
    if (!("caseMeta" in x)) x.caseMeta = x.caseMeta || null;

    // ULTRA fields
    if (!("appeal" in x)) x.appeal = null;
    if (!("ai" in x)) x.ai = null;

    // scoring global
    if (!("scoreGlobal" in x)) x.scoreGlobal = safeNum(x.scoreGlobal);

    return x;
  });

  return migrated.slice(0, MAX_RUNS);
}

function normalizeStats(stats) {
  const s = stats && typeof stats === "object" ? { ...stats } : {};

  if (!s.skills) {
    s.skills = {
      qualification: { avg: 0, n: 0 },
      procedure: { avg: 0, n: 0 },
      audience: { avg: 0, n: 0 },
      droits: { avg: 0, n: 0 },
      motivation: { avg: 0, n: 0 },
    };
  } else {
    if (!s.skills.qualification) s.skills.qualification = { avg: 0, n: 0 };
    if (!s.skills.procedure) s.skills.procedure = { avg: 0, n: 0 };
    if (!s.skills.audience) s.skills.audience = { avg: 0, n: 0 };
    if (!s.skills.droits) s.skills.droits = { avg: 0, n: 0 };
    if (!s.skills.motivation) s.skills.motivation = { avg: 0, n: 0 };
  }

  if (!s.byDomaine) s.byDomaine = {};
  if (!("totalRuns" in s)) s.totalRuns = 0;
  if (!("avgScore" in s)) s.avgScore = 0;
  if (!("bestScore" in s)) s.bestScore = 0;
  if (!("lastRunAt" in s)) s.lastRunAt = null;

  return s;
}

/* =========================================================
   RUNS
========================================================= */
export function readRuns() {
  const raw = lsGet(KEY_RUNS);
  if (!raw) {
    // fallback mémoire
    MEM_RUNS = normalizeRuns(MEM_RUNS);
    return MEM_RUNS;
  }

  const runs = safeParse(raw || "[]", []);
  const normalized = normalizeRuns(runs);

  // auto-migration si besoin
  try {
    if (JSON.stringify(normalized) !== JSON.stringify(runs)) {
      writeRuns(normalized);
    }
  } catch {
    // ignore
  }

  return normalized;
}

export function writeRuns(runs) {
  const normalized = normalizeRuns(runs);
  const ok = lsSet(KEY_RUNS, JSON.stringify(normalized));
  if (!ok) MEM_RUNS = normalized;
}

export function addRun(run) {
  const runs = readRuns();
  const updated = normalizeRuns([run, ...runs]);
  writeRuns(updated);
  return updated;
}

export function updateRunById(runId, patch) {
  const id = String(runId || "");
  if (!id) return null;

  const runs = readRuns();
  let found = null;

  const next = runs.map((r) => {
    if (r.runId !== id) return r;
    found = { ...r, ...(patch || {}) };
    return found;
  });

  if (found) writeRuns(next);
  return found;
}

export function upsertRun(run) {
  const r = run || null;
  if (!r?.runId) return null;

  const runs = readRuns();
  const idx = runs.findIndex((x) => x.runId === r.runId);

  let next;
  if (idx >= 0) {
    next = runs.slice();
    next[idx] = r;
  } else {
    next = [r, ...runs];
  }

  next = normalizeRuns(next);
  writeRuns(next);
  return r;
}

export function deleteRun(runId) {
  const id = String(runId || "");
  if (!id) return false;

  const runs = readRuns();
  const next = runs.filter((r) => r.runId !== id);
  writeRuns(next);

  // si run actif = supprimé
  const active = getActiveRunId();
  if (active && active === id) clearActiveRunId();

  return true;
}

export function clearAllRuns() {
  writeRuns([]);
  clearActiveRunId();
  writeStats({});
  return true;
}

/* =========================================================
   STATS
========================================================= */
export function readStats() {
  const raw = lsGet(KEY_STATS);
  if (!raw) {
    MEM_STATS = normalizeStats(MEM_STATS);
    return MEM_STATS;
  }

  const stats = safeParse(raw || "{}", {});
  const normalized = normalizeStats(stats);

  try {
    if (JSON.stringify(normalized) !== JSON.stringify(stats)) writeStats(normalized);
  } catch {
    // ignore
  }

  return normalized;
}

export function writeStats(stats) {
  const normalized = normalizeStats(stats);
  const ok = lsSet(KEY_STATS, JSON.stringify(normalized));
  if (!ok) MEM_STATS = normalized;
}

/* =========================================================
   ✅ ACTIVE RUN (session)
========================================================= */
export function setActiveRunId(runId) {
  const id = String(runId || "");
  if (!id) return null;

  const ok = lsSet(KEY_ACTIVE_RUN_ID, id);
  if (!ok) MEM_ACTIVE = id;
  return id;
}

export function getActiveRunId() {
  const v = lsGet(KEY_ACTIVE_RUN_ID);
  if (v !== null) return v || "";
  return MEM_ACTIVE || "";
}

export function clearActiveRunId() {
  lsRemove(KEY_ACTIVE_RUN_ID);
  MEM_ACTIVE = "";
}

export function getActiveRun() {
  const id = getActiveRunId();
  if (!id) return null;
  const runs = readRuns();
  return runs.find((r) => r.runId === id) || null;
}

export function ensureActiveRunValid() {
  const id = getActiveRunId();
  if (!id) return null;
  const r = getActiveRun();
  if (!r) {
    clearActiveRunId();
    return null;
  }
  return r;
}

export function upsertAndSetActive(run) {
  const saved = upsertRun(run);
  if (saved?.runId) setActiveRunId(saved.runId);
  return saved;
}

export function patchActiveRun(patch) {
  const r = ensureActiveRunValid();
  if (!r) return null;

  // shallow merge + préserver structures
  const updated = { ...r, ...(patch || {}) };

  // protéger sous-objets
  if (patch?.answers) updated.answers = { ...(r.answers || {}), ...(patch.answers || {}) };
  if (patch?.state) updated.state = { ...(r.state || {}), ...(patch.state || {}) };
  if (patch?.scores) updated.scores = { ...(r.scores || {}), ...(patch.scores || {}) };

  upsertRun(updated);
  return updated;
}

/* =========================================================
   ✅ GLOBAL STATS
========================================================= */
export function updateGlobalStats(run) {
  const stats = readStats();

  const total = (stats.totalRuns || 0) + 1;
  const runScoreGlobal = safeNum(run?.scoreGlobal);

  const avgScore =
    total === 1
      ? runScoreGlobal
      : Math.round(((stats.avgScore || 0) * (total - 1) + runScoreGlobal) / total);

  const byDomaine = stats.byDomaine || {};
  const d = run?.caseMeta?.domaine || "Autre";
  byDomaine[d] = byDomaine[d] || { runs: 0, avg: 0, best: 0 };

  const dRuns = (byDomaine[d].runs || 0) + 1;
  const dAvg =
    dRuns === 1
      ? runScoreGlobal
      : Math.round((safeNum(byDomaine[d].avg) * (dRuns - 1) + runScoreGlobal) / dRuns);

  byDomaine[d] = {
    runs: dRuns,
    avg: dAvg,
    best: Math.max(safeNum(byDomaine[d].best), runScoreGlobal),
  };

  const skills = stats.skills || {
    qualification: { avg: 0, n: 0 },
    procedure: { avg: 0, n: 0 },
    audience: { avg: 0, n: 0 },
    droits: { avg: 0, n: 0 },
    motivation: { avg: 0, n: 0 },
  };

  const nextSkills = {
    qualification: skills.qualification || { avg: 0, n: 0 },
    procedure: skills.procedure || { avg: 0, n: 0 },
    audience: skills.audience || { avg: 0, n: 0 },
    droits: skills.droits || { avg: 0, n: 0 },
    motivation: skills.motivation || { avg: 0, n: 0 },
  };

  const runScores = run?.scores || {};
  for (const k of Object.keys(nextSkills)) {
    const prev = nextSkills[k];
    const n = (prev.n || 0) + 1;
    const value = safeNum(runScores[k]);
    const avg = n === 1 ? value : Math.round(((prev.avg || 0) * (n - 1) + value) / n);
    nextSkills[k] = { avg, n };
  }

  const bestScore = Math.max(safeNum(stats.bestScore), runScoreGlobal);

  const updated = {
    totalRuns: total,
    avgScore,
    bestScore,
    byDomaine,
    skills: nextSkills,
    lastRunAt: run?.finishedAt || nowISO(),
  };

  writeStats(updated);
  return updated;
}

// =========================================================
// ✅ Network helper (token + cookies + retry + timeout)
// =========================================================
export function getAuthTokenSafe() {
  try {
    const keys = [
      "droitgpt_access_token",
      "access_token",
      "AUTH_TOKEN",
      "auth_token",
      "authToken",
      "token",
      "accessToken",
      "droitgpt_token",
      "jwt",
    ];
    for (const k of keys) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v && String(v).trim().length > 20) return String(v).trim();
    }
    const sessionKeys = ["session", "user", "auth", "droitgpt_session"];
    for (const k of sessionKeys) {
      const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        const v =
          obj?.token ||
          obj?.access_token ||
          obj?.accessToken ||
          obj?.jwt ||
          obj?.data?.token ||
          obj?.data?.access_token;
        if (v && String(v).trim().length > 20) return String(v).trim();
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function apiFetch(url, options = {}, cfg = {}) {
  const {
    timeoutMs = 25000,
    retries = 2,
    retryBaseDelayMs = 800,
  } = cfg;

  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = getAuthTokenSafe();
      const headers = { ...(options.headers || {}) };

      if (!headers["Content-Type"] && options.body && typeof options.body === "string") {
        headers["Content-Type"] = "application/json";
      }
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal: controller.signal,
      });

      if (!resp.ok) {
        if (resp.status >= 500 && attempt < retries) {
          await sleep(retryBaseDelayMs * Math.pow(2, attempt));
          continue;
        }
      }

      return resp;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(retryBaseDelayMs * Math.pow(2, attempt));
        continue;
      }
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr || new Error("NETWORK_ERROR");
}

export async function apiFetchJSON(url, options = {}, cfg = {}) {
  const resp = await apiFetch(url, options, cfg);
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) throw new Error("AUTH_TOKEN_MISSING");
    throw new Error(`HTTP_${resp.status}:${text.slice(0, 220)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
