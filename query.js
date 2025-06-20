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

// Vérification de l'API
app.get('/', (req, res) => {
  res.send('✅ API DroitGPT + Qdrant est en ligne');
});

// Point d'accès principal
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
    // Générer l'embedding
    const embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: 'text-embedding-ada-002',
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Recherche dans Qdrant
    const searchResult = await qdrant.search('documents', {
      vector: embedding,
      limit: 2, // ⚠️ réduction du contexte
      with_payload: true,
    });

    const context = searchResult.map(doc => doc.payload?.content || '').join('\n');

    // Historique du chat
    const chatHistory = [
      { role: 'system', content: 'Tu es un assistant juridique spécialisé dans le droit congolais.' },
      { role: 'user', content: `Voici les documents pertinents :\n${context}` },
      ...messages.map(msg => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
    ];

    // Appel OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 500, // ⚠️ limitation des tokens pour réduire les coûts
    });

    const reply = completion.choices[0].message.content;
    res.status(200).json({ answer: reply });

  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// Lancement
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // Pas de console.log pour Render
});
