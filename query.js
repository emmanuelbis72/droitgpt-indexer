import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai'; // ✅ Import sans accolades
import getPort from 'get-port';

config();
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ API DroitGPT + Qdrant est en ligne');
});

// Qdrant client
const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// ✅ OpenAI client (sans `apiKey:`, mais `apiKey` directement)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Endpoint
app.post('/ask', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Veuillez fournir une question.' });
  }

  try {
    const embeddingResponse = await openai.embeddings.create({
      input: question,
      model: 'text-embedding-ada-002',
    });

    const embedding = embeddingResponse.data[0].embedding;

    const searchResult = await client.search('documents', {
      vector: embedding,
      limit: 3,
      with_payload: true,
    });

    if (!searchResult || searchResult.length === 0) {
      return res.status(200).json({ error: 'Aucun document pertinent trouvé.' });
    }

    const context = searchResult.map(doc => doc.payload?.content || '').join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: "Tu es un assistant juridique spécialisé dans le droit congolais. Réponds uniquement à partir des documents suivants.",
        },
        {
          role: 'user',
          content: `Voici les documents :\n${context}\n\nQuestion : ${question}`,
        },
      ],
      temperature: 0.3,
    });

    const answer = completion.choices[0].message.content;
    res.status(200).json({ answer });
  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Port dynamique
getPort().then((PORT) => {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  });
});
