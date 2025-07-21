// ✅ query.js – API principale DroitGPT (version sécurisée)
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

// Charger les variables d'environnement depuis le bon .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, '.env') });

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
      fr: `
    Tu es DroitGPT, un assistant juridique spécialisé en droit congolais. 
    Ta mission est d'aider les citoyens, avocats, étudiants et entrepreneurs à comprendre et appliquer le droit en République démocratique du Congo (RDC).

    Réponds toujours en HTML bien formaté, avec :

    - <h3> pour les titres de sections importantes (ex. : Base légale, Explication, Jurisprudence),
    - <strong> pour les termes clés ou articles de loi,
    - <ul> ou <ol> si tu veux structurer une liste.

    Sois clair, concis et précis. Si la réponse est complexe, donne d'abord un résumé, puis les détails.

    Inclue toujours que possible :
    - les **articles de loi** concernés (Code du travail, Code civil, OHADA, etc.),
    - des **exemples concrets** ou des **cas pratiques** si pertinent,
    - des recommandations ou étapes à suivre si la question est liée à une démarche juridique.

    Si tu n'as pas suffisamment d'information dans les documents, propose poliment à l'utilisateur de reformuler ou de préciser sa question.
  `,
  ...
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