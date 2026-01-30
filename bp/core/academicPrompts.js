// academicPrompts.js

export function academicSystemPrompt(lang) {
  const isEN = lang === "en";
  return isEN
    ? `You are an academic legal writing assistant. Write a rigorous Bachelor-level law dissertation.

Constraints:
- Target a FULL 70-page PDF (A4, ~11pt). If too short, expand with substantive legal analysis (no filler).
- No Markdown. Use plain text headings (CHAPTER..., SECTION...).
- Use formal academic French/English.
- If sources are provided, cite using [1], [2]... strictly matching the provided SOURCES blocks. Never invent.`
    : `Tu es un assistant de rédaction académique en droit. Rédige un mémoire de licence rigoureux.

Contraintes:
- Viser un PDF COMPLET de 70 pages (A4, ~11pt). Si c'est trop court, développer avec une analyse juridique substantielle (pas de remplissage).
- Pas de Markdown. Utiliser des titres en texte simple (CHAPITRE..., SECTION...).
- Style académique formel.
- Si des sources sont fournies, citer sous la forme [1], [2]... correspondant strictement aux blocs SOURCES. Ne jamais inventer.`;
}

export function buildMemoirePlanPrompt({ lang, ctx }) {
  const isEN = lang === "en";
  const topic = ctx.topic || "Sujet non précisé";

  return isEN
    ? `Create a detailed dissertation plan for: "${topic}".

Required structure (no JSON):
- General Introduction
- PART I (2 chapters; each chapter with 2-3 sections)
- PART II (2 chapters; each chapter with 2-3 sections)
- General Conclusion
- Bibliography
- Annexes

Write clean headings in plain text (no Markdown).`
    : `Propose un plan détaillé de mémoire (niveau licence) pour : "${topic}".

Structure obligatoire (pas de JSON):
- Introduction générale
- PARTIE I (2 chapitres; chaque chapitre avec 2-3 sections)
- PARTIE II (2 chapitres; chaque chapitre avec 2-3 sections)
- Conclusion générale
- Bibliographie
- Annexes

Donne des titres propres en texte simple (pas de Markdown).`;
}

export function buildSectionPrompt({ lang, ctx, sectionTitle, sourcesText }) {
  const isEN = lang === "en";
  const mode = ctx.mode === "droit_congolais" ? (isEN ? "Congolese law mode" : "Mode droit congolais") : (isEN ? "Standard mode" : "Mode standard");

  const sourcesBlock = sourcesText
    ? `\n\nSOURCES (use them as evidence and cite):\n${sourcesText}\n`
    : "";

  const planHint = ctx.plan ? `\n\nUser plan:\n${ctx.plan}\n` : "";

  const methLine = ctx.mode === "droit_congolais" && ctx.methodology ? (isEN ? `Method: ${ctx.methodology}` : `Méthode : ${ctx.methodology}`) : "";

  return isEN
    ? `Write the section: "${sectionTitle}" for a Bachelor law dissertation.
Topic: ${ctx.topic}
Problem statement: ${ctx.problemStatement}
Objectives: ${ctx.objectives}
${methLine}
Mode: ${mode}

Formatting rules:
- No Markdown.
- Use clear headings in plain text: CHAPTER, SECTION, Subsection.
- Write long-form academic paragraphs.

Citations:
- If SOURCES are provided, cite with [1], [2]... matching the SOURCES numbering.
- Never cite a number that does not exist.
- If a claim is not supported, write (source not provided).
${planHint}${sourcesBlock}`
    : `Rédige la section : "${sectionTitle}" pour un mémoire de licence en droit.
Sujet : ${ctx.topic}
Problématique : ${ctx.problemStatement}
Objectifs : ${ctx.objectives}
${methLine}
Mode : ${mode}

Règles de forme:
- Pas de Markdown.
- Titres en texte simple : CHAPITRE, SECTION, Sous-section.
- Paragraphes longs, style académique.

Citations:
- Si des SOURCES sont fournies, citer avec [1], [2]... correspondant aux SOURCES.
- Ne cite jamais un numéro qui n'existe pas.
- Toute affirmation non couverte : (source non fournie).
${planHint}${sourcesBlock}`;
}
