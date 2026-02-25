// core/articleOrchestrator.js
// Generates a scientific article. For Congolese law mode, uses RAG via Qdrant proxy.

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

function tryParseJson(s) {
  const t = safeStr(s).trim();
  const cleaned = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

async function strictJsonFromModel({ messages, temperature, max_tokens, retries = 1 }) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    const out = await deepseekChat({ messages, temperature, max_tokens });
    try {
      return tryParseJson(out);
    } catch (e) {
      last = { out, e };
      messages = [
        messages[0],
        {
          role: "user",
          content:
            "Ta réponse précédente n'était pas un JSON strict. Renvoie UNIQUEMENT un JSON valide conforme au schéma, sans markdown, sans commentaire.",
        },
      ];
      await sleep(200);
    }
  }
  throw new Error(
    `JSON_PARSE_FAILED: ${String(last?.e?.message || last?.e || "unknown")} | sample=${safeStr(last?.out).slice(0, 200)}`
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

export async function generateScientificArticle({ lang = "fr", mode = "scientific", ctx = {}, lite = false }) {
  const L = normalizeLang(lang);
  const isLaw = mode === "law_rag";

  const temperature = Number(process.env.ARTICLE_TEMPERATURE || 0.25);
  const maxTokens = Number(process.env.ARTICLE_MAX_TOKENS || (lite ? 3000 : 5200));
  const retries = Number(process.env.ARTICLE_JSON_RETRIES || 1);

  let ragExcerpts = "";
  let sourcesUsed = [];

  if (isLaw) {
    const q = lawQuery(ctx);
    const strictFilter = { must: [{ key: "type", match: { value: "jurisprudence" } }] };

    const a = await searchCongoLawSources({ query: q, limit: 20, filter: strictFilter, score_threshold: 0.15 }).catch(
      () => ({ sources: [], passages: [] })
    );
    const b = await searchCongoLawSources({ query: q, limit: 20 }).catch(() => ({ sources: [], passages: [] }));

    const mergedPassages = dedupePassages([...(a.passages || []), ...(b.passages || [])]);
    sourcesUsed = [...(a.sources || []), ...(b.sources || [])];
    ragExcerpts = formatPassagesForPrompt(mergedPassages, { max: 20 });
  }

  const system = L === "fr" ? ARTICLE_SYSTEM_PROMPT_FR : ARTICLE_SYSTEM_PROMPT_EN;
  const user = buildArticleUserPrompt({ lang: L, mode, ctx, ragExcerpts });

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const json = await strictJsonFromModel({ messages, temperature, max_tokens: maxTokens, retries });

  const title = safeStr(json?.title || ctx?.title || (isLaw ? "Article sur la jurisprudence congolaise" : "Article scientifique"))
    .trim()
    .slice(0, 160);
  const abstract = safeStr(json?.abstract || "").trim();
  const keywords = Array.isArray(json?.keywords) ? json.keywords.map((k) => safeStr(k).trim()).filter(Boolean).slice(0, 12) : [];
  const sections = Array.isArray(json?.sections)
    ? json.sections
        .map((s) => ({ heading: safeStr(s?.heading).trim(), content: safeStr(s?.content).trim() }))
        .filter((s) => s.heading && s.content)
    : [];

  const juris = Array.isArray(json?.jurisprudences) ? json.jurisprudences : [];
  const jurisprudences = juris
    .map((j, idx) => ({
      id: `JUR-${String(idx + 1).padStart(4, "0")}`,
      juridiction: safeStr(j?.juridiction || j?.court || (L === "fr" ? "INCOMPLET" : "INCOMPLETE")).trim() || (L === "fr" ? "INCOMPLET" : "INCOMPLETE"),
      date: safeStr(j?.date || (L === "fr" ? "INCOMPLET" : "INCOMPLETE")).trim() || (L === "fr" ? "INCOMPLET" : "INCOMPLETE"),
      numero: safeStr(j?.numero || j?.number || (L === "fr" ? "INCOMPLET" : "INCOMPLETE")).trim() || (L === "fr" ? "INCOMPLET" : "INCOMPLETE"),
      matiere: safeStr(j?.matiere || j?.field || "autre").trim() || "autre",
      principe: safeStr(j?.principe || j?.principle || "").trim(),
      resume: safeStr(j?.resume || j?.summary || "").trim(),
    }))
    .filter((j) => j.principe || j.resume)
    .slice(0, 120);

  const references = Array.isArray(json?.references) ? json.references.map((r) => safeStr(r).trim()).filter(Boolean).slice(0, 60) : [];

  const meta = {
    mode,
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

  return { title, abstract, keywords, sections, jurisprudences: isLaw ? jurisprudences : [], references, meta, sourcesUsed };
}
