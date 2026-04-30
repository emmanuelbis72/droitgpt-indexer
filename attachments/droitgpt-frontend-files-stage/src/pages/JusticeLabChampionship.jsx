import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

/**
 * JusticeLabChampionship.jsx
 * Onglet officiel Championnat National d’Audiences – ULTRA PRO
 */

const PHASES = [
  { id: "QUALIF", label: "Qualifications" },
  { id: "QUARTS", label: "Quarts de finale" },
  { id: "SEMIS", label: "Demi-finales" },
  { id: "FINALE", label: "Finale nationale" },
];

export default function JusticeLabChampionship() {
  const [phase, setPhase] = useState("QUALIF");
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 🔜 À brancher plus tard sur /justice-lab/championship/leaderboard
    setLoading(true);
    setTimeout(() => {
      setRanking([
        { rank: 1, name: "Participant A", province: "Kinshasa", score: 92 },
        { rank: 2, name: "Participant B", province: "Goma", score: 88 },
        { rank: 3, name: "Participant C", province: "Lubumbashi", score: 85 },
      ]);
      setLoading(false);
    }, 600);
  }, [phase]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="rounded-3xl border border-amber-400/40 bg-gradient-to-b from-slate-900 to-slate-950 p-6">
          <div className="text-xs uppercase tracking-[0.25em] text-amber-300">
            Justice Lab • Championnat officiel
          </div>
          <h1 className="mt-2 text-3xl font-bold text-amber-200">
            🏆 Championnat National d’Audiences
          </h1>
          <p className="mt-2 text-sm text-slate-300 max-w-3xl">
            Compétition judiciaire virtuelle ULTRA PRO : qualifications, phases
            éliminatoires et finale nationale avec scoring IA, PV d’audience,
            replay et récompense officielle.
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            {PHASES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPhase(p.id)}
                className={`px-4 py-2 rounded-full text-xs border transition ${
                  phase === p.id
                    ? "border-amber-400 bg-amber-400/10 text-amber-200"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Infos phase */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">
            Phase actuelle :{" "}
            <span className="text-amber-300">
              {PHASES.find((p) => p.id === phase)?.label}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Les audiences sont notées par l’IA (procédure, motivation,
            contradictoire, gestion des incidents). Les meilleurs avancent à la
            phase suivante.
          </p>
        </div>

        {/* Classement */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">🏅 Classement provisoire</h3>
            <span className="text-xs text-slate-500">
              Phase {phase}
            </span>
          </div>

          {loading ? (
            <p className="mt-3 text-sm text-slate-400">Chargement…</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10">
                    <th className="py-2 text-left">Rang</th>
                    <th className="py-2 text-left">Participant</th>
                    <th className="py-2 text-left">Province</th>
                    <th className="py-2 text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r) => (
                    <tr key={r.rank} className="border-b border-white/5">
                      <td className="py-2">{r.rank}</td>
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="py-2">{r.province}</td>
                      <td className="py-2 text-right font-semibold text-amber-200">
                        {r.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <Link
            to="/justice-lab"
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm"
          >
            ⬅️ Retour Justice Lab
          </Link>

          <button
            disabled
            className="px-4 py-2 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-200 opacity-60 cursor-not-allowed text-sm"
          >
            🎙️ Lancer une audience de championnat (bientôt)
          </button>
        </div>

      </div>
    </div>
  );
}