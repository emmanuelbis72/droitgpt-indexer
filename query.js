// ✅ query.js — version rapide sans streaming (GPT-3.5 Turbo + Qdrant)

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

app.get('/', (req, res) => {
  res.send('✅ API DroitGPT est en ligne (rapide sans streaming)');
});

app.post('/ask', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Aucun message fourni.' });
  }

  const lastUserMessage = messages[messages.length - 1]?.text;
  if (!lastUserMessage) {
    return res.status(400).json({ error: 'Message utilisateur manquant.' });
  }

  try {
    // 🔹 Étape 1 : Générer embedding
    const { data } = await openai.embeddings.create({
      input: lastUserMessage,
      model: 'text-embedding-ada-002',
    });

    const embedding = data[0].embedding;

    // 🔹 Étape 2 : Requête à Qdrant avec payload minimal
    const searchResult = await qdrant.search('documents', {
      vector: embedding,
      limit: 2,
      with_payload: true,
    });

    // 🔹 Étape 3 : Extraire les documents pertinents
    const context = searchResult
      .map(doc => doc.payload?.content || '')
      .filter(Boolean)
      .join('\n');

    // 🔹 Étape 4 : Réduire l'historique à 3 derniers messages max
    const recentMessages = messages.slice(-3);

    // 🔹 Étape 5 : Historique final
    const chatHistory = [
      {
        role: 'system',
        content:
          'Tu es un assistant juridique spécialisé en droit congolais. Réponds toujours en HTML structuré. Commence par un <h3>Titre</h3>, utilise le <strong>gras</strong> pour les parties importantes, et reste juridique.',
      },
      { role: 'user', content: `Voici les documents pertinents :\n${context}` },
      ...recentMessages.map(msg => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
    ];

    // 🔹 Étape 6 : Appel à ChatGPT (sans streaming)
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0].message.content;
    res.status(200).json({ text: responseText });
  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Serveur backend DroitGPT (rapide sans streaming) lancé sur le port ${port}`);
});
