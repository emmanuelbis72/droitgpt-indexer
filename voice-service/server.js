// server.js – Service d'analyse de documents DroitGPT (OCR + IA)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const createAnalyseDocumentRoute = require("./analyseDocument");

dotenv.config();

const app = express();
app.set("trust proxy", 1); // ✅ recommandé sur Render

const PORT = process.env.PORT || 5002;

// ✅ CORS: ajoute aussi droitgpt.com sans www + (optionnel) ton Render UI si besoin
const defaultOrigins = [
  "https://www.droitgpt.com",
  "https://droitgpt.com",
  "http://localhost:5173",
  "http://localhost:5174",
];

let envOrigins = [];
if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim() !== "") {
  envOrigins = process.env.CORS_ORIGIN.split(",").map((o) => o.trim());
}

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

app.use(
  cors({
    origin(origin, callback) {
      // Autorise aussi les requêtes sans origin (ex: curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      console.warn("❌ Origin non autorisée par CORS :", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

// ✅ IMPORTANT: limite JSON plus grande (OCR texte complet -> /analyse/text)
app.use(express.json({ limit: process.env.JSON_LIMIT || "6mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Router OCR+Analyse
const analyseRouter = createAnalyseDocumentRoute(openai);

// ✅ Route principale attendue par ton frontend
app.use("/analyse", analyseRouter);

// ✅ Backward-compat (si tu avais déjà /analyse-document utilisé ailleurs)
app.use("/analyse-document", analyseRouter);

// ✅ Healthchecks
app.get("/", (req, res) => res.send("✅ Analyse OCR + IA opérationnelle."));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 Analyse Service lancé sur http://localhost:${PORT}`);
  console.log("🌐 CORS autorisés :", allowedOrigins.join(" , "));
});
