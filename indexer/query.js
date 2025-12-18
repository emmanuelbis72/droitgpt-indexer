// ✅ query.js – API principale DroitGPT + AUTH + /ask protégé + /ask-stream (streaming SSE)
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
  // ✅ Ajout Accept pour SSE / streaming
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
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
   Helper: Construire prompt + historique
======================= */
function buildSystemPrompt(safeLang) {
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

  return systemPrompt[safeLang] || systemPrompt.fr;
}

function buildChatHistory({ safeLang, context, messages }) {
  return [
    { role: "system", content: buildSystemPrompt(safeLang) },
    { role: "user", content: `Extraits juridiques pertinents :\n${context}` },
    ...messages.slice(-6).map((msg) => ({
      role: msg.from === "user" ? "user" : "assistant",
      content: msg.text,
    })),
  ];
}

/* =======================
   AUTH ROUTES
======================= */
app.use("/auth", authRoutes);

/* =======================
   HEALTH
======================= */
app.get("/", (_req, res) => {
  res.send("✅ API DroitGPT opérationnelle (AUTH + STREAM).");
});

/* =======================
   /ASK (protégé) - JSON classique
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  const { messages, lang } = req.body || {};

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

  const safeLang = (safeString(lang).trim() || "fr").toLowerCase();

  try {
    /* 1️⃣ Embedding */
    const embeddingModel =
      process.env.EMBEDDING_MODEL || "text-embedding-3-small";

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

    /* 2️⃣ Recherche Qdrant */
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

    /* 3️⃣ Historique + prompt */
    const chatHistory = buildChatHistory({ safeLang, context, messages });

    /* 4️⃣ Réponse OpenAI */
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
      completion?.choices?.[0]?.message?.content?.trim() ||
      "<p>❌ Réponse vide.</p>";

    return res.json({ answer });
  } catch (err) {
    console.error("❌ Erreur /ask (catch-all):", err);
    return res.status(500).json({
      error: "Erreur serveur",
      details: err?.message || "Unknown error",
    });
  }
});

/* =======================
   /ASK-STREAM (protégé) - Streaming SSE (comme ChatGPT)
   → renvoie des "delta" au fur et à mesure
======================= */
app.post("/ask-stream", requireAuth, async (req, res) => {
  const { messages, lang } = req.body || {};

  // ✅ Validation
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

  const safeLang = (safeString(lang).trim() || "fr").toLowerCase();

  // ✅ SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  // si derrière proxy
  res.flushHeaders?.();

  const sseSend = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ✅ Heartbeat: évite que Render/proxy coupe une connexion silencieuse
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: {}\n\n`);
    } catch {
      // ignore
    }
  }, 15000);

  // ✅ Déconnexion client
  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
    clearInterval(heartbeat);
  });

  try {
    /* 1️⃣ Embedding */
    const embeddingModel =
      process.env.EMBEDDING_MODEL || "text-embedding-3-small";

    let embeddingResponse;
    try {
      embeddingResponse = await openai.embeddings.create({
        input: lastUserMessage,
        model: embeddingModel,
      });
    } catch (err) {
      logOpenAIError("Erreur embeddings.create()", err);
      clearInterval(heartbeat);
      sseSend("error", {
        error: "Erreur serveur (embeddings).",
        details: err?.error?.message || err?.message || "OpenAI embeddings error",
      });
      return res.end();
    }

    const embedding = embeddingResponse?.data?.[0]?.embedding;
    if (!embedding) {
      clearInterval(heartbeat);
      sseSend("error", { error: "Erreur serveur: embedding manquant." });
      return res.end();
    }

    /* 2️⃣ Qdrant */
    const collection = process.env.QDRANT_COLLECTION || "documents";
    const searchResult = await qdrant.search(collection, {
      vector: embedding,
      limit: 3,
      with_payload: true,
    });

    if (!searchResult?.length) {
      sseSend("delta", {
        content:
          `<p><strong>❗ Aucun document juridique pertinent trouvé.</strong></p>` +
          `<p>Merci de reformuler ou de préciser votre question.</p>`,
      });
      clearInterval(heartbeat);
      sseSend("done", { answer: "" });
      return res.end();
    }

    const context = searchResult
      .map((doc) => doc?.payload?.content || "")
      .filter(Boolean)
      .join("\n");

    /* 3️⃣ Historique + prompt */
    const chatHistory = buildChatHistory({ safeLang, context, messages });

    /* 4️⃣ OpenAI streaming */
    const chatModel = process.env.CHAT_MODEL || "gpt-4o-mini";

    let full = "";

    let stream;
    try {
      stream = await openai.chat.completions.create({
        model: chatModel,
        messages: chatHistory,
        temperature: 0.3,
        max_tokens: 800,
        stream: true,
      });
    } catch (err) {
      logOpenAIError("Erreur chat.completions.create(stream)", err);
      clearInterval(heartbeat);
      sseSend("error", {
        error: "Erreur serveur (chat).",
        details: err?.error?.message || err?.message || "OpenAI chat error",
      });
      return res.end();
    }

    for await (const chunk of stream) {
      if (clientClosed) break;

      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (!delta) continue;

      full += delta;
      sseSend("delta", { content: delta });
    }

    clearInterval(heartbeat);

    if (!clientClosed) {
      sseSend("done", { answer: full });
      res.end();
    }
  } catch (err) {
    console.error("❌ Erreur /ask-stream (catch-all):", err);
    clearInterval(heartbeat);
    try {
      sseSend("error", { error: "Erreur serveur", details: err?.message || "" });
    } finally {
      res.end();
    }
  }
});

/* =======================
   START
======================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 API DroitGPT en ligne sur http://localhost:${port}`);
});
