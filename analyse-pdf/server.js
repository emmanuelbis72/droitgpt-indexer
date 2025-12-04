// server.js – Service d'analyse de documents DroitGPT

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const createAnalyseDocumentRoute = require("./analyseDocument");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

/**
 * ✅ CORS
 * Origines par défaut :
 *  - Prod : https://www.droitgpt.com
 *  - Dev : http://localhost:5173 et 5174
 * + éventuellement ce qui est mis dans CORS_ORIGIN
 */
const defaultOrigins = [
  "https://www.droitgpt.com",
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
      // autorise aussi les requêtes sans origin (Postman, curl, healthcheck…)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn("❌ Origin non autorisée par CORS :", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// pré-vol CORS
app.options("*", cors());

app.use(express.json());

// ✅ OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Route d'analyse de document
app.use("/analyse-document", createAnalyseDocumentRoute(openai));

// ✅ Route de test
app.get("/", (req, res) => {
  res.send("✅ Service d’analyse de documents juridique opérationnel.");
});

// ✅ Lancement serveur
app.listen(PORT, () => {
  console.log(`🚀 Analyse Service lancé sur http://localhost:${PORT}`);
  console.log("🌐 CORS autorisés :", allowedOrigins.join(" , "));
});
