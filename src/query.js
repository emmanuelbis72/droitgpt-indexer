// ✅ query.js pour DroitGPT avec Qdrant Cloud

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from 'langchain/community/vectorstores/qdrant';
import getPort from 'get-port';

config(); // charge les variables d'environnement

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Connexion Qdrant Cloud
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });
const model = new ChatOpenAI({ temperature: 0, openAIApiKey: process.env.OPENAI_API_KEY });

// Route test GET
app.get('/', (req, res) => {
  res.send('✅ API DroitGPT connectée à Qdrant Cloud.');
});

app.post('/ask', async (req, res) => {
  const { question } = req.body;
  console.log('❓ Question :', question);

  if (!question) {
    return res.status(400).json({ error: 'Aucune question fournie.' });
  }

  try {
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      client: qdrant,
      collectionName: 'documents',
    });

    const results = await vectorStore.similaritySearchWithScore(question, 3);
    const context = results.map(([doc]) => doc.pageContent).join('\n');

    const response = await model.invoke([
      {
        role: 'user',
        content: `Réponds à la question suivante à partir des documents :\n${context}\n\nQuestion : ${question}`,
      },
    ]);

    res.json({ answer: response });
  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Démarre sur port dynamique
getPort().then((PORT) => {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  });
});
