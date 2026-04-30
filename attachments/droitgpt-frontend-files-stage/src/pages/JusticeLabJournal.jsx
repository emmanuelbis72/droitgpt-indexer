import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { readRuns, setActiveRunId, upsertAndSetActive } from "../justiceLab/storage.js";
import { CASES, buildGreffierPV, gradeMagistratureExam } from "../justiceLab/cases.js";
import { getPiecesStatusSummary } from "../justiceLab/engine.js";

const API_BASE =
  (import.meta?.env?.VITE_API_URL || import.meta?.env?.VITE_API_BASE || "https://droitgpt-indexer.onrender.com").replace(
    /\/$/,
    ""
  );

const CASE_CACHE_KEY_V2 = "justicelab_caseCache_v2";

function getAuthToken() {
  // ✅ FIX: inclure la clé réelle observée chez toi
  const candidates = ["token", "authToken", "accessToken", "droitgpt_token", "droitgpt_access_token"];
  for (const k of candidates) {
    const v = localStorage.getItem(k);
    if (v && v.trim().length > 10) return v.trim();
  }
  return null;
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

function DecisionBadgeClass(decision) {
  const d = String(decision || "").toUpperCase();
  if (d === "CONFIRMATION") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-100";
  if (d === "ANNULATION") return "border-rose-500/60 bg-rose-500/10 text-rose-100";
  return "border-amber-500/60 bg-amber-500/10 text-amber-100";
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}

function cls(...a) {
  return a.filter(Boolean).join(" ");
}

function loadCaseFromCache(caseId) {
  try {
    const raw = localStorage.getItem(CASE_CACHE_KEY_V2);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj[caseId] || null;
  } catch {
    return null;
  }
}

function resolveCaseDataFromRun(run) {
  if (!run) return null;

  // 1) si tu as stocké caseData complet dans run.caseMeta.caseData
  const metaCase = run.caseMeta?.caseData;
  if (metaCase && typeof metaCase === "object") return metaCase;

  const cid = run.caseId || run.caseMeta?.caseId || run.caseMeta?.id;
  if (!cid) return null;

  // 2) cas statiques (CASES)
  const fromStatic = CASES.find((c) => c.caseId === cid || c.id === cid);
  if (fromStatic) return fromStatic;

  // 3) cache localStorage (dossiers IA générés)
  const fromCache = loadCaseFromCache(cid);
  if (fromCache) return fromCache;

  // 4) fallback minimal depuis meta
  if (run.caseMeta?.titre || run.caseMeta?.domaine || run.caseMeta?.niveau) {
    return {
      caseId: cid,
      titre: run.caseMeta?.titre || "Dossier",
      domaine: run.caseMeta?.domaine || "Autre",
      niveau: run.caseMeta?.niveau || "Intermédiaire",
      pieces: run.caseMeta?.pieces || [],
      legalIssues: run.caseMeta?.legalIssues || [],
      resume: run.caseMeta?.resume || "",
      parties: run.caseMeta?.parties || {},
    };
  }

  return null;
}

function downloadTextFile(filename, text) {
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function JusticeLabJournal() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const id = decodeURIComponent(runId || "");

  const run = useMemo(() => {
    const all = readRuns();
    return all.find((r) => r.runId === id) || null;
  }, [id]);

  const caseData = useMemo(() => resolveCaseDataFromRun(run), [run]);

  const [appeal, setAppeal] = useState(run?.appeal || null);
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealError, setAppealError] = useState(null);

  // ✅ Greffier PV
  const [pvOpen, setPvOpen] = useState(false);
  const [pvText, setPvText] = useState("");
  const [greffierName, setGreffierName] = useState("Le Greffier");

  // ✅ Examen
  const [examOpen, setExamOpen] = useState(false);
  const [examResult, setExamResult] = useState(null);

  useEffect(() => {
    if (!run?.runId) return;
    try {
      setActiveRunId(run.runId);
      upsertAndSetActive(run);
    } catch {
      // ignore
    }
  }, [run?.runId]);

  useEffect(() => {
    setAppeal(run?.appeal || null);
  }, [run]);

  if (!run || !caseData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-slate-300">Journal introuvable.</p>
          <Link className="mt-3 inline-flex text-emerald-300 underline" to="/justice-lab">
            Retour Justice Lab
          </Link>
        </div>
      </div>
    );
  }

  const piecesSummary = getPiecesStatusSummary(run, caseData);
  const pieces = [...piecesSummary.ok, ...piecesSummary.admittedLate, ...piecesSummary.excluded];

  const excluded = piecesSummary.excluded || [];
  const late = piecesSummary.admittedLate || [];
  const tasks = Array.isArray(run?.state?.pendingTasks) ? run.state.pendingTasks : [];
  const log = Array.isArray(run?.state?.auditLog) ? run.state.auditLog : [];

  const goAudience = () => navigate("/justice-lab/audience", { state: { runData: run, caseData } });

  const goAppeal = () => {
    navigate("/justice-lab/appeal", {
      state: {
        runData: run,
        caseData,
        scored: run.ai || { scoreGlobal: run.scoreGlobal, scores: run.scores, flags: run.flags },
      },
    });
  };

  const refreshAppeal = async () => {
    setAppealError(null);
    setAppealLoading(true);
    try {
      const appealAI = await postJSON(`${API_BASE}/justice-lab/appeal`, {
        caseData,
        runData: run,
        scored: run.ai || { scoreGlobal: run.scoreGlobal, scores: run.scores, flags: run.flags },
      });

      setAppeal(appealAI);

      const nextRun = { ...run, appeal: appealAI };
      upsertAndSetActive(nextRun);
      setActiveRunId(nextRun.runId);
    } catch (e) {
      setAppealError(e?.message || "Erreur cour d'appel IA");
    } finally {
      setAppealLoading(false);
    }
  };

  const buildPV = () => {
    const res = buildGreffierPV({
      caseData,
      runData: run,
      journalEntries: log,
      greffierName: greffierName || "Le Greffier",
    });
    setPvText(res?.pvText || "");
    setPvOpen(true);
  };

  const gradeExam = () => {
    const decisionText = `${run?.answers?.decisionMotivation || ""}\n\n${run?.answers?.decisionDispositif || ""}`.trim();
    const result = gradeMagistratureExam({
      caseData,
      runData: run,
      journalEntries: log,
      decisionText,
    });
    setExamResult(result);
    setExamOpen(true);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 py-6">
      <div className="w-full max-w-6xl mx-auto rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="px-6 md:px-8 py-6 border-b border-white/10 bg-slate-950/70 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">JUSTICE LAB • JOURNAL</div>
            <h1 className="mt-2 text-2xl font-semibold text-amber-200">{run.caseMeta?.titre || caseData?.titre}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {(run.caseMeta?.domaine || caseData?.domaine) ?? "—"} • {(run.caseMeta?.niveau || caseData?.niveau) ?? "—"} • Rôle :{" "}
              <span className="text-slate-100 font-semibold">{run.answers?.role || "—"}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs md:text-sm">
            <Link
              to="/justice-lab"
              className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 transition"
            >
              ⬅️ Justice Lab
            </Link>

            <Link
              to={`/justice-lab/results/${encodeURIComponent(run.runId)}`}
              className="px-4 py-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 transition"
            >
              ✅ Résultats
            </Link>

            <button
              type="button"
              onClick={goAudience}
              className="px-4 py-2 rounded-full border border-amber-500/70 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 transition"
            >
              🏛️ Audience
            </button>

            <button
              type="button"
              onClick={goAppeal}
              className="px-4 py-2 rounded-full border border-rose-500/70 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20 transition"
            >
              ⚖️ Appel
            </button>

            <button
              type="button"
              onClick={buildPV}
              className="px-4 py-2 rounded-full border border-sky-500/70 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20 transition"
            >
              🖋️ PV certifié
            </button>

            <button
              type="button"
              onClick={gradeExam}
              className="px-4 py-2 rounded-full border border-violet-500/70 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20 transition"
            >
              🎓 Mode Examen
            </button>
          </div>
        </div>

        <div className="px-6 md:px-8 py-6 space-y-6">
          {/* PV modal */}
          {pvOpen && (
            <section className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-sky-200">🖋️ PV d’audience certifié (Mode Greffier)</h2>
                  <p className="mt-1 text-xs text-slate-300">Généré depuis le journal + pièces + mentions.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <input
                    value={greffierName}
                    onChange={(e) => setGreffierName(e.target.value)}
                    className="px-3 py-2 rounded-full border border-white/10 bg-slate-950/60 text-xs outline-none"
                    placeholder="Nom du greffier"
                  />
                  <button
                    onClick={() => {
                      const res = buildGreffierPV({ caseData, runData: run, journalEntries: log, greffierName });
                      setPvText(res?.pvText || "");
                    }}
                    className="px-4 py-2 rounded-full border border-sky-500/60 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20 text-xs"
                  >
                    🔄 Regénérer
                  </button>
                  <button
                    onClick={() => downloadTextFile(`PV_${caseData.caseId || "dossier"}.txt`, pvText || "")}
                    className="px-4 py-2 rounded-full border border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 text-xs"
                  >
                    ⬇️ Télécharger
                  </button>
                  <button
                    onClick={() => setPvOpen(false)}
                    className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 text-xs"
                  >
                    ✖ Fermer
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <textarea
                  value={pvText}
                  onChange={(e) => setPvText(e.target.value)}
                  className="w-full min-h-[240px] rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-xs outline-none whitespace-pre-wrap"
                />
              </div>
            </section>
          )}

          {/* Exam modal */}
          {examOpen && examResult && (
            <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-violet-200">🎓 Notation (Mode Examen)</h2>
                  <p className="mt-1 text-xs text-slate-300">Grille magistrature — score /100 + rubriques.</p>
                </div>
                <button
                  onClick={() => setExamOpen(false)}
                  className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 text-xs"
                >
                  ✖ Fermer
                </button>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm text-slate-100">
                    Score : <span className="font-bold">{examResult.score}</span>/100
                  </div>
                  <div className="text-xs text-slate-300">{examResult.appreciation}</div>
                </div>

                <div className="mt-3 grid md:grid-cols-2 gap-3 text-xs">
                  {Object.entries(examResult.rubric || {}).map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-slate-200 font-semibold">{k}</div>
                      <div className="mt-1 text-slate-300">
                        {v.score}/{v.max}
                      </div>
                    </div>
                  ))}
                </div>

                {Array.isArray(examResult.recommandations) && examResult.recommandations.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Recommandations</div>
                    <ul className="mt-2 text-xs text-slate-300 space-y-1 list-disc list-inside">
                      {examResult.recommandations.slice(0, 10).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Cour d’appel IA */}
          <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-violet-200">🏛️ Cour d’appel (IA)</h2>
                <p className="mt-1 text-xs text-slate-300">
                  Issue probable : confirmation / annulation / renvoi (simulation pédagogique).
                </p>
              </div>

              <button
                type="button"
                onClick={refreshAppeal}
                disabled={appealLoading}
                className={`px-4 py-2 rounded-full border text-xs transition ${
                  appealLoading
                    ? "border-slate-700 bg-slate-900/60 text-slate-400 cursor-not-allowed"
                    : "border-violet-500/60 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
                }`}
              >
                {appealLoading ? "⏳ Rafraîchissement..." : "🔄 Rafraîchir Cour d’appel"}
              </button>
            </div>

            {appealError && (
              <div className="mt-3 text-xs text-amber-200">
                ⚠️{" "}
                {appealError === "AUTH_TOKEN_MISSING"
                  ? "Token manquant : reconnecte-toi puis relance la Cour d’appel."
                  : appealError}
              </div>
            )}

            {!appeal ? (
              <p className="mt-3 text-sm text-slate-300">Aucune décision d’appel enregistrée. Clique sur “Rafraîchir”.</p>
            ) : (
              <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm text-slate-200">
                    Décision : <span className="font-semibold">{String(appeal.decision || "RENVOI").toUpperCase()}</span>
                  </p>
                  <span className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${DecisionBadgeClass(appeal.decision)}`}>
                    {String(appeal.decision || "RENVOI").toUpperCase()}
                  </span>
                </div>

                <ul className="mt-2 text-xs text-slate-300 space-y-1 list-disc list-inside">
                  {(appeal.grounds || []).slice(0, 8).map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>

                {appeal.dispositif && (
                  <div className="mt-3 text-xs text-slate-200/90 whitespace-pre-wrap">
                    <span className="text-slate-400">Dispositif : </span>
                    {appeal.dispositif}
                  </div>
                )}

                {Array.isArray(appeal.recommendations) && appeal.recommendations.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Recommandations</div>
                    <ul className="mt-2 text-xs text-slate-300 space-y-1 list-disc list-inside">
                      {appeal.recommendations.slice(0, 8).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4">
              <h2 className="text-sm font-semibold text-slate-100 mb-2">🧾 Journal des actes</h2>

              {log.length ? (
                <div className="space-y-2">
                  {log.map((l, i) => (
                    <div key={l.id || i} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                        {(l.type || l.kind || "LOG")} • {fmtDate(l.ts || l.at)}
                      </div>
                      <div className="text-sm text-slate-100 font-semibold mt-1">{l.title || l.action || "Action"}</div>
                      {l.detail ? <div className="text-xs text-slate-300 mt-1">{l.detail}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Aucun acte enregistré.</p>
              )}
            </section>

            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <h2 className="text-sm font-semibold text-emerald-200 mb-2">📌 Mesures / tâches</h2>

              {tasks.length ? (
                <div className="space-y-2">
                  {tasks.map((t, i) => (
                    <div key={t.id || i} className="rounded-xl border border-emerald-500/30 bg-slate-950/60 p-3">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/80">
                        {t.type || "TASK"} • {fmtDate(t.ts || t.createdAt)}
                      </div>
                      <div className="text-sm font-semibold text-slate-100 mt-1">{t.label}</div>
                      {t.detail ? <div className="text-xs text-slate-300 mt-1">{t.detail}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Aucune mesure.</p>
              )}

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
                Risk modifiers : bonus{" "}
                <span className="font-semibold">{run.state?.riskModifiers?.dueProcessBonus || 0}</span> / penalty{" "}
                <span className="font-semibold">{run.state?.riskModifiers?.appealRiskPenalty || 0}</span>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <h2 className="text-sm font-semibold text-amber-200 mb-2">📎 Pièces (état du dossier)</h2>

            {excluded.length > 0 && (
              <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
                <div className="text-xs font-semibold text-rose-100">Pièces écartées</div>
                <div className="mt-2 text-xs text-rose-50/90">{excluded.map((p) => `${p.id} — ${p.title}`).join(" • ")}</div>
              </div>
            )}

            {late.length > 0 && (
              <div className="mb-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3">
                <div className="text-xs font-semibold text-sky-100">Pièces admises tardivement</div>
                <div className="mt-2 text-xs text-sky-50/90">{late.map((p) => `${p.id} — ${p.title}`).join(" • ")}</div>
              </div>
            )}

            <div className="grid gap-2">
              {pieces.map((p) => (
                <div
                  key={p.id}
                  className={cls(
                    "rounded-xl border p-3",
                    p.status === "EXCLUDEE"
                      ? "border-rose-500/40 bg-rose-500/5 text-slate-500"
                      : "border-white/10 bg-white/5 text-slate-100"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                        {p.type} • {p.id}
                      </div>
                      <div className="text-sm font-semibold">{p.title}</div>
                    </div>
                    <div className="flex gap-2 text-[11px]">
                      {p.status === "EXCLUDEE" ? (
                        <span className="px-2 py-1 rounded-full border border-rose-500/60 bg-rose-500/10 text-rose-100">
                          Écartée
                        </span>
                      ) : p.status === "TARDIVE_ADMISE" ? (
                        <span className="px-2 py-1 rounded-full border border-sky-500/60 bg-sky-500/10 text-sky-100">
                          Admise tardive
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className={cls("mt-2 text-xs", p.status === "EXCLUDEE" ? "line-through" : "opacity-90")}>{p.content}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
