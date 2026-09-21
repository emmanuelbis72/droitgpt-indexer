// academicPrompts.js

/**
 * DroitGPT — Academic prompts (Mémoire / Dissertation)
 *
 * ✅ Production rules
 * - Multi-disciplines (law + non-law)
 * - No invented sources: if missing => "source non fournie" / "source not provided"
 * - No Markdown headings (#, ##, ### forbidden)
 * - Headings/subheadings must be in **bold** only
 */

function normalizeDiscipline(ctx = {}) {
  const d = String(ctx.discipline || ctx.field || ctx.faculty || ctx.department || "").trim();
  if (!d) return "";
  return d;
}

function isLawDiscipline(ctx = {}) {
  const d = normalizeDiscipline(ctx).toLowerCase();
  return (
    d.includes("droit") ||
    d.includes("law") ||
    d.includes("jurid") ||
    d.includes("juris") ||
    d.includes("legal")
  );
}

function citationStyleLabel(lang, style) {
  const s = String(style || "footnotes").toLowerCase();
  if (lang === "en") {
    return s === "apa" ? "APA (author-date)" : "Footnotes";
  }
  return s === "apa" ? "APA (auteur-date)" : "Notes de bas de page";
}

function lengthTarget(ctx = {}) {
  const p = Number(ctx.lengthPagesTarget || 0);
  if (Number.isFinite(p) && p > 0) return Math.max(50, Math.min(90, p));
  return 55; // default: >=50 and faster than 70
}

function buildDraftDigest(raw, maxChars) {
  const text = String(raw || "");
  if (!text.trim()) return { text: "", omittedChars: 0 };
  if (text.length <= maxChars) return { text, omittedChars: 0 };

  const firstLen = Math.floor(maxChars * 0.45);
  const middleLen = Math.floor(maxChars * 0.2);
  const lastLen = Math.max(1200, maxChars - firstLen - middleLen);
  const midStart = Math.max(firstLen, Math.floor((text.length - middleLen) / 2));
  const lastStart = Math.max(0, text.length - lastLen);

  const digest = [
    text.slice(0, firstLen),
    "\n\n[...EXTRAIT CENTRAL DU BROUILLON...]\n\n",
    text.slice(midStart, midStart + middleLen),
    "\n\n[...FIN DU BROUILLON...]\n\n",
    text.slice(lastStart),
  ].join("").slice(0, maxChars + 240);

  return { text: digest, omittedChars: Math.max(0, text.length - digest.length) };
}

function draftContextBlock(lang = "fr", ctx = {}) {
  const raw = String(ctx.draftText || "").trim();
  if (!raw) return "";
  const isEN = String(lang).toLowerCase() === "en";
  const maxChars = Math.max(10000, Number(process.env.MEMOIRE_DRAFT_CONTEXT_MAX_CHARS || 60000));
  const { text, omittedChars } = buildDraftDigest(raw, maxChars);
  const sourceName = String(ctx.draftFileName || "").trim();
  const meta = ctx.draftMeta && typeof ctx.draftMeta === "object" ? ctx.draftMeta : {};
  const methods = Array.isArray(meta.extractionMethods) ? meta.extractionMethods.filter(Boolean).join(", ") : "";
  const warnings = Array.isArray(meta.warnings) && meta.warnings.length ? meta.warnings.join(" | ") : "";
  const roughKind = meta.kind || (methods.includes("ocr") ? "ocr" : methods.includes("pasted") ? "rough_text" : "");
  const metaLine = [methods ? `Extraction: ${methods}` : "", roughKind ? `Type: ${roughKind}` : "", warnings ? `Warnings: ${warnings}` : ""]
    .filter(Boolean)
    .join(" | ");
  const coverage = omittedChars > 0
    ? isEN
      ? `\nThe uploaded draft has ${raw.length} characters. The prompt includes representative beginning, middle and end extracts; ${omittedChars} characters are not included verbatim. Clearly state if some parts could not be exploited.\n`
      : `\nLe brouillon uploadé contient ${raw.length} caractères. Le prompt inclut des extraits représentatifs du début, du milieu et de la fin ; ${omittedChars} caractères ne sont pas inclus mot pour mot. Signale clairement si certaines parties n'ont pas pu être exploitées.\n`
    : "";

  return isEN
    ? `

UPLOADED DRAFT ${sourceName ? `(${sourceName})` : ""}:
${metaLine ? `${metaLine}\n` : ""}Use this draft as a primary factual source, even if it comes from OCR, handwritten notes, or unstructured rough text. Reorganize it into a coherent academic structure. Improve and complete it, but do not invent references, statistics, laws or authors.
If essential information is missing, insert clear placeholders like [TO COMPLETE: ...] and add a short "Additional information needed from the student" note in the relevant place.
${coverage}
"""${text}"""
`
    : `

BROUILLON UPLOADÉ ${sourceName ? `(${sourceName})` : ""} :
${metaLine ? `${metaLine}\n` : ""}Utilise ce brouillon comme source factuelle principale, même s'il provient d'un OCR, d'un manuscrit ou d'un texte en vrac non structuré. Réorganise-le dans une structure académique cohérente. Améliore, restructure et complète, mais n'invente pas de références, chiffres, lois ou auteurs.
Si des informations indispensables manquent, insère des placeholders clairs comme [À COMPLÉTER : ...] et ajoute une courte note "Éléments complémentaires à fournir par l'étudiant" à l'endroit pertinent.
${coverage}
"""${text}"""
`;
}

