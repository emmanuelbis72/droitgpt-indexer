// ✅ Fichier optimisé : query.js pour DroitGPT (performance améliorée avec streaming, filtre, historique réduit)

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
  res.send('✅ API DroitGPT + Qdrant est en ligne (optimisée)');
});

// Endpoint avec STREAMING activé
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
    // Embedding de la requête utilisateur
    const embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: 'text-embedding-ada-002',
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Recherche Qdrant avec payload minimal
    const searchResult = await qdrant.search('documents', {
      vector: embedding,
      limit: 2,
      with_payload: true, // garder si tu as besoin du contenu texte
    });

    const context = searchResult.map(doc => doc.payload?.content || '').join('\n');

    // Historique limité à 4 derniers messages
    const recentMessages = messages.slice(-4);

    const chatHistory = [
      { role: 'system', content: 'Tu es un assistant juridique spécialisé dans le droit congolais. Rédige toujours ta réponse en incluant un <h3>Titre</h3> et du <strong>gras</strong> pour les points importants. Réponds toujours en HTML structuré.' },
      { role: 'user', content: `Voici les documents pertinents :\n${context}` },
      ...recentMessages.map(msg => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
    ];

    // Streaming de la réponse OpenAI
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

    for await (const chunk of completion) {
      const token = chunk.choices?.[0]?.delta?.content;
      if (token) res.write(token);
    }

    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Lancement du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur backend DroitGPT lancé sur le port ${port}`);
});
