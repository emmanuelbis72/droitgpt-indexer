/**
 * ============================================
 * DroitGPT – Backend principal (query.js)
 * Mode : REST JSON (sans streaming SSE)
 * Optimisé pour réduire la latence réelle
 * ============================================
 */

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";

// 🔐 Auth
import authRoutes from "./auth/auth.routes.js";
import * as requireAuthModule from "./auth/requireAuth.js";
const requireAuth = requireAuthModule.default || requireAuthModule.requireAuth;

/* =======================
   ENV
======================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, ".env") });

const app = express();

/* =======================
   Keep-alive agents (latence réseau ↓)
======================= */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

/* =======================
   CORS
======================= */
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

/* =======================
   MongoDB
======================= */
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté"))
    .catch((err) => console.error("❌ Erreur MongoDB :", err.message));
}

/* =======================
   Clients
======================= */
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // OpenAI SDK utilise fetch, mais garder agents aide si ton runtime les exploite;
  // sinon c’est inoffensif. (La vraie optimisation ici est surtout le cache/limites.)
});

/* =======================
   Mini cache embeddings (mémoire)
   - réduit le temps sur questions répétées
======================= */
const EMB_CACHE_TTL_MS = 1000 * 60 * 60; // 1h
const embCache = new Map(); // key -> { vec, exp }

function getEmbCache(key) {
  const it = embCache.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) {
    embCache.delete(key);
    return null;
  }
  return it.vec;
}

function setEmbCache(key, vec) {
  // petit contrôle de taille
  if (embCache.size > 1500) {
    // purge simple: on supprime ~10%
    let n = 0;
    for (const k of embCache.keys()) {
      embCache.delete(k);
      n += 1;
      if (n > 150) break;
    }
  }
  embCache.set(key, { vec, exp: Date.now() + EMB_CACHE_TTL_MS });
}

/* =======================
   Utils
======================= */
function isValidMessage(m) {
  return (
    m &&
    typeof m === "object" &&
    typeof m.from === "string" &&
    typeof m.text === "string" &&
    m.text.trim().length > 0
  );
}

function buildSystemPrompt(lang = "fr") {
  if (lang === "en") {
    return `
You are DroitGPT, a professional Congolese legal assistant.
Answer in simple HTML only (<p>, <h3>, <ul>, <li>, <strong>, <br/>).

Structure:
- Summary
- Legal basis
- Legal explanation
- Practical application
- Remedies and steps
- Caution points
`;
  }

  return `
Tu es DroitGPT, un assistant juridique congolais professionnel,
spécialisé en droit de la République Démocratique du Congo (RDC)
et, lorsque pertinent, en droit OHADA.

Réponds UNIQUEMENT en HTML simple :
<p>, <h3>, <ul>, <li>, <strong>, <br/>

Structure obligatoire :
<p><strong>Résumé</strong></p>
<h3>Base légale</h3>
<h3>Explications juridiques</h3>
<h3>Application au cas concret</h3>
<h3>Recours et démarches possibles</h3>
<h3>Points de vigilance</h3>
`;
}

function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeoutPromise = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(t));
}

/* =======================
   ROUTES
======================= */
app.use("/auth", authRoutes);

app.get("/", (_req, res) => {
  res.send("✅ API DroitGPT opérationnelle");
});

/* =======================
   /ASK — ENDPOINT UNIQUE
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  const t0 = Date.now();
  let embMs = 0;
  let qdrantMs = 0;
  let openaiMs = 0;

  try {
    const { messages, lang = "fr" } = req.body || {};

    // Validation
    if (!Array.isArray(messages) || !messages.every(isValidMessage)) {
      return res.status(400).json({ error: "Format des messages invalide." });
    }

    const lastUserMessage = messages[messages.length - 1].text.trim();

    /* 1) Embedding (avec cache) */
    const tEmb0 = Date.now();
    const cacheKey = `v1:${lastUserMessage.toLowerCase()}`;
    let embeddingVector = getEmbCache(cacheKey);

    if (!embeddingVector) {
      const embeddingResponse = await openai.embeddings.create({
        model: process.env.EMBED_MODEL || "text-embedding-3-small",
        input: lastUserMessage,
      });
      embeddingVector = embeddingResponse.data?.[0]?.embedding;

      if (!embeddingVector) {
        return res.status(500).json({ error: "Erreur embedding OpenAI." });
      }
      setEmbCache(cacheKey, embeddingVector);
    }
    embMs = Date.now() - tEmb0;

    /* 2) Qdrant (avec timeout soft) */
    const tQ0 = Date.now();
    let searchResult = [];
    try {
      searchResult = await withTimeout(
        qdrant.search(process.env.QDRANT_COLLECTION || "documents", {
          vector: embeddingVector,
          limit: Number(process.env.QDRANT_LIMIT || 3),
          with_payload: true,
        }),
        Number(process.env.QDRANT_TIMEOUT_MS || 2500),
        "QDRANT_TIMEOUT"
      );
    } catch (e) {
      console.warn("⚠️ Qdrant search skipped:", e.message);
      searchResult = [];
    }
    qdrantMs = Date.now() - tQ0;

    // Contexte: limiter taille pour accélérer OpenAI
    let context = (searchResult || [])
      .map((item) => item.payload?.content)
      .filter(Boolean)
      .join("\n");

    const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 6000);
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS);
    }

    /* 3) Prompt */
    const historyWindow = Number(process.env.HISTORY_WINDOW || 4); // 3 ou 4 conseillé
    const chatHistory = [
      { role: "system", content: buildSystemPrompt(lang) },
      ...(context
        ? [{ role: "user", content: `Contexte juridique pertinent :\n${context}` }]
        : []),
      ...messages.slice(-historyWindow).map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      })),
    ];

    /* 4) OpenAI chat */
    const tA0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      messages: chatHistory,
      temperature: Number(process.env.TEMPERATURE || 0.3),
      max_tokens: Number(process.env.MAX_TOKENS || 550),
    });
    openaiMs = Date.now() - tA0;

    const answer =
      completion.choices?.[0]?.message?.content || "<p>❌ Réponse vide.</p>";

    const totalMs = Date.now() - t0;
    res.setHeader("X-Ask-Time-Ms", String(totalMs));
    res.setHeader("X-Ask-Breakdown", JSON.stringify({ embMs, qdrantMs, openaiMs, totalMs }));
    console.log("⏱️ /ask timings:", { embMs, qdrantMs, openaiMs, totalMs });

    return res.json({ answer });
  } catch (error) {
    const totalMs = Date.now() - t0;
    console.error("❌ Erreur /ask :", error);
    console.log("⏱️ /ask timings (failed):", { embMs, qdrantMs, openaiMs, totalMs });
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
});

/* =======================
   START SERVER
======================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 DroitGPT API démarrée sur le port ${port}`);
});