export function academicSystemPrompt(lang = "fr", ctx = {}) {
  const isEN = String(lang).toLowerCase() === "en";
  const discipline = normalizeDiscipline(ctx) || (isEN ? "the requested discipline" : "la discipline demandée");
  const pages = lengthTarget(ctx);
  const cite = citationStyleLabel(isEN ? "en" : "fr", ctx.citationStyle);

  const common = isEN
    ? `You are a senior academic writing assistant.
Write a rigorous Bachelor-level dissertation in ${discipline}.
Tone: formal, structured, analytical.

NON-NEGOTIABLE OUTPUT RULES:
- Target a dissertation long enough to fill ~${pages} pages (A4, ~11pt). If content is short, EXPAND with substantive analysis (no filler, no repetition).
- NO Markdown headings. Do NOT use #, ##, ###.
- Use bold markers ONLY for headings/subheadings: **CHAPTER I: ...**, **Section 1: ...**, **Paragraph 1: ...**.

CITATIONS:
- Default citation style: ${cite}.
- If a claim needs a source but none is provided, write: (source not provided).
- NEVER invent statutes, cases, authors, books, or exact statistics.
`
    : `Tu es un assistant de rédaction académique senior.
Rédige un mémoire de licence rigoureux en ${discipline}.
Ton : académique, structuré, analytique.

RÈGLES DE SORTIE (OBLIGATOIRES) :
- Viser un mémoire suffisamment long pour remplir ~${pages} pages (A4, ~11pt). Si c’est trop court, DÉVELOPPER avec une analyse substantielle (pas de remplissage, pas de répétition).
- AUCUN titre en Markdown. Ne pas utiliser #, ##, ###.
- Titres / sous-titres uniquement en GRAS via **...** : **CHAPITRE I : ...**, **Section 1 : ...**, **Paragraphe 1 : ...**.

CITATIONS :
- Style par défaut : ${cite}.
- Si une affirmation nécessite une source mais qu’aucune n’est fournie : écrire (source non fournie).
- Interdiction d’inventer : lois/articles numérotés, jurisprudences, auteurs, ouvrages, statistiques précises.
`;

  // Extra guardrails for law (helps prevent law content in non-law topics)
  if (isLawDiscipline(ctx)) {
    return common +
      (isEN
        ? `
LAW-SPECIFIC:
- Use legal reasoning when relevant (norms, doctrine, jurisprudence) BUT do not invent references.
`
        : `
SPÉCIFIQUE DROIT :
- Utilise un raisonnement juridique (normes, doctrine, jurisprudence) seulement si pertinent, sans jamais inventer de références.
`);
  }

  return common +
    (isEN
      ? `
NON-LAW GUARDRAIL:
- Do NOT turn the dissertation into a law thesis.
- Do NOT introduce legal codes, statutes, jurisprudence unless the topic explicitly requires it.
`
      : `
GARDE-FOU (HORS DROIT) :
- Ne transforme PAS le mémoire en mémoire de droit.
- N’introduis pas de codes/lois/jurisprudences sauf si le sujet l’exige explicitement.
`);
}

