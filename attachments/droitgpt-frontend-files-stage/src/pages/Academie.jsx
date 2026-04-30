// src/pages/Academie.jsx
import React from "react";
import { Link } from "react-router-dom";

export default function Academie() {
  const modules = [
    {
      id: 1,
      titre: "Fondamentaux du droit congolais",
      niveau: "Niveau débutant",
      description:
        "Comprendre le système juridique de la RDC, les sources du droit, les grandes familles de branches et l’organisation des juridictions.",
    },
    {
      id: 2,
      titre: "Droit constitutionnel congolais",
      niveau: "Niveau fondamental",
      description:
        "Constitution de la RDC, droits et libertés fondamentaux, institutions politiques, séparation des pouvoirs et contrôle de constitutionnalité.",
    },
    {
      id: 3,
      titre: "Droit pénal & procédure pénale",
      niveau: "Niveau intermédiaire",
      description:
        "Infractions, peines, garde à vue, droits de la défense et déroulement d’un procès pénal en RDC.",
    },
    {
      id: 4,
      titre: "Droit de la famille & successions",
      niveau: "Niveau intermédiaire",
      description:
        "Mariage, divorce, filiation, tutelle, héritage et protection de la famille selon le droit congolais.",
    },
    {
      id: 5,
      titre: "Droit du travail congolais",
      niveau: "Niveau pratique",
      description:
        "Contrats de travail, licenciement, congés, obligations de l’employeur et du travailleur, inspection du travail.",
    },
    {
      id: 6,
      titre: "OHADA & droit des affaires",
      niveau: "Niveau avancé",
      description:
        "Création d’entreprise, SARL, SA, actes de commerce, procédures collectives et sécurité juridique des affaires.",
    },
    {
      id: 7,
      titre: "Cas pratiques & mises en situation",
      niveau: "Ateliers guidés",
      description:
        "Études de cas concrets inspirés de la pratique congolaise : conflits familiaux, litiges commerciaux, licenciement, etc.",
    },
  ];

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-slate-900/70 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="px-4 md:px-8 py-6 border-b border-white/10 bg-slate-950/70 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
              DROITGPT • ACADÉMIE
            </div>

            <h1 className="mt-2 text-3xl md:text-4xl font-bold">
              <span className="text-emerald-400">Apprenez le droit congolais</span> avec intelligence
            </h1>

            <p className="mt-3 text-sm md:text-base text-slate-300 max-w-2xl leading-relaxed">
              Explorez les fondements du droit congolais, le droit constitutionnel, pénal,
              civil, du travail, les règles OHADA et des cas pratiques guidés par{" "}
              <strong>DroitGPT Académie</strong>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-start md:justify-end text-xs md:text-sm">
            <Link
              to="/academie/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-violet-500/70 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition"
            >
              📊 Tableau de bord
            </Link>

            <Link
              to="/chat"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/70 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition"
            >
              💬 Poser une question
            </Link>

            <Link
              to="/assistant-vocal"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-sky-500/70 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 transition"
            >
              🎤 Assistant vocal
            </Link>

            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-600/70 bg-slate-900/80 text-slate-200 hover:bg-slate-800 transition"
            >
              ⬅️ Accueil
            </Link>
          </div>
        </div>

        {/* AVANTAGES */}
        <div className="px-4 md:px-8 py-6 space-y-8">

          <div className="grid gap-4 md:grid-cols-3 text-sm">
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-300 mb-1">
                Parcours progressif
              </div>
              <p className="text-slate-200">
                Un apprentissage du niveau débutant à avancé, avec des explications simplifiées
                et des exemples réels issus du droit congolais.
              </p>
            </div>

            <div className="rounded-2xl border border-sky-500/40 bg-sky-500/5 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.2em] text-sky-300 mb-1">
                IA juridique spécialisée
              </div>
              <p className="text-slate-200">
                DroitGPT s’appuie sur la Constitution, le Code civil, pénal, du travail,
                les Actes OHADA et la jurisprudence congolaise.
              </p>
            </div>

            <div className="rounded-2xl border border-violet-500/40 bg-violet-500/5 px-4 py-4">
              <div className="text-xs uppercase tracking-[0.2em] text-violet-300 mb-1">
                Méthode active
              </div>
              <p className="text-slate-200">
                Études de cas, quiz, résumés interactifs et possibilité de questionner l’IA
                sur n’importe quel chapitre.
              </p>
            </div>
          </div>

          {/* MODULES */}
          <div>
            <h2 className="text-lg md:text-xl font-semibold mb-4">
              📚 Parcours de formation – Droit congolais
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {modules.map((m) => (
                <div
                  key={m.id}
                  className="rounded-2xl bg-slate-900/90 border border-white/10 hover:border-emerald-400 hover:bg-slate-900 transition shadow-lg p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400">
                      {m.niveau}
                    </div>

                    <h3 className="mt-1 text-lg font-semibold text-emerald-300">
                      {m.titre}
                    </h3>

                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                      {m.description}
                    </p>
                  </div>

                  <div className="mt-5 flex items-center justify-between text-xs">
                    <Link
                      to={`/academie/programme/${m.id}`}
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition"
                    >
                      🎓 Ouvrir le module
                    </Link>
                    <span className="text-slate-400">Guidé par l’IA</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* BAS DE PAGE */}
          <div className="mt-10 rounded-2xl border border-slate-700/70 bg-slate-900/80 px-5 py-4 text-xs md:text-sm text-slate-300 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p>
              Pour approfondir vos connaissances, utilisez le{" "}
              <strong>chat DroitGPT</strong> ou l’<strong>assistant vocal</strong>{" "}
              pour interroger les notions apprises.
            </p>

            <Link
              to="/academie/dashboard"
              className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-emerald-500/70 text-emerald-200 hover:bg-emerald-500/10 transition"
            >
              📊 Accéder au tableau de bord
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
