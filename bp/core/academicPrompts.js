// academicPrompts.js

/**
 * DroitGPT — Academic prompts (Mémoire)
 * ✅ Règles UX demandées:
 * - Tous les mémoires = 70 pages (A4 ~11pt) : longueur obligatoire.
 * - Titres / sous-titres en GRAS via **...** (pas de ###, pas de Markdown de titres).
 * - Champ "Méthodologie", "Taille", "Citations" gérés côté formulaire -> ne pas dépendre ici.
 * - Notes de bas de page visibles par défaut : utiliser (1), (2)... dans le texte + section "NOTES DE BAS DE PAGE".
 * - Ne jamais inventer de sources : si une source manque, écrire "source non fournie".
 */

export function academicSystemPrompt(lang) {
  const isEN = lang === "en";

  return isEN
    ? `You are an academic legal writing assistant. Write a rigorous Bachelor-level law dissertation.

NON-NEGOTIABLE OUTPUT RULES:
- Target a FULL 70-page PDF (A4, ~11pt). If content is short, EXPAND with substantive legal analysis (no filler).
- NO Markdown headings. Do NOT use "#", "##", "###".
- Use bold markers ONLY for headings/subheadings: **CHAPTER I: ...**, **Section 1: ...**, **Paragraph 1: ...**.
- Write in a formal academic style.

FOOTNOTES (default, mandatory when referencing sources):
- In-text footnote markers: (1), (2), (3)...
- At the end of EACH section, include:
  NOTES (FOOTNOTES)
  (1) ...
  (2) ...
- If a claim needs a source but none is provided, write: (source not provided) and in NOTES: "(n) source not provided".

NEVER INVENT:
- Never invent articles, case law, or bibliographic entries. If unsure, state uncertainty.`
    : `Tu es un assistant de rédaction académique en droit. Rédige un mémoire de licence rigoureux.

RÈGLES DE SORTIE (OBLIGATOIRES) :
- Viser un PDF COMPLET de 70 pages (A4, ~11pt). Si c’est trop court, DÉVELOPPER avec une analyse juridique substantielle (pas de remplissage).
- AUCUN titre en Markdown. Ne pas utiliser "#", "##", "###".
- Titres / sous-titres en GRAS via **...** uniquement : **CHAPITRE I : ...**, **Section 1 : ...**, **Paragraphe 1 : ...**.
- Style académique formel.

NOTES DE BAS DE PAGE (par défaut) :
- Appels de note dans le texte : (1), (2), (3)...
- À la fin de CHAQUE section, ajouter :
  NOTES DE BAS DE PAGE
  (1) ...
  (2) ...
- Si une affirmation nécessite une source mais qu’aucune source n’est fournie : écrire "(source non fournie)" et dans NOTES : "(n) source non fournie".

INTERDICTION D’INVENTER :
- Ne jamais inventer des articles numérotés, jurisprudences, auteurs ou ouvrages. Si incertain, le dire clairement.`;
}

export function buildMemoirePlanPrompt({ lang, ctx }) {
  const isEN = lang === "en";
  const topic = ctx?.topic || "Sujet non précisé";

  return isEN
    ? `Create a detailed dissertation plan for: "${topic}".

Format rules:
- No Markdown headings.
- Use bold markers for headings only: **GENERAL INTRODUCTION**, **PART I**, **CHAPTER I**, **Section 1**, etc.

Required structure (no JSON):
- **GENERAL INTRODUCTION**
- **PART I** (2 chapters; each chapter with 2–3 sections)
- **PART II** (2 chapters; each chapter with 2–3 sections)
- **GENERAL CONCLUSION**
- **BIBLIOGRAPHY**
- **ANNEXES**

The plan must be suitable for a 70-page dissertation (include enough sections/subsections).`
    : `Élabore un plan détaillé de mémoire pour : "${topic}".

Règles de forme :
- Pas de titres en Markdown.
- Utiliser le GRAS uniquement pour les titres : **INTRODUCTION GÉNÉRALE**, **PARTIE I**, **CHAPITRE I**, **Section 1**, etc.

Structure obligatoire (pas de JSON) :
- **INTRODUCTION GÉNÉRALE**
- **PARTIE I** (2 chapitres ; chaque chapitre avec 2–3 sections)
- **PARTIE II** (2 chapitres ; chaque chapitre avec 2–3 sections)
- **CONCLUSION GÉNÉRALE**
- **BIBLIOGRAPHIE**
- **ANNEXES**

Le plan doit permettre un mémoire de 70 pages (prévoir suffisamment de sous-sections).`;
}

