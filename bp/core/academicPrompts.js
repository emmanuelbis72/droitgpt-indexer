// academicPrompts.js
export function academicSystemPrompt(lang) {
  const isEN = lang === "en";
  return isEN
    ? `You are an academic legal writing assistant. Produce a rigorous undergraduate (Bachelor) law dissertation. Be structured, formal, and cautious. Target a maximum of 70 pages total in the final PDF. When sources are provided, cite them and do NOT invent.`
    : `Tu es un assistant de rédaction académique en droit. Rédige un mémoire de licence rigoureux, structuré et formel. Vise un maximum de 70 pages au total dans le PDF final. Quand des sources sont fournies, cite-les et n’invente pas.`;
}

export function buildMemoirePlanPrompt({ lang, ctx }) {
  const isEN = lang === "en";
  const topic = ctx.topic || "Sujet non précisé";
  return isEN
    ? `Create a detailed dissertation plan (Bachelor level) for the topic: "${topic}". Include: Introduction, 2-3 chapters with 2-3 sections each, conclusion, bibliography and annexes. Provide a clean outline (no JSON).`
    : `Propose un plan détaillé de mémoire (niveau licence) pour le sujet : "${topic}". Inclure : Introduction, 2-3 chapitres avec 2-3 sections chacun, conclusion, bibliographie et annexes. Donne un plan propre (pas de JSON).`;
}

export function buildSectionPrompt({ lang, ctx, sectionTitle, sourcesText }) {
  const isEN = lang === "en";
  const citeStyle = ctx.citationStyle === "apa" ? "APA" : "notes de bas de page";
  const mode =
    ctx.mode === "droit_congolais"
      ? isEN
        ? "Congolese law mode"
        : "Mode droit congolais"
      : isEN
      ? "Standard mode"
      : "Mode standard";

  const sourcesBlock = sourcesText
    ? `\n\nSOURCES (use them as evidence and cite):\n${sourcesText}\n`
    : "";
  const planHint = ctx.plan ? `\n\nUser plan:\n${ctx.plan}\n` : "";

  return isEN
    ? `Write the section: "${sectionTitle}" for a Bachelor law dissertation.\nTopic: ${ctx.topic}\nProblem statement: ${ctx.problemStatement}\nObjectives: ${ctx.objectives}\nMethodology: ${ctx.methodology}\nMode: ${mode}\nCitation style: ${citeStyle}\n${planHint}${sourcesBlock}\nMaximum length constraint:
- Keep this section concise so the whole dissertation stays within 70 pages total.

Rules:
(1) Use headings and subheadings.
(2) If SOURCES are provided, you MUST cite using bracketed numbers exactly like [1], [2], [3]... corresponding to the numbered SOURCES blocks.
    - Never cite a number that does not exist.
    - When a claim is not supported by the provided sources, explicitly write "(source not provided)" instead of inventing.
(3) Provide footnote-style writing or APA depending on style.
(4) Be precise and avoid hallucinations.`
    : `Rédige la section : "${sectionTitle}" pour un mémoire de licence en droit.\nSujet : ${ctx.topic}\nProblématique : ${ctx.problemStatement}\nObjectifs : ${ctx.objectives}\nMéthodologie : ${ctx.methodology}\nMode : ${mode}\nStyle de citation : ${citeStyle}\n${planHint}${sourcesBlock}\nRÈGLE CITATIONS (OBLIGATOIRE) :
- Si des SOURCES sont fournies, tu DOIS citer dans le texte sous la forme [1], [2], [3]… correspondant aux blocs SOURCES numérotés.
- Ne cite jamais un numéro qui n’existe pas.
- Toute affirmation non couverte par les sources doit être marquée “(source non fournie)” au lieu d’inventer.

Règles : (1) titres et sous-titres, (2) références en notes ou APA selon le style, (3) précision, pas d’invention.`;
}
