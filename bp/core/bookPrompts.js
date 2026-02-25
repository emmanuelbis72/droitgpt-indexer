// core/bookPrompts.js
// DroitGPT Editions — Book prompts (Jurisprudence RDC)

export const BOOK_SYSTEM_PROMPT_FR = `
Tu es un rédacteur juridique senior (niveau magistrat / avocat / universitaire) spécialisé en droit congolais.
OBJECTIF: rédiger un ouvrage professionnel doctrinal basé UNIQUEMENT sur les extraits fournis (RAG).
REGLES ABSOLUES:
- Interdiction d'inventer des jurisprudences, dates, numéros, juridictions.
- Toute jurisprudence citée doit provenir des EXTRATS FOURNIS.
- Si une métadonnée manque dans les extraits, écris "INCOMPLET" (ne devine pas).
- Style: professionnel, précis, doctrinal; pas de marketing.
- Ne reproduis pas intégralement de longs passages; synthétise et analyse.
- Chaque principe dégagé doit être justifié par au moins une jurisprudence citée.
FORMAT:
- Tu dois répondre en JSON STRICT valide, sans markdown, sans texte autour.
`;

export const BOOK_SYSTEM_PROMPT_EN = `
You are a senior legal writer (judge/lawyer/academic level) specialized in Congolese law.
GOAL: produce a professional doctrinal book based ONLY on provided RAG excerpts.
ABSOLUTE RULES:
- Do not invent case law, dates, numbers, courts.
- Any case cited must come from PROVIDED EXCERPTS.
- If metadata is missing, write "INCOMPLETE" (do not guess).
- Professional, precise, doctrinal tone.
- Do not reproduce long verbatim excerpts; synthesize and analyze.
- Each legal principle must be supported by at least one cited case.
OUTPUT:
- Respond with STRICT valid JSON only.
`;

export function chapterPrompt({ lang = 'fr', chapterTitle, chapterScope, maxPagesHint = 10 }) {
  const isFr = String(lang || 'fr').toLowerCase().startsWith('fr');
  const rules = isFr
    ? `Rédige un chapitre structuré (titres, sous-titres, paragraphes). Vise ~${maxPagesHint} pages A4 équivalent.`
    : `Write a structured chapter (headings, subheadings, paragraphs). Target ~${maxPagesHint} A4 pages equivalent.`;

  const jsonShape = isFr
    ? `{
  "title": "...",
  "text": "...",
  "jurisprudences": [
    {
      "id": "JUR-0001",
      "juridiction": "...",
      "date": "YYYY-MM-DD ou INCOMPLET",
      "numero": "... ou INCOMPLET",
      "matiere": "civil|penal|commercial|administratif|constitutionnel|travail|foncier|autre",
      "probleme": "...",
      "solution": "...",
      "principe": "...",
      "source_ref": "(1) ou (2) etc"
    }
  ],
  "principes": ["..."],
  "mots_cles": ["..."]
}`
    : `{
  "title": "...",
  "text": "...",
  "jurisprudences": [
    {
      "id": "JUR-0001",
      "court": "...",
      "date": "YYYY-MM-DD or INCOMPLETE",
      "number": "... or INCOMPLETE",
      "field": "...",
      "issue": "...",
      "holding": "...",
      "principle": "...",
      "source_ref": "(1) or (2) etc"
    }
  ],
  "principles": ["..."],
  "keywords": ["..."]
}`;

  const citeRule = isFr
    ? `Dans le texte, cite tes jurisprudences sous la forme: [JUR-0001], [JUR-0002]...`
    : `In the chapter text, cite cases as: [JUR-0001], [JUR-0002]...`;

  const scopeLine = chapterScope ? (isFr ? `PÉRIMÈTRE: ${chapterScope}` : `SCOPE: ${chapterScope}`) : '';

  return `${rules}\n${citeRule}\n${scopeLine}\n\nTa sortie doit être un JSON strict conforme au schéma suivant:\n${jsonShape}`;
}

export function annexPrompt({ lang = 'fr' }) {
  const isFr = String(lang || 'fr').toLowerCase().startsWith('fr');
  return isFr
    ? `Construis une ANNEXE "Répertoire des jurisprudences analysées" à partir d'une liste d'objets jurisprudence. Harmonise les champs, déduplique et trie par matière puis juridiction puis date. Sortie JSON strict: {"rows":[{...}]}.`
    : `Build an ANNEX "Repository of analyzed case law" from a list of case objects. Normalize fields, deduplicate, sort by field then court then date. Output strict JSON: {"rows":[{...}]}.`;
}

export function indexPrompt({ lang = 'fr' }) {
  const isFr = String(lang || 'fr').toLowerCase().startsWith('fr');
  return isFr
    ? `Construis un index alphabétique des principes juridiques à partir d'une liste de principes et des pages. Sortie JSON strict: {"index":[{"term":"...","pages":[1,2]}]}.`
    : `Build an alphabetical index of legal principles from a list of principles and pages. Output strict JSON: {"index":[{"term":"...","pages":[1,2]}]}.`;
}
