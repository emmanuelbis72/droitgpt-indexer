// src/pages/AcademieLecon.jsx
import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import jsPDF from "jspdf";

const MODULE_TITLES = {
  "1": "Fondamentaux du droit congolais",
  "2": "Droit constitutionnel congolais",
  "3": "Droit pénal & procédure pénale",
  "4": "Droit de la famille & successions",
  "5": "Droit du travail congolais",
  "6": "OHADA & droit des affaires",
  "7": "Cas pratiques & mises en situation",
};

const LESSONS = {
  "1": [
    {
      id: 1,
      titre: "Notions de base du droit congolais",
      objectifs: [
        "Comprendre ce qu’est le droit et son rôle dans la société congolaise.",
        "Identifier les grandes branches du droit (public, privé, mixte).",
        "Situer le citoyen par rapport aux institutions et aux textes juridiques.",
      ],
      resume:
        "Ce chapitre présente les bases du droit congolais : définition du droit, sources principales et grandes branches. Il permet d’avoir une vue d’ensemble avant d’entrer dans les matières spécialisées.",
      contenu: [
        "Le droit est l’ensemble des règles obligatoires qui organisent la vie en société et sont sanctionnées par l’État.",
        "En RDC, les principales sources du droit sont : la Constitution, les lois, les règlements, les actes internationaux ratifiés et la jurisprudence.",
        "On distingue notamment le droit public (État, Constitution, finances publiques…), le droit privé (famille, contrats, obligations, propriété…) et le droit mixte (droit pénal, droit du travail, etc.).",
      ],
      quiz: [
        {
          question: "Quelle est la meilleure définition du droit ?",
          options: [
            "Un ensemble de conseils moraux proposés aux citoyens.",
            "Un ensemble de règles obligatoires organisant la vie en société, sanctionnées par l’État.",
            "Une simple coutume sans force obligatoire.",
            "Une opinion personnelle du juge.",
          ],
          bonneReponse: 1,
          explication:
            "Le droit regroupe des règles obligatoires, générales et impersonnelles, sanctionnées par l’État lorsqu’elles ne sont pas respectées.",
        },
        {
          question:
            "Laquelle de ces sources n’est PAS une source principale du droit en RDC ?",
          options: [
            "La Constitution.",
            "Les lois votées par le Parlement.",
            "Les règlements et arrêtés.",
            "Les rumeurs circulant sur les réseaux sociaux.",
          ],
          bonneReponse: 3,
          explication:
            "Les rumeurs ne sont évidemment pas une source de droit. Les textes officiels, eux, sont adoptés par les autorités compétentes.",
        },
      ],
      questionsSuggeres: [
        "Demander à DroitGPT : « Quelles sont les différences entre droit public et droit privé en RDC ? »",
        "Demander à DroitGPT : « Quelles sont les principales sources du droit en République démocratique du Congo ? »",
      ],
    },
    {
      id: 2,
      titre: "Les sources du droit congolais",
      objectifs: [
        "Identifier les principales sources du droit en RDC.",
        "Comprendre la hiérarchie des normes (Constitution, lois, règlements).",
        "Savoir pourquoi la Constitution est la norme suprême.",
      ],
      resume:
        "On détaille ici les sources du droit en RDC et la hiérarchie entre elles : la Constitution au sommet, puis les lois, ordonnances, règlements, etc.",
      contenu: [
        "La Constitution du 18 février 2006, révisée, est la norme suprême. Tout texte contraire à la Constitution peut être annulé.",
        "Les lois sont votées par le Parlement ; les ordonnances présidentielles, décrets et arrêtés complètent ce cadre juridique.",
        "Les traités internationaux ratifiés par la RDC font également partie du bloc de légalité lorsqu’ils sont intégrés dans l’ordre interne.",
      ],
      quiz: [
        {
          question: "Quel texte occupe le sommet de la hiérarchie des normes ?",
          options: [
            "Les arrêtés ministériels.",
            "Les lois ordinaires.",
            "La Constitution.",
            "Les circulaires administratives.",
          ],
          bonneReponse: 2,
          explication:
            "La Constitution est la norme suprême : toutes les autres normes doivent la respecter.",
        },
      ],
      questionsSuggeres: [
        "Demander à DroitGPT : « Que se passe-t-il si une loi contredit la Constitution congolaise ? »",
      ],
    },
  ],

  "2": [
    {
      id: 1,
      // 🔗 On relie ce chapitre au fichier public/academie-cours/module1_chap1.txt
      fileSlug: "module1_chap1",
      titre: "Chapitre I — Les notions de la Constitution",
      objectifs: [
        "Expliquer les différentes définitions de la Constitution (matérielle et formelle) et leurs implications dans l’ordre juridique congolais.",
        "Identifier les éléments garantissant la suprématie et la rigidité de la Constitution, ainsi que les procédures d’élaboration et de révision.",
        "Distinguer les formes de constitutions (écrite, coutumière, coutume constitutionnelle) et analyser leur rôle dans un État de droit moderne.",
      ],
      resume:
        "La Constitution est la norme juridique suprême qui organise l’État, définit les compétences des pouvoirs publics et garantit les droits fondamentaux des citoyens. Elle peut être envisagée sous un sens matériel (ensemble de règles relatives à l’exercice du pouvoir) ou formel (texte écrit adopté selon une procédure spéciale). Sa suprématie repose à la fois sur son caractère supérieur et sur la procédure exigeante de son élaboration et de sa révision. On distingue les constitutions écrites et coutumières, ainsi que la coutume constitutionnelle résultant de pratiques institutionnelles ayant force obligatoire. Enfin, la rigidité constitutionnelle, les limites posées au pouvoir constituant dérivé et les mécanismes de contrôle (politique, juridictionnel, citoyen) sont essentiels pour protéger l’État de droit en République démocratique du Congo.",
      // On peut laisser 'contenu' vide, le texte complet vient du fichier TXT
      contenu: [],
      quiz: [
        {
          question:
            "Dans son sens matériel, la Constitution désigne principalement :",
          options: [
            "Seules les règles écrites relatives aux droits fondamentaux.",
            "L’ensemble des règles concernant l’organisation et l’exercice du pouvoir.",
            "Un texte accessible uniquement par référendum.",
            "Les lois adoptées par le Parlement.",
          ],
          bonneReponse: 1,
          explication:
            "La définition matérielle vise toutes les règles qui concernent l’exercice du pouvoir politique, quelle que soit leur forme.",
        },
        {
          question:
            "Selon le sens formel, la Constitution se caractérise avant tout par :",
          options: [
            "Son ancienneté et son origine coutumière.",
            "Un texte élaboré par les juges constitutionnels.",
            "Une procédure d’adoption et de révision spécifique.",
            "La souplesse de modification.",
          ],
          bonneReponse: 2,
          explication:
            "La Constitution formelle est un texte écrit adopté selon des procédures particulières distinctes des lois ordinaires.",
        },
        {
          question: "Pourquoi une Constitution rigide est-elle importante ?",
          options: [
            "Parce qu’elle se modifie plus facilement.",
            "Parce qu’elle protège la Constitution contre des révisions opportunistes.",
            "Parce qu’elle supprime la séparation des pouvoirs.",
            "Parce qu’elle permet de gouverner sans règles.",
          ],
          bonneReponse: 1,
          explication:
            "La rigidité empêche des modifications intempestives motivées par des intérêts politiques particuliers.",
        },
        {
          question:
            "Quel organe veille au respect de la Constitution en RDC, selon l’article 69 ?",
          options: [
            "Le Parlement.",
            "La Cour constitutionnelle.",
            "Le Président de la République.",
            "Le Gouvernement.",
          ],
          bonneReponse: 2,
          explication:
            "L’article 69 de la Constitution attribue au Président de la République la mission de veiller au respect de la Constitution.",
        },
        {
          question: "La coutume constitutionnelle se définit comme :",
          options: [
            "Une Constitution non écrite et complète.",
            "Un ensemble de pratiques obligatoires en marge du texte écrit.",
            "Une norme internationale applicable en droit interne.",
            "Une procédure d’élaboration monarchique.",
          ],
          bonneReponse: 1,
          explication:
            "La coutume constitutionnelle résulte de pratiques institutionnelles répétées et acceptées comme obligatoires, en complément ou en marge du texte écrit.",
        },
        {
          question:
            "Quel est l’avantage principal d’une Constitution écrite par rapport à une Constitution purement coutumière ?",
          options: [
            "Elle se modifie sans procédure.",
            "Elle garantit la clarté et la sécurité juridique.",
            "Elle supprime les droits fondamentaux.",
            "Elle remplace le contrôle de constitutionnalité.",
          ],
          bonneReponse: 1,
          explication:
            "Une Constitution écrite permet une meilleure précision et stabilité du cadre institutionnel, ce qui renforce la sécurité juridique.",
        },
        {
          question:
            "Pourquoi une Constitution trop révisée risque-t-elle de perdre sa valeur ?",
          options: [
            "Parce qu’elle devient illisible.",
            "Parce qu’elle s’adapte trop au peuple.",
            "Parce qu’elle cesse d’exprimer la volonté générale pour devenir l’outil d’intérêts particuliers.",
            "Parce qu’elle ne peut plus être appliquée par les tribunaux.",
          ],
          bonneReponse: 2,
          explication:
            "Une Constitution façonnée pour un individu ou un groupe perd son caractère impersonnel et sa légitimité, cessant de refléter la volonté générale.",
        },
      ],
      questionsSuggeres: [
        "Demander à DroitGPT : « Explique la différence entre Constitution matérielle et Constitution formelle dans le contexte congolais. »",
        "Demander à DroitGPT : « Pourquoi la suprématie et la rigidité de la Constitution sont essentielles pour l’État de droit en RDC ? »",
      ],
    },
    {
      id: 2,
      fileSlug: "module1_chap2",
      titre: "Chapitre II — Théories générales sur la forme de l’État",
      objectifs: [
        "Distinguer les différentes formes d’État (unitaire, fédéral, confédéral, régional) et leurs caractéristiques essentielles.",
        "Expliquer les mécanismes de déconcentration et de décentralisation et leur importance dans l’organisation territoriale.",
        "Analyser les implications de chaque forme d’État dans la gestion du pouvoir politique et administratif en contexte congolais.",
      ],
      resume:
        "La forme de l’État renvoie à la manière dont le pouvoir politique est organisé et réparti sur un territoire donné. Deux grandes catégories sont classiquement distinguées : l’État unitaire et l’État composé. L’État unitaire, modèle dominant en Afrique et en RDC, repose sur un seul centre de décision politique et administrative mais connaît des aménagements comme la déconcentration et la décentralisation, destinés à rapprocher l’administration des citoyens. L’État composé peut prendre la forme d’un État fédéral, où coexistent un État central et des entités fédérées dotées d’autonomie, ou d’une confédération d’États, union plus souple dans laquelle chaque membre conserve sa souveraineté. Entre ces modèles se situe l’État régional, marqué par une forte décentralisation tout en demeurant unitaire. L’étude de ces formes permet de mieux comprendre les choix et l’évolution de l’organisation de l’État congolais.",
      contenu: [],
      quiz: [
        {
          id: 1,
          question: "L’État unitaire se caractérise principalement par :",
          options: [
            "Plusieurs centres de souveraineté",
            "Un seul centre de décision politique et administrative",
            "Une autonomie constitutionnelle des entités territoriales",
            "La coexistence de plusieurs constitutions",
          ],
          bonneReponse: 1,
          explication:
            "L’État unitaire repose sur l’unité de territoire, de population et d’organisation politique, avec un centre de décision unique.",
        },
        {
          id: 2,
          question: "La déconcentration consiste en :",
          options: [
            "La création de nouvelles personnes morales autonomes",
            "Le transfert de compétences à des autorités locales déléguées représentant l’État",
            "La disparition du pouvoir central",
            "L’octroi d’une souveraineté aux provinces",
          ],
          bonneReponse: 1,
          explication:
            "La déconcentration rapproche l’administration des citoyens mais ne crée pas d’autonomie juridique ; les autorités déconcentrées agissent au nom de l’État.",
        },
        {
          id: 3,
          question: "La décentralisation se distingue de la déconcentration parce qu’elle implique :",
          options: [
            "L’absence de tutelle de l’État",
            "La reconnaissance d’une personnalité juridique aux entités locales",
            "Un pouvoir central renforcé",
            "La suppression du découpage territorial",
          ],
          bonneReponse: 1,
          explication:
            "La décentralisation crée de véritables centres de pouvoir autonomes dotés d’une personnalité juridique propre.",
        },
        {
          id: 4,
          question: "Dans un État fédéral :",
          options: [
            "Les États fédérés sont souverains sur le plan international",
            "Les compétences sont exclusivement exercées par l’État central",
            "Les États fédérés disposent d’une autonomie constitutionnelle et législative",
            "La Constitution fédérale peut être modifiée par un seul État fédéré",
          ],
          bonneReponse: 2,
          explication:
            "Les États fédérés ont une autonomie constitutionnelle et législative mais ne disposent pas de souveraineté internationale.",
        },
        {
          id: 5,
          question: "La confédération d’États se distingue de la fédération par :",
          options: [
            "L’unicité de la souveraineté",
            "Le maintien de la souveraineté des États membres",
            "L’existence d’une Constitution unique",
            "La primauté du droit confédéral",
          ],
          bonneReponse: 1,
          explication:
            "Dans une confédération, les États membres demeurent souverains et conservent leur personnalité internationale.",
        },
        {
          id: 6,
          question: "L’État régional se situe entre l’État unitaire et l’État fédéral car :",
          options: [
            "Il supprime toute autonomie locale",
            "Il reprend strictement le modèle fédéral",
            "Il combine une forte décentralisation avec un État central unitaire",
            "Il est fondé sur un traité international",
          ],
          bonneReponse: 2,
          explication:
            "L’État régional est une forme intermédiaire : très décentralisé mais demeurant unitaire.",
        },
        {
          id: 7,
          question: "Parmi les principes fondamentaux du fédéralisme figure :",
          options: [
            "Le monopole du pouvoir central",
            "L’unanimité obligatoire pour toute décision",
            "L’autonomie, la participation et la coopération",
            "L’absence de constitution écrite",
          ],
          bonneReponse: 2,
          explication:
            "Le fédéralisme repose sur trois piliers : autonomie des entités, participation au pouvoir fédéral et coopération.",
        },
      ],
      questionsSuggeres: [
        "Expliquez la différence entre déconcentration et décentralisation dans l’organisation territoriale de la RDC.",
        "Discutez les avantages et limites d’un État fédéral par rapport à un État unitaire en Afrique.",
      ],
    },
  ],

  "3": [
    {
      id: 1,
      titre: "Introduction au droit pénal congolais",
      objectifs: [
        "Comprendre la notion d’infraction et de sanction pénale.",
        "Identifier les grandes catégories d’infractions.",
      ],
      resume:
        "Première approche du droit pénal congolais : rôle, principes généraux et catégories d’infractions.",
      contenu: [
        "Le droit pénal protège l’ordre public en réprimant les comportements interdits par la loi.",
        "On distingue classiquement les contraventions, délits et crimes selon la gravité.",
      ],
      quiz: [],
      questionsSuggeres: [],
    },
  ],
  "4": [
    {
      id: 1,
      titre: "Principes du droit de la famille en RDC",
      objectifs: [],
      resume: "Introduction aux grandes notions du droit de la famille.",
      contenu: [],
      quiz: [],
      questionsSuggeres: [],
    },
  ],
  "5": [
    {
      id: 1,
      titre: "Introduction au droit du travail congolais",
      objectifs: [],
      resume:
        "Vue d’ensemble des relations de travail formelles en RDC et des textes applicables.",
      contenu: [],
      quiz: [],
      questionsSuggeres: [],
    },
  ],
  "6": [
    {
      id: 1,
      titre: "Notions clés d’OHADA & droit des affaires",
      objectifs: [],
      resume:
        "Présentation rapide de l’OHADA et de son rôle dans l’uniformisation du droit des affaires.",
      contenu: [],
      quiz: [],
      questionsSuggeres: [],
    },
  ],
  "7": [
    {
      id: 1,
      titre: "Cas pratiques – Mise en situation",
      objectifs: [],
      resume:
        "Exemples pratiques pour appliquer les notions vues dans les autres modules.",
      contenu: [],
      quiz: [],
      questionsSuggeres: [],
    },
  ],
};