export function buildMemoirePlanPrompt({ lang = "fr", ctx = {} }) {
  const isEN = String(lang).toLowerCase() === "en";
  const topic = String(ctx.topic || "").trim() || (isEN ? "Unspecified topic" : "Sujet non précisé");
  const discipline = normalizeDiscipline(ctx) || (isEN ? "the requested discipline" : "la discipline demandée");
  const pages = lengthTarget(ctx);

  const baseRules = isEN
    ? `Create a detailed dissertation plan for: "${topic}".
Discipline: ${discipline}.
${draftContextBlock(lang, ctx)}

Format rules:
- No Markdown headings.
- Use bold markers for headings only: **GENERAL INTRODUCTION**, **PART I**, **CHAPTER I**, **Section 1**, etc.

The plan must be suitable for ~${pages} pages.
- Keep it efficient: no redundant/filler sections.
- Prefer fewer but stronger subsections with clear objectives.
- If the draft is unstructured/OCR, infer a logical academic order instead of preserving the disorder.
- If important details are missing, include explicit [TO COMPLETE: ...] placeholders.
Return plain text (no JSON).`
    : `Élabore un plan détaillé de mémoire pour : "${topic}".
Discipline : ${discipline}.
${draftContextBlock(lang, ctx)}

Règles de forme :
- Pas de titres en Markdown.
- Utiliser le GRAS uniquement pour les titres : **INTRODUCTION GÉNÉRALE**, **PARTIE I**, **CHAPITRE I**, **Section 1**, etc.

Le plan doit permettre ~${pages} pages.
- Structure efficace : pas de sections redondantes / blabla.
- Préfère moins de sous-sections, mais solides, avec objectifs clairs.
- Si le brouillon est en vrac/OCR, reconstruis un ordre académique logique au lieu de garder le désordre.
- Si des informations importantes manquent, prévois des placeholders explicites [À COMPLÉTER : ...].
Retourne du texte (pas de JSON).`;

  // Law plan template (classic)
  if (isLawDiscipline(ctx)) {
    return baseRules +
      (isEN
        ? `

Required structure:
- **GENERAL INTRODUCTION** (context, problem statement, objectives, research questions, methodology, scope)
- **PART I** (2 chapters; each chapter with 2–3 sections)
- **PART II** (2 chapters; each chapter with 2–3 sections)
- **GENERAL CONCLUSION**
- **BIBLIOGRAPHY**
- **ANNEXES**`
        : `

Structure obligatoire :
- **INTRODUCTION GÉNÉRALE** (contexte, problématique, objectifs, questions, méthodologie, délimitation)
- **PARTIE I** (2 chapitres ; chaque chapitre avec 2–3 sections)
- **PARTIE II** (2 chapitres ; chaque chapitre avec 2–3 sections)
- **CONCLUSION GÉNÉRALE**
- **BIBLIOGRAPHIE**
- **ANNEXES**`);
  }

  // Non-law plan template (research oriented)
  return baseRules +
    (isEN
      ? `

Required structure:
- **GENERAL INTRODUCTION** (background, problem statement, objectives, research questions/hypotheses, methodology)
- **THEORETICAL / CONCEPTUAL FRAMEWORK**
- **METHODOLOGY** (design, population/sample, data collection, analysis, ethics/limitations)
- **RESULTS / FINDINGS** (organized by themes)
- **DISCUSSION** (interpretation, implications)
- **GENERAL CONCLUSION & RECOMMENDATIONS**
- **REFERENCES**
- **APPENDICES**`
      : `

Structure obligatoire :
- **INTRODUCTION GÉNÉRALE** (contexte, problématique, objectifs, questions/hypothèses, méthodologie)
- **CADRE THÉORIQUE / CONCEPTUEL**
- **MÉTHODOLOGIE** (design, population/échantillon, collecte, analyse, éthique/limites)
- **RÉSULTATS / CONSTATS** (par thèmes)
- **DISCUSSION** (interprétation, implications)
- **CONCLUSION GÉNÉRALE & RECOMMANDATIONS**
- **RÉFÉRENCES**
- **ANNEXES**`);
}

