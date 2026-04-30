import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { readRuns, writeRuns } from "../justiceLab/storage.js";
import {
  mergeAudienceWithTemplates,
  setAudienceScene as setAudienceSceneOnRun,
  applyAudienceDecision,
  startChrono,
  stopChrono,
  setChronoElapsed,
  recordIncident,
} from "../justiceLab/engine.js";

const API_BASE = (
  import.meta?.env?.VITE_API_URL ||
  import.meta?.env?.VITE_API_BASE ||
  "https://droitgpt-indexer.onrender.com"
).replace(/\/$/, "");

const KEY_ACTIVE = "justiceLabActiveRun";

/* ---------------- Utils ---------------- */
const cls = (...a) => a.filter(Boolean).join(" ");
const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

function getAuthToken() {
  // ✅ IMPORTANT: tu as un token sous 'droitgpt_access_token'
  const candidates = [
    "token",
    "authToken",
    "accessToken",
    "droitgpt_token",
    "droitgpt_access_token",
  ];
  for (const k of candidates) {
    const v = localStorage.getItem(k);
    if (v && v.trim().length > 10) return v.trim();
  }
  return "";
}

function getActiveRunLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY_ACTIVE) || "null");
  } catch {
    return null;
  }
}

function setActiveRunLocal(run) {
  localStorage.setItem(KEY_ACTIVE, JSON.stringify(run));
}

function upsertRunInHistory(run) {
  const runs = readRuns();
  const idx = runs.findIndex((r) => r?.runId === run.runId);
  const next = [...runs];
  if (idx >= 0) next[idx] = run;
  else next.unshift(run);
  writeRuns(next.slice(0, 80));
}

/* ----------- Résolution dossier dynamique ----------- */
function resolveCaseDataFromRun(run) {
  if (!run) return null;
  const cm = run.caseMeta || {};
  if (cm.caseData && typeof cm.caseData === "object") return cm.caseData;

  if (cm.resume || cm.parties || cm.pieces) {
    return {
      caseId: cm.caseId || run.caseId || "CASE",
      titre: cm.titre || "Dossier judiciaire",
      domaine: cm.domaine || "Autre",
      niveau: cm.niveau || "Intermédiaire",
      resume: cm.resume || "",
      parties: cm.parties || {},
      pieces: cm.pieces || [],
      legalIssues: cm.legalIssues || [],
    };
  }
  return null;
}

