// 📄 pdf-service/server.js – Service indépendant de génération PDF
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import generatePdfRoute from './generatePdf.js';
import generateLicenceMemoireRoute from './routes/generateLicenceMemoire.js';

dotenv.config();

const app = express();

/** ===========================
 *  CORS (robuste, dev+prod)
 *  ===========================
 *  - Autorise tous les ports localhost (Vite)
 *  - Autorise Vercel + domaine public
 *  - Répond aux preflight OPTIONS avec 204 + headers
 *  - Ajoute systématiquement les headers CORS sur les réponses autorisées
 */
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/droitgpt-ui\.vercel\.app$/i,
  /^https:\/\/www\.droitgpt\.com$/i,
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/postman
  return allowedOriginPatterns.some((p) => p.test(origin));
}

function applyCors(req, res) {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      // outils sans Origin
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Access-Control-Max-Age", "86400");
}
app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// IMPORTANT: “béton” — handler OPTIONS global (certaines libs interceptent autrement)
app.options("*", (req, res) => {
  applyCors(req, res);
  return res.sendStatus(204);
});



const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.use('/generate-pdf', generatePdfRoute);
app.use('/generate-academic', generateLicenceMemoireRoute);

app.get('/', (req, res) => {
  res.send('✅ Serveur de génération PDF opérationnel.');
});

app.listen(PORT, () => {
  console.log(`🚀 PDF Service en ligne sur http://localhost:${PORT}`);
});
