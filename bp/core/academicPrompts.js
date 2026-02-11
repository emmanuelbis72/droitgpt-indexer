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

export function buildMemoireSectionPrompt({ lang, ctx, sectionTitle, sourcesText, endMarker }) {
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

  const marker = String(endMarker || "").trim();

  return isEN
    ? `Write the section: "${sectionTitle}" for a Bachelor law dissertation.

Context:
- Topic: ${topic}
- Problem statement: ${ps}
- Objectives: ${obj}
- Mode: ${mode}
${planHint}${sourcesBlock}

Length requirement:
- This dissertation must reach a FULL 70 pages overall. Do NOT be overly concise.
- Write a complete section with: definitions, doctrinal views (only if provided), constitutional/legal analysis, practical issues, and structured mini-conclusion.

Formatting rules:
- No Markdown headings (#, ##, ### prohibited).
- Headings/subheadings must be bold with **...**:
  **CHAPTER/CHAPITRE...**, **Section...**, **Paragraph...**
- Use footnotes by default:
  - In-text markers: (1), (2), (3)...
  - End of section: "NOTES (FOOTNOTES)" listing each note.

Strict ending rule:
- End the section with the exact marker: ${marker}
- Write NOTHING after the marker.

Sources policy:
- If SOURCES are provided, base claims on them and create footnotes referencing the relevant source text.
- If a needed source is missing, write "(source not provided)" and add the corresponding note "source not provided".
- Never invent legal articles, cases, or bibliographic entries.`
    : `Rédige la section : "${sectionTitle}" pour un mémoire de licence en droit.

Contexte :
- Sujet : ${topic}
- Problématique : ${ps}
- Objectifs : ${obj}
- Mode : ${mode}
${planHint}${sourcesBlock}

Exigence de longueur :
- Le mémoire doit atteindre un TOTAL de 70 pages. Ne sois pas trop bref.
- Produis une section complète : définitions, points doctrinaux (seulement si fournis), analyse constitutionnelle/juridique, difficultés pratiques, mini-conclusion structurée.

Règles de forme :
- Interdiction d’utiliser des titres Markdown (#, ##, ###).
- Titres / sous-titres en GRAS via **...** :
  **CHAPITRE...**, **Section...**, **Paragraphe...**
- Notes de bas de page par défaut :
  - Appels : (1), (2), (3)...
  - Fin de section : "NOTES DE BAS DE PAGE" listant chaque note.

Règle de fin stricte :
- Termine la section par le marqueur exact : ${marker}
- N'écris RIEN après le marqueur.

Politique des sources :
- Si des SOURCES sont fournies, fonder les affirmations dessus et ajouter des notes correspondantes.
- Si une source manque : écrire "(source non fournie)" et ajouter la note "source non fournie".
- Ne jamais inventer des articles numérotés, jurisprudences, auteurs ou ouvrages.`;
}


export function buildMemoireRevisionPrompt({ lang = "fr", ctx = {}, title = "", sectionTitle = "Révision", draftChunk = "" }) {
  const c = ctx || {};
  const topic = c.topic || title || "Mémoire";

  if (String(lang).toLowerCase().startsWith("en")) {
    return `You are revising a draft dissertation. Improve language, structure, and depth while preserving meaning.

Context:
- Topic: ${topic}
- Section: ${sectionTitle}

TASK:
- Correct grammar, spelling, style, and clarity.
- Enrich with deeper explanations, better transitions, and academic tone.
- Do NOT invent references, laws, cases, statistics. If you need a citation, write "(source not provided)" and add it in the footnotes.
- Keep content faithful to the draft; you may reorganize for clarity.

FORMAT:
- No Markdown headings (#, ##, ###).
- Headings/subheadings in bold via **...**.
- Footnotes: markers (1), (2), ... and end with "NOTES (FOOTNOTES)".

DRAFT TO REVISE:
${draftChunk}
`;
  }

  return `Tu es un relecteur académique et un rédacteur. Tu révises un mémoire brouillon pour le corriger et l’enrichir, tout en gardant le fond.

Contexte :
- Sujet : ${topic}
- Section : ${sectionTitle}

TÂCHE :
- Corriger orthographe, grammaire, ponctuation, style.
- Améliorer la structure (transitions, cohérence, titres), enrichir par des explications et une analyse plus profonde.
- Ne pas inventer de références, lois, jurisprudences, chiffres. Si une source est nécessaire : écrire "(source non fournie)" et l’ajouter dans les notes.
- Rester fidèle au contenu du brouillon ; tu peux réorganiser pour clarifier.

FORMAT :
- Interdiction des titres Markdown (#, ##, ###).
- Titres/sous-titres en gras via **...**.
- Notes: appels (1), (2), (3) ... et finir par "NOTES DE BAS DE PAGE".

BROUILLON À RÉVISER :
${draftChunk}
`;
}


// ✅ Backward-compat alias
export const buildSectionPrompt = buildMemoireSectionPrompt;