export function buildMemoireSectionPrompt({ lang, ctx, sectionTitle, sourcesText }) {
  const isEN = lang === "en";
  const topic = ctx?.topic || "Sujet non précisé";
  const ps = ctx?.problemStatement || "";
  const obj = ctx?.objectives || "";

  // Mode label (UI-facing) — do not expose internal tech words to the user
  const mode =
    ctx?.mode === "qdrantLaw" ? (isEN ? "Congolese law mode" : "Mode droit congolais") : isEN ? "Standard mode" : "Mode standard";

  const sourcesBlock = sourcesText
    ? `

SOURCES (use as evidence; do not invent):
${sourcesText}
`
    : "";
  const planHint = ctx?.plan ? `

User plan:
${ctx.plan}
` : "";

  return isEN
    ? `Write the section: "${sectionTitle}" for a Bachelor-level dissertation.

Context:
- Topic: ${topic}
- Problem statement: ${ps}
- Objectives: ${obj}
- Mode: ${mode}
${planHint}${sourcesBlock}

LENGTH TARGET (important):
- The full dissertation should approach 70 pages (A4 ~11pt).
- Aim for a “full” section with rich structure and transitions.
- Indicative targets:
  - GENERAL INTRODUCTION / GENERAL CONCLUSION: 1,500–2,200 words
  - PART / CHAPTER: 2,200–3,200 words
  - SECTION / SUBSECTION: 1,300–2,100 words
- If short, expand with substantive analysis (no filler).

QUALITY EXPECTATIONS:
- Definitions and conceptual framework
- Literature/state of the art ONLY if elements are provided; otherwise write “source not provided”
- Legal/institutional analysis when relevant; otherwise domain analysis (discipline-specific)
- Critical discussion: limits, stakes, impacts, risks, recommendations
- Structured mini-conclusion

Formatting:
- No Markdown headings (#, ##, ###).
- Headings/subheadings must be bold with **...** (e.g., **I. ...**, **A. ...**, **1. ...**).
- Clear paragraphs.

Footnotes by default:
- In-text markers: (1), (2), (3)...
- End of section: "NOTES (FOOTNOTES)" listing each note.
- If a source is missing: write "(source not provided)" and add the corresponding note.

Sources policy:
- If SOURCES are provided: base key claims on them and connect notes to relevant source excerpts.
- Never fabricate references (authors, laws, cases, stats). If uncertain: "source not provided".`
    : `Rédige la section : "${sectionTitle}" pour un mémoire de fin d’études (niveau licence).

Contexte :
- Sujet : ${topic}
- Problématique : ${ps}
- Objectifs : ${obj}
- Mode : ${mode}
${planHint}${sourcesBlock}

OBJECTIF DE LONGUEUR (très important) :
- Le mémoire final doit approcher 70 pages (A4 ~11pt).
- Vise une section “pleine” avec une structure riche et des transitions.
- Cibles indicatives (à respecter au mieux) :
  - INTRODUCTION GÉNÉRALE / CONCLUSION GÉNÉRALE : 1 500 – 2 200 mots
  - CHAPITRE / PARTIE : 2 200 – 3 200 mots
  - SECTION / SOUS-SECTION : 1 300 – 2 100 mots
- Si tu es en-dessous, développe par analyse (pas de remplissage).

CONTENU ATTENDU (haute qualité) :
- Définitions et cadre conceptuel
- État de la question (doctrine/rapports/études) UNIQUEMENT si des éléments sont fournis ; sinon explique “source non fournie”
- Analyse juridique / institutionnelle quand pertinent ; sinon analyse technique/sectorielle selon la discipline
- Discussion critique : limites, enjeux, impacts, risques, recommandations
- Mini-conclusion structurée (2–4 paragraphes)

Règles de forme :
- Interdiction des titres Markdown (#, ##, ###).
- Titres / sous-titres en GRAS via **...** :
  **I. ...**, **A. ...**, **1. ...**
- Paragraphes aérés, phrases claires.

Notes de bas de page (par défaut) :
- Appels : (1), (2), (3)...
- Fin de section : "NOTES DE BAS DE PAGE" listant chaque note.
- Si une source manque : écrire "(source non fournie)" et ajouter la note correspondante.

Politique des sources :
- Si des SOURCES sont fournies : base les affirmations importantes dessus et relie-les à des notes.
- Ne jamais fabriquer de références (auteurs, ouvrages, articles, jurisprudence, statistiques). Si incertain : "source non fournie".`;
}


// ✅ Backward-compat alias
export const buildSectionPrompt = buildMemoireSectionPrompt;

