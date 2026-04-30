// src/pages/AcademieProgramme.jsx
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import jsPDF from "jspdf";

// 🧭 Infos descriptives par module (à enrichir si tu veux)
const MODULES = {
  "1": {
    titre: "Fondamentaux du droit congolais",
    niveau: "Niveau débutant",
    resume:
      "Comprendre les bases du système juridique congolais : sources du droit, organisation judiciaire et distinction des grandes branches du droit.",
    objectifs: [
      "Identifier les sources du droit en RDC (Constitution, lois, règlements, coutume…).",
      "Comprendre l'organisation des juridictions congolaises.",
      "Distinguer droit public et droit privé dans la pratique.",
    ],
    plan: [
      "Introduction au système juridique congolais",
      "Les principales sources du droit en RDC",
      "Organisation des juridictions congolaises",
      "Droit public vs droit privé – exemples concrets",
    ],
    publicCible:
      "Étudiants, entrepreneurs, citoyens souhaitant acquérir une vision globale du droit congolais.",
    competences: [
      "Lecture plus sûre d’un texte juridique congolais.",
      "Capacité à identifier la juridiction compétente.",
      "Compréhension des grandes familles de branches du droit.",
    ],
  },

  "2": {
    titre: "Droit constitutionnel congolais",
    niveau: "Niveau fondamental",
    resume:
      "Étude de la Constitution, de l’organisation des pouvoirs publics et de la protection des droits fondamentaux en RDC.",
    objectifs: [
      "Comprendre le rôle de la Constitution dans la hiérarchie des normes.",
      "Identifier les institutions constitutionnelles congolaises.",
      "Appréhender la protection des droits et libertés fondamentaux.",
    ],
    plan: [
      "Notion et rôle de la Constitution",
      "Organisation des pouvoirs publics",
      "Contrôle de constitutionnalité",
      "Droits fondamentaux et mécanismes de protection",
    ],
    publicCible:
      "Étudiants en droit, agents publics, toute personne intéressée par les institutions et les droits fondamentaux.",
    competences: [
      "Repérer une violation potentielle de la Constitution.",
      "Comprendre les rôles du Président, du Parlement et des Cours.",
    ],
  },

  "3": {
    titre: "Droit pénal & procédure pénale",
    niveau: "Niveau intermédiaire",
    resume:
      "Les principes généraux du droit pénal congolais et les grandes étapes de la procédure pénale.",
    objectifs: [
      "Comprendre le principe de légalité des infractions et des peines.",
      "Identifier les grandes étapes d’une procédure pénale.",
      "Appréhender les droits de la défense et le rôle du ministère public.",
    ],
    plan: [
      "Principes généraux du droit pénal",
      "Les infractions et les peines",
      "Déroulement de la procédure pénale",
      "Droits de la défense et garanties fondamentales",
    ],
    publicCible:
      "Étudiants, professionnels de la sécurité, défenseurs des droits humains.",
    competences: [
      "Compréhension du traitement pénal d’un comportement.",
      "Sensibilisation aux garanties procédurales en RDC.",
    ],
  },

  "4": {
    titre: "Droit de la famille & successions",
    niveau: "Niveau intermédiaire",
    resume:
      "Règles essentielles relatives au mariage, à la filiation, aux régimes matrimoniaux et aux successions en RDC.",
    objectifs: [
      "Maîtriser les notions de base en droit de la famille (mariage, filiation, régimes).",
      "Comprendre les grands principes du droit des successions.",
      "Appréhender les enjeux pratiques des conflits familiaux.",
    ],
    plan: [
      "Mariage et conditions de validité",
      "Filiation, adoption et autorité parentale",
      "Régimes matrimoniaux",
      "Principes des successions et partage",
    ],
    publicCible:
      "Citoyens, leaders communautaires, praticiens confrontés à des conflits familiaux.",
    competences: [
      "Capacité à identifier les règles applicables à une succession simple.",
      "Meilleure compréhension des droits des conjoints et enfants.",
    ],
  },

  "5": {
    titre: "Droit du travail congolais",
    niveau: "Niveau pratique",
    resume:
      "Le contrat de travail, les droits et obligations du travailleur et de l’employeur, la rupture et le rôle de l’inspection du travail.",
    objectifs: [
      "Connaître les éléments essentiels du contrat de travail.",
      "Comprendre les droits et obligations des parties.",
      "Identifier les voies de recours en cas de conflit.",
    ],
    plan: [
      "Sources du droit du travail en RDC",
      "Contrat de travail : formation et contenu",
      "Droits et obligations du travailleur et de l’employeur",
      "Rupture du contrat et rôle de l’inspection du travail",
    ],
    publicCible:
      "Travailleurs, employeurs, responsables RH, syndicalistes.",
    competences: [
      "Comprendre les bases d’un licenciement régulier ou irrégulier.",
      "Mieux dialoguer avec l’inspection du travail.",
    ],
  },

  "6": {
    titre: "OHADA & droit des affaires",
    niveau: "Niveau avancé",
    resume:
      "Introduction à l’OHADA, aux principaux Actes uniformes et aux enjeux pratiques pour les entreprises congolaises.",
    objectifs: [
      "Comprendre le rôle de l’OHADA dans l’espace africain.",
      "Identifier les principaux Actes uniformes applicables en RDC.",
      "Appréhender les impacts pour les entreprises et les investisseurs.",
    ],
    plan: [
      "Présentation de l’OHADA et de ses objectifs",
      "Actes uniformes clés (sociétés, sûretés, procédures collectives…) ",
      "Sécurité juridique des transactions",
      "Enjeux pour les entreprises congolaises",
    ],
    publicCible:
      "Entrepreneurs, juristes d’entreprise, comptables, conseillers d’affaires.",
    competences: [
      "Aptitude à repérer les textes OHADA pertinents pour une opération.",
      "Meilleure compréhension du cadre juridique des affaires.",
    ],
  },

  "7": {
    titre: "Cas pratiques & mises en situation",
    niveau: "Ateliers",
    resume:
      "Application des notions vues dans les autres modules à travers des cas pratiques inspirés de situations congolaises réelles.",
    objectifs: [
      "S’exercer à raisonner juridiquement sur des cas concrets.",
      "Mobiliser les différentes branches du droit en situation.",
      "Identifier les démarches à entreprendre dans un dossier type.",
    ],
    plan: [
      "Cas pratique en droit de la famille",
      "Cas pratique en droit du travail",
      "Cas pratique en droit pénal",
      "Cas pratique en droit des affaires (OHADA)",
    ],
    publicCible:
      "Apprenants souhaitant tester et consolider leurs connaissances.",
    competences: [
      "Capacité à analyser une situation et proposer un début de solution.",
      "Réflexe de consulter les textes et la jurisprudence.",
    ],
  },
};