const STORAGE_KEY = "academieProgress";

function readProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // ignore
  }
}

// Nettoyage HTML -> texte
function stripHtmlToText(html) {
  if (!html) return "";
  return (
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

// Construire un texte brut à envoyer à DroitGPT pour explication orale
function buildLessonRawText(lesson, moduleTitle, chapterIndex, fullLessonText) {
  if (!lesson) return "";
  const parts = [];
  parts.push(`Module : ${moduleTitle}`);
  parts.push(`Chapitre ${chapterIndex} : ${lesson.titre}`);
  if (lesson.resume) {
    parts.push(`Résumé : ${lesson.resume}`);
  }
  if (fullLessonText) {
    parts.push("Contenu du cours :");
    parts.push(fullLessonText);
  } else if (lesson.contenu && lesson.contenu.length > 0) {
    parts.push("Contenu :");
    lesson.contenu.forEach((c) => parts.push(c));
  }
  return parts.join("\n");
}

export default function AcademieLecon() {
  const { id, lessonId } = useParams();
  const navigate = useNavigate();

  const moduleId = MODULE_TITLES[id] ? id : "1";
  const lessonsForModule = LESSONS[moduleId] || LESSONS["1"];
  const index = Math.max(
    0,
    Math.min(lessonsForModule.length - 1, (parseInt(lessonId, 10) || 1) - 1)
  );
  const lesson = lessonsForModule[index];
  const moduleTitle = MODULE_TITLES[moduleId];

  const hasPrev = index > 0;
  const hasNext = index < lessonsForModule.length - 1;

  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(null);

  // Audio
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isGeneratingAudioText, setIsGeneratingAudioText] = useState(false);

  // 🆕 Texte complet du cours provenant du fichier TXT
  const [fullLessonText, setFullLessonText] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechSupported(false);
    }
  }, []);

  // 🔁 Charger le texte du fichier si fileSlug est défini
  useEffect(() => {
    if (!lesson || !lesson.fileSlug) {
      setFullLessonText("");
      return;
    }

    const url = `/academie-cours/${lesson.fileSlug}.txt`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Fichier cours introuvable");
        return res.text();
      })
      .then((txt) => {
        setFullLessonText(txt);
      })
      .catch((err) => {
        console.error("Erreur chargement cours :", err);
        setFullLessonText(
          "Le contenu détaillé de ce chapitre sera bientôt disponible."
        );
      });
  }, [lesson]);

  // reset quiz + stop audio + update progression quand le chapitre change
  useEffect(() => {
    setSelectedAnswers({});
    setQuizSubmitted(false);
    setQuizScore(null);

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    try {
      const progress = readProgress();
      const prev = progress[moduleId] || {};
      const totalLessons = LESSONS[moduleId]?.length || 1;
      const completed = Math.max(prev.completedLessons || 0, index + 1);

      progress[moduleId] = {
        ...prev,
        hasStarted: true,
        totalLessons,
        completedLessons: completed,
        quizzesTotal: prev.quizzesTotal || 0,
        quizzesPassed: prev.quizzesPassed || 0,
      };

      writeProgress(progress);
    } catch {
      // ignore
    }
  }, [moduleId, index]);

  const handleAnswerChange = (questionIndex, optionIndex) => {
    if (quizSubmitted) return;
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionIndex]: optionIndex,
    }));
  };

  const handleSubmitQuiz = () => {
    if (!lesson.quiz || lesson.quiz.length === 0) return;

    let score = 0;
    lesson.quiz.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.bonneReponse) {
        score += 1;
      }
    });

    setQuizSubmitted(true);
    setQuizScore(score);

    try {
      const progress = readProgress();
      const prev = progress[moduleId] || {};
      const quizzesTotal = Math.max(prev.quizzesTotal || 0, lesson.quiz.length);
      const quizzesPassed = Math.max(prev.quizzesPassed || 0, score);

      progress[moduleId] = {
        ...prev,
        hasStarted: true,
        totalLessons: LESSONS[moduleId]?.length || prev.totalLessons || 1,
        completedLessons: Math.max(prev.completedLessons || 0, index + 1),
        quizzesTotal,
        quizzesPassed,
      };

      writeProgress(progress);
    } catch {
      // ignore
    }
  };

  const handleGoPrev = () => {
    if (!hasPrev) return;
    navigate(`/academie/programme/${moduleId}/lesson/${index}`);
  };

  const handleGoNext = () => {
    if (!hasNext) return;
    navigate(`/academie/programme/${moduleId}/lesson/${index + 2}`);
  };

  // 🔊 Explication orale (DroitGPT → texte oral → speechSynthesis)
  const handleToggleAudio = async () => {
    if (!speechSupported) {
      alert(
        "La lecture audio n’est pas supportée par ce navigateur. Essaye avec Chrome ou Edge récent."
      );
      return;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) return;

    // Si déjà en train de parler → stop
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    try {
      setIsGeneratingAudioText(true);

      // 1) Construire un texte brut du cours (en priorité depuis le fichier)
      const rawText = buildLessonRawText(
        lesson,
        moduleTitle,
        index + 1,
        fullLessonText
      ).slice(0, 4000);

      // 2) Appeler ton backend DroitGPT pour une explication orale
      const prompt =
        "Explique oralement, de manière simple, claire et pédagogique, le cours suivant à un étudiant congolais. " +
        "Utilise un ton parlé, des phrases courtes, sans HTML, sans listes techniques lourdes, comme un professeur qui explique. " +
        "Ne donne pas de structure trop académique, privilégie la compréhension orale.\n\n" +
        'Cours à expliquer : """\n' +
        rawText +
        '\n"""';

      const res = await fetch("https://droitgpt-indexer.onrender.com/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ from: "user", text: prompt }],
          lang: "fr",
        }),
      });

      if (!res.ok) {
        throw new Error("Erreur backend DroitGPT.");
      }

      const data = await res.json();
      let explained = data.answer || "";
      explained = stripHtmlToText(explained);

      if (!explained) {
        throw new Error("Texte audio vide.");
      }

      setIsGeneratingAudioText(false);

      // 3) Lecture avec speechSynthesis
      const utterance = new SpeechSynthesisUtterance(explained);
      utterance.lang = "fr-FR";
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
    } catch (e) {
      console.error(e);
      setIsGeneratingAudioText(false);
      alert(
        "Impossible de générer l’explication audio pour le moment. Réessaie un peu plus tard."
      );
    }
  };

  const handleGeneratePdf = () => {
    if (!lesson) return;

    const doc = new jsPDF();
    const marginLeft = 20;
    let y = 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("DroitGPT Académie", marginLeft, y);
    y += 8;

    doc.setFontSize(13);
    doc.text(`Module : ${moduleTitle}`, marginLeft, y);
    y += 6;
    doc.text(`Chapitre ${index + 1} – ${lesson.titre}`, marginLeft, y);
    y += 8;

    if (lesson.resume) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Résumé du chapitre", marginLeft, y);
      y += 6;

      doc.setFont("helvetica", "normal");
      const resumeLines = doc.splitTextToSize(lesson.resume, 170);
      doc.text(resumeLines, marginLeft, y);
      y += resumeLines.length * 6 + 4;
    }

    // Points clés ou texte du cours
    if (fullLessonText || (lesson.contenu && lesson.contenu.length > 0)) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Points clés du cours", marginLeft, y);
      y += 6;

      doc.setFont("helvetica", "normal");

      if (fullLessonText) {
        const lines = doc.splitTextToSize(fullLessonText, 170);
        lines.forEach((line) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, marginLeft, y);
          y += 6;
        });
      } else {
        lesson.contenu.forEach((c) => {
          const lines = doc.splitTextToSize(`• ${c}`, 170);
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(lines, marginLeft, y);
          y += lines.length * 6 + 2;
        });
      }
      y += 2;
    }

    if (lesson.quiz && lesson.quiz.length > 0) {
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Quiz du chapitre (avec corrigé)", marginLeft, y);
      y += 6;

      doc.setFont("helvetica", "normal");
      lesson.quiz.forEach((q, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        const qLines = doc.splitTextToSize(
          `${idx + 1}. ${q.question}`,
          170
        );
        doc.text(qLines, marginLeft, y);
        y += qLines.length * 6 + 2;

        q.options.forEach((opt, optIdx) => {
          const prefix = optIdx === q.bonneReponse ? "✔ " : "- ";
          const optLines = doc.splitTextToSize(`${prefix}${opt}`, 170);
          doc.text(optLines, marginLeft + 4, y);
          y += optLines.length * 6 + 1;
        });

        if (q.explication) {
          const explLines = doc.splitTextToSize(
            `Explication : ${q.explication}`,
            170
          );
          doc.text(explLines, marginLeft + 4, y);
          y += explLines.length * 6 + 3;
        }
        y += 2;
      });
    }

    const today = new Date().toLocaleDateString("fr-FR");
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text(
      `Document généré automatiquement par DroitGPT Académie le ${today}.`,
      marginLeft,
      y + 4
    );

    doc.save(`module_${moduleId}_chapitre_${index + 1}.pdf`);
  };

  if (!lesson) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-300">
            Le chapitre demandé n’existe pas.
          </p>
          <Link
            to="/academie"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
          >
            ⬅️ Retour à l’Académie
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="px-5 md:px-7 py-4 border-b border-white/10 bg-slate-950/80 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
              DROITGPT • ACADEMIE
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Module : <span className="text-slate-200">{moduleTitle}</span>
            </p>
            <h1 className="mt-1 text-xl md:text-2xl font-semibold text-emerald-300">
              Chapitre {index + 1} – {lesson.titre}
            </h1>
          </div>

          <div className="flex flex-wrap gap-2 text-xs justify-end">
            <button
              type="button"
              onClick={handleToggleAudio}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs transition ${
                isSpeaking
                  ? "border-rose-400 bg-rose-500/10 text-rose-100"
                  : "border-emerald-500/80 bg-slate-900 text-emerald-200 hover:bg-emerald-500/10"
              }`}
              disabled={isGeneratingAudioText}
            >
              {isGeneratingAudioText
                ? "⏳ Préparation de l’explication..."
                : isSpeaking
                ? "⏹️ Arrêter l’audio"
                : "🔊 Écouter une explication orale du cours"}
            </button>

            <button
              type="button"
              onClick={handleGeneratePdf}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-sky-500/70 bg-slate-900 text-sky-200 hover:bg-sky-500/10 transition"
            >
              📄 PDF du chapitre
            </button>

            <Link
              to="/academie/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-600/60 bg-slate-900 hover:bg-slate-800 text-slate-100 transition"
            >
              📊 Tableau de bord
            </Link>

            <Link
              to="/academie"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-600/60 bg-slate-900 hover:bg-slate-800 text-slate-100 transition"
            >
              ⬅️ Tous les modules
            </Link>
          </div>
        </div>

        {/* CONTENU */}
        <div className="px-5 md:px-7 py-5 space-y-5 bg-slate-950/70">
          {/* Bande info audio */}
          {isGeneratingAudioText && (
            <div className="mb-2 rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span>
                L’assistant prépare une explication orale simplifiée du cours…
              </span>
            </div>
          )}

          {/* Navigation chapitre précédent / suivant */}
          <div className="flex items-center justify-between text-xs mb-2">
            <button
              type="button"
              onClick={handleGoPrev}
              disabled={!hasPrev}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition ${
                hasPrev
                  ? "border-slate-600/70 bg-slate-900 hover:bg-slate-800 text-slate-100"
                  : "border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed"
              }`}
            >
              ⬅️ Chapitre précédent
            </button>
            <span className="text-slate-400">
              Chapitre {index + 1} / {lessonsForModule.length}
            </span>
            <button
              type="button"
              onClick={handleGoNext}
              disabled={!hasNext}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition ${
                hasNext
                  ? "border-emerald-500/70 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-100"
                  : "border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed"
              }`}
            >
              Chapitre suivant ➡️
            </button>
          </div>

          {/* Résumé + objectifs */}
          <div className="grid grid-cols-1 md:grid-cols-[1.6fr_1.2fr] gap-4">
            <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-4">
              <h2 className="text-sm font-semibold text-emerald-200 mb-2">
                📝 Résumé du chapitre
              </h2>
              <p className="text-sm text-emerald-50 leading-relaxed">
                {lesson.resume || "Résumé à venir pour ce chapitre."}
              </p>
            </section>

            <section className="rounded-2xl border border-slate-700/60 bg-slate-900 px-4 py-4">
              <h2 className="text-sm font-semibold text-slate-100 mb-2">
                🎯 Objectifs pédagogiques
              </h2>
              {lesson.objectifs && lesson.objectifs.length > 0 ? (
                <ul className="text-xs text-slate-200 space-y-1.5 list-disc list-inside">
                  {lesson.objectifs.map((obj, idx) => (
                    <li key={idx}>{obj}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  Les objectifs détaillés seront ajoutés pour ce module.
                </p>
              )}
            </section>
          </div>

          {/* Contenu principal */}
          <section className="rounded-2xl border border-slate-700/60 bg-slate-900 px-4 py-4">
            <h2 className="text-sm font-semibold text-slate-100 mb-2">
              📚 Contenu du cours
            </h2>
            {fullLessonText ? (
              <pre className="whitespace-pre-wrap text-sm text-slate-100 leading-relaxed">
                {fullLessonText}
              </pre>
            ) : lesson.contenu && lesson.contenu.length > 0 ? (
              <ul className="text-sm text-slate-100 space-y-1.5 list-disc list-inside">
                {lesson.contenu.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">
                Le contenu détaillé de ce chapitre sera enrichi prochainement.
              </p>
            )}
          </section>

          {/* Quiz interactif */}
          {lesson.quiz && lesson.quiz.length > 0 && (
            <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-4">
              <h2 className="text-sm font-semibold text-amber-200 mb-2">
                🧠 Quiz du chapitre
              </h2>
              <p className="text-xs text-amber-100 mb-3">
                Testez votre compréhension. Les bonnes réponses s’affichent
                après validation.
              </p>

              <div className="space-y-4">
                {lesson.quiz.map((q, qIndex) => {
                  const userChoice = selectedAnswers[qIndex];
                  const isCorrect =
                    quizSubmitted && userChoice === q.bonneReponse;

                  return (
                    <div
                      key={qIndex}
                      className="rounded-xl border border-amber-500/40 bg-slate-950/60 px-3 py-3"
                    >
                      <p className="text-sm font-medium text-amber-100 mb-2">
                        {qIndex + 1}. {q.question}
                      </p>
                      <div className="space-y-1.5 text-xs">
                        {q.options.map((opt, optIndex) => {
                          const isUserChoice = userChoice === optIndex;
                          const isGoodAnswer = q.bonneReponse === optIndex;

                          let optionClass =
                            "w-full text-left px-3 py-1.5 rounded-lg border text-xs transition";
                          if (!quizSubmitted) {
                            optionClass += isUserChoice
                              ? " border-amber-400 bg-amber-500/20 text-amber-50"
                              : " border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800";
                          } else {
                            if (isGoodAnswer) {
                              optionClass +=
                                " border-emerald-400 bg-emerald-600/20 text-emerald-50";
                            } else if (isUserChoice && !isGoodAnswer) {
                              optionClass +=
                                " border-rose-400 bg-rose-600/20 text-rose-50";
                            } else {
                              optionClass +=
                                " border-slate-800 bg-slate-900 text-slate-300";
                            }
                          }

                          return (
                            <button
                              key={optIndex}
                              type="button"
                              disabled={quizSubmitted}
                              onClick={() =>
                                handleAnswerChange(qIndex, optIndex)
                              }
                              className={optionClass}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>

                      {quizSubmitted && (
                        <p className="mt-2 text-[11px] text-amber-100">
                          ✅ Bonne réponse :{" "}
                          <span className="font-semibold">
                            {q.options[q.bonneReponse]}
                          </span>
                          {q.explication && (
                            <>
                              <br />
                              <span className="opacity-80">
                                Explication : {q.explication}
                              </span>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleSubmitQuiz}
                  disabled={quizSubmitted}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition ${
                    quizSubmitted
                      ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                      : "bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-lg shadow-amber-500/30"
                  }`}
                >
                  ✅ Valider le quiz
                </button>

                {quizSubmitted && (
                  <div className="text-xs text-amber-100">
                    Score :{" "}
                    <span className="font-semibold">
                      {quizScore} / {lesson.quiz.length}
                    </span>{" "}
                    réponses correctes.
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Suggestions questions DroitGPT */}
          {lesson.questionsSuggeres && lesson.questionsSuggeres.length > 0 && (
            <section className="rounded-2xl border border-sky-500/40 bg-sky-500/5 px-4 py-4">
              <h2 className="text-sm font-semibold text-sky-200 mb-2">
                💬 Idées de questions à poser à DroitGPT
              </h2>
              <ul className="text-xs text-sky-50 space-y-1.5 list-disc list-inside">
                {lesson.questionsSuggeres.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
              <div className="mt-3">
                <Link
                  to="/chat"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs transition"
                >
                  💬 Ouvrir le chat DroitGPT maintenant
                </Link>
              </div>
            </section>
          )}

          {/* Note bas de page */}
          <div className="border-t border-slate-800 pt-4 text-[11px] text-slate-500">
            Ce chapitre est une synthèse pédagogique. Pour un litige, un contrat
            ou une procédure concrète, rapprochez-vous d’un professionnel du
            droit en RDC.
          </div>
        </div>
      </div>
    </div>
  );
}