export function buildMemoireSectionPrompt({ lang = "fr", ctx = {}, sectionTitle, sourcesText, endMarker }) {
  const isEN = String(lang).toLowerCase() === "en";
  const topic = String(ctx.topic || "").trim() || (isEN ? "Unspecified topic" : "Sujet non précisé");
  const discipline = normalizeDiscipline(ctx) || (isEN ? "the requested discipline" : "la discipline demandée");
  const ps = String(ctx.problemStatement || "").trim();
  const obj = String(ctx.objectives || "").trim();
  const meth = String(ctx.methodology || "").trim();
  const pages = lengthTarget(ctx);

  const perSectionWords = Number(ctx.__sectionWordsTarget || 0);
  const wordsHint = perSectionWords > 0
    ? (isEN ? `Target length: ~${perSectionWords} words (adjust as needed).` : `Longueur cible : ~${perSectionWords} mots (ajuste si nécessaire).`)
    : (isEN ? `Target length: develop enough to contribute to ~${pages} pages total.` : `Longueur : développer suffisamment pour contribuer à ~${pages} pages au total.`);

  const sourcesBlock = sourcesText
    ? `\n\nSOURCES (use as evidence; do not invent):\n${sourcesText}\n`
    : "";

  const planHint = ctx.plan
    ? `\n\nPlan (reference):\n${ctx.plan}\n`
    : "";
  const draftBlock = draftContextBlock(lang, ctx);

  const marker = String(endMarker || "").trim();

  // Footnotes requirement only when footnotes mode (keeps APA compatibility)
  const citeStyle = String(ctx.citationStyle || "footnotes").toLowerCase();
  const footnotesBlock = citeStyle === "apa"
    ? (isEN
        ? `\nCITATION FORMAT:\n- Use APA author-date style when referencing provided sources (no invented references).\n- If a needed source is missing: write (source not provided).\n`
        : `\nFORMAT DE CITATION :\n- Utilise APA (auteur-date) si tu cites des sources fournies (sans inventer).\n- Si une source manque : écrire (source non fournie).\n`)
    : (isEN
        ? `\nFOOTNOTES (default):\n- In-text markers: (1), (2), (3)...\n- End of section: "NOTES (FOOTNOTES)" listing each note.\n- If source missing: write (source not provided) and add the note "source not provided".\n`
        : `\nNOTES DE BAS DE PAGE (par défaut) :\n- Appels dans le texte : (1), (2), (3)...\n- Fin de section : "NOTES DE BAS DE PAGE" listant chaque note.\n- Si source manquante : écrire (source non fournie) et ajouter la note correspondante.\n`);

  const analysisGuidance = isLawDiscipline(ctx)
    ? (isEN
        ? `Write for a law dissertation: definitions, legal framework (only if sources/known), doctrinal debate (only if provided), practical issues, structured mini-conclusion.`
        : `Écris pour un mémoire en droit : définitions, cadre juridique (sans inventer), débat doctrinal (si fourni), difficultés pratiques, mini-conclusion structurée.`)
    : (isEN
        ? `Write for a ${discipline} dissertation: definitions, conceptual/theoretical framing, methodology alignment, analysis of mechanisms and evidence, implications, structured mini-conclusion.`
        : `Écris pour un mémoire en ${discipline} : définitions, cadre conceptuel/théorique, cohérence méthodologique, analyse des mécanismes et des preuves, implications, mini-conclusion structurée.`);

  return isEN
    ? `Write the section: "${sectionTitle}" for a Bachelor dissertation in ${discipline}.

Context:
- Topic: ${topic}
- Problem statement: ${ps}
- Objectives: ${obj}
- Methodology: ${meth}
${planHint}${draftBlock}${sourcesBlock}

Length:
- ${wordsHint}
- Be concise and dense: avoid filler/blabla.
- Prefer short paragraphs and clear reasoning.
- Stay within the target word range.

Formatting rules:
- No Markdown headings (#, ##, ### prohibited).
- Headings/subheadings must be bold with **...**.

${analysisGuidance}
${footnotesBlock}

Draft handling:
- If the uploaded draft is rough/OCR/unstructured, reorganize the ideas into a coherent academic argument.
- Preserve factual elements from the draft but do not preserve disorder, repetitions or OCR noise.
- If required information is absent, write a clear [TO COMPLETE: ...] placeholder instead of inventing.

Strict ending rule:
- End the section with the exact marker: ${marker}
- Write NOTHING after the marker.

Sources policy:
- Use provided SOURCES if present; otherwise stay generic and mark missing citations as (source not provided).
- Never invent laws/cases/authors/books/statistics.`
    : `Rédige la section : "${sectionTitle}" pour un mémoire de licence en ${discipline}.

Contexte :
- Sujet : ${topic}
- Problématique : ${ps}
- Objectifs : ${obj}
- Méthodologie : ${meth}
${planHint}${draftBlock}${sourcesBlock}

Longueur :
- ${wordsHint}
- Ne sois pas trop bref. Développe avec une analyse substantielle.

Règles de forme :
- Interdiction des titres Markdown (#, ##, ###).
- Titres / sous-titres en GRAS via **...**.

${analysisGuidance}
${footnotesBlock}

Traitement du brouillon :
- Si le brouillon uploadé est en vrac/OCR/non structuré, réorganise les idées dans un raisonnement académique cohérent.
- Conserve les éléments factuels du brouillon mais ne conserve pas le désordre, les répétitions ou les erreurs OCR.
- Si une information nécessaire manque, écris un placeholder clair [À COMPLÉTER : ...] au lieu d'inventer.

Règle de fin stricte :
- Termine la section par le marqueur exact : ${marker}
- N'écris RIEN après le marqueur.

Politique des sources :
- Utilise les SOURCES si elles existent ; sinon reste générique et marque les citations manquantes par (source non fournie).
- Ne jamais inventer lois/jurisprudences/auteurs/ouvrages/statistiques.`;
}

