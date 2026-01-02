// server.js – Service d'analyse de documents DroitGPT

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const createAnalyseDocumentRoute = require("./analyseDocument");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

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
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      console.warn("❌ Origin non autorisée par CORS :", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"], // ✅
  })
);

app.options("*", cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use("/analyse-document", createAnalyseDocumentRoute(openai));

app.get("/", (req, res) => res.send("✅ Analyse OCR + IA opérationnelle."));

app.listen(PORT, () => {
  console.log(`🚀 Analyse Service lancé sur http://localhost:${PORT}`);
  console.log("🌐 CORS autorisés :", allowedOrigins.join(" , "));
});
