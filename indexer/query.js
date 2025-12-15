// ✅ query.js – API principale DroitGPT + AUTH + /ask protégé (logs robustes)
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
   CORS (FIX preflight + origins)
======================= */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (!ALLOWED_ORIGINS.length) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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

function safeString(x) {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}

function isValidMessage(m) {
  return (
    m &&
    typeof m === "object" &&
    typeof m.from === "string" &&
    typeof m.text === "string" &&
    m.text.trim().length > 0
  );
}

/**
 * Log OpenAI errors with details (instead of only "Bad Request")
 */
function logOpenAIError(prefix, err) {
  const status = err?.status;
  const name = err?.name;
  const message = err?.message;

  // SDK OpenAI v4: err.error peut contenir { message, type, param, code }
  const apiError = err?.error;
  const apiMsg = apiError?.message;
  const apiType = apiError?.type;
  const apiParam = apiError?.param;
  const apiCode = apiError?.code;

  console.error(`❌ ${prefix}`, {
    status,
    name,
    message,
    apiMsg,
    apiType,
    apiParam,
    apiCode,
  });
}

/* =======================
   AUTH ROUTES
======================= */
app.use("/auth", authRoutes);

/* =======================
   HEALTH
======================= */
app.get("/", (_req, res) => {
  res.send("✅ API DroitGPT opérationnelle (AUTH).");
});

/* =======================
   /ASK (protégé)
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  const { messages, lang } = req.body || {};

  // ✅ Validation solide (évite 400 flou)
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Bad Request: 'messages' doit être un tableau non vide.",
    });
  }

  const bad = messages.find((m) => !isValidMessage(m));
  if (bad) {
    return res.status(400).json({
      error: "Bad Request: chaque message doit avoir { from, text } valides.",
    });
  }

  const lastUserMessage = safeString(messages[messages.length - 1]?.text).trim();
  if (!lastUserMessage) {
    return res.status(400).json({ error: "Bad Request: dernier message vide." });
  }

  // Lang fallback
  const safeLang = (safeString(lang).trim() || "fr").toLowerCase();

  try {
    /* 1️⃣ Embedding */
    const embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

    let embeddingResponse;
    try {
      embeddingResponse = await openai.embeddings.create({
        input: lastUserMessage,
        model: embeddingModel,
      });
    } catch (err) {
      logOpenAIError("Erreur embeddings.create()", err);
      return res.status(500).json({
        error: "Erreur serveur (embeddings).",
        details: err?.error?.message || err?.message || "OpenAI embeddings error",
      });
    }

    const embedding = embeddingResponse?.data?.[0]?.embedding;
    if (!embedding) {
      return res.status(500).json({
        error: "Erreur serveur: embedding manquant.",
      });
    }

    /* 2️⃣ Recherche Qdrant (SANS filtre needs_reindex) */
    const collection = process.env.QDRANT_COLLECTION || "documents";

    const searchResult = await qdrant.search(collection, {
      vector: embedding,
      limit: 3,
      with_payload: true,
    });

    if (!searchResult?.length) {
      return res.json({
        answer:
          `<p><strong>❗ Aucun document juridique pertinent trouvé.</strong></p>` +
          `<p>Merci de reformuler ou de préciser votre question.</p>`,
      });
    }

    const context = searchResult
      .map((doc) => doc?.payload?.content || "")
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
        content: systemPrompt[safeLang] || systemPrompt.fr,
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
    const chatModel = process.env.CHAT_MODEL || "gpt-4o-mini";

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: chatModel,
        messages: chatHistory,
        temperature: 0.3,
        max_tokens: 800,
      });
    } catch (err) {
      logOpenAIError("Erreur chat.completions.create()", err);
      return res.status(500).json({
        error: "Erreur serveur (chat).",
        details: err?.error?.message || err?.message || "OpenAI chat error",
      });
    }

    const answer =
      completion?.choices?.[0]?.message?.content?.trim() || "<p>❌ Réponse vide.</p>";

    return res.json({ answer });
  } catch (err) {
    // Catch-all (Qdrant / autres)
    console.error("❌ Erreur /ask (catch-all):", err);
    return res.status(500).json({
      error: "Erreur serveur",
      details: err?.message || "Unknown error",
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
