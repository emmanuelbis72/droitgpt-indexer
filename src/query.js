import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';

config(); // Charge les variables d'environnement

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Route de test
app.get('/', (req, res) => {
  res.send('✅ API DroitGPT en ligne avec Qdrant');
});

// 🧠 Initialisation Qdrant Cloud
const client = new QdrantClient({
  url: process.env.QDRANT_URL, // ex. https://xxx.us-east4-0.gcp.cloud.qdrant.io
  apiKey: process.env.QDRANT_API_KEY
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY
});

const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
  client,
  collectionName: 'documents'
});

const model = new ChatOpenAI({
  temperature: 0,
  openAIApiKey: process.env.OPENAI_API_KEY
});

// 💬 Traitement des questions
app.post('/ask', async (req, res) => {
  const { question } = req.body;
  console.log('❓ Question reçue :', question);

  if (!question) {
    return res.status(400).json({ error: 'Aucune question fournie.' });
  }

  try {
    const results = await vectorStore.similaritySearchWithScore(question, 3);
    const context = results.map(([doc]) => doc.pageContent).join('\n');

    const response = await model.invoke([
      {
        role: 'user',
        content: `Réponds à la question suivante uniquement à partir des documents :\n${context}\n\nQuestion : ${question}`
      }
    ]);

    res.json({ answer: response });
  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ✅ Démarrage sur le port imposé par Render ou 3000 en local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
