// Route d'accueil pour test rapide
app.get('/', (req, res) => {
  res.send('✅ API DroitGPT est en ligne et fonctionne.');
});
// query.js
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';

config(); // Charge les variables d'environnement

const app = express();
app.use(cors());
app.use(express.json());

// Initialisation Supabase + Embeddings
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });

const vectorStore = new SupabaseVectorStore(embeddings, {
  client,
  tableName: 'documents',
  queryName: 'match_documents',
});

const model = new ChatOpenAI({ temperature: 0, openAIApiKey: process.env.OPENAI_API_KEY });

app.post('/ask', async (req, res) => {
  const { question } = req.body;

  try {
    const results = await vectorStore.similaritySearch(question, 3);
    const context = results.map(doc => doc.pageContent).join('\n');
    const response = await model.call([
      {
        role: 'user',
        content: `Réponds à la question suivante en te basant sur les documents :\n${context}\n\nQuestion : ${question}`
      }
    ]);
    res.json({ answer: response.text });
  } catch (err) {
    console.error("❌ Erreur complète :", err); // Affiche l'erreur exacte dans les logs Render
    res.status(500).json({ error: 'Erreur de traitement' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));