// 🔐 Progression globale
function readProgress() {
  try {
    const raw = localStorage.getItem("academieProgress");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default function AcademieProgramme() {
  const { id } = useParams();
  const moduleId = MODULES[id] ? id : "1";
  const moduleData = MODULES[moduleId];

  const [moduleProgress, setModuleProgress] = useState({
    hasStarted: false,
    totalLessons: 0,
    completedLessons: 0,
    quizzesTotal: 0,
    quizzesPassed: 0,
  });

  useEffect(() => {
    const all = readProgress();
    const p = all[moduleId] || {};
    setModuleProgress({
      hasStarted: !!p.hasStarted,
      totalLessons: p.totalLessons || 0,
      completedLessons: p.completedLessons || 0,
      quizzesTotal: p.quizzesTotal || 0,
      quizzesPassed: p.quizzesPassed || 0,
    });
  }, [moduleId]);

  const {
    hasStarted,
    totalLessons,
    completedLessons,
    quizzesTotal,
    quizzesPassed,
  } = moduleProgress;

  const lessonPercent =
    totalLessons > 0
      ? Math.round((completedLessons / totalLessons) * 100)
      : hasStarted
      ? 25
      : 0;

  const quizRate =
    quizzesTotal > 0
      ? Math.round((quizzesPassed / quizzesTotal) * 100)
      : 0;

  // 🎓 Critère de “Maîtrise” du module
  const isMastered =
    totalLessons > 0 &&
    lessonPercent >= 80 &&
    quizzesTotal > 0 &&
    quizRate >= 60;

  // 📄 Génère un PDF complet du module (résumé + objectifs + plan + stats)
  const handleGenerateModulePdf = () => {
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("DROITGPT ACADEMIE – Module complet", 20, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Module ${moduleId} : ${moduleData.titre}`, 20, 30);
    doc.text(`Niveau : ${moduleData.niveau}`, 20, 38);

    let y = 48;

    // Résumé
    doc.setFont("helvetica", "bold");
    doc.text("Résumé :", 20, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const resumeLines = doc.splitTextToSize(moduleData.resume, 170);
    doc.text(resumeLines, 20, y);
    y += resumeLines.length * 6 + 4;

    // Objectifs
    if (moduleData.objectifs?.length) {
      doc.setFont("helvetica", "bold");
      doc.text("Objectifs pédagogiques :", 20, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      moduleData.objectifs.forEach((obj) => {
        const lines = doc.splitTextToSize(`• ${obj}`, 170);
        doc.text(lines, 20, y);
        y += lines.length * 6;
      });
      y += 2;
    }

    // Plan = “tous les chapitres”
    if (moduleData.plan?.length) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text("Chapitres du module :", 20, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      moduleData.plan.forEach((p, idx) => {
        const lines = doc.splitTextToSize(`${idx + 1}. ${p}`, 170);
        doc.text(lines, 20, y);
        y += lines.length * 6;
      });
      y += 2;
    }

    // Public cible & compétences
    if (moduleData.publicCible || moduleData.competences?.length) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      if (moduleData.publicCible) {
        doc.setFont("helvetica", "bold");
        doc.text("Public cible :", 20, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        const publicLines = doc.splitTextToSize(
          moduleData.publicCible,
          170
        );
        doc.text(publicLines, 20, y);
        y += publicLines.length * 6 + 2;
      }

      if (moduleData.competences?.length) {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFont("helvetica", "bold");
        doc.text("Compétences développées :", 20, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        moduleData.competences.forEach((c) => {
          const lines = doc.splitTextToSize(`• ${c}`, 170);
          doc.text(lines, 20, y);
          y += lines.length * 6;
        });
        y += 2;
      }
    }

    // Statistiques & quiz
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Progression & quiz :", 20, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    const statsLines = doc.splitTextToSize(
      `Leçons complétées : ${completedLessons} / ${
        totalLessons || 0
      } (${lessonPercent}%).`,
      170
    );
    doc.text(statsLines, 20, y);
    y += statsLines.length * 6;

    if (quizzesTotal > 0) {
      const quizLines = doc.splitTextToSize(
        `Résultats aux quiz : ${quizzesPassed} / ${quizzesTotal} bonnes réponses (${quizRate}%).`,
        170
      );
      doc.text(quizLines, 20, y);
      y += quizLines.length * 6;
      const noteLines = doc.splitTextToSize(
        "Les quiz détaillés (questions et corrigés) sont disponibles dans chaque chapitre sur la plateforme DroitGPT Académie.",
        170
      );
      doc.text(noteLines, 20, y);
      y += noteLines.length * 6;
    } else {
      const noneLines = doc.splitTextToSize(
        "Aucun quiz n’a encore été complété pour ce module. Les quiz interactifs sont accessibles dans les leçons associées.",
        170
      );
      doc.text(noneLines, 20, y);
      y += noneLines.length * 6;
    }

    const today = new Date().toLocaleDateString("fr-FR");
    y += 8;
    doc.setFont("helvetica", "italic");
    doc.text(
      `Document généré automatiquement via DroitGPT Académie le ${today}.`,
      20,
      y
    );

    const safeName = moduleData.titre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 60);

    doc.save(`module_${moduleId}_${safeName}.pdf`);
  };

  // 🎓 Génère un certificat si le module est maîtrisé
  const handleGenerateCertificate = () => {
    if (!isMastered) return;

    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("CERTIFICAT DE SUIVI", 105, 40, { align: "center" });

    doc.setFontSize(12);
    doc.text("DROITGPT ACADEMIE – Droit congolais", 105, 50, {
      align: "center",
    });

    doc.setDrawColor(60, 179, 113);
    doc.line(30, 55, 180, 55);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const yStart = 70;

    const lines = doc.splitTextToSize(
      `Ce certificat atteste que l’apprenant a achevé avec succès le module :`,
      160
    );
    doc.text(lines, 25, yStart);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`« ${moduleData.titre} »`, 25, yStart + 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const details = doc.splitTextToSize(
      `Niveau : ${moduleData.niveau}
Progression minimale atteinte : au moins 80 % des leçons du module complétées et au moins 60 % de bonnes réponses aux quiz associés.`,
      160
    );
    doc.text(details, 25, yStart + 26);

    const today = new Date().toLocaleDateString("fr-FR");
    doc.text(`Fait à Kinshasa, le ${today}`, 25, yStart + 56);

    doc.text("Signature (DroitGPT Académie) :", 25, yStart + 74);
    doc.line(25, yStart + 78, 100, yStart + 78);

    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "Ce document est généré à titre pédagogique par DroitGPT Académie et ne constitue pas un diplôme officiel.",
      25,
      yStart + 95,
      { maxWidth: 160 }
    );

    const safeName = moduleData.titre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 60);

    doc.save(`certificat_${moduleId}_${safeName}.pdf`);
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
            <h1 className="mt-2 text-xl md:text-2xl font-semibold text-emerald-300">
              {moduleData.titre}
            </h1>
            <p className="text-xs md:text-sm text-slate-300 mt-1">
              {moduleData.niveau} • Programme détaillé & progression
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs md:text-sm">
            <Link
              to="/academie"
              className="px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900 hover:bg-slate-800 text-slate-100 transition"
            >
              ⬅️ Retour à l’Académie
            </Link>
            <Link
              to="/academie/dashboard"
              className="px-4 py-2 rounded-full border border-violet-500/70 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition"
            >
              📊 Tableau de bord
            </Link>
            <Link
              to={`/academie/programme/${moduleId}/lesson/1`}
              className="px-4 py-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition"
            >
              ▶️ Commencer / continuer le module
            </Link>
          </div>
        </div>

        {/* CONTENU */}
        <div className="px-6 md:px-8 py-6 grid gap-6 md:grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)]">
          {/* Colonne gauche : Description, objectifs, plan */}
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-4 space-y-3">
              <h2 className="text-sm md:text-base font-semibold mb-1">
                🧾 Résumé du module
              </h2>
              <p className="text-sm text-slate-200 leading-relaxed">
                {moduleData.resume}
              </p>

              {moduleData.publicCible && (
                <div className="mt-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300 mb-1">
                    Public cible
                  </div>
                  <p className="text-xs md:text-sm text-emerald-50">
                    {moduleData.publicCible}
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-4 space-y-3">
              <h2 className="text-sm md:text-base font-semibold">
                🎯 Objectifs pédagogiques
              </h2>
              <ul className="list-disc list-inside text-xs md:text-sm text-slate-200 space-y-1">
                {moduleData.objectifs.map((obj, idx) => (
                  <li key={idx}>{obj}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm md:text-base font-semibold">
                  📚 Plan du module (chapitres)
                </h2>
                <span className="text-[11px] text-slate-400">
                  Cliquez pour ouvrir un chapitre
                </span>
              </div>

              <ol className="space-y-2 text-xs md:text-sm text-slate-100">
                {moduleData.plan.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 hover:border-emerald-500/70 hover:bg-slate-800/90 transition"
                  >
                    <span className="mt-0.5 text-[11px] text-slate-400">
                      {idx + 1}.
                    </span>
                    <div className="flex-1 flex flex-col">
                      <span>{item}</span>
                      <Link
                        to={`/academie/programme/${moduleId}/lesson/${
                          idx + 1
                        }`}
                        className="mt-1 text-[11px] text-emerald-300 hover:text-emerald-200 underline"
                      >
                        Ouvrir le chapitre
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* Colonne droite : Progression, PDF, certificat */}
          <div className="space-y-4">
            <section className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-4 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                Progression dans ce module
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">
                  Leçons complétées :
                </span>
                <span className="font-semibold text-slate-50">
                  {completedLessons} / {totalLessons || 0} ({lessonPercent}
                  %)
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                  style={{ width: `${lessonPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs mt-2">
                <span className="text-slate-300">Résultats aux quiz :</span>
                <span className="font-semibold text-slate-50">
                  {quizzesPassed} / {quizzesTotal || 0} ({quizRate}%)
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-4 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400 mb-1">
                Documents à télécharger
              </div>

              <button
                type="button"
                onClick={handleGenerateModulePdf}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs md:text-sm text-slate-50 transition"
              >
                📄 Générer le PDF complet du module
              </button>

              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleGenerateCertificate}
                  disabled={!isMastered}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition ${
                    isMastered
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  🎓 Télécharger mon certificat du module
                </button>
                {!isMastered && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    Le certificat se débloque lorsque vous avez complété au
                    moins <strong>80 %</strong> des leçons et obtenu au
                    moins <strong>60 %</strong> de bonnes réponses aux quiz
                    du module.
                  </p>
                )}
                {isMastered && (
                  <p className="mt-2 text-[11px] text-emerald-300">
                    🎉 Félicitations ! Vous avez atteint le niveau{" "}
                    <strong>“Maîtrisé”</strong> pour ce module.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-[11px] text-slate-400">
              Ce module a une vocation pédagogique. Pour une affaire
              concrète, un contrat ou un litige en cours, il est recommandé
              de consulter un avocat ou un professionnel du droit en RDC.
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
