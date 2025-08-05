import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import createAnalyseDocumentRoute from './analyseDocument.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

const allowedOrigin = process.env.CORS_ORIGIN || 'https://www.droitgpt.com';

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

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
