// ✅ query.js – API principale DroitGPT + AUTH + /ask + /ask-stream (SSE streaming stable)
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
  // ✅ IMPORTANT : Accept pour SSE
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
   Helpers : construire le prompt + historique
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
    en: `
You are DroitGPT, a professional Congolese legal assistant. Answer using simple HTML tags: <p>, <h3>, <ul>, <li>, <strong>, <br/>.
Structure: Summary, Legal basis, Explanation, Practical application, Remedies/steps, Caution points.
    `,
  };

  return systemPrompt[safeLang] || systemPrompt.fr;
}

async function buildRagHistory({ messages, lang }) {
  // ✅ validations
  if (!Array.isArray(messages) || messages.length === 0) {
    const e = new Error("Bad Request: 'messages' doit être un tableau non vide.");
    e.status = 400;
    throw e;
  }

  const bad = messages.find((m) => !isValidMessage(m));
  if (bad) {
    const e = new Error("Bad Request: chaque message doit avoir { from, text } valides.");
    e.status = 400;
    throw e;
  }

  const lastUserMessage = safeString(messages[messages.length - 1]?.text).trim();
  if (!lastUserMessage) {
    const e = new Error("Bad Request: dernier message vide.");
    e.status = 400;
    throw e;
  }

  const safeLang = (safeString(lang).trim() || "fr").toLowerCase();

  // 1) embedding
  const embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

  let embeddingResponse;
  try {
    embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: embeddingModel,
    });
  } catch (err) {
    logOpenAIError("Erreur embeddings.create()", err);
    const e = new Error(err?.error?.message || err?.message || "OpenAI embeddings error");
    e.status = 500;
    throw e;
  }

  const embedding = embeddingResponse?.data?.[0]?.embedding;
  if (!embedding) {
    const e = new Error("Erreur serveur: embedding manquant.");
    e.status = 500;
    throw e;
  }

  // 2) Qdrant search
  const collection = process.env.QDRANT_COLLECTION || "documents";
  const searchResult = await qdrant.search(collection, {
    vector: embedding,
    limit: 3,
    with_payload: true,
  });

  const context = (searchResult || [])
    .map((doc) => doc?.payload?.content || "")
    .filter(Boolean)
    .join("\n");

  // 3) chatHistory
  const chatHistory = [
    { role: "system", content: buildSystemPrompt(safeLang) },
    ...(context
      ? [{ role: "user", content: `Extraits juridiques pertinents :\n${context}` }]
      : []),
    ...messages.slice(-6).map((msg) => ({
      role: msg.from === "user" ? "user" : "assistant",
      content: msg.text,
    })),
  ];

  return { chatHistory, safeLang, context, hasContext: Boolean(context) };
}

/* =======================
   /ASK (protégé) - JSON classique (inchangé)
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  const { messages, lang } = req.body || {};

  try {
    const { chatHistory, hasContext } = await buildRagHistory({ messages, lang });

    // Si aucun doc pertinent, répondre vite
    if (!hasContext) {
      return res.json({
        answer:
          `<p><strong>❗ Aucun document juridique pertinent trouvé.</strong></p>` +
          `<p>Merci de reformuler ou de préciser votre question.</p>`,
      });
    }

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
    const status = err?.status || 500;
    if (status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("❌ Erreur /ask (catch-all):", err);
    return res.status(500).json({
      error: "Erreur serveur",
      details: err?.message || "Unknown error",
    });
  }
});

/* =======================
   /ASK-STREAM (protégé) - Streaming SSE (comme ChatGPT)
   Envoie des deltas au fur et à mesure
======================= */
app.post("/ask-stream", requireAuth, async (req, res) => {
  // ✅ SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // ✅ anti-buffering (utile selon proxy)
  res.setHeader("X-Accel-Buffering", "no");

  res.flushHeaders?.();

  // ✅ premier paquet pour démarrer immédiatement (évite "ça répond pas")
  res.write(`event: ready\ndata: {}\n\n`);

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ✅ heartbeat pour éviter coupure proxy
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: {}\n\n`);
    } catch {
      // ignore
    }
  }, 15000);

  let closed = false;
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });

  try {
    const { messages, lang } = req.body || {};
    const { chatHistory, hasContext } = await buildRagHistory({ messages, lang });

    if (!hasContext) {
      sendEvent("delta", {
        content:
          `<p><strong>❗ Aucun document juridique pertinent trouvé.</strong></p>` +
          `<p>Merci de reformuler ou de préciser votre question.</p>`,
      });
      sendEvent("done", {});
      clearInterval(heartbeat);
      return res.end();
    }

    const chatModel = process.env.CHAT_MODEL || "gpt-4o-mini";

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
      sendEvent("error", {
        error: err?.error?.message || err?.message || "OpenAI chat error",
      });
      sendEvent("done", {});
      clearInterval(heartbeat);
      return res.end();
    }

    for await (const chunk of stream) {
      if (closed) break;
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) sendEvent("delta", { content: delta });
    }

    if (!closed) sendEvent("done", {});
    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    console.error("❌ Erreur /ask-stream (catch-all):", err);
    sendEvent("error", { error: err?.message || "Erreur serveur" });
    sendEvent("done", {});
    clearInterval(heartbeat);
    res.end();
  }
});

/* =======================
   START
======================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 API DroitGPT en ligne sur http://localhost:${port}`);
});
