// 📄 pdf-service/server.js – Service indépendant de génération PDF
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import generatePdfRoute from './generatePdf.js';

dotenv.config();

const app = express();

/**
 * ===== CORS (robuste) =====
 * Objectif: éviter le "No Access-Control-Allow-Origin" sur OPTIONS + POST (PDF).
 * - Autorise tous les ports localhost (dev)
 * - Autorise Vercel + domaine prod
 * - Expose Content-Disposition (nom du PDF)
 */
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/droitgpt-ui\.vercel\.app$/i,
  /^https:\/\/www\.droitgpt\.com$/i,
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    const ok = allowedOriginPatterns.some((p) => p.test(origin));
    return cb(null, ok);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Disposition"],
  credentials: false,
  maxAge: 86400,
};

// ✅ CORS avant tout (y compris OPTIONS preflight)
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const PORT = process.env.PORT || 5001;

app.use(express.json());

// ✅ Debug route pour vérifier en prod que ce serveur est bien celui déployé
app.get("/__whoami", (req, res) => {
  res.json({
    ok: true,
    service: "pdf-service/generate-academic",
    time: new Date().toISOString(),
    pid: process.pid,
  });
});


app.use('/generate-pdf', generatePdfRoute);

app.get('/', (req, res) => {
  res.send('✅ Serveur de génération PDF opérationnel.');
});

app.listen(PORT, () => {
  console.log(`🚀 PDF Service en ligne sur http://localhost:${PORT}`);
});