export function buildMemoireRevisionPrompt({ lang = "fr", ctx = {}, title = "", sectionTitle = "Révision", draftChunk = "" }) {
  const isEN = String(lang).toLowerCase() === "en";
  const c = ctx || {};
  const topic = String(c.topic || title || "Mémoire").trim();
  const discipline = normalizeDiscipline(c) || (isEN ? "the requested discipline" : "la discipline demandée");

  if (isEN) {
    return `You are revising a draft dissertation in ${discipline}. Improve language, structure, and depth while preserving meaning.

Context:
- Topic: ${topic}
- Section: ${sectionTitle}

TASK:
- Correct grammar, spelling, style, and clarity.
- Improve structure (better transitions, clear headings in **bold**), and deepen analysis.
- If the draft is rough/OCR/unstructured, reorganize it into a coherent dissertation section; remove OCR noise and repetitions.
- If the student must provide missing facts, add clear [TO COMPLETE: ...] placeholders.
- Do NOT invent references, laws, cases, statistics. If you need a citation, write "(source not provided)".
- Keep content faithful to the draft; you may reorganize for clarity.

FORMAT:
- No Markdown headings (#, ##, ###).
- Headings/subheadings in bold via **...**.

DRAFT TO REVISE:
${draftChunk}
`;
  }

  return `Tu es un relecteur académique et rédacteur. Tu révises un brouillon de mémoire en ${discipline} pour le corriger et l’enrichir, tout en gardant le fond.

Contexte :
- Sujet : ${topic}
- Section : ${sectionTitle}

TÂCHE :
- Corriger orthographe, grammaire, ponctuation, style.
- Améliorer la structure (transitions, cohérence, titres en **gras**), enrichir par des explications et une analyse plus profonde.
- Si le brouillon est en vrac/OCR/non structuré, le réorganiser en section cohérente de mémoire ; supprimer le bruit OCR et les répétitions.
- Si l'étudiant doit fournir une information manquante, ajouter un placeholder clair [À COMPLÉTER : ...].
- Ne pas inventer de références, lois, jurisprudences, chiffres. Si une source est nécessaire : écrire "(source non fournie)".
- Rester fidèle au contenu du brouillon ; tu peux réorganiser pour clarifier.

FORMAT :
- Interdiction des titres Markdown (#, ##, ###).
- Titres/sous-titres en gras via **...**.

BROUILLON À RÉVISER :
${draftChunk}
`;
}

// ✅ Backward-compat alias
export const buildSectionPrompt = buildMemoireSectionPrompt;
