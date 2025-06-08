import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import getPort from 'get-port';

config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ API DroitGPT + Qdrant est en ligne');
});

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });

const COLLECTION_NAME = 'documents';

const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
  client,
  collectionName: COLLECTION_NAME,
});

const model = new ChatOpenAI({ temperature: 0, openAIApiKey: process.env.OPENAI_API_KEY });

app.post('/ask', async (req, res) => {
  const { question } = req.body;
  console.log('❓ Question reçue :', question);

  try {
    const results = await vectorStore.similaritySearch(question, 3);
    const context = results.map(doc => doc.pageContent).join('\n');

    const response = await model.invoke([
      {
        role: 'user',
        content: `Réponds à la question suivante en te basant sur les documents suivants :\n${context}\n\nQuestion : ${question}`
      }
    ]);

    res.json({ answer: response });
  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

getPort().then((PORT) => {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  });
});