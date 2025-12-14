// ✅ query.js – API principale DroitGPT + AUTH + /ask protégé + filtre Qdrant SAFE
import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

// 🔐 Auth
import authRoutes from "./auth/auth.routes.js";

// ✅ Import robuste: accepte export default OU export nommé "requireAuth"
import * as requireAuthModule from "./auth/requireAuth.js";
const requireAuth = requireAuthModule.default || requireAuthModule.requireAuth;

// Charger les variables d'environnement
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, ".env") });

const app = express();

/* =======================
   CORS
======================= */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "2mb" }));

/* =======================
   MongoDB (AUTH)
======================= */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI manquant dans indexer/.env");
} else {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté (utilisateurs)."))
    .catch((err) => console.error("❌ Erreur MongoDB:", err.message));
}

/* =======================
   Qdrant
======================= */
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

/* =======================
   OpenAI
======================= */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =======================
   AUTH ROUTES
======================= */
app.use("/auth", authRoutes);

/* =======================
   HEALTH
======================= */
app.get("/", (_req, res) => {
  res.send("✅ API DroitGPT opérationnelle (AUTH + Qdrant filter).");
});

/* =======================
   /ASK (protégé)
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  const { messages, lang } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: "Aucun message fourni." });
  }

  const lastUserMessage = messages[messages.length - 1]?.text?.trim();
  if (!lastUserMessage) {
    return res.status(400).json({ error: "Message vide." });
  }

  try {
    /* 1️⃣ Embedding */
    const embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: process.env.EMBEDDING_MODEL || "text-embedding-ada-002",
    });

    const embedding = embeddingResponse.data[0].embedding;

    /* 2️⃣ Recherche Qdrant (FILTRÉE) */
    const collection = process.env.QDRANT_COLLECTION || "documents";

    const searchResult = await qdrant.search(collection, {
      vector: embedding,
      limit: 3,
      with_payload: true,

      // ✅ FILTRE SAFE : ignorer les points cassés
      filter: {
        must_not: [
          {
            key: "needs_reindex",
            match: { value: true },
          },
        ],
      },
    });

    if (!searchResult.length) {
      return res.json({
        answer:
          `<p><strong>❗ Aucun document juridique pertinent trouvé.</strong></p>` +
          `<p>Merci de reformuler ou de préciser votre question.</p>`,
      });
    }

    const context = searchResult
      .map((doc) => doc.payload?.content || "")
      .filter(Boolean)
      .join("\n");

    /* 3️⃣ SYSTEM PROMPT */
    const systemPrompt = {
      fr: `
Tu es DroitGPT, un avocat congolais professionnel et moderne, spécialisé en droit de la République Démocratique du Congo (RDC) et, lorsque c’est pertinent, en droit OHADA.

🎯 TA MISSION
Aider les citoyens, entrepreneurs et justiciables à comprendre leurs droits et obligations selon le droit congolais.

🧱 FORMAT DE RÉPONSE
HTML simple uniquement : <p>, <h3>, <ul>, <li>, <strong>, <br/>

Structure :
<p><strong>Résumé</strong></p>
<h3>Base légale</h3>
<h3>Explications juridiques</h3>
<h3>Application au cas concret</h3>
<h3>Recours et démarches possibles</h3>
<h3>Points de vigilance</h3>
      `,
    };

    /* 4️⃣ Historique */
    const chatHistory = [
      {
        role: "system",
        content: systemPrompt[lang] || systemPrompt.fr,
      },
      {
        role: "user",
        content: `Extraits juridiques pertinents :\n${context}`,
      },
      ...messages.slice(-6).map((msg) => ({
        role: msg.from === "user" ? "user" : "assistant",
        content: msg.text,
      })),
    ];

    /* 5️⃣ Réponse OpenAI */
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 800,
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() ||
      "<p>❌ Réponse vide.</p>";

    return res.json({ answer });
  } catch (err) {
    console.error("❌ Erreur /ask:", err.message);
    return res.status(500).json({
      error: "Erreur serveur",
      details: err.message,
    });
  }
});

/* =======================
   START
======================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 API DroitGPT en ligne sur http://localhost:${port}`);
});
