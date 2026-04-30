import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { readRuns, readStats } from "../justiceLab/storage.js";

function Badge({ score }) {
  if (!score) return { label: "Début", color: "bg-slate-800 border-slate-600 text-slate-100" };
  if (score < 50) return { label: "En progression", color: "bg-slate-800 border-slate-600 text-slate-100" };
  if (score < 70) return { label: "Magistrat opérationnel", color: "bg-emerald-900/40 border-emerald-500/60 text-emerald-100" };
  if (score < 85) return { label: "Magistrat confirmé", color: "bg-sky-900/40 border-sky-500/60 text-sky-100" };
  return { label: "Magistrat expert", color: "bg-violet-900/40 border-violet-500/70 text-violet-100" };
}

export default function JusticeLabDashboard() {
  const stats = useMemo(() => readStats(), []);
  const runs = useMemo(() => readRuns(), []);
  const badge = Badge({ score: stats.avgScore });

  const lastRun = runs?.[0] || null;

  const skills = stats.skills || {};
  const radar = {
    qualification: skills.qualification?.avg || 0,
    procedure: skills.procedure?.avg || 0,
    audience: skills.audience?.avg || 0,
    droits: skills.droits?.avg || 0,
    motivation: skills.motivation?.avg || 0,
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 py-6 flex items-center justify-center">
      <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="px-6 md:px-8 py-6 border-b border-white/10 bg-slate-950/70 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">DROITGPT • JUSTICE LAB</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-semibold text-emerald-300">Tableau de bord – Évaluation continue</h1>
            <p className="mt-1 text-xs md:text-sm text-slate-400">Statistiques globales, compétences, et historique des dossiers joués.</p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs md:text-sm">
            <Link to="/justice-lab" className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 transition">
              ⬅️ Justice Lab
            </Link>
            <Link to="/" className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 transition">
              Accueil
            </Link>
            {lastRun && (
              <>
                <Link
                  to={`/justice-lab/results/${encodeURIComponent(lastRun.runId)}`}
                  className="px-4 py-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 transition"
                >
                  ✅ Dernier résultat
                </Link>
                <Link
                  to={`/justice-lab/journal/${encodeURIComponent(lastRun.runId)}`}
                  className="px-4 py-2 rounded-full border border-amber-500/70 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 transition"
                >
                  🧾 Dernier journal
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="px-6 md:px-8 py-6 space-y-6">
          <section className="grid gap-4 md:grid-cols-[1.2fr_1.8fr]">
            <div className={`rounded-2xl border px-4 py-4 ${badge.color}`}>
              <p className="text-[11px] uppercase tracking-[0.2em] mb-1">Niveau actuel</p>
              <h2 className="text-xl md:text-2xl font-semibold">{badge.label}</h2>
              <div className="mt-3 text-xs space-y-1.5 opacity-95">
                <p>🎮 Parties : <span className="font-semibold">{stats.totalRuns || 0}</span></p>
                <p>📈 Score moyen : <span className="font-semibold">{stats.avgScore || 0}</span></p>
                <p>🏆 Meilleur score : <span className="font-semibold">{stats.bestScore || 0}</span></p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h3 className="text-sm font-semibold text-slate-100 mb-2">🧩 Compétences (moyennes)</h3>

              <div className="grid gap-3 md:grid-cols-2 text-sm">
                {Object.entries(radar).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                    <div className="text-xs text-slate-400 capitalize">{k}</div>
                    <div className="mt-1 font-semibold text-slate-100">{v}</div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${v}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-slate-400">
                Nouveau : <strong>Audience</strong> + <strong>Cour d’appel</strong> (simulation IA) dans les résultats.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">📚 Historique des dossiers</h3>
              <span className="text-xs text-slate-500">{runs.length} entrées</span>
            </div>

            {runs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Aucune partie jouée pour l’instant.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {runs.slice(0, 12).map((r) => (
                  <div
                    key={r.runId}
                    className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                  >
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                        {r.caseMeta?.domaine} • {r.caseMeta?.niveau}
                        {r?.answers?.role ? <span className="ml-2 text-slate-300">• {r.answers.role}</span> : null}
                      </div>
                      <div className="text-sm font-semibold text-emerald-200">{r.caseMeta?.titre}</div>
                      <div className="text-xs text-slate-500 mt-1">{new Date(r.finishedAt || r.startedAt).toLocaleString()}</div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-3 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-100 text-xs font-semibold">
                        Score {r.scoreGlobal}
                      </span>

                      {Number.isFinite(r?.scores?.audience) && (
                        <span className="px-3 py-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-100 text-xs font-semibold">
                          Audience {r.scores.audience}
                        </span>
                      )}

                      {r?.appeal?.decision && (
                        <span className="px-3 py-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-100 text-xs font-semibold">
                          Appel {String(r.appeal.decision).toUpperCase()}
                        </span>
                      )}

                      <Link
                        to={`/justice-lab/results/${encodeURIComponent(r.runId)}`}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs transition"
                      >
                        Voir détails
                      </Link>

                      <Link
                        to={`/justice-lab/journal/${encodeURIComponent(r.runId)}`}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs transition"
                      >
                        Journal
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
