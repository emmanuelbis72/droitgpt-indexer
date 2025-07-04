// ✅ query.js – API rapide sans streaming pour DroitGPT
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

config();

const app = express();
app.use(cors());
app.use(express.json());

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get('/', (req, res) => {
  res.send('✅ API DroitGPT sans streaming opérationnelle.');
});

app.post('/ask', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Aucun message fourni.' });
  }

  let lastUserMessage = messages[messages.length - 1]?.text || '';
  if (!lastUserMessage.trim()) {
    return res.status(400).json({ error: 'Message vide.' });
  }

  lastUserMessage = lastUserMessage.trim().toLowerCase();

  try {
    const embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: 'text-embedding-ada-002',
    });

    const embedding = embeddingResponse.data[0].embedding;

    const searchResult = await qdrant.search('documents', {
      vector: embedding,
      limit: 2,
      with_payload: true,
    });

    if (!searchResult.length) {
      return res.status(200).json({
        answer: `<strong>❗ Aucun document pertinent trouvé.</strong><br/>Merci de reformuler votre question.`,
      });
    }

    const context = searchResult
      .map(doc => doc.payload?.content || '')
      .filter(Boolean)
      .join('\n');

    const recentMessages = messages.slice(-4);

    const chatHistory = [
      {
        role: 'system',
        content: `Tu es un assistant juridique congolais. Donne des réponses claires, précises et structurées en HTML avec <h3>titres</h3> et <strong>gras</strong>.`,
      },
      {
        role: 'user',
        content: `Voici les documents pertinents :\n${context}`,
      },
      ...recentMessages.map(msg => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 800,
    });

    const fullText = completion.choices[0]?.message?.content?.trim();

    res.json({
      answer: fullText || '❌ Réponse vide.',
    });
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 DroitGPT API lancée sur http://localhost:${port}`);
});
