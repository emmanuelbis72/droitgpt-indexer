import React, { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { readRuns, setActiveRunId, upsertAndSetActive } from "../justiceLab/storage.js";

function ScorePill({ label, value }) {
  const v = Number.isFinite(value) ? value : 0;

  const color =
    v >= 75
      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
      : v >= 55
      ? "border-amber-500/60 bg-amber-500/10 text-amber-100"
      : "border-rose-500/60 bg-rose-500/10 text-rose-100";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${color}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] opacity-90">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{v}</div>
    </div>
  );
}

function decisionBadgeClass(decision) {
  const d = String(decision || "").toUpperCase();
  if (d === "CONFIRMATION") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-100";
  if (d === "ANNULATION") return "border-rose-500/60 bg-rose-500/10 text-rose-100";
  return "border-amber-500/60 bg-amber-500/10 text-amber-100"; // RENVOI
}

export default function JusticeLabResults() {
  const { runId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const run = useMemo(() => {
    // ✅ Supporte plusieurs formes de state envoyées depuis Play / Results
    const stateRun = location.state?.run || location.state?.runData || null;
    if (stateRun?.runId) return stateRun;

    const stateRunId = location.state?.runId ? String(location.state.runId) : "";
    const idFromUrl = runId ? decodeURIComponent(runId) : "";
    const targetId = idFromUrl || stateRunId;

    const all = readRuns();
    if (!targetId) return all?.[0] || null;
    return all.find((r) => r.runId === targetId) || null;
  }, [location.state, runId]);

  // ✅ ULTRA PRO: dès qu'on ouvre Results -> on fixe le run actif
  useEffect(() => {
    if (!run?.runId) return;
    try {
      setActiveRunId(run.runId);
      // garde la version la plus récente dans runs (utile si Results arrive avec state.runData)
      upsertAndSetActive(run);
    } catch {
      // ignore
    }
  }, [run?.runId]);

  if (!run) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-slate-300">Résultat introuvable.</p>
          <Link className="mt-3 inline-flex text-emerald-300 underline" to="/justice-lab">
            Retour Justice Lab
          </Link>
        </div>
      </div>
    );
  }

  const scores = run.scores || {};
  const audienceScore = Number.isFinite(scores.audience) ? scores.audience : 0;

  const appeal = run.appeal || null;
  const appealDecision = appeal?.decision || "RENVOI";
  const appealGrounds = Array.isArray(appeal?.grounds) ? appeal.grounds : [];
  const appealRecs = Array.isArray(appeal?.recommendations) ? appeal.recommendations : [];
  const appealDispositif = appeal?.dispositif || "";

  const caseIdForReplay = run.caseMeta?.caseId || run.caseMeta?.id || "";

  const goAudience = () => {
    navigate("/justice-lab/audience", { state: { runData: run, caseData: run.caseMeta } });
  };

  const goAppeal = () => {
    navigate("/justice-lab/appeal", { state: { runData: run, caseData: run.caseMeta, scored: run.ai || null } });
  };

  const replayCase = () => {
    if (!caseIdForReplay) return navigate("/justice-lab");
    navigate(`/justice-lab/play/${encodeURIComponent(caseIdForReplay)}`);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 py-6">
      <div className="w-full max-w-6xl mx-auto rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="px-6 md:px-8 py-6 border-b border-white/10 bg-slate-950/70 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">JUSTICE LAB • RÉSULTATS</div>
            <h1 className="mt-2 text-2xl font-semibold text-emerald-300">{run.caseMeta?.titre}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {run.caseMeta?.domaine} • {run.caseMeta?.niveau} • Score global :{" "}
              <span className="text-slate-100 font-semibold">{run.scoreGlobal}</span>
              {run?.answers?.role ? (
                <>
                  {" "}
                  • Rôle : <span className="text-slate-100 font-semibold">{run.answers.role}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs md:text-sm">
            <Link
              to="/justice-lab"
              className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 transition"
            >
              ⬅️ Justice Lab
            </Link>

            <button
              type="button"
              onClick={replayCase}
              className="px-4 py-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 transition"
              title="Relancer le cas (nouvelle tentative)"
            >
              🔁 Rejouer ce cas
            </button>

            <button
              type="button"
              onClick={goAudience}
              className="px-4 py-2 rounded-full border border-amber-500/70 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 transition"
              title="Ouvrir la phase Audience (objections, journal, pièces admises/écartées)"
            >
              🏛️ Revoir l’audience
            </button>

            <button
              type="button"
              onClick={goAppeal}
              className="px-4 py-2 rounded-full border border-rose-500/70 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20 transition"
              title="Ouvrir la phase Appel (IA). Si l'appel n’existe pas, il sera généré."
            >
              ⚖️ Voir l’appel
            </button>

            <Link
              to="/justice-lab/dashboard"
              className="px-4 py-2 rounded-full border border-violet-500/70 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition"
            >
              📊 Dashboard
            </Link>

            <Link
              to={`/justice-lab/journal/${encodeURIComponent(run.runId)}`}
              className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 transition"
            >
              🧾 Journal
            </Link>
          </div>
        </div>

        <div className="px-6 md:px-8 py-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-6">
            <ScorePill label="Global" value={run.scoreGlobal} />
            <ScorePill label="Qualification" value={scores.qualification} />
            <ScorePill label="Procédure" value={scores.procedure} />
            <ScorePill label="Audience" value={audienceScore} />
            <ScorePill label="Droits" value={scores.droits} />
            <ScorePill label="Motivation" value={scores.motivation} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4">
              <h2 className="text-sm font-semibold text-slate-100 mb-2">🧠 Débrief</h2>
              <ul className="text-sm text-slate-200/90 space-y-2 list-disc list-inside">
                {(run.debrief || []).map((d, idx) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4">
              <h2 className="text-sm font-semibold text-slate-100 mb-2">🚩 Alertes</h2>
              {run.flags?.length ? (
                <div className="space-y-2">
                  {run.flags.map((f, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl border p-3 ${
                        f.level === "critical"
                          ? "border-rose-500/60 bg-rose-500/10 text-rose-100"
                          : "border-amber-500/60 bg-amber-500/10 text-amber-100"
                      }`}
                    >
                      <div className="text-sm font-semibold">{f.label}</div>
                      <div className="text-xs opacity-90 mt-1">{f.detail}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Aucune alerte détectée.</p>
              )}
            </section>
          </div>

          {/* Cour d'appel IA */}
          <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-100">🏛️ Cour d’appel (IA)</h2>
              <span className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${decisionBadgeClass(appealDecision)}`}>
                {String(appealDecision).toUpperCase()}
              </span>
            </div>

            {!appeal ? (
              <div className="mt-3 text-sm text-slate-400">
                Cour d’appel non disponible pour ce run (ancienne version ou échec IA).{" "}
                <button type="button" onClick={goAppeal} className="ml-1 text-rose-200 underline hover:text-rose-100">
                  Générer maintenant
                </button>
                .
              </div>
            ) : (
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Motifs (grounds)</div>
                  <ul className="mt-2 text-sm text-slate-200/90 space-y-1 list-disc list-inside">
                    {appealGrounds.length ? appealGrounds.map((g, i) => <li key={i}>{g}</li>) : <li>Aucun motif.</li>}
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Dispositif</div>
                  <p className="mt-2 text-sm text-slate-200/90 whitespace-pre-wrap">{appealDispositif || "—"}</p>

                  <div className="mt-4 text-[11px] uppercase tracking-[0.2em] text-slate-400">Recommandations</div>
                  <ul className="mt-2 text-sm text-slate-200/90 space-y-1 list-disc list-inside">
                    {appealRecs.length ? appealRecs.map((r, i) => <li key={i}>{r}</li>) : <li>—</li>}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs text-emerald-50/90">
            Nouveau : <strong>Audience</strong> mesure les objections/contradictoire (journal live, pièces admises/écartées),
            et la <strong>Cour d’appel</strong> simule l’issue probable.
          </div>
        </div>
      </div>
    </div>
  );
}
