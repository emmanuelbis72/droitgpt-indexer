import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  createNewRun,
  scoreRun,
  mergeAudienceWithTemplates,
  setAudienceScene as setAudienceSceneOnRun,
  applyAudienceDecision,
} from "../justiceLab/engine.js";

import {
  addRun,
  updateGlobalStats,
  readRuns,
  upsertAndSetActive,
  patchActiveRun,
  ensureActiveRunValid,
  setActiveRunId,
} from "../justiceLab/storage.js";

const API_BASE = (
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_URL ||
  "https://droitgpt-indexer.onrender.com"
).replace(/\/$/, "");

const PROCEDURE_CHOICES = [
  { id: "A", title: "Mesures conservatoires / garanties + audience rapide", hint: "Équilibrée" },
  { id: "B", title: "Renvoi / instruction complémentaire (dossier incomplet)", hint: "Prudent si pièces insuffisantes" },
  { id: "C", title: "Décision immédiate sur base des éléments disponibles", hint: "Risque si garanties faibles" },
];

// ✅ Modes de jeu
// - SOLO : tu joues ton rôle, le système simule les autres intervenants.
// - MULTIJOUEUR : salle partagée (roomId persisté). La synchro temps réel complète pourra être branchée ensuite.
const GAME_MODES = [
  { id: "solo", label: "🧑‍⚖️ Solo", desc: "Tu joues ton rôle, l'IA simule les autres." },
  { id: "multi", label: "👥 Multijoueur", desc: "Plusieurs joueurs dans une salle (code)." },
];

// ✅ Rôles jouables (réalistes en audience en RDC)
// (Autres acteurs réels mais non joués ici : Huissier/Audiencier, Parties, Témoins, Experts...)
const ROLES = [
  { id: "Juge", label: "👨🏽‍⚖️ Juge", desc: "Dirige l’audience, tranche les incidents/objections, rend la décision ou met en délibéré." },
  { id: "Procureur", label: "🟥 Procureur (Ministère public)", desc: "Réquisitions/avis, veille à l’ordre public (surtout en pénal)." },
  { id: "Avocat Demandeur", label: "🟦 Avocat Demandeur", desc: "Soutient la demande / partie civile : prétentions, pièces, exceptions." },
  { id: "Avocat Défendeur", label: "🟪 Avocat Défendeur", desc: "Assure la défense : contestations, exceptions, nullités, plaidoirie." },
  { id: "Greffier", label: "🟨 Greffier", desc: "Tient le PV : consigne interventions, incidents, décisions, renvois." },
];

// ✅ cache local dossiers dynamiques (v2 + fallback v1)
const CASE_CACHE_KEY_V2 = "justicelab_caseCache_v2";
const CASE_CACHE_KEY_V1 = "justicelab_caseCache_v1";

