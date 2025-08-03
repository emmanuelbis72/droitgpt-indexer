import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import createAnalyseDocumentRoute from './analyseDocument.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

console.log("🔐 Clé OpenAI :", process.env.OPENAI_API_KEY ? "✅ chargée" : "❌ manquante");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// On passe `openai` comme argument
app.use('/analyse-document', createAnalyseDocumentRoute(openai));

app.get('/', (req, res) => {
  res.send('✅ Service d’analyse de documents juridique opérationnel.');
});

app.listen(PORT, () => {
  console.log(`🚀 Analyse Service lancé sur http://localhost:${PORT}`);
});
