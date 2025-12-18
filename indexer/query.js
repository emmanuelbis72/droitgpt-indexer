// ✅ query.js — API DroitGPT (STABLE, RAPIDE, SANS STREAMING SSE)

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

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
   CORS (simple & fiable)
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
   MongoDB (auth users)
======================= */
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté"))
    .catch((e) => console.error("❌ MongoDB:", e.message));
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
});

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
You are DroitGPT, a Congolese legal assistant.
Answer in simple HTML (<p>, <h3>, <ul>, <li>, <strong>, <br/>).
Provide: Summary, Legal basis, Explanation, Practical application, Remedies, Caution points.
`;
  }

  return `
Tu es DroitGPT, assistant juridique congolais.
Réponds en HTML simple (<p>, <h3>, <ul>, <li>, <strong>, <br/>).

Structure obligatoire :
<p><strong>Résumé</strong></p>
<h3>Base légale</h3>
<h3>Explications juridiques</h3>
<h3>Application au cas concret</h3>
<h3>Recours et démarches possibles</h3>
<h3>Points de vigilance</h3>
`;
}

/* =======================
   Routes
======================= */
app.use("/auth", authRoutes);

app.get("/", (_req, res) => {
  res.send("✅ API DroitGPT opérationnelle");
});

/* =======================
   /ASK — ENDPOINT UNIQUE
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  try {
    const { messages, lang = "fr" } = req.body || {};

    if (!Array.isArray(messages) || !messages.every(isValidMessage)) {
      return res.status(400).json({ error: "Messages invalides" });
    }

    const lastUserMessage = messages[messages.length - 1].text;

    /* 1️⃣ Embedding */
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: lastUserMessage,
    });

    /* 2️⃣ Qdrant */
    const search = await qdrant.search(
      process.env.QDRANT_COLLECTION || "documents",
      {
        vector: embedding.data[0].embedding,
        limit: 3,
        with_payload: true,
      }
    );

    const context = (search || [])
      .map((d) => d.payload?.content)
      .filter(Boolean)
      .join("\n");

    /* 3️⃣ Prompt */
    const chatHistory = [
      { role: "system", content: buildSystemPrompt(lang) },
      ...(context
        ? [{ role: "user", content: `Contexte juridique :\n${context}` }]
        : []),
      ...messages.slice(-4).map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      })),
    ];

    /* 4️⃣ OpenAI */
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 700,
    });

    const answer =
      completion.choices[0]?.message?.content || "<p>❌ Réponse vide.</p>";

    res.json({ answer });
  } catch (e) {
    console.error("❌ /ask error:", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* =======================
   START
======================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("🚀 DroitGPT API en ligne sur port", port);
});
