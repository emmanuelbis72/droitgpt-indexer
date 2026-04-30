// src/pages/AcademieModule.jsx
import React from "react";
import { Link, useParams } from "react-router-dom";

const MODULES = {
  "1": {
    titre: "Fondamentaux du droit congolais",
    niveau: "Niveau débutant",
    resume:
      "Ce module présente la structure du système juridique en RDC, les sources du droit, les grandes branches et l’organisation des juridictions.",
    objectifs: [
      "Comprendre les différentes sources du droit en RDC (Constitution, lois, règlements, jurisprudence…).",
      "Identifier les principales juridictions et leurs compétences.",
      "Faire la différence entre droit public et droit privé.",
    ],
    plan: [
      "1. Introduction au système juridique congolais",
      "2. Sources du droit : Constitution, lois, règlements, coutume",
      "3. Organisation judiciaire : tribunaux de paix, tribunaux de grande instance, cours d'appel, Cour de cassation, Conseil d'État, Cour constitutionnelle",
      "4. Distinction droit public / droit privé",
      "5. Rôle pratique du juriste et de l'avocat en RDC",
    ],
    exemples: [
      "Exemple : À qui s’adresser pour contester une décision administrative ?",
      "Exemple : Différence entre un litige civil (entre particuliers) et un litige pénal (infraction).",
    ],
  },
  "2": {
    titre: "Droit constitutionnel congolais",
    niveau: "Niveau fondamental",
    resume:
      "Ce module explique le rôle de la Constitution de la RDC, les droits fondamentaux, les institutions politiques et la séparation des pouvoirs.",
    objectifs: [
      "Comprendre la place de la Constitution dans la hiérarchie des normes.",
      "Identifier les principales institutions : Président de la République, Parlement, Gouvernement, Cour constitutionnelle…",
      "Connaître les grandes catégories de droits et libertés fondamentaux reconnus par la Constitution.",
    ],
    plan: [
      "1. La Constitution de la RDC : rôle et principes fondamentaux",
      "2. Les droits et libertés fondamentaux (civils, politiques, économiques, sociaux)",
      "3. Les institutions politiques : exécutif, législatif, judiciaire",
      "4. La Cour constitutionnelle : missions, contrôle de constitutionnalité",
      "5. Mécanismes de protection des droits fondamentaux en RDC",
    ],
    exemples: [
      "Exemple : recours possible en cas de loi jugée contraire à la Constitution.",
      "Exemple : atteinte à un droit fondamental (liberté d’expression, droit à la défense, etc.).",
    ],
  },
  "3": {
    titre: "Droit pénal & procédure pénale",
    niveau: "Niveau intermédiaire",
    resume:
      "Ce module couvre la notion d’infraction, les catégories de peines, la garde à vue et les grandes étapes d’un procès pénal en RDC.",
    objectifs: [
      "Comprendre la notion d’infraction (élément légal, matériel et moral).",
      "Distinguer crime, délit et contravention.",
      "Connaître les grandes étapes de la procédure pénale (plainte, enquête, jugement).",
    ],
    plan: [
      "1. Définition de l’infraction et éléments constitutifs",
      "2. Catégories d’infractions : crimes, délits, contraventions",
      "3. Rôle du ministère public",
      "4. Garde à vue et droits de la défense",
      "5. Déroulement d’un procès pénal en RDC",
    ],
    exemples: [
      "Exemple : différence entre vol simple et vol qualifié.",
      "Exemple : droits d’une personne arrêtée par la police.",
    ],
  },
  "4": {
    titre: "Droit de la famille & successions",
    niveau: "Niveau intermédiaire",
    resume:
      "Ce module aborde le mariage, le divorce, la filiation, la tutelle et les règles de succession selon le droit congolais.",
    objectifs: [
      "Comprendre les conditions du mariage et ses effets juridiques.",
      "Connaître les principaux cas de divorce et leurs conséquences.",
      "Saisir les grandes règles de partage successoral.",
    ],
    plan: [
      "1. Mariage : conditions, formalités et régimes",
      "2. Droits et devoirs des époux",
      "3. Divorce : causes et procédure",
      "4. Filiation et autorité parentale",
      "5. Successions : héritiers, réserve et partage",
    ],
    exemples: [
      "Exemple : effets du mariage coutumier non transcrit.",
      "Exemple : partage de l’héritage entre enfants et conjoint survivant.",
    ],
  },
  "5": {
    titre: "Droit du travail congolais",
    niveau: "Niveau pratique",
    resume:
      "Ce module traite du contrat de travail, du licenciement, des congés, des obligations de l’employeur et du travailleur en RDC.",
    objectifs: [
      "Comprendre les éléments essentiels du contrat de travail.",
      "Connaître les conditions de licenciement et de rupture du contrat.",
      "Identifier les droits fondamentaux du travailleur.",
    ],
    plan: [
      "1. Notion et formes du contrat de travail",
      "2. Droits et obligations de l’employeur et du travailleur",
      "3. Licenciement : motifs légitimes et irréguliers",
      "4. Congés, rémunération, heures supplémentaires",
      "5. Rôle de l’inspection du travail",
    ],
    exemples: [
      "Exemple : licenciement sans motif valable.",
      "Exemple : non-paiement du salaire ou des heures supplémentaires.",
    ],
  },
  "6": {
    titre: "OHADA & droit des affaires",
    niveau: "Niveau avancé",
    resume:
      "Ce module présente les grands principes de l’OHADA, la création d’entreprise, les formes sociales et la sécurité juridique des affaires.",
    objectifs: [
      "Comprendre le rôle de l’OHADA dans l’espace africain.",
      "Connaître les principales formes d’entreprise (SARL, SA…).",
      "Identifier les grands actes de commerce et les règles de base de la sécurité juridique.",
    ],
    plan: [
      "1. Présentation de l’OHADA et des Actes uniformes",
      "2. Création d’entreprise : étapes clés",
      "3. Formes sociales : SARL, SA, SNC…",
      "4. Contrats commerciaux essentiels",
      "5. Procédures collectives et prévention des difficultés",
    ],
    exemples: [
      "Exemple : formalités pour créer une SARL.",
      "Exemple : protection d’un associé minoritaire.",
    ],
  },
  "7": {
    titre: "Cas pratiques & mises en situation",
    niveau: "Ateliers guidés",
    resume:
      "Module basé sur des scénarios concrets : conflits familiaux, litiges commerciaux, licenciement, infractions, etc., pour appliquer la théorie.",
    objectifs: [
      "Appliquer les notions vues dans les autres modules à des situations réelles.",
      "Apprendre à qualifier juridiquement un cas concret.",
      "S’entraîner à formuler des conseils juridiques pratiques.",
    ],
    plan: [
      "1. Cas pratique : licenciement contesté",
      "2. Cas pratique : litige entre associés",
      "3. Cas pratique : conflit successoral",
      "4. Cas pratique : infraction pénale courante",
      "5. Travail guidé avec DroitGPT Académie",
    ],
    exemples: [
      "Exemple : comment analyser un courrier de licenciement.",
      "Exemple : comment conseiller un client dans un litige familial.",
    ],
  },
};

