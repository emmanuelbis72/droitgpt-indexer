// qdrantRag.js
// RAG adapter via QDRANT_PROXY_URL (recommended).
// Backward-compatible: if your proxy ignores "filter" it still works.
// Adds: filter, score_threshold, tags, and richer passage formatting.

export async function searchCongoLawSources({
  query,
  limit = 10,
  filter = null,
  score_threshold = null,
  tags = null,
}) {
  const proxy = process.env.QDRANT_PROXY_URL; // e.g. https://droitgpt-indexer.onrender.com/congo-law/search
  if (!proxy) return { sources: [], passages: [] };

  const body = { query, limit };
  if (filter) body.filter = filter;
  if (typeof score_threshold === "number") body.score_threshold = score_threshold;
  if (tags) body.tags = tags;

  const r = await fetch(proxy, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) return { sources: [], passages: [] };

  const data = await r.json().catch(() => null);

  // Normalize response shapes (robust)
  const passages =
    (Array.isArray(data?.passages) && data.passages) ||
    (Array.isArray(data?.results) && data.results) ||
    (Array.isArray(data?.matches) && data.matches) ||
    [];

  const sources = Array.isArray(data?.sources) ? data.sources : [];

  return { sources, passages };
}

export function formatPassagesForPrompt(passages, { max = 18 } = {}) {
  if (!Array.isArray(passages) || !passages.length) return "";

  return passages
    .slice(0, max)
    .map((p, i) => {
      const title = p?.title || p?.source || p?.file || "Source";
      const chunk = String(p?.text || p?.chunk || p?.content || "").trim();
      const ref = p?.ref || p?.id || p?.point_id || "";
      const meta = p?.meta || p?.payload || p?.metadata || {};
      const metaLine = meta && Object.keys(meta).length ? `META: ${safeJson(meta)}` : "";
      return `(${i + 1}) ${title}${ref ? ` [${ref}]` : ""}\n${metaLine ? metaLine + "\n" : ""}${chunk}`;
    })
    .join("\n\n");
}

function safeJson(x) {
  try {
    return JSON.stringify(x).slice(0, 500);
  } catch {
    return "";
  }
}