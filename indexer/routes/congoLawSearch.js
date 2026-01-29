import express from "express";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const COLLECTION = process.env.QDRANT_COLLECTION || "documents";

// Heuristique “Droit congolais” sans réindexation
const CONGO_KEYWORDS = [
  "rdc",
  "république démocratique du congo",
  "republique democratique du congo",
  "congo-kinshasa",
  "kinshasa",
  "code",
  "loi n°",
  "loi no",
  "décret",
  "decret",
  "arrêté",
  "arrete",
  "cour constitutionnelle",
  "cour de cassation",
  "conseil d'etat",
  "conseil d’état",
  "journal officiel",
];

function scoreCongoHeuristic(text) {
  const t = String(text || "").toLowerCase();
  let s = 0;
  for (const k of CONGO_KEYWORDS) {
    if (t.includes(k)) s += 1;
  }
  return s;
}

router.post("/congo-law/search", async (req, res) => {
  try {
    const { query, limit = 7 } = req.body || {};
    const q = String(query || "").trim();
    if (q.length < 3) return res.status(400).json({ error: "query requis" });

    const vector = await embeddings.embedQuery(q);

    // 1) Search large, then filter/rerank
    const hits = await qdrant.search(COLLECTION, {
      vector,
      limit: 30,
      with_payload: true,
      with_vector: false,
    });

    const passages = (hits || [])
      .map((h) => {
        const p = h?.payload || {};
        const text =
          String(p.pageContent || p.text || p.content || p.chunk || "").trim() ||
          "";

        const source = String(p.source || p.filename || p.path || "").trim();
        const title = String(p.title || p.source || "Source").trim();

        const congoScore = scoreCongoHeuristic(`${title}\n${source}\n${text}`);

        return {
          title,
          source,
          text,
          score: h?.score ?? 0,
          congoScore,
          type: p.type || p.doc_type || null,
          year: p.year || p.date || null,
          author: p.author || null,
        };
      })
      .filter((x) => x.text);

    // 2) Rerank: prefer high Qdrant score + Congo heuristic
    const ranked = passages
      .sort((a, b) => (b.congoScore * 0.15 + b.score) - (a.congoScore * 0.15 + a.score))
      .slice(0, Math.min(Math.max(Number(limit) || 7, 1), 15));

    // 3) Sources list (dedupe)
    const seen = new Set();
    const sources = [];
    for (const p of ranked) {
      const key = `${p.title}::${p.year || ""}::${p.author || ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        title: p.title,
        type: p.type,
        year: p.year,
        author: p.author,
        source: p.source,
      });
    }

    return res.json({ sources, passages: ranked });
  } catch (e) {
    console.error("❌ congo-law/search error:", e);
    return res.status(500).json({ error: "server_error", details: String(e?.message || e) });
  }
});

export default router;