export default function AcademieModule() {
  const { id } = useParams();
  const moduleData = MODULES[id] || MODULES["1"]; // fallback module 1

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-900/75 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 md:px-8 py-5 border-b border-white/10 bg-slate-950/80 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
              DROITGPT • ACADÉMIE
            </div>
            <h1 className="mt-2 text-xl md:text-2xl font-semibold text-emerald-300">
              {moduleData.titre}
            </h1>
            <p className="text-xs mt-1 text-slate-400">{moduleData.niveau}</p>
          </div>

          <div className="flex flex-wrap gap-2 justify-start md:justify-end text-xs">
            <Link
              to="/academie"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-600/70 bg-slate-900 text-slate-200 hover:bg-slate-800 transition"
            >
              ⬅︎ Retour à l’Académie
            </Link>
            <Link
              to="/chat"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition"
            >
              💬 Poser une question à DroitGPT
            </Link>
          </div>
        </div>

        {/* Contenu */}
        <div className="px-4 md:px-8 py-6 space-y-6">
          {/* Résumé */}
          <section className="rounded-2xl border border-slate-700/70 bg-slate-900/80 px-4 py-4">
            <h2 className="text-sm font-semibold text-slate-100 mb-2">
              Résumé du module
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {moduleData.resume}
            </p>
          </section>

          {/* Objectifs & Plan */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-4">
              <h3 className="text-sm font-semibold text-emerald-200 mb-2">
                🎯 Objectifs pédagogiques
              </h3>
              <ul className="text-sm text-emerald-50/90 space-y-1.5 list-disc list-inside">
                {moduleData.objectifs.map((obj, idx) => (
                  <li key={idx}>{obj}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-sky-500/40 bg-sky-500/5 px-4 py-4">
              <h3 className="text-sm font-semibold text-sky-200 mb-2">
                🧩 Plan du cours
              </h3>
              <ul className="text-sm text-slate-100 space-y-1.5 list-disc list-inside">
                {moduleData.plan.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </section>
          </div>

          {/* Exemples + Interaction avec DroitGPT */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-violet-500/40 bg-violet-500/5 px-4 py-4">
              <h3 className="text-sm font-semibold text-violet-200 mb-2">
                📌 Exemples concrets
              </h3>
              <ul className="text-sm text-slate-100 space-y-1.5 list-disc list-inside">
                {moduleData.exemples.map((ex, idx) => (
                  <li key={idx}>{ex}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-600/60 bg-slate-900 px-4 py-4 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 mb-2">
                  💬 Utiliser DroitGPT comme coach
                </h3>
                <p className="text-sm text-slate-300 mb-3">
                  Après avoir lu ce module, ouvrez le chat et posez vos propres
                  questions, par exemple :
                </p>
                <ul className="text-xs text-slate-200 space-y-1 list-disc list-inside">
                  <li>
                    « Explique-moi simplement{" "}
                    <strong>le point 2 de ce module</strong>. »
                  </li>
                  <li>
                    « Donne-moi un exemple pratique en RDC pour ce module. »
                  </li>
                  <li>
                    « Comment ce module s’applique dans un cas réel&nbsp;? ».
                  </li>
                </ul>
              </div>

              <div className="mt-3">
                <Link
                  to="/chat"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition"
                >
                  💬 Ouvrir le chat DroitGPT pour poser des questions
                </Link>
              </div>
            </section>
          </div>

          {/* Bas de page */}
          <div className="mt-2 text-[11px] text-slate-400 border-t border-slate-800 pt-3">
            Ce module donne une base théorique. DroitGPT ne remplace pas un
            avocat ni un enseignant, mais vous aide à mieux comprendre le{" "}
            <strong>droit congolais</strong> au quotidien.
          </div>
        </div>
      </div>
    </div>
  );
}
