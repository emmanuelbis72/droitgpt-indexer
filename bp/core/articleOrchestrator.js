// core/articleOrchestrator.js
// Generates a scientific article. For Congolese law mode, uses RAG via Qdrant proxy.
// Upgrade: enforce target length (pages/words) by iterative expansion rounds (no hallucinated case law).

import { deepseekChat } from "./deepseekClient.js";
import { searchCongoLawSources, formatPassagesForPrompt } from "./qdrantRag.js";
import {
  ARTICLE_SYSTEM_PROMPT_FR,
  ARTICLE_SYSTEM_PROMPT_EN,
  buildArticleUserPrompt,
} from "./articlePrompts.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeLang(lang) {
  const l = String(lang || "fr").toLowerCase();
  return l.startsWith("en") ? "en" : "fr";
}

function safeStr(v) {
  return String(v || "");
}

function toInt(n, d) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : d;
}

function tryParseJson(s) {
  const t = safeStr(s).trim();
  const cleaned = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

async function strictJsonFromModel({ messages, temperature, max_tokens, retries = 1 }) {
  let last = null;
  let msgs = messages;
  for (let i = 0; i <= retries; i++) {
    const out = await deepseekChat({ messages: msgs, temperature, max_tokens });
    try {
      return tryParseJson(out);
    } catch (e) {
      last = { out, e };
      msgs = [
        msgs[0],
        {
          role: "user",
          content:
            "Ta réponse précédente n'était pas un JSON strict. Renvoie UNIQUEMENT un JSON valide conforme au schéma, sans markdown, sans commentaire.",
        },
      ];
      await sleep(250);
    }
  }
  throw new Error(
    `JSON_PARSE_FAILED: ${String(last?.e?.message || last?.e || "unknown")} | sample=${safeStr(last?.out).slice(0, 220)}`
  );
}

function dedupePassages(passages) {
  const out = [];
  const seen = new Set();
  for (const p of passages || []) {
    const ref = safeStr(p?.ref || p?.id || p?.point_id || "").trim();
    const text = safeStr(p?.text || p?.chunk || p?.content || "").trim();
    const key = (ref || "") + "|" + text.slice(0, 180);
    if (!text) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function lawQuery(ctx) {
  const topic = safeStr(ctx?.topic || ctx?.theme || ctx?.title || "jurisprudence");
  const rq = safeStr(ctx?.researchQuestion || ctx?.question || "");
  return `${topic}. ${rq} jurisprudence arrêt jugement Cour Tribunal RDC "Cour d'appel" "Cour de cassation" "Cour constitutionnelle" RPA RP RC`;
}

function countWords(text) {
  const t = safeStr(text).replace(/\s+/g, " ").trim();
  if (!t) return 0;
  return t.split(" ").length;
}

function totalWordsFromJson(j) {
  const abstract = safeStr(j?.abstract || "");
  const sections = Array.isArray(j?.sections) ? j.sections : [];
  const sectionText = sections.map((s) => safeStr(s?.heading) + " " + safeStr(s?.content)).join("\n");
  return countWords(abstract + "\n" + sectionText);
}

function normalizeJsonToArticle({ json, ctx, L, isLaw }) {
  const title = safeStr(json?.title || ctx?.title || (isLaw ? "Article sur la jurisprudence congolaise" : "Article scientifique"))
    .trim()
    .slice(0, 160);

  const abstract = safeStr(json?.abstract || "").trim();

  const keywords = Array.isArray(json?.keywords)
    ? json.keywords.map((k) => safeStr(k).trim()).filter(Boolean).slice(0, 12)
    : [];

  const sections = Array.isArray(json?.sections)
    ? json.sections
        .map((s) => ({ heading: safeStr(s?.heading).trim(), content: safeStr(s?.content).trim() }))
        .filter((s) => s.heading && s.content)
    : [];

  const juris = Array.isArray(json?.jurisprudences) ? json.jurisprudences : [];
  const jurisprudences = juris
    .map((j, idx) => ({
      id: `JUR-${String(idx + 1).padStart(4, "0")}`,
      juridiction:
        safeStr(j?.juridiction || j?.court || (L === "fr" ? "INCOMPLET" : "INCOMPLETE")).trim() ||
        (L === "fr" ? "INCOMPLET" : "INCOMPLETE"),
      date:
        safeStr(j?.date || (L === "fr" ? "INCOMPLET" : "INCOMPLETE")).trim() ||
        (L === "fr" ? "INCOMPLET" : "INCOMPLETE"),
      numero:
        safeStr(j?.numero || j?.number || (L === "fr" ? "INCOMPLET" : "INCOMPLETE")).trim() ||
        (L === "fr" ? "INCOMPLET" : "INCOMPLETE"),
      matiere: safeStr(j?.matiere || j?.field || "autre").trim() || "autre",
      principe: safeStr(j?.principe || j?.principle || "").trim(),
      resume: safeStr(j?.resume || j?.summary || "").trim(),
    }))
    .filter((j) => j.principe || j.resume)
    .slice(0, 200);

  const references = Array.isArray(json?.references)
    ? json.references.map((r) => safeStr(r).trim()).filter(Boolean).slice(0, 80)
    : [];

  const meta = {
    mode: isLaw ? "law_rag" : "scientific",
    lang: L,
    generatedAt: new Date().toISOString(),
    disclaimer:
      ctx?.disclaimer ||
      (L === "fr"
        ? (isLaw
            ? "Article généré automatiquement à partir d'extraits RAG. Les métadonnées manquantes sont indiquées 'INCOMPLET'."
            : "Article généré automatiquement. Les références doivent être vérifiées avant publication.")
        : (isLaw
            ? "Automatically generated from RAG excerpts. Missing metadata is marked 'INCOMPLETE'."
            : "Automatically generated. References should be verified before publication.")),
  };

  return { title, abstract, keywords, sections, jurisprudences: isLaw ? jurisprudences : [], references, meta };
}

async function expandToTarget({
  L,
  isLaw,
  ctx,
  ragExcerpts,
  baseJson,
  temperature,
  maxTokensPerRound,
  retries,
  maxRounds,
}) {
  const pages = toInt(ctx?.targetPages || ctx?.pages, isLaw ? 18 : 12);
  const minWords = toInt(ctx?.minWords, pages * 420);

  let current = baseJson;
  let words = totalWordsFromJson(current);

  for (let round = 1; round <= maxRounds; round++) {
    if (words >= minWords) break;

    const system = L === "fr" ? ARTICLE_SYSTEM_PROMPT_FR : ARTICLE_SYSTEM_PROMPT_EN;

    const user =
      (L === "fr"
        ? `Tu dois ÉTENDRE l'article ci-dessous pour atteindre AU MOINS ${minWords} mots (~${pages} pages).
Contraintes:
- Ne change pas le schéma JSON.
- Garde le même titre et l'abstract (tu peux améliorer légèrement l'abstract si nécessaire).
- Allonge surtout la section 4 (Analyse/Discussion) en ajoutant des sous-sections (4.1, 4.2, 4.3...) et des exemples pratiques.
- Ajoute des développements doctrinaux, définitions, raisonnements, limites, et implications.
- N'ajoute aucune jurisprudence inventée. Si RAG fourni, utilise uniquement les extraits.
- Pas de listes "****" ; écris des paragraphes.
Retourne UNIQUEMENT le JSON complet (pas un diff).
JSON actuel:
`
        : `You must EXPAND the article below to reach AT LEAST ${minWords} words (~${pages} pages).
Constraints:
- Do not change the JSON schema.
- Keep the same title and abstract (minor improvements allowed).
- Expand mainly section 4 (Analysis/Discussion) by adding subsections (4.1, 4.2, 4.3...) and practical examples.
- Add doctrinal depth, definitions, reasoning, limits, implications.
- Do NOT invent case law. If RAG provided, use only the excerpts.
- No "****" lists; write paragraphs.
Return ONLY the full JSON (no diff).
Current JSON:
`);

    const maybeRag =
      isLaw && ragExcerpts
        ? (L === "fr"
            ? `
EXTRAITS RAG (pour jurisprudence uniquement):
${ragExcerpts}
`
            : `
RAG EXCERPTS (for case law only):
${ragExcerpts}
`)
        : "";

    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: user + safeStr(JSON.stringify(current)) + maybeRag,
      },
    ];

    current = await strictJsonFromModel({
      messages,
      temperature,
      max_tokens: maxTokensPerRound,
      retries,
    });

    words = totalWordsFromJson(current);
    await sleep(250);
  }

  return current;
}

export async function generateScientificArticle({ lang = "fr", mode = "scientific", ctx = {}, lite = false }) {
  const L = normalizeLang(lang);
  const isLaw = mode === "law_rag";

  const temperature = Number(process.env.ARTICLE_TEMPERATURE || 0.25);

  // Token budget per round (increase for long targets)
  const pages = toInt(ctx?.targetPages || ctx?.pages, isLaw ? 18 : 12);
  const baseMax = lite ? 3000 : 5200;
  const maxTokensPerRound = Number(process.env.ARTICLE_MAX_TOKENS || Math.min(9000, baseMax + Math.max(0, pages - 12) * 250));

  const retries = Number(process.env.ARTICLE_JSON_RETRIES || 1);

  // How many expansion rounds allowed (default 4 for ~20 pages)
  const maxRounds = Number(process.env.ARTICLE_CONTINUE_ROUNDS || (pages >= 20 ? 4 : 2));

  let ragExcerpts = "";
  let sourcesUsed = [];

  if (isLaw) {
    const q = lawQuery(ctx);

    // Try strict filter first, then fallback broader query (proxy may ignore filter)
    const strictFilter = { must: [{ key: "type", match: { value: "jurisprudence" } }] };

    const a = await searchCongoLawSources({ query: q, limit: 24, filter: strictFilter, score_threshold: 0.15 }).catch(
      () => ({ sources: [], passages: [] })
    );
    const b = await searchCongoLawSources({ query: q, limit: 24 }).catch(() => ({ sources: [], passages: [] }));

    const mergedPassages = dedupePassages([...(a.passages || []), ...(b.passages || [])]);
    sourcesUsed = [...(a.sources || []), ...(b.sources || [])];
    ragExcerpts = formatPassagesForPrompt(mergedPassages, { max: 24 });
  }

  const system = L === "fr" ? ARTICLE_SYSTEM_PROMPT_FR : ARTICLE_SYSTEM_PROMPT_EN;
  const user = buildArticleUserPrompt({ lang: L, mode, ctx, ragExcerpts });

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  // First draft
  const draftJson = await strictJsonFromModel({
    messages,
    temperature,
    max_tokens: maxTokensPerRound,
    retries,
  });

  // Expand to target length if needed
  const expandedJson = await expandToTarget({
    L,
    isLaw,
    ctx,
    ragExcerpts,
    baseJson: draftJson,
    temperature,
    maxTokensPerRound,
    retries,
    maxRounds,
  });

  const article = normalizeJsonToArticle({ json: expandedJson, ctx, L, isLaw });
  return { ...article, sourcesUsed };
}
