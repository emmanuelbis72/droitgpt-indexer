// ✅ Fichier : query.js
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

config();
const app = express();
app.use(cors());
app.use(express.json());

// Qdrant client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Vérification
app.get('/', (req, res) => {
  res.send('✅ API DroitGPT avec streaming actif');
});

// Point d’accès principal
app.post('/ask', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Aucun message fourni.' });
  }

  const lastUserMessage = messages[messages.length - 1]?.text;
  if (!lastUserMessage) {
    return res.status(400).json({ error: 'Dernier message utilisateur manquant.' });
  }

  try {
    // Embedding
    const embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: 'text-embedding-ada-002',
    });
    const embedding = embeddingResponse.data[0].embedding;

    // Recherche dans Qdrant
    const searchResult = await qdrant.search('documents', {
      vector: embedding,
      limit: 2,
      with_payload: true,
    });

    const context = searchResult.map(doc => doc.payload?.content || '').join('\n');

    // Contexte + messages utilisateurs (historique réduit à 3 échanges max)
    const recentMessages = messages.slice(-3);
    const chatHistory = [
      {
        role: 'system',
        content:
          'Tu es un assistant juridique congolais. Réponds toujours en HTML structuré. Donne un <h3>Titre</h3> au début, puis des explications en <strong>gras</strong> quand nécessaire.',
      },
      { role: 'user', content: `Voici les documents pertinents :\n${context}` },
      ...recentMessages.map((m) => ({
        role: m.from === 'user' ? 'user' : 'assistant',
        content: m.text,
      })),
    ];

    // Réponse en streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 800,
      stream: true,
    });

    for await (const part of completion) {
      const token = part.choices?.[0]?.delta?.content;
      if (token) res.write(token);
    }

    res.end();
  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.write('❌ Erreur côté serveur.');
    res.end();
  }
});

// Lancement du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur backend DroitGPT lancé sur le port ${port}`);
});