/* ---------------- Backend helpers ---------------- */
async function postJSON(url, body) {
  const token = getAuthToken();
  if (!token || token.length < 10) throw new Error("AUTH_TOKEN_MISSING");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`HTTP_${r.status}: ${txt.slice(0, 200)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function computePiecesBoard(run, caseData) {
  const base = Array.isArray(caseData?.pieces) ? caseData.pieces : [];
  const decisions = run?.answers?.audience?.decisions || [];

  const ex = new Set();
  const late = new Set();

  decisions.forEach((d) => {
    const e = d.effects || {};
    (e.excludePieceIds || []).forEach((x) => ex.add(x));
    (e.admitLatePieceIds || []).forEach((x) => late.add(x));
  });

  const effective = base.map((p) => ({
    ...p,
    status: ex.has(p.id) ? "EXCLUDEE" : late.has(p.id) ? "TARDIVE_ADMISE" : "OK",
  }));

  return {
    effective,
    okPieces: effective.filter((p) => p.status === "OK"),
    excludedPieces: effective.filter((p) => p.status === "EXCLUDEE"),
    latePieces: effective.filter((p) => p.status === "TARDIVE_ADMISE"),
  };
}

export default function JusticeLabAudience() {
  const navigate = useNavigate();
  const location = useLocation();

  const [run, setRun] = useState(null);
  const [caseData, setCaseData] = useState(null);

  const [turns, setTurns] = useState([]);
  const [objections, setObjections] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [choice, setChoice] = useState("Demander précision");
  const [reasoning, setReasoning] = useState("");
  const [locked, setLocked] = useState(false);

  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ✅ Greffier tools
  const [incidentType, setIncidentType] = useState("communication");
  const [incidentDetail, setIncidentDetail] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);

  const commitRun = (nextRun) => {
    if (!nextRun?.runId) return;
    setRun(nextRun);
    try {
      setActiveRunLocal(nextRun);
      upsertRunInHistory(nextRun);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const navRun = location?.state?.runData || null;
    if (navRun?.runId) {
      setActiveRunLocal(navRun);
      upsertRunInHistory(navRun);
      setRun(navRun);
      return;
    }
    const active = getActiveRunLocal();
    if (active?.runId) {
      setRun(active);
      return;
    }
    const hist = readRuns();
    if (hist?.[0]) {
      setActiveRunLocal(hist[0]);
      setRun(hist[0]);
    }
  }, [location?.state]);

  // ✅ sync elapsed from run
  useEffect(() => {
    setElapsedMs(run?.state?.chrono?.elapsedMs || 0);
  }, [run?.state?.chrono?.elapsedMs]);

  // ✅ tick chrono when running
  useEffect(() => {
    if (!run?.state?.chrono?.running) return;
    const id = setInterval(() => {
      setElapsedMs((prev) => {
        const next = prev + 1000;
        const patched = setChronoElapsed(run, next);
        commitRun(patched);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.state?.chrono?.running, run?.runId]);

  useEffect(() => {
    if (run) setCaseData(resolveCaseDataFromRun(run));
  }, [run]);

  const role = run?.answers?.role || "Juge";
  const canJudgeDecide = role === "Juge";
  const canGreffierAct = role === "Greffier";
  const audit = run?.state?.auditLog || [];
  const piecesBoard = useMemo(() => (run && caseData ? computePiecesBoard(run, caseData) : null), [run, caseData]);

  const selectedObj = objections.find((o) => o.id === selectedId) || null;

  // ✅ si déjà décidé, verrouiller automatiquement
  useEffect(() => {
    if (!run || !selectedObj) return;
    const exists = (run?.answers?.audience?.decisions || []).some((d) => d.objectionId === selectedObj.id);
    setLocked(Boolean(exists));
    if (exists) setFeedback({ ok: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId, selectedId]);

  async function loadAudience() {
    if (!run || !caseData) return;
    setLoading(true);
    setError("");

    try {
      const payload = {
        type: "justicelab_audience_scene",
        data: {
          caseId: caseData.caseId,
          domaine: caseData.domaine,
          niveau: caseData.niveau,
          resume: caseData.resume,
          pieces: caseData.pieces,
          legalIssues: caseData.legalIssues,
          role,
        },
      };

      const data = await postJSON(`${API_BASE}/ask`, payload);
      const scene = data?.audience || data?.scene || data?.result?.audience || null;

      const merged = mergeAudienceWithTemplates(caseData, scene);
      const next = setAudienceSceneOnRun(run, merged);

      commitRun(next);

      // ✅ FIX: mergeAudienceWithTemplates renvoie "turns" (pas "transcript")
      setTurns(merged.turns || []);
      setObjections(merged.objections || []);
      setSelectedId(merged.objections?.[0]?.id || null);
    } catch (e) {
      setError(e?.message || "Erreur lors du chargement de l’audience.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (run && caseData && !run?.answers?.audience?.scene) loadAudience();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId, caseData?.caseId]);

  async function saveDecision() {
    if (!run || !selectedObj) return;

    // ✅ Contrôle strict : seul le Juge peut enregistrer une décision
    if (!canJudgeDecide) {
      setFeedback({ ok: false, msg: `Action bloquée : vous jouez le rôle “${role}”. Seul le Juge peut trancher.` });
      return;
    }

    // ✅ IMPORTANT: transmettre les "effects" de l’objection, sinon les pièces ne changent pas
    const next = applyAudienceDecision(run, {
      objectionId: selectedObj.id,
      decision: choice,
      reasoning,
      role,
      effects: selectedObj.effects || null,
    });

    commitRun(next);
    setLocked(true);
    setFeedback({ ok: true });
  }

  function backToPlay() {
    navigate("/justice-lab");
  }

  if (!run || !caseData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-slate-200 font-semibold">Audience introuvable.</p>
          <Link className="mt-3 inline-flex text-emerald-300 underline" to="/justice-lab">
            Retour Justice Lab
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-6">
        <div className="flex justify-between items-start gap-4">
          <div>
            <Link to="/justice-lab" className="text-xs text-slate-400 hover:underline">
              Justice Lab
            </Link>
            <h1 className="text-2xl font-bold mt-1">🏛️ Audience simulée</h1>
            <div className="mt-2 text-xs text-slate-400">
              {caseData.domaine} • Niveau {caseData.niveau} • Rôle {role}
            </div>
          </div>
          <button
            onClick={backToPlay}
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10"
          >
            ← Retour
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error === "AUTH_TOKEN_MISSING"
              ? "Token manquant : reconnecte-toi puis relance l’audience."
              : error}
          </div>
        )}

        <div className="mt-6 grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-semibold mb-2">Transcription</h2>
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {turns.map((t, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="text-xs text-slate-400">{t.speaker}</div>
                    <div className="text-sm">{t.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {piecesBoard && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold mb-2">Pièces</h2>
                <div className="grid md:grid-cols-2 gap-2">
                  {piecesBoard.effective.map((p) => (
                    <div
                      key={p.id}
                      className={cls(
                        "rounded-xl border p-3 text-xs",
                        p.status === "EXCLUDEE"
                          ? "border-amber-500/30 bg-amber-500/10"
                          : p.status === "TARDIVE_ADMISE"
                          ? "border-violet-500/30 bg-violet-500/10"
                          : "border-white/10 bg-slate-950/40"
                      )}
                    >
                      <div className="font-semibold">{p.title}</div>
                      <div className="opacity-70">{p.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-semibold mb-2">Journal d’audience</h2>
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {audit.map((a, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs">
                    <div className="text-slate-400">
                      {formatTime(a.ts || a.at)} • {a.title || a.action}
                    </div>
                    {a.detail && <div className="mt-1">{a.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* ✅ Mode Greffier */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">📝 Mode Greffier</h2>
                  <div className="mt-1 text-xs text-slate-400">
                    Chrono + incidents procéduraux → journal.
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400">Chronomètre</div>
                  <div className="text-lg font-bold">
                    {String(Math.floor((elapsedMs || 0) / 60000)).padStart(2, "0")}:
                    {String(Math.floor(((elapsedMs || 0) % 60000) / 1000)).padStart(2, "0")}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={!canGreffierAct}
                  onClick={() => {
                    if (!canGreffierAct) return;
                    commitRun(startChrono(run));
                  }}
                  className={`px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs ${
                    canGreffierAct ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  ▶️ Démarrer
                </button>
                <button
                  type="button"
                  disabled={!canGreffierAct}
                  onClick={() => {
                    if (!canGreffierAct) return;
                    commitRun(stopChrono(run));
                  }}
                  className={`px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs ${
                    canGreffierAct ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  ⏸️ Pause
                </button>
                <button
                  type="button"
                  disabled={!canGreffierAct}
                  onClick={() => {
                    if (!canGreffierAct) return;
                    setElapsedMs(0);
                    commitRun(setChronoElapsed(run, 0));
                  }}
                  className={`px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs ${
                    canGreffierAct ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  🔄 Reset
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <select
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value)}
                  disabled={!canGreffierAct}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs outline-none"
                >
                  <option value="nullite">Nullité</option>
                  <option value="renvoi">Renvoi</option>
                  <option value="jonction">Jonction</option>
                  <option value="disjonction">Disjonction</option>
                  <option value="communication">Communication de pièces</option>
                </select>

                <textarea
                  value={incidentDetail}
                  onChange={(e) => setIncidentDetail(e.target.value)}
                  disabled={!canGreffierAct}
                  placeholder="Détail / motif (1–3 lignes)"
                  className="w-full min-h-[72px] rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs outline-none"
                />

                <button
                  type="button"
                  disabled={!canGreffierAct}
                  onClick={() => {
                    if (!canGreffierAct) {
                      setFeedback({
                        ok: false,
                        msg: `Action bloquée : vous jouez le rôle “${role}”. Seul le Greffier gère le journal.`,
                      });
                      return;
                    }
                    const labelMap = {
                      nullite: "Incident: nullité",
                      renvoi: "Incident: renvoi",
                      jonction: "Incident: jonction",
                      disjonction: "Incident: disjonction",
                      communication: "Incident: communication de pièces",
                    };
                    const next = recordIncident(run, {
                      type: incidentType,
                      detail: incidentDetail || "(sans détail)",
                      by: role || "Greffier",
                      title: labelMap[incidentType] || "Incident procédural",
                    });
                    commitRun(next);
                    setIncidentDetail("");
                  }}
                  className={`w-full px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs font-semibold ${
                    canGreffierAct ? "hover:bg-emerald-500/15" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  ➕ Ajouter au journal
                </button>
              </div>
            </div>

            {/* Objections */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-semibold mb-2">🎯 Objections</h2>
              <div className="space-y-2">
                {objections.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelectedId(o.id);
                      setLocked(false);
                      setReasoning("");
                      setChoice("Demander précision");
                      setFeedback(null);
                    }}
                    className={cls(
                      "w-full text-left rounded-xl border p-3",
                      selectedId === o.id
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-white/10 bg-slate-950/40"
                    )}
                  >
                    <div className="text-xs text-slate-400">{o.by}</div>
                    <div className="font-semibold text-sm">{o.title}</div>
                  </button>
                ))}
              </div>
            </div>

            {selectedObj && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold mb-2">Décision</h2>

                <div className="flex gap-2 flex-wrap mb-2">
                  {["Accueillir", "Rejeter", "Demander précision"].map((opt) => (
                    <button
                      key={opt}
                      disabled={!canJudgeDecide}
                      onClick={() => {
                        if (!canJudgeDecide) {
                          setFeedback({
                            ok: false,
                            msg: `Action bloquée : vous jouez le rôle “${role}”. Seul le Juge décide.`,
                          });
                          return;
                        }
                        setChoice(opt);
                      }}
                      className={cls(
                        "px-3 py-2 rounded-xl border text-xs",
                        !canJudgeDecide && "opacity-50 cursor-not-allowed",
                        choice === opt
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-white/10 bg-white/5"
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                <textarea
                  value={reasoning}
                  onChange={(e) => setReasoning(e.target.value)}
                  placeholder="Motivation courte (2–5 phrases)…"
                  className="w-full min-h-[120px] rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs outline-none"
                  disabled={locked || !canJudgeDecide}
                />

                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    onClick={saveDecision}
                    disabled={locked || !canJudgeDecide}
                    className={cls(
                      "px-4 py-2 rounded-xl text-xs font-semibold",
                      locked || !canJudgeDecide
                        ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                        : "bg-emerald-500 hover:bg-emerald-600 text-white"
                    )}
                  >
                    Enregistrer
                  </button>
                  {feedback?.ok ? (
                    <div className="text-xs text-emerald-300">✅ Décision enregistrée</div>
                  ) : feedback?.msg ? (
                    <div className="text-xs text-rose-200">{feedback.msg}</div>
                  ) : null}
                </div>
              </div>
            )}

            {loading && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300">
                Chargement de l’audience…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
