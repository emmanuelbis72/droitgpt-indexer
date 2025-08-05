import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import createAnalyseDocumentRoute from './analyseDocument.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// 🔐 Log des clés importantes
console.log("🔐 Clé OpenAI :", process.env.OPENAI_API_KEY ? "✅ chargée" : "❌ manquante");
console.log("🌐 CORS autorisé :", process.env.CORS_ORIGIN || '*');

// ✅ Configuration CORS dynamique
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
}));

app.use(express.json());

// 🔁 Route principale avec OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.use('/analyse-document', createAnalyseDocumentRoute(openai));

// ✅ Route test
app.get('/', (req, res) => {
  res.send('✅ Service d’analyse de documents juridique opérationnel.');
});

// 🚀 Démarrage serveur
app.listen(PORT, () => {
  console.log(`🚀 Analyse Service lancé sur http://localhost:${PORT}`);
});
