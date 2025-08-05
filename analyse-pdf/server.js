import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import createAnalyseDocumentRoute from './analyseDocument.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// 🔐 Configuration CORS manuelle compatible Render
const allowedOrigin = process.env.CORS_ORIGIN || '*';

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", allowedOrigin);
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use('/analyse-document', createAnalyseDocumentRoute(openai));

app.get('/', (req, res) => {
  res.send('✅ Service d’analyse de documents juridique opérationnel.');
});

app.listen(PORT, () => {
  console.log(`🚀 Analyse Service lancé sur http://localhost:${PORT}`);
  console.log(`🌐 CORS autorisé : ${allowedOrigin}`);
});
