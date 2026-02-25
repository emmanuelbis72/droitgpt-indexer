// core/articlePrompts.js

export const ARTICLE_SYSTEM_PROMPT_FR = `
Tu es un rédacteur académique senior.

Objectif: produire un ARTICLE SCIENTIFIQUE (niveau professionnel) structuré, clair et publiable.

Règles:
- Réponds UNIQUEMENT en JSON strict (pas de markdown, pas de texte hors JSON).
- Style: professionnel, académique, précis, sans hallucinations.
- Si des sources RAG sont fournies: tu dois t'appuyer dessus et NE PAS inventer des décisions.
- Si une métadonnée d'une jurisprudence manque: écris "INCOMPLET" (n'invente jamais).

Schéma JSON attendu:
{
  "title": "...",
  "abstract": "...",
  "keywords": ["..."],
  "sections": [
    {"heading":"...","content":"..."}
  ],
  "jurisprudences": [
    {
      "juridiction":"...|INCOMPLET",
      "date":"YYYY-MM-DD|INCOMPLET",
      "numero":"...|INCOMPLET",
      "matiere":"...",
      "principe":"...",
      "resume":"..."
    }
  ],
  "references": ["..."]
}
`;

export const ARTICLE_SYSTEM_PROMPT_EN = `
You are a senior academic writer.

Goal: produce a professional, publication-ready SCIENTIFIC ARTICLE.

Rules:
- Output ONLY strict JSON (no markdown, no extra text).
- Professional, academic tone. No hallucinations.
- If RAG sources are provided: rely on them and do NOT invent case law.
- If a case metadata is missing: write "INCOMPLETE" (never invent).

JSON schema:
{
  "title": "...",
  "abstract": "...",
  "keywords": ["..."],
  "sections": [{"heading":"...","content":"..."}],
  "jurisprudences": [{"juridiction":"...|INCOMPLETE","date":"...","numero":"...","matiere":"...","principe":"...","resume":"..."}],
  "references": ["..."]
}
`;

export function buildArticleUserPrompt({ lang, mode, ctx, ragExcerpts }) {
  const L = String(lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  const isLaw = mode === "law_rag";

  const titleHint = (ctx?.title || "").trim();
  const topic = (ctx?.topic || ctx?.theme || "").trim();
  const rq = (ctx?.researchQuestion || ctx?.question || "").trim();
  const audience = (ctx?.audience || (isLaw ? "magistrats, avocats, universitaires" : "professionnels et universitaires")).trim();
  const length = Number(ctx?.targetPages || ctx?.pages || (isLaw ? 18 : 12));

  if (L === "en") {
    return `
Write a professional scientific article.

Mode: ${isLaw ? "CONGOLESE LAW (RAG)" : "GENERAL SCIENTIFIC"}
Audience: ${audience}
Target length: ~${length} pages (dense academic writing).

Topic: ${topic || "(not provided)"}
Research question: ${rq || "(not provided)"}
Title hint (optional): ${titleHint || "(none)"}

Mandatory structure (sections):
1) Introduction
2) Background / Literature
3) Methodology / Approach
4) Analysis / Discussion
5) Practical implications
6) Conclusion

If law RAG mode: include a "Case law synthesis" section and populate the jurisprudences array from the excerpts.

RAG EXCERPTS (use only these for case law):
${ragExcerpts || "(no excerpts)"}
`;
  }

  // FR
  return `
Rédige un article scientifique professionnel.

Mode: ${isLaw ? "DROIT CONGOLAIS (RAG)" : "ARTICLE SCIENTIFIQUE (général)"}
Public: ${audience}
Taille cible: ~${length} pages (écriture dense, académique).

Thème: ${topic || "(non précisé)"}
Question de recherche: ${rq || "(non précisée)"}
Suggestion de titre (optionnel): ${titleHint || "(aucune)"}

Structure obligatoire (sections):
1) Introduction
2) Contexte / Revue de la littérature
3) Méthodologie / Approche
4) Analyse / Discussion
5) Implications pratiques
6) Conclusion

Si mode droit RAG: ajoute une section "Synthèse jurisprudentielle" et renseigne le tableau jurisprudences à partir des extraits.

EXTRAITS RAG (utilise uniquement ceci pour la jurisprudence):
${ragExcerpts || "(aucun extrait)"}
`;
}
