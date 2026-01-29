// qdrantRag.js
// Minimal RAG adapter. Works with either:
// 1) QDRANT_PROXY_URL (recommended): your existing indexer endpoint that already embeds queries
// 2) Direct Qdrant vector search (requires embeddings; left optional)
// If nothing configured, returns empty sources (non-breaking).

export async function searchCongoLawSources({ query, limit = 6 }) {
  const proxy = process.env.QDRANT_PROXY_URL; // e.g. https://droitgpt-indexer.onrender.com/congo-law/search
  if (proxy) {
    const r = await fetch(proxy, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    if (!r.ok) return { sources: [], passages: [] };
    const data = await r.json().catch(() => null);
    return {
      sources: Array.isArray(data?.sources) ? data.sources : [],
      passages: Array.isArray(data?.passages) ? data.passages : [],
    };
  }

  // Direct Qdrant mode (requires embeddings). Keep disabled by default.
  return { sources: [], passages: [] };
}

export function formatPassagesForPrompt(passages) {
  if (!Array.isArray(passages) || !passages.length) return "";
  return passages
    .slice(0, 10)
    .map((p, i) => {
      const title = p?.title || p?.source || "Source";
      const chunk = String(p?.text || p?.chunk || "").trim();
      const ref = p?.ref || p?.id || "";
      return `(${i + 1}) ${title}${ref ? ` [${ref}]` : ""}\n${chunk}`;
    })
    .join("\n\n");
}
