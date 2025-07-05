// ✅ query.js – API principale DroitGPT (ne rien modifier)
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get('/', (req, res) => {
  res.send('✅ API DroitGPT avec détection de langue opérationnelle.');
});

app.post('/ask', async (req, res) => {
  const { messages, lang } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Aucun message fourni.' });
  }

  let lastUserMessage = messages[messages.length - 1]?.text?.trim().toLowerCase();
  if (!lastUserMessage) {
    return res.status(400).json({ error: 'Message vide.' });
  }

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

    const context = searchResult.map(doc => doc.payload?.content || '').join('\n');

    const systemPrompt = {
      fr: "Tu es un assistant juridique congolais. Donne des réponses claires, précises et structurées en HTML avec <h3>titres</h3> et <strong>gras</strong>.",
      en: "You are a legal assistant specialized in Congolese law. Provide clear and structured answers in HTML.",
      sw: "Wewe ni msaidizi wa sheria maalumu kwa sheria ya Kongo. Toa majibu wazi katika HTML.",
      ln: "Ozali mosungi ya mibeko ya Kongo. Pesá biyano ya polele na HTML.",
      kg: "Uvele wakangayi wa mabeka ya Kongo. Zabisa bizaba ya munene.",
      tsh: "Uli musungi wa muoyo mu muoyo wa ntu. Pesá miyembo ya bungi na HTML."
    };

    const chatHistory = [
      { role: 'system', content: systemPrompt[lang] || systemPrompt['fr'] },
      { role: 'user', content: `Voici les documents pertinents :\n${context}` },
      ...messages.slice(-4).map(msg => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text
      }))
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 800,
    });

    res.json({ answer: completion.choices[0]?.message?.content?.trim() || '❌ Réponse vide.' });
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 API DroitGPT en ligne sur http://localhost:${port}`);
});
