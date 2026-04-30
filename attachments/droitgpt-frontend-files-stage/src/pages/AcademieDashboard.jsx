// src/pages/AcademieDashboard.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import jsPDF from "jspdf";

// Même mapping de modules que dans l'Académie
const MODULES = [
  {
    id: "1",
    titre: "Fondamentaux du droit congolais",
    niveau: "Débutant",
    couleur: "from-emerald-500/80 to-emerald-700/80",
  },
  {
    id: "2",
    titre: "Droit constitutionnel congolais",
    niveau: "Fondamental",
    couleur: "from-sky-500/80 to-sky-700/80",
  },
  {
    id: "3",
    titre: "Droit pénal & procédure pénale",
    niveau: "Intermédiaire",
    couleur: "from-rose-500/80 to-rose-700/80",
  },
  {
    id: "4",
    titre: "Droit de la famille & successions",
    niveau: "Intermédiaire",
    couleur: "from-violet-500/80 to-violet-700/80",
  },
  {
    id: "5",
    titre: "Droit du travail congolais",
    niveau: "Pratique",
    couleur: "from-amber-500/80 to-amber-700/80",
  },
  {
    id: "6",
    titre: "OHADA & droit des affaires",
    niveau: "Avancé",
    couleur: "from-fuchsia-500/80 to-fuchsia-700/80",
  },
  {
    id: "7",
    titre: "Cas pratiques & mises en situation",
    niveau: "Ateliers",
    couleur: "from-teal-500/80 to-teal-700/80",
  },
];