function lsAvailable() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const k = "__t";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function loadCaseCacheByKey(key) {
  if (!lsAvailable()) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function loadCaseCache() {
  // merge v2 + v1 (v2 prioritaire)
  const v2 = loadCaseCacheByKey(CASE_CACHE_KEY_V2);
  const v1 = loadCaseCacheByKey(CASE_CACHE_KEY_V1);
  return { ...(v1 || {}), ...(v2 || {}) };
}

function saveCaseToCache(caseData) {
  if (!lsAvailable()) return;
  try {
    if (!caseData?.caseId) return;
    const cache = loadCaseCacheByKey(CASE_CACHE_KEY_V2);
    cache[caseData.caseId] = caseData;
    localStorage.setItem(CASE_CACHE_KEY_V2, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function getAuthToken() {
  // ✅ IMPORTANT : compat ton token réel
  const candidates = [
    "droitgpt_access_token",
    "token",
    "authToken",
    "accessToken",
    "droitgpt_token",
  ];
  for (const k of candidates) {
    const v = localStorage.getItem(k);
    if (v && v.trim().length > 10) return v.trim();
  }
  return null;
}

function toFlagsFromAi(ai) {
  const flags = [];
  const critical = Array.isArray(ai?.criticalErrors) ? ai.criticalErrors : [];
  const warnings = Array.isArray(ai?.warnings) ? ai.warnings : [];
  for (const c of critical)
    flags.push({
      level: "critical",
      label: c?.label || "Erreur critique",
      detail: c?.detail || "",
    });
  for (const w of warnings)
    flags.push({ level: "warn", label: w?.label || "Avertissement", detail: w?.detail || "" });
  return flags;
}

function toDebriefFromAi(ai) {
  const strengths = Array.isArray(ai?.strengths) ? ai.strengths : [];
  const feedback = Array.isArray(ai?.feedback) ? ai.feedback : [];
  const appealRisk = ai?.appealRisk ? `📌 Risque d’annulation en appel (simulation) : ${ai.appealRisk}.` : null;

  const out = [];
  for (const s of strengths.slice(0, 5)) out.push(`✅ ${s}`);
  for (const f of feedback.slice(0, 7)) out.push(`⚙️ ${f}`);
  if (appealRisk) out.push(appealRisk);

  return out.length ? out : ["⚠️ Débrief indisponible."];
}

async function postJSON(url, body) {
  const token = getAuthToken();
  if (!token) throw new Error("AUTH_TOKEN_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP_${resp.status}:${text.slice(0, 200)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ======= helpers live feedback =======
function nowIso() {
  return new Date().toISOString();
}
function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
function setDiff(nextArr, prevArr) {
  const next = new Set(Array.isArray(nextArr) ? nextArr : []);
  const prev = new Set(Array.isArray(prevArr) ? prevArr : []);
  const added = [];
  for (const x of next) if (!prev.has(x)) added.push(x);
  return added;
}

function bestChoiceForRole(obj, role) {
  if (obj?.bestChoiceByRole?.[role]) return obj.bestChoiceByRole[role];

  const t = `${obj?.title || ""} ${obj?.statement || ""}`.toLowerCase();
  if (role === "Juge") return "Demander précision";
  if (role === "Procureur") {
    if (t.includes("null") || t.includes("irr") || t.includes("vice") || t.includes("tardiv") || t.includes("recev"))
      return "Rejeter";
    return "Rejeter";
  }
  if (t.includes("null") || t.includes("irr") || t.includes("vice") || t.includes("defense") || t.includes("contradic"))
    return "Accueillir";
  if (t.includes("tardiv") || t.includes("recev")) return "Rejeter";
  return "Accueillir";
}

// ✅ récupère un caseData : cache local (v2/v1) → runs (fallback)
function resolveCaseData(decodedCaseId) {
  const cache = loadCaseCache();
  if (cache?.[decodedCaseId]) return cache[decodedCaseId];

  try {
    const runs = readRuns();
    const r = (runs || []).find((x) => x?.caseMeta?.caseId === decodedCaseId);
    if (r?.caseMeta?.caseData) return r.caseMeta.caseData;
  } catch {
    // ignore
  }

  return null;
}

function normalizePartyValue(v) {
  if (!v) return { title: "-", sub: "" };
  if (typeof v === "string") return { title: v, sub: "" };
  if (typeof v === "object") {
    const title = v.nom || v.name || v.label || "-";
    const sub = v.statut || v.role || v.desc || "";
    return { title, sub };
  }
  return { title: String(v), sub: "" };
}
function dedupeRepeats(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  // Normalize whitespace
  const norm = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();

  // 1) Remove consecutive duplicate paragraphs
  const paras = norm.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paras) {
    const last = out[out.length - 1];
    if (last && last === p) continue;
    out.push(p);
  }
  let joined = out.join("\n\n").trim();

  // 2) Remove obvious "A + A" duplication (same second half)
  // Only if it's a near exact half repeat
  const half = Math.floor(joined.length / 2);
  if (joined.length > 200) {
    const a = joined.slice(0, half).trim();
    const b = joined.slice(half).trim();
    if (a && b && (a === b || b.startsWith(a.slice(0, Math.min(200, a.length))))) {
      // keep the longer coherent part (usually a)
      joined = a.length >= b.length ? a : b;
    }
  }

  return joined;
}

function getCaseSummaryOnce(caseData) {
  // Prefer explicit fields, but always dedupe
  const raw =
    caseData?.resume ||
    caseData?.summary ||
    caseData?.description ||
    "";
  return dedupeRepeats(raw);
}

function getCaseFactsFromData(caseData) {
  // If backend provides facts arrays, use them
  const candidates = [
    caseData?.faits,
    caseData?.faitsEssentiels,
    caseData?.facts,
    caseData?.keyFacts,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.filter(Boolean).length) return c.filter(Boolean).slice(0, 10);
  }
  // Fallback: derive 6 sentences from summary
  const s = getCaseSummaryOnce(caseData);
  if (!s) return [];
  const sentences = s
    .split(/(?<=[\.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 20);
  return sentences.slice(0, 6);
}


/** ========== ✅ Audit helper compatible engine ========== */
function pushAuditLocal(runObj, evt) {
  const next = { ...(runObj || {}) };
  next.state = next.state || {};
  next.state.auditLog = Array.isArray(next.state.auditLog) ? next.state.auditLog : [];
  next.state.auditLog.unshift({
    id: `log_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: nowIso(),
    ...evt,
  });
  next.state.auditLog = next.state.auditLog.slice(0, 250);
  return next;
}

/** ========== ✅ Chrono helpers ========== */
function msToClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function computeChronoElapsedMs(ch) {
  if (!ch) return 0;
  const elapsedBase = Number(ch.elapsedMs || 0);
  if (!ch.running) return elapsedBase;

  const startedAt = ch.startedAt ? new Date(ch.startedAt).getTime() : Date.now();
  const lastStartAt = ch.lastStartAt ? new Date(ch.lastStartAt).getTime() : startedAt;
  const delta = Date.now() - lastStartAt;
  return elapsedBase + Math.max(0, delta);
}

function PedagogyPanel({ caseData, compact = false }) {
  const p = caseData?.pedagogy;
  if (!p) return null;

  const objectifs = Array.isArray(p.objectifs) ? p.objectifs : [];
  const erreurs = Array.isArray(p.erreursFrequentes) ? p.erreursFrequentes : [];
  const checklist = Array.isArray(p.checklistAudience) ? p.checklistAudience : [];

  return (
    <div className={`rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 ${compact ? "" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-violet-300/80">Didacticiel</div>
          <div className="mt-1 text-sm font-semibold text-violet-100">
            Objectifs pédagogiques • Niveau: {p.level || caseData?.niveau || "—"}
          </div>
        </div>
        <div className="text-[11px] text-slate-300">{caseData?.meta?.city ? `Ville: ${caseData.meta.city}` : ""}</div>
      </div>

      <div className={`mt-3 grid gap-3 ${compact ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <div className="text-xs text-slate-200 font-semibold">🎯 Objectifs</div>
          <ul className="mt-2 space-y-1 text-xs text-slate-200">
            {objectifs.slice(0, compact ? 4 : 6).map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <div className="text-xs text-slate-200 font-semibold">⚠️ Erreurs fréquentes</div>
          <ul className="mt-2 space-y-1 text-xs text-slate-200">
            {erreurs.slice(0, compact ? 4 : 6).map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
        </div>

        {!compact && (
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-200 font-semibold">✅ Checklist audience</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-200">
              {checklist.slice(0, 6).map((x, i) => (
                <li key={i}>• {x}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-slate-300">
        Astuce : pendant l’audience, motive en 2–5 phrases et note l’impact sur le contradictoire / recevabilité /
        proportionnalité.
      </div>
    </div>
  );
}

export default function JusticeLabPlay() {
  const { caseId } = useParams();
  const navigate = useNavigate();

  const decodedCaseId = useMemo(() => decodeURIComponent(caseId || ""), [caseId]);
  const caseData = useMemo(() => resolveCaseData(decodedCaseId), [decodedCaseId]);

  useMemo(() => {
    if (caseData?.caseId) saveCaseToCache(caseData);
    return null;
  }, [caseData]);

  // ✅ init run
  const [run, setRun] = useState(() => {
    if (!caseData) return null;
    const active = ensureActiveRunValid();
    const activeCaseId = active?.caseId || active?.caseMeta?.caseId;
    if (active && activeCaseId === caseData.caseId) return active;

    const r = createNewRun(caseData);
    return { ...r, caseMeta: { ...(r.caseMeta || {}), caseId: caseData.caseId, caseData } };
  });

  const [step, setStep] = useState("ROLE");

  // Audience
  const [audienceScene, setAudienceScene] = useState(() => run?.answers?.audience?.scene || null);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);
  // ✅ Progress bar dynamique (création audience) — 15s minimum
  const [audienceLoadProgress, setAudienceLoadProgress] = useState(0);
  const audienceProgressTimerRef = useRef(null);

  // Scoring IA + Appeal IA
  const [isScoring, setIsScoring] = useState(false);
  const [scoreError, setScoreError] = useState(null);
  const [appealError, setAppealError] = useState(null);
  const [progress, setProgress] = useState(0);

  // ✅ mini feedback offline + map par objection
  const [liveFeedback, setLiveFeedback] = useState([]);
  const [feedbackByObjection, setFeedbackByObjection] = useState({});

  // ✅ verrouillage motivation (objections)
  const [editReasoningById, setEditReasoningById] = useState({});
  const [draftReasoningById, setDraftReasoningById] = useState({});

  // UI toggles
  const [showAudit, setShowAudit] = useState(true);
  const [showPiecesImpact, setShowPiecesImpact] = useState(true);

  // ✅ Greffier (nom)
  const [greffierName, setGreffierName] = useState(() => {
    if (!lsAvailable()) return "Le Greffier";
    return localStorage.getItem("justicelab_greffier_name") || "Le Greffier";
  });

  // ✅ Chrono UI refresh
  const [chronoUiTick, setChronoUiTick] = useState(0);
  const chronoIntervalRef = useRef(null);

  // ✅ persister run en storage comme active
  useEffect(() => {
    if (!run?.runId) return;
    try {
      upsertAndSetActive(run);
      setActiveRunId(run.runId);
    } catch {
      // ignore
    }
  }, [run?.runId]);

  // ✅ sync audienceScene depuis run
  useEffect(() => {
    const sc = run?.answers?.audience?.scene || null;
    if (sc && sc !== audienceScene) setAudienceScene(sc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.answers?.audience?.scene]);

  // ✅ start chrono auto quand on arrive en AUDIENCE
  useEffect(() => {
    if (!run?.runId) return;

    if (step !== "AUDIENCE") {
      // stop UI tick
      if (chronoIntervalRef.current) {
        clearInterval(chronoIntervalRef.current);
        chronoIntervalRef.current = null;
      }
      return;
    }

    // tick UI
    if (!chronoIntervalRef.current) {
      chronoIntervalRef.current = setInterval(() => setChronoUiTick((t) => t + 1), 1000);
    }

    // auto start if not started
    const ch = run?.state?.chrono || null;
    if (!ch?.startedAt) {
      const next = pushAuditLocal(
        {
          ...run,
          state: {
            ...(run.state || {}),
            chrono: {
              startedAt: nowIso(),
              lastStartAt: nowIso(),
              elapsedMs: 0,
              running: true,
            },
          },
        },
        {
          type: "CHRONO",
          title: "Chronomètre — démarrage",
          detail: "Début du temps d’audience (auto).",
          meta: { step: "AUDIENCE" },
        }
      );
      saveRunState(next);
    } else if (ch?.startedAt && !ch?.running) {
      // keep paused if user paused
    } else if (ch?.startedAt && ch?.running && !ch?.lastStartAt) {
      const next = {
        ...run,
        state: {
          ...(run.state || {}),
          chrono: { ...(ch || {}), lastStartAt: nowIso(), running: true },
        },
      };
      saveRunState(next);
    }

    return () => {
      if (chronoIntervalRef.current) {
        clearInterval(chronoIntervalRef.current);
        chronoIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, run?.runId]);

  // ✅ persist greffierName
  useEffect(() => {
    try {
      if (lsAvailable()) localStorage.setItem("justicelab_greffier_name", greffierName || "Le Greffier");
    } catch {
      // ignore
    }
  }, [greffierName]);

  if (!caseData || !run) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-slate-200 font-semibold">Dossier introuvable.</p>
          <p className="text-sm text-slate-300 mt-2">
            Si ce dossier a été généré dynamiquement, assure-toi qu’il est encore dans le cache local
            (ou regénère-le depuis Justice Lab).
          </p>
          <div className="mt-4 flex gap-2">
            <Link className="inline-flex text-emerald-300 underline" to="/justice-lab">
              Retour Justice Lab
            </Link>
            <button
              type="button"
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={() => window.location.reload()}
            >
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const piecesById = useMemo(() => {
    const m = new Map();
    (caseData.pieces || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [caseData]);

  const excludedIds = run.state?.excludedPieceIds || [];
  const admittedLateIds = run.state?.admittedLatePieceIds || [];
  const tasks = run.state?.pendingTasks || [];
  const audit = run.state?.auditLog || [];

  const excludedPieces = excludedIds.map((id) => piecesById.get(id)).filter(Boolean);
  const admittedLatePieces = admittedLateIds.map((id) => piecesById.get(id)).filter(Boolean);

  const excludedCount = excludedIds.length || 0;
  const admittedLateCount = admittedLateIds.length || 0;
  const tasksCount = tasks.length || 0;

  const saveRunState = (nextRunOrPatch) => {
    const next = nextRunOrPatch && nextRunOrPatch.runId ? nextRunOrPatch : patchActiveRun(nextRunOrPatch);

    if (next?.runId) {
      upsertAndSetActive(next);
      setActiveRunId(next.runId);
      setRun(next);
    }
    return next;
  };

  const goNext = async () => {
    if (isScoring || isLoadingAudience) return;

    if (step === "ROLE") return setStep("BRIEFING");
    if (step === "BRIEFING") return setStep("QUALIFICATION");
    if (step === "QUALIFICATION") return setStep("PROCEDURE");
    if (step === "PROCEDURE") {
      await loadAudience();
      return setStep("AUDIENCE");
    }
    if (step === "AUDIENCE") return setStep("DECISION");
    if (step === "DECISION") return finalize();
  };

  const goPrev = () => {
    if (isScoring || isLoadingAudience) return;
    if (step === "BRIEFING") return setStep("ROLE");
    if (step === "QUALIFICATION") return setStep("BRIEFING");
    if (step === "PROCEDURE") return setStep("QUALIFICATION");
    if (step === "AUDIENCE") return setStep("PROCEDURE");
    if (step === "DECISION") return setStep("AUDIENCE");
  };

  const loadAudience = async () => {
    if (audienceScene?.objections?.length) return;

    // --- progress bar : démarre immédiatement, 15s minimum ---
    const MIN_MS = 20000;
    const startAt = Date.now();
    setAudienceLoadProgress(0);
    if (audienceProgressTimerRef.current) {
      clearInterval(audienceProgressTimerRef.current);
      audienceProgressTimerRef.current = null;
    }
    audienceProgressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startAt;
      // On monte jusqu'à 95% pendant le chargement.
      const pct = Math.min(95, Math.round((elapsed / MIN_MS) * 100));
      setAudienceLoadProgress((prev) => (pct > prev ? pct : prev));
    }, 120);

    setIsLoadingAudience(true);
    try {
      const gameMode = run?.answers?.gameMode || "solo";
      const roomId = run?.answers?.roomId || null;
      const payload = {
        caseId: run.caseId || run.caseMeta?.caseId,
        role: run.answers?.role || "Juge",
        difficulty: caseData?.niveau || "Intermédiaire",
        gameMode,
        roomId,
        facts: caseData?.resume || "",
        parties: caseData?.parties || {},
        pieces: (caseData?.pieces || []).map((p) => ({
          id: p.id,
          title: p.title,
          type: p.type,
          content: (p.content || "").slice(0, 900),
        })),
        legalIssues: caseData?.legalIssues || [],
        procedureChoice: run.answers?.procedureChoice || null,
        procedureJustification: run.answers?.procedureJustification || "",
        language: "fr",
      };

      const data = await postJSON(`${API_BASE}/justice-lab/audience`, payload);

      const merged = mergeAudienceWithTemplates(caseData, data);
      setAudienceScene(merged);

      const nextRun = setAudienceSceneOnRun(run, merged);
      saveRunState(nextRun);
    } catch (e) {
      console.warn(e);
      const fallback = {
        turns: [
          { speaker: "Greffier", text: "Affaire appelée. Parties présentes." },
          { speaker: "Juge", text: "L’audience est ouverte. Nous allons entendre les incidents." },
          { speaker: "Procureur", text: "Le parquet conteste l’exception et invoque l’intérêt public." },
          { speaker: "Avocat", text: "La défense insiste sur le contradictoire et l’égalité des armes." },
        ],
        objections: [
          {
            id: "OBJ1",
            by: "Avocat",
            title: "Exception de nullité / irrégularité",
            statement: "La défense soutient qu’un acte essentiel est irrégulier et doit être écarté.",
            options: ["Accueillir", "Rejeter", "Demander précision"],
          },
          {
            id: "OBJ2",
            by: "Procureur",
            title: "Recevabilité / preuve tardive",
            statement: "Le parquet conteste une pièce produite tardivement et en discute la recevabilité.",
            options: ["Accueillir", "Rejeter", "Demander précision"],
          },
        ],
      };

      const merged = mergeAudienceWithTemplates(caseData, fallback);
      setAudienceScene(merged);

      const nextRun = setAudienceSceneOnRun(run, merged);
      saveRunState(nextRun);
    } finally {
      // ✅ On garantit 15s minimum pour que la barre "respire" même si le backend répond vite.
      const elapsed = Date.now() - startAt;
      const remain = Math.max(0, MIN_MS - elapsed);
      if (remain) await new Promise((r) => setTimeout(r, remain));

      setIsLoadingAudience(false);

      // stop timer + force 100% (progress vert visible)
      if (audienceProgressTimerRef.current) {
        clearInterval(audienceProgressTimerRef.current);
        audienceProgressTimerRef.current = null;
      }
      setAudienceLoadProgress(100);
    }
  };

  // ✅ applique décision V5 + feedback instant offline + impacts
  const applyDecisionHybrid = (obj, decision, reasoning) => {
    setRun((prev) => {
      const before = prev;

      const beforeExcluded = before.state?.excludedPieceIds || [];
      const beforeLate = before.state?.admittedLatePieceIds || [];
      const beforeTasks = before.state?.pendingTasks || [];
      const beforeAudit = before.state?.auditLog || [];

      const role = (before.answers?.role || "").trim() || "Juge";

      const payload = {
        objectionId: obj?.id,
        decision,
        reasoning: (reasoning || "").slice(0, 1200),
        role,
        effects: obj?.effects || obj?.effect || null,
      };

      const next = applyAudienceDecision(before, payload);

      const addedExcluded = setDiff(next.state?.excludedPieceIds, beforeExcluded);
      const addedLate = setDiff(next.state?.admittedLatePieceIds, beforeLate);

      const addedTasks = setDiff(
        (next.state?.pendingTasks || []).map((t) => `${t.type}|${t.label}|${t.detail}`),
        beforeTasks.map((t) => `${t.type}|${t.label}|${t.detail}`)
      );

      const lastAudit =
        (next.state?.auditLog || []).slice(0, 1)[0] ||
        (next.state?.auditLog || []).slice(-1)[0] ||
        (beforeAudit || []).slice(0, 1)[0] ||
        (beforeAudit || []).slice(-1)[0] ||
        null;

      const best = bestChoiceForRole(obj, role);
      const ok = decision === best;

      const impactLines = [];
      if (addedExcluded.length) {
        const labels = addedExcluded.map((id) => piecesById.get(id)?.title || id).slice(0, 3);
        impactLines.push(`🧾 Pièces écartées: ${labels.join(" • ")}`);
      }
      if (addedLate.length) {
        const labels = addedLate.map((id) => piecesById.get(id)?.title || id).slice(0, 3);
        impactLines.push(`📎 Pièces admises tardives: ${labels.join(" • ")}`);
      }
      if (addedTasks.length) {
        const lastTasks = (next.state?.pendingTasks || [])
          .slice(-Math.min(2, addedTasks.length))
          .map((t) => t.label || t.type);
        impactLines.push(`✅ Actions: ${lastTasks.join(" • ")}`);
      }
      if (!impactLines.length) impactLines.push("ℹ️ Impact: pas d’effet procédural majeur (bonus/penalty interne possible).");

      const fb = {
        id: `fb_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        at: nowIso(),
        objId: obj?.id || "",
        title: obj?.title || "Objection",
        decision,
        role,
        verdict: ok ? "BON" : "À AMÉLIORER",
        headline: ok ? "✅ Bonne décision (cohérence rôle/garanties)" : "⚠️ Décision discutable (risque procédural)",
        suggestion: ok
          ? "Continue : motive brièvement (contradictoire / recevabilité / proportionnalité)."
          : `Suggestion IA (instant) : pour le rôle ${role}, un choix souvent plus sûr est “${best}”.`,
        impact: impactLines,
        audit: lastAudit
          ? `${lastAudit.title || lastAudit.action || lastAudit.type || "Acte"}${lastAudit.detail ? ` — ${lastAudit.detail}` : ""}`
          : null,
      };

      setLiveFeedback((arr) => [fb, ...(arr || [])].slice(0, 4));
      if (obj?.id) setFeedbackByObjection((m) => ({ ...(m || {}), [obj.id]: fb }));

      try {
        upsertAndSetActive(next);
        setActiveRunId(next.runId);
      } catch {
        // ignore
      }

      return next;
    });
  };

  /** ✅ Incidents procéduraux (écrit dans auditLog + crée tâche) */
  const addProceduralIncident = (kind) => {
    const k = String(kind || "").toUpperCase();

    const labels = {
      NULLITE: "Incident procédural — Nullité soulevée",
      RENVOI: "Incident procédural — Demande de renvoi",
      JONCTION: "Incident procédural — Jonction sollicitée",
      DISJONCTION: "Incident procédural — Disjonction sollicitée",
      COMMUNICATION_PIECES: "Incident procédural — Communication de pièces",
    };

    const details = {
      NULLITE: "Une partie invoque un vice de procédure. Le juge doit entendre le contradictoire puis motiver la décision.",
      RENVOI: "Renvoi demandé (préparation, témoin, pièces). Décision motivée + fixation éventuelle d’une date.",
      JONCTION: "Demande de jonction de procédures/dossiers connexes. Vérifier connexité, bonne administration de la justice.",
      DISJONCTION: "Demande de disjonction pour juger séparément. Vérifier intérêt, délais, droits de la défense.",
      COMMUNICATION_PIECES: "Demande de communication de pièces. Garantir contradictoire + délai raisonnable.",
    };

    const title = labels[k] || `Incident procédural — ${k}`;
    const detail = details[k] || "Incident ajouté au dossier.";

    const task = {
      type: "INCIDENT",
      label: title,
      detail: "À consigner au PV + décision motivée (2–6 phrases).",
    };

    const next0 = pushAuditLocal(
      {
        ...run,
        state: {
          ...(run.state || {}),
          pendingTasks: Array.isArray(run.state?.pendingTasks)
            ? [...run.state.pendingTasks, task].slice(0, 60)
            : [task],
        },
      },
      {
        type: "INCIDENT",
        title,
        detail,
        meta: { kind: k, step: "AUDIENCE" },
      }
    );

    saveRunState(next0);
  };

  /** ✅ Chrono actions */
  const chrono = run?.state?.chrono || null;
  const elapsedMs = useMemo(() => computeChronoElapsedMs(chrono), [chrono, chronoUiTick]);
  const chronoText = msToClock(elapsedMs);

  const chronoStart = () => {
    const ch = run?.state?.chrono || {};
    const next = pushAuditLocal(
      {
        ...run,
        state: {
          ...(run.state || {}),
          chrono: {
            startedAt: ch.startedAt || nowIso(),
            lastStartAt: nowIso(),
            elapsedMs: Number(ch.elapsedMs || 0),
            running: true,
          },
        },
      },
      { type: "CHRONO", title: "Chronomètre — reprise", detail: "Reprise du temps d’audience.", meta: { step: "AUDIENCE" } }
    );
    saveRunState(next);
  };

  const chronoPause = () => {
    const ch = run?.state?.chrono || {};
    const current = computeChronoElapsedMs(ch);
    const next = pushAuditLocal(
      {
        ...run,
        state: {
          ...(run.state || {}),
          chrono: {
            startedAt: ch.startedAt || nowIso(),
            lastStartAt: ch.lastStartAt || nowIso(),
            elapsedMs: current,
            running: false,
          },
        },
      },
      { type: "CHRONO", title: "Chronomètre — pause", detail: `Pause à ${msToClock(current)}.`, meta: { step: "AUDIENCE" } }
    );
    saveRunState(next);
  };

  const chronoReset = () => {
    const next = pushAuditLocal(
      {
        ...run,
        state: {
          ...(run.state || {}),
          chrono: {
            startedAt: nowIso(),
            lastStartAt: nowIso(),
            elapsedMs: 0,
            running: false,
          },
        },
      },
      { type: "CHRONO", title: "Chronomètre — reset", detail: "Remise à zéro.", meta: { step: "AUDIENCE" } }
    );
    saveRunState(next);
  };

  const finalize = async () => {
    setScoreError(null);
    setAppealError(null);
    setIsScoring(true);
    setProgress(8);

    try {
      const local = scoreRun(run);
      setProgress(15);

      let aiScore = null;
      try {
        aiScore = await postJSON(`${API_BASE}/justice-lab/score`, {
          caseData,
          runData: run,
          caseId: run.caseId || run.caseMeta?.caseId,
          role: run.answers?.role || "Juge",
          facts: caseData?.resume || "",
          qualification: run.answers?.qualification || "",
          procedureChoice: run.answers?.procedureChoice || null,
          procedureJustification: run.answers?.procedureJustification || "",
          audience: run.answers?.audience || {},
          decisionMotivation: run.answers?.decisionMotivation || "",
          decisionDispositif: run.answers?.decisionDispositif || "",
          language: "fr",
          greffierName,
          chrono: run?.state?.chrono || null,
        });
        setProgress(55);
      } catch (e) {
        console.warn("score ia failed", e);
      }

      let appeal = null;
      try {
        appeal = await postJSON(`${API_BASE}/justice-lab/appeal`, {
          caseData,
          runData: run,
          scored: aiScore || local,
          caseId: run.caseId || run.caseMeta?.caseId,
          role: run.answers?.role || "Juge",
          facts: caseData?.resume || "",
          decisionMotivation: run.answers?.decisionMotivation || "",
          decisionDispositif: run.answers?.decisionDispositif || "",
          audience: run.answers?.audience || {},
          language: "fr",
          greffierName,
          chrono: run?.state?.chrono || null,
        });
        setProgress(80);
      } catch (e) {
        console.warn("appeal ia failed", e);
      }

      const scoreGlobal = typeof aiScore?.scoreGlobal === "number" ? aiScore.scoreGlobal : local?.scoreGlobal || 0;
      const scores = aiScore?.scores || local?.scores || {};
      const flags = aiScore
        ? toFlagsFromAi(aiScore)
        : (local?.flags || []).map((x) => ({ level: "warn", label: x, detail: "" }));
      const debrief = aiScore ? toDebriefFromAi(aiScore) : local?.debrief || [];

      const finalRun = {
        ...run,
        scoreGlobal,
        scores,
        flags,
        debrief,
        ai: aiScore || null,
        appeal: appeal || null,
        finishedAt: nowIso(),
        caseMeta: {
          ...(run.caseMeta || {}),
          caseId: run.caseId || run.caseMeta?.caseId,
          caseData,
        },
      };

      addRun(finalRun);
      updateGlobalStats(finalRun);

      setProgress(100);
      navigate("/justice-lab/results", { state: { runId: finalRun.runId, runData: finalRun } });
    } catch (e) {
      console.error(e);
      setScoreError("Erreur scoring. Vérifie le token, réseau ou endpoint /justice-lab/score.");
    } finally {
      setIsScoring(false);
    }
  };

  const roleCard = (r) => {
    const active = (run.answers?.role || "Juge") === r.id;
    return (
      <button
        key={r.id}
        type="button"
        onClick={() =>
          saveRunState({
            ...run,
            answers: { ...run.answers, role: r.id },
          })
        }
        className={`w-full text-left rounded-2xl border p-4 transition ${
          active ? "border-emerald-500/50 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
        }`}
      >
        <div className="text-sm font-semibold text-slate-100">{r.label}</div>
        <div className="text-xs text-slate-300 mt-1">{r.desc}</div>
      </button>
    );
  };

  const procedureCard = (c) => {
    const active = run.answers?.procedureChoice === c.id;
    return (
      <button
        key={c.id}
        type="button"
        onClick={() =>
          saveRunState({
            ...run,
            answers: { ...run.answers, procedureChoice: c.id },
          })
        }
        className={`w-full text-left rounded-2xl border p-4 transition ${
          active ? "border-emerald-500/50 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-100">
            {c.id}. {c.title}
          </div>
          <div className="text-[11px] text-slate-400">{c.hint}</div>
        </div>
      </button>
    );
  };

  const recentAudit = useMemo(() => {
    const arr = Array.isArray(audit) ? audit : [];
    return arr.slice(0, 12).map((a) => ({
      at: a.ts || a.at || nowIso(),
      kind: a.type || a.kind || "Action",
      action: a.title || a.action || a.label || "Action",
      detail: a.detail || a.description || "",
    }));
  }, [audit]);

  const getDecisionForObj = (objId) => {
    const decisions = Array.isArray(run?.answers?.audience?.decisions) ? run.answers.audience.decisions : [];
    return decisions.find((d) => d.objectionId === objId) || null;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400">
              <Link to="/justice-lab" className="hover:underline">
                Justice Lab
              </Link>{" "}
              <span className="opacity-60">/</span>{" "}
              <span className="text-slate-200 font-semibold">{caseData.caseId}</span>
              {caseData?.meta?.seed ? (
                <span className="ml-2 text-[11px] text-slate-500">seed: {String(caseData.meta.seed).slice(0, 22)}</span>
              ) : null}
            </div>
            <h1 className="text-2xl font-bold mt-2">{caseData.titre}</h1>
            <p className="text-sm text-slate-300 mt-1">{getCaseSummaryOnce(caseData)}</p>

            {/* ✅ Greffier inline */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="text-[11px] text-slate-400">Greffier :</div>
              <input
                value={greffierName}
                onChange={(e) => setGreffierName(e.target.value)}
                className="h-9 w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 outline-none focus:border-emerald-400/50"
                placeholder="Nom du greffier"
              />
              <button
                type="button"
                className="h-9 px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                onClick={() => navigate("/justice-lab/journal")}
              >
                📓 Journal (PV greffier)
              </button>
              <button
                type="button"
                className="h-9 px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                onClick={() => navigate("/justice-lab/results")}
              >
                🧪 Mode Examen (résultats)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={() => navigate("/justice-lab")}
            >
              Quitter
            </button>
          </div>
        </div>

        {/* Didacticiel top */}
        <div className="mt-6">
          <PedagogyPanel caseData={caseData} compact />
        </div>

        {/* top controls */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs px-3 py-1 rounded-full border border-white/10 bg-white/5">
              Étape: <span className="text-slate-100 font-semibold">{step}</span>
            </span>

            {step === "AUDIENCE" ? (
              <>
                <span className="text-xs px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-200">
                  Gestion d’audience: {run?.scores?.audience ?? 0}/100
                </span>
                <span className="text-xs px-3 py-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-200">
                  ⏱️ {chronoText} {chrono?.running ? "• en cours" : "• pause"}
                </span>
              </>
            ) : null}

            {excludedCount ? (
              <span className="text-xs px-3 py-1 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-200">
                Pièces écartées: {excludedCount}
              </span>
            ) : null}

            {admittedLateCount ? (
              <span className="text-xs px-3 py-1 rounded-full border border-violet-500/20 bg-violet-500/10 text-violet-200">
                Tardives admises: {admittedLateCount}
              </span>
            ) : null}

            {tasksCount ? (
              <span className="text-xs px-3 py-1 rounded-full border border-sky-500/20 bg-sky-500/10 text-sky-200">
                Actions: {tasksCount}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={isScoring || isLoadingAudience || step === "ROLE"}
              onClick={goPrev}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
            >
              ← Retour
            </button>

            <button
              disabled={isScoring || isLoadingAudience}
              onClick={goNext}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-500 hover:from-emerald-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold text-sm"
            >
              {step === "DECISION" ? "Terminer & scorer" : "Continuer →"}
            </button>
          </div>
        </div>

        {/* content */}
        <div className="mt-6">
          {/* ROLE */}
          {step === "ROLE" && (
            <div className="grid gap-4 md:grid-cols-3">
              {ROLES.map(roleCard)}
              <div className="md:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm text-slate-200 font-semibold">🎮 Mode “jeu”</div>
                <div className="text-xs text-slate-300 mt-1">
                  Choisis ton rôle. Le moteur adaptera le feedback (contradictoire, recevabilité, proportionnalité).
                </div>

                {/* ✅ SOLO / MULTIJOUEUR */}
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {GAME_MODES.map((m) => {
                    const active = (run?.answers?.gameMode || "solo") === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          const next = {
                            ...run,
                            answers: { ...(run.answers || {}), gameMode: m.id },
                          };
                          // roomId persistant en multi
                          if (m.id === "solo") {
                            next.answers.roomId = null;
                          } else {
                            next.answers.roomId = next.answers.roomId || String(Math.random()).slice(2, 8);
                          }
                          saveRunState(next);
                        }}
                        className={`text-left rounded-2xl border p-3 transition ${
                          active
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/10 bg-slate-950/30 hover:bg-white/5"
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-100">{m.label}</div>
                        <div className="mt-1 text-xs text-slate-300">{m.desc}</div>
                      </button>
                    );
                  })}
                </div>

                {(run?.answers?.gameMode || "solo") === "multi" && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="text-xs text-slate-300">
                      Salle (code) :
                      <span className="ml-2 font-semibold text-emerald-200">{run?.answers?.roomId || "—"}</span>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400">
                      Partage ce code aux autres joueurs. (La synchronisation temps réel peut être branchée côté backend
                      ensuite.)
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* BRIEFING */}
          {step === "BRIEFING" && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold text-slate-100">📌 Faits & parties</h2>
                
                {getCaseFactsFromData(caseData)?.length ? (
                  <ul className="mt-2 text-sm text-slate-300 list-disc pl-5 space-y-1">
                    {getCaseFactsFromData(caseData).map((f, i) => (
                      <li key={`fact-${i}`}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400 mt-2">Aucun fait disponible.</p>
                )}

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {Object.entries(caseData.parties || {}).map(([k, v]) => {
                    const pv = normalizePartyValue(v);
                    return (
                      <div key={k} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                        <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">{k}</div>
                        <div className="text-sm text-slate-100 font-semibold mt-1">{pv.title}</div>
                        {pv.sub ? <div className="text-xs text-slate-300 mt-1">{pv.sub}</div> : null}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <PedagogyPanel caseData={caseData} />
                </div>
              </section>

              <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <h2 className="text-sm font-semibold text-emerald-200">🧾 Pièces au dossier</h2>
                <div className="mt-3 space-y-2">
                  {(caseData.pieces || []).map((p) => (
                    <div key={p.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-100">
                          {p.id} • {p.title}
                        </div>
                        <div className="text-[11px] text-slate-400">{p.type}</div>
                      </div>
                      <div className="text-xs text-slate-300 mt-1">{(p.content || "").slice(0, 180)}…</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* QUALIFICATION */}
          {step === "QUALIFICATION" && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <h2 className="text-sm font-semibold text-emerald-200 mb-2">🧠 Qualification</h2>
                <p className="text-xs text-emerald-50/90 mb-3">
                  Décris la qualification, les questions litigieuses, et les garanties (faits → questions → règles → application).
                </p>
                <textarea
                  value={run.answers.qualification}
                  onChange={(e) =>
                    saveRunState({
                      ...run,
                      answers: { ...run.answers, qualification: e.target.value },
                    })
                  }
                  rows={10}
                  className="w-full rounded-2xl border border-emerald-500/30 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="Ex: question de recevabilité… droits de défense… délais…"
                />
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold text-slate-100 mb-2">🎯 Axes juridiques</h2>
                <ul className="space-y-2 text-sm text-slate-300">
                  {(caseData.legalIssues || []).map((x, i) => (
                    <li key={i} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                      {x}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {/* PROCEDURE */}
          {step === "PROCEDURE" && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold text-slate-100 mb-2">⚙️ Procédure</h2>
                <p className="text-xs text-slate-300 mb-3">Choisis l’orientation procédurale la plus cohérente.</p>
                <div className="space-y-2">{PROCEDURE_CHOICES.map(procedureCard)}</div>

                <div className="mt-3">
                  <textarea
                    value={run.answers.procedureJustification}
                    onChange={(e) =>
                      saveRunState({
                        ...run,
                        answers: { ...run.answers, procedureJustification: e.target.value },
                      })
                    }
                    rows={5}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400/50"
                    placeholder="Justifie en 3–6 lignes : garanties, délais, droits, charge de preuve..."
                  />
                </div>
              </section>

              <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <h2 className="text-sm font-semibold text-emerald-200 mb-2">➡️ Étape suivante : Audience IA</h2>
                <p className="text-sm text-slate-200/90">
                  Après PROCÉDURE, le jeu lance une audience simulée : objections, gestion de débats, pièces tardives,
                  audit log en direct.
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isLoadingAudience}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-500 hover:from-emerald-600 hover:to-indigo-600 disabled:opacity-60 transition font-semibold"
                    onClick={async () => {
                      await loadAudience();
                      setStep("AUDIENCE");
                    }}
                  >
                    {isLoadingAudience ? "Chargement audience..." : "Lancer l’audience →"}
                  </button>
                </div>

                {/* ✅ Progress bar verte (15s min) pendant la création/chargement d'audience */}
                {isLoadingAudience && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span>Création de l’audience...</span>
                      <span>{Math.min(100, Math.max(0, audienceLoadProgress || 0))}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-900/70 border border-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-150"
                        style={{ width: `${Math.min(100, Math.max(0, audienceLoadProgress || 0))}%` }}
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">Attente backend (minimum 15s)...</div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* AUDIENCE */}
          {step === "AUDIENCE" && (
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">🏛️ Audience simulée</h2>
                    <p className="text-xs text-slate-300 mt-1">
                      Phase interactive: objections + décisions + journal d’audience (audit log) + impact sur pièces.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`px-3 py-2 rounded-xl border text-xs transition ${
                        showPiecesImpact
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                      }`}
                      onClick={() => setShowPiecesImpact((v) => !v)}
                    >
                      Pièces (impact)
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-2 rounded-xl border text-xs transition ${
                        showAudit
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                      }`}
                      onClick={() => setShowAudit((v) => !v)}
                    >
                      Audit log
                    </button>
                  </div>
                </div>

                {/* ✅ Chrono + Incidents */}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-indigo-200/80">⏱️ Chronomètre audience</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-2xl font-bold text-slate-100">{chronoText}</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                          onClick={chronoStart}
                        >
                          Start
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                          onClick={chronoPause}
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                          onClick={chronoReset}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-300">
                      Le chrono est automatiquement enregistré dans le journal (PV) pour la notation “magistrature”.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-200/80">⚖️ Incidents procéduraux</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                        onClick={() => addProceduralIncident("NULLITE")}
                      >
                        Nullité
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                        onClick={() => addProceduralIncident("RENVOI")}
                      >
                        Renvoi
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                        onClick={() => addProceduralIncident("JONCTION")}
                      >
                        Jonction
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                        onClick={() => addProceduralIncident("DISJONCTION")}
                      >
                        Disjonction
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-xs"
                        onClick={() => addProceduralIncident("COMMUNICATION_PIECES")}
                      >
                        Communication pièces
                      </button>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-300">
                      Chaque clic est inscrit au journal d’audience + ajoute une tâche “à motiver”.
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Dialogue (extraits)</div>
                    <div className="mt-2 space-y-2 max-h-[280px] overflow-auto pr-1">
                      {(audienceScene?.turns || []).map((t, i) => (
                        <div key={i} className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                          <div className="text-xs text-slate-400">{t.speaker}</div>
                          <div className="text-sm text-slate-100 mt-1">{t.text}</div>
                        </div>
                      ))}
                      {!audienceScene?.turns?.length ? <div className="text-sm text-slate-400">Chargement...</div> : null}
                    </div>
                  </div>

                  {showPiecesImpact && (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Pièces & incidents</div>

                      <div className="mt-2 space-y-3">
                        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          <div className="text-xs text-slate-300 font-semibold">🧾 Pièces écartées</div>
                          {excludedPieces.length ? (
                            <ul className="mt-2 text-xs text-slate-200 space-y-1">
                              {excludedPieces.slice(0, 6).map((p) => (
                                <li key={p.id}>• {p.title}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-2 text-xs text-slate-400">Aucune.</div>
                          )}
                        </div>

                        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          <div className="text-xs text-slate-300 font-semibold">📎 Pièces tardives admises</div>
                          {admittedLatePieces.length ? (
                            <ul className="mt-2 text-xs text-slate-200 space-y-1">
                              {admittedLatePieces.slice(0, 6).map((p) => (
                                <li key={p.id}>• {p.title}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-2 text-xs text-slate-400">Aucune.</div>
                          )}
                        </div>

                        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          <div className="text-xs text-slate-300 font-semibold">✅ Actions / tâches</div>
                          {tasks.length ? (
                            <ul className="mt-2 text-xs text-slate-200 space-y-1">
                              {tasks.slice(0, 8).map((t, i) => (
                                <li key={i}>• {t.label || t.type}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-2 text-xs text-slate-400">Aucune.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {showAudit && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300">Journal d’audience (live)</div>
                    {recentAudit.length ? (
                      <div className="mt-2 space-y-2 max-h-[360px] overflow-auto pr-1">
                        {recentAudit.map((a, idx) => (
                          <div key={idx} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs text-slate-200">
                                <span className="text-slate-400">{formatTime(a.at)}</span> •{" "}
                                <span className="text-slate-100 font-semibold">{a.kind}</span>
                              </div>
                              <div className="text-[11px] text-slate-400">{a.action}</div>
                            </div>
                            {a.detail ? <div className="mt-1 text-xs text-slate-300">{a.detail}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-400">Aucune action enregistrée pour le moment.</div>
                    )}
                  </div>
                )}
              </section>

              {/* Objections */}
              <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <h2 className="text-sm font-semibold text-emerald-200 mb-2">🎯 Objections à trancher</h2>
                <p className="text-xs text-emerald-50/90 mb-3">
                  Choisis une décision. La motivation est <b>verrouillée</b> : clique “Modifier” pour éditer puis “Enregistrer”.
                </p>

                {(audienceScene?.objections || []).length === 0 ? (
                  <div className="text-sm text-slate-300">Aucune objection.</div>
                ) : (
                  <div className="space-y-3">
                    {(audienceScene?.objections || []).map((obj) => {
                      const d = getDecisionForObj(obj.id);
                      const current = { decision: d?.decision || "", reasoning: d?.reasoning || "" };

                      const isEditing = !!editReasoningById[obj.id];
                      const role = (run.answers?.role || "").trim() || "Juge";
                      const best = bestChoiceForRole(obj, role);

                      return (
                        <div key={obj.id} className="rounded-2xl border border-emerald-500/30 bg-slate-950/60 p-4">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/80">
                            {obj.by} • {obj.id}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-100">{obj.title}</div>
                          <div className="mt-2 text-sm text-slate-200/90">{obj.statement}</div>

                          <div className="mt-2 text-[11px] text-slate-300">
                            IA instant (rôle {role}) : option souvent la plus sûre →{" "}
                            <span className="text-slate-100 font-semibold">“{best}”</span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {(obj.options || ["Accueillir", "Rejeter", "Demander précision"]).map((opt) => {
                              const active = (current?.decision || "") === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  className={`px-3 py-2 rounded-xl border text-xs transition ${
                                    active
                                      ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-100"
                                      : "border-white/10 bg-white/5 hover:bg-white/10 text-slate-100"
                                  }`}
                                  onClick={() => {
                                    const rr = isEditing
                                      ? (draftReasoningById[obj.id] ?? current?.reasoning ?? "")
                                      : (current?.reasoning || "");
                                    applyDecisionHybrid(obj, opt, rr);
                                  }}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] text-slate-400">
                                Motivation (2–5 phrases). {isEditing ? "✍️ édition" : "🔒 verrouillé"}
                              </div>

                              {!isEditing ? (
                                <button
                                  type="button"
                                  className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
                                  onClick={() => {
                                    setEditReasoningById((mm) => ({ ...(mm || {}), [obj.id]: true }));
                                    setDraftReasoningById((mm) => ({ ...(mm || {}), [obj.id]: current?.reasoning || "" }));
                                  }}
                                >
                                  Modifier
                                </button>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className="text-[11px] px-2 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15 transition text-emerald-100"
                                    onClick={() => {
                                      const val = (draftReasoningById[obj.id] ?? current?.reasoning ?? "").trim();
                                      const chosen = (current?.decision || "").trim() || "Demander précision";
                                      applyDecisionHybrid(obj, chosen, val);
                                      setEditReasoningById((mm) => ({ ...(mm || {}), [obj.id]: false }));
                                    }}
                                  >
                                    Enregistrer
                                  </button>
                                  <button
                                    type="button"
                                    className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
                                    onClick={() => {
                                      setEditReasoningById((mm) => ({ ...(mm || {}), [obj.id]: false }));
                                      setDraftReasoningById((mm) => {
                                        const next = { ...(mm || {}) };
                                        delete next[obj.id];
                                        return next;
                                      });
                                    }}
                                  >
                                    Annuler
                                  </button>
                                </div>
                              )}
                            </div>

                            <textarea
                              value={
                                isEditing
                                  ? (draftReasoningById[obj.id] ?? current?.reasoning ?? "")
                                  : (current?.reasoning || "")
                              }
                              onChange={(e) => {
                                if (!isEditing) return;
                                setDraftReasoningById((mm) => ({ ...(mm || {}), [obj.id]: e.target.value }));
                              }}
                              rows={3}
                              disabled={!isEditing}
                              className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm text-slate-100 outline-none ${
                                isEditing
                                  ? "border-emerald-500/30 bg-slate-950/70 focus:border-emerald-400"
                                  : "border-white/10 bg-slate-950/40 opacity-80 cursor-not-allowed"
                              }`}
                              placeholder="Justification courte : contradictoire, pertinence, régularité, droits de défense…"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* DECISION */}
          {step === "DECISION" && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <h2 className="text-sm font-semibold text-emerald-200 mb-2">🧾 Motivation</h2>
                <p className="text-xs text-emerald-50/90 mb-3">Faits → Questions → Droit → Application → Conclusion</p>

                <textarea
                  value={run.answers.decisionMotivation}
                  onChange={(e) =>
                    saveRunState({
                      ...run,
                      answers: { ...run.answers, decisionMotivation: e.target.value },
                    })
                  }
                  rows={10}
                  className="w-full rounded-2xl border border-emerald-500/30 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="Attendu que… Considérant que… Au regard de…"
                  disabled={isScoring}
                />

                <div className="mt-4">
                  <PedagogyPanel caseData={caseData} compact />
                </div>
              </section>

              <section className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4">
                <h2 className="text-sm font-semibold text-slate-100 mb-2">Dispositif</h2>

                <textarea
                  value={run.answers.decisionDispositif}
                  onChange={(e) =>
                    saveRunState({
                      ...run,
                      answers: { ...run.answers, decisionDispositif: e.target.value },
                    })
                  }
                  rows={10}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400/50"
                  placeholder="Par ces motifs… Le tribunal…"
                  disabled={isScoring}
                />

                {isScoring ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-slate-300">Scoring en cours…</div>
                    <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-2 bg-emerald-500/80" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-400 mt-2">{progress}%</div>
                  </div>
                ) : null}

                {scoreError ? (
                  <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {scoreError}
                  </div>
                ) : null}

                {appealError ? (
                  <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                    {appealError}
                  </div>
                ) : null}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}