// Lecture de la progression dans localStorage
function readProgressFromStorage() {
  try {
    const raw = localStorage.getItem("academieProgress");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Déterminer un badge global en fonction de la progression
function getGlobalBadge(
  completedLessonsAll,
  totalLessonsAll,
  quizPassed,
  quizTotal
) {
  if (!totalLessonsAll || totalLessonsAll === 0) {
    return {
      label: "Apprenant débutant",
      description:
        "Commencez un premier module pour débloquer plus de fonctionnalités.",
      color: "bg-slate-800 text-slate-100 border-slate-600",
    };
  }

  const lessonRate = Math.round(
    (completedLessonsAll / totalLessonsAll) * 100
  );
  const quizRate =
    quizTotal > 0 ? Math.round((quizPassed / quizTotal) * 100) : 0;

  let score = lessonRate;
  if (quizTotal > 0) {
    score = Math.round(lessonRate * 0.7 + quizRate * 0.3);
  }

  if (score < 20) {
    return {
      label: "Apprenant",
      description:
        "Vous avez commencé votre parcours. Continuez à suivre les chapitres.",
      color: "bg-slate-800 text-slate-100 border-slate-600",
    };
  } else if (score < 50) {
    return {
      label: "Juriste Junior",
      description:
        "Les bases du droit congolais commencent à se structurer. Poursuivez vos efforts.",
      color: "bg-emerald-900/60 text-emerald-100 border-emerald-500/60",
    };
  } else if (score < 80) {
    return {
      label: "Juriste Confirmé",
      description:
        "Vous maîtrisez déjà une bonne partie des notions. Approfondissez avec les cas pratiques.",
      color: "bg-sky-900/60 text-sky-100 border-sky-500/70",
    };
  } else {
    return {
      label: "Expert DroitGPT",
      description:
        "Vous avez un niveau avancé. Utilisez DroitGPT pour affiner votre compréhension de cas complexes.",
      color: "bg-violet-900/60 text-violet-100 border-violet-500/80",
    };
  }
}

export default function AcademieDashboard() {
  const [progress, setProgress] = useState({});

  useEffect(() => {
    const stored = readProgressFromStorage();
    setProgress(stored || {});
  }, []);

  const totalModules = MODULES.length;

  let modulesEntames = 0;
  let completedLessonsAll = 0;
  let totalLessonsAll = 0;
  let totalQuiz = 0;
  let totalQuizReussis = 0;
  let masteredModulesCount = 0;

  // Calcul des stats globales + nombre de modules certifiés
  MODULES.forEach((m) => {
    const p = progress[m.id] || {};
    if (p.hasStarted) modulesEntames += 1;

    const totalLessons = p.totalLessons || 0;
    const completedLessons = p.completedLessons || 0;
    totalLessonsAll += totalLessons;
    completedLessonsAll += completedLessons;

    const quizzesTotal = p.quizzesTotal || 0;
    const quizzesPassed = p.quizzesPassed || 0;
    totalQuiz += quizzesTotal;
    totalQuizReussis += quizzesPassed;

    const lessonPercent =
      totalLessons > 0
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;
    const quizRate =
      quizzesTotal > 0
        ? Math.round((quizzesPassed / quizzesTotal) * 100)
        : 0;

    const isMastered =
      totalLessons > 0 &&
      lessonPercent >= 80 &&
      quizzesTotal > 0 &&
      quizRate >= 60;

    if (isMastered) {
      masteredModulesCount += 1;
    }
  });

  const globalLessonCompletion =
    totalLessonsAll === 0
      ? 0
      : Math.round((completedLessonsAll / totalLessonsAll) * 100);

  const quizSuccessRate =
    totalQuiz === 0 ? 0 : Math.round((totalQuizReussis / totalQuiz) * 100);

  const badge = getGlobalBadge(
    completedLessonsAll,
    totalLessonsAll,
    totalQuizReussis,
    totalQuiz
  );

  // 📄 PDF global : Parcours complet DroitGPT Académie
  const handleDownloadGlobalPdf = () => {
    if (masteredModulesCount < 2) return;

    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Parcours DroitGPT Académie", 105, 20, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(
      "Synthèse de votre parcours sur les modules certifiés de droit congolais.",
      20,
      30
    );

    let y = 40;

    doc.setFont("helvetica", "bold");
    doc.text("1. Statistiques globales", 20, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    const statsLines = doc.splitTextToSize(
      `Modules entamés : ${modulesEntames} / ${totalModules}
Modules certifiés : ${masteredModulesCount}
Leçons complétées : ${completedLessonsAll} / ${totalLessonsAll || 0} (${globalLessonCompletion}%)
Résultats aux quiz : ${totalQuizReussis} / ${totalQuiz || 0} (${quizSuccessRate}%)`,
      170
    );
    doc.text(statsLines, 20, y);
    y += statsLines.length * 6 + 4;

    // Liste des modules certifiés
    doc.setFont("helvetica", "bold");
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.text("2. Modules certifiés", 20, y);
    y += 6;

    doc.setFont("helvetica", "normal");

    MODULES.forEach((m) => {
      const p = progress[m.id] || {};
      const totalLessons = p.totalLessons || 0;
      const completedLessons = p.completedLessons || 0;
      const quizzesTotal = p.quizzesTotal || 0;
      const quizzesPassed = p.quizzesPassed || 0;

      const lessonPercent =
        totalLessons > 0
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;
      const quizRate =
        quizzesTotal > 0
          ? Math.round((quizzesPassed / quizzesTotal) * 100)
          : 0;

      const isMastered =
        totalLessons > 0 &&
        lessonPercent >= 80 &&
        quizzesTotal > 0 &&
        quizRate >= 60;

      if (!isMastered) return;

      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.text(`• ${m.titre} (${m.niveau})`, 20, y);
      y += 6;

      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(
        `Progression : ${completedLessons} / ${totalLessons} leçons (${lessonPercent}%).
Quiz : ${quizzesPassed} / ${quizzesTotal} bonnes réponses (${quizRate}%).`,
        170
      );
      doc.text(lines, 24, y);
      y += lines.length * 6 + 4;
    });

    if (y > 260) {
      doc.addPage();
      y = 20;
    }

    const today = new Date().toLocaleDateString("fr-FR");
    doc.setFont("helvetica", "italic");
    doc.text(
      `Document généré automatiquement par DroitGPT Académie le ${today}.`,
      20,
      y + 6
    );

    doc.save("parcours_droitgpt_academie.pdf");
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-slate-900/80 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="px-6 md:px-8 py-5 border-b border-white/10 bg-slate-950/80 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              DROITGPT • ACADEMIE
            </div>
            <h1 className="mt-2 text-2xl md:text-3xl font-semibold text-emerald-300">
              Tableau de bord d’apprentissage
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-400">
              Suivez votre progression dans les modules de{" "}
              <span className="font-semibold">droit congolais</span> et vos
              résultats aux quiz.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs md:text-sm">
            <Link
              to="/academie"
              className="px-4 py-2 rounded-full border border-slate-600/60 bg-slate-900 hover:bg-slate-800 transition"
            >
              ⬅️ Retour à l’Académie
            </Link>
            <Link
              to="/chat"
              className="px-4 py-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition"
            >
              💬 Poser une question à DroitGPT
            </Link>
          </div>
        </div>

        {/* CONTENU */}
        <div className="px-6 md:px-8 py-6 space-y-6">
          {/* NIVEAU GLOBAL + STATS + PDF Parcours */}
          <section className="grid gap-4 md:grid-cols-[1.4fr_1.6fr]">
            {/* Badge global */}
            <div className={`rounded-2xl border px-4 py-4 ${badge.color}`}>
              <p className="text-[11px] uppercase tracking-[0.2em] mb-1">
                Votre niveau actuel
              </p>
              <h2 className="text-xl md:text-2xl font-semibold mb-1">
                {badge.label}
              </h2>
              <p className="text-xs md:text-sm opacity-90 mb-3">
                {badge.description}
              </p>

              <div className="mt-2 text-xs text-slate-100/90 space-y-1.5">
                <p>
                  📚 Modules entamés :{" "}
                  <span className="font-semibold">
                    {modulesEntames} / {totalModules}
                  </span>
                </p>
                <p>
                  🏅 Modules certifiés :{" "}
                  <span className="font-semibold">
                    {masteredModulesCount}
                  </span>
                </p>
                <p>
                  🧾 Leçons complétées :{" "}
                  <span className="font-semibold">
                    {completedLessonsAll} / {totalLessonsAll || 0}
                  </span>
                </p>
                <p>
                  🧠 Quiz réussis :{" "}
                  <span className="font-semibold">
                    {totalQuizReussis} / {totalQuiz || 0}
                  </span>{" "}
                  {totalQuiz > 0 && (
                    <span className="ml-1 text-[11px] opacity-80">
                      ({quizSuccessRate}% de bonnes réponses)
                    </span>
                  )}
                </p>
              </div>

              {/* Bouton PDF global si au moins 2 modules certifiés */}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleDownloadGlobalPdf}
                  disabled={masteredModulesCount < 2}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition ${
                    masteredModulesCount >= 2
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  📄 Télécharger mon parcours DroitGPT Académie (PDF)
                </button>
                {masteredModulesCount < 2 ? (
                  <p className="mt-2 text-[11px] text-slate-300">
                    Ce PDF se débloque lorsque vous avez{" "}
                    <strong>au moins 2 modules certifiés</strong> (≥80% des
                    leçons et ≥60% des quiz pour ces modules).
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-emerald-200">
                    🎉 Bravo ! Vous avez plusieurs modules certifiés. Votre
                    parcours global peut être téléchargé en PDF.
                  </p>
                )}
              </div>
            </div>

            {/* Cartes stats progression */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Leçons */}
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-4">
                <p className="text-xs text-emerald-200 uppercase tracking-wide mb-1">
                  Progression sur les leçons
                </p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-semibold text-emerald-100">
                    {globalLessonCompletion}%
                  </span>
                  <span className="text-xs text-emerald-200">
                    des chapitres disponibles
                  </span>
                </div>
                <div className="mt-3 h-2 w-full rounded-full bg-emerald-900/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
                    style={{ width: `${globalLessonCompletion}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-emerald-200">
                  Chaque quiz validé et chapitre parcouru met à jour ces
                  statistiques.
                </p>
              </div>

              {/* Quiz */}
              <div className="rounded-2xl border border-sky-500/40 bg-sky-500/5 px-4 py-4">
                <p className="text-xs text-sky-200 uppercase tracking-wide mb-1">
                  Maîtrise des quiz
                </p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-semibold text-sky-100">
                    {quizSuccessRate}%
                  </span>
                  <span className="text-xs text-sky-200">
                    de bonnes réponses
                  </span>
                </div>
                <div className="mt-3 h-2 w-full rounded-full bg-sky-900/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-500 transition-all"
                    style={{ width: `${quizSuccessRate}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-sky-200">
                  Refaites les quiz de chaque chapitre pour améliorer votre
                  score global.
                </p>
              </div>
            </div>
          </section>

          {/* LISTE DES MODULES + PROGRESSION DETAILLEE */}
          <section className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-100">
                Progression par module
              </h2>
              <p className="text-[11px] text-slate-400">
                Les pourcentages sont calculés sur les chapitres parcourus &
                quiz validés pour chaque module.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((m) => {
                const p = progress[m.id] || {};
                const totalLessons = p.totalLessons || 0;
                const completedLessons = p.completedLessons || 0;

                const percent =
                  totalLessons > 0
                    ? Math.round((completedLessons / totalLessons) * 100)
                    : p.hasStarted
                    ? 25
                    : 0;

                const quizzesTotal = p.quizzesTotal || 0;
                const quizzesPassed = p.quizzesPassed || 0;
                const quizRate =
                  quizzesTotal > 0
                    ? Math.round((quizzesPassed / quizzesTotal) * 100)
                    : 0;

                // Critère module certifié
                const isMastered =
                  totalLessons > 0 &&
                  percent >= 80 &&
                  quizzesTotal > 0 &&
                  quizRate >= 60;

                // Micro-badge par module
                let moduleBadgeLabel = "Non commencé";
                let moduleBadgeClass =
                  "bg-slate-800 text-slate-200 border-slate-600";
                if (percent > 0 && percent < 40) {
                  moduleBadgeLabel = "En cours";
                  moduleBadgeClass =
                    "bg-slate-900 text-emerald-100 border-emerald-500/60";
                } else if (percent >= 40 && percent < 80) {
                  moduleBadgeLabel = "Bon niveau";
                  moduleBadgeClass =
                    "bg-sky-900/60 text-sky-100 border-sky-500/70";
                } else if (percent >= 80) {
                  moduleBadgeLabel = "Maîtrisé";
                  moduleBadgeClass =
                    "bg-violet-900/60 text-violet-100 border-violet-500/80";
                }

                // Badge spécial "Certifié"
                if (isMastered) {
                  moduleBadgeLabel = "Certifié";
                  moduleBadgeClass =
                    "bg-emerald-900/80 text-emerald-100 border-emerald-400/90";
                }

                return (
                  <div
                    key={m.id}
                    className="rounded-2xl border border-slate-700/60 bg-slate-900/90 overflow-hidden flex flex-col"
                  >
                    {/* Bande colorée */}
                    <div
                      className={`h-1 w-full bg-gradient-to-r ${m.couleur}`}
                    />

                    <div className="px-4 py-4 flex-1 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-50">
                            {m.titre}
                          </h3>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {m.niveau}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={`px-2 py-1 rounded-full border text-[10px] ${moduleBadgeClass}`}
                          >
                            {moduleBadgeLabel}
                          </span>
                          {isMastered && (
                            <span className="text-[10px] text-emerald-300 flex items-center gap-1">
                              🏅 <span>Module certifié</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Barre progression leçons */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                          <span>Leçons complétées</span>
                          <span>
                            {completedLessons} / {totalLessons || 0} (
                            {percent}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>

                      {/* Quiz stats */}
                      <div className="mt-2 text-[11px] text-slate-300">
                        {quizzesTotal > 0 ? (
                          <p>
                            🧠 Quiz :{" "}
                            <span className="font-semibold">
                              {quizzesPassed} / {quizzesTotal}
                            </span>{" "}
                            bonnes réponses ({quizRate}%)
                          </p>
                        ) : (
                          <p className="text-slate-500">
                            Aucun quiz complété pour ce module pour l’instant.
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="mt-3 flex gap-2 text-[11px]">
                        <Link
                          to={`/academie/programme/${m.id}`}
                          className="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 transition"
                        >
                          📘 Voir le programme
                        </Link>
                        <Link
                          to={`/academie/programme/${m.id}/lesson/1`}
                          className="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition"
                        >
                          ▶️ Continuer
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Bas de page */}
          <div className="mt-4 border-t border-slate-800 pt-4 text-[11px] text-slate-500">
            Ce tableau de bord se met à jour automatiquement lorsque vous suivez
            les chapitres et validez les quiz dans{" "}
            <strong>DroitGPT Académie</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
