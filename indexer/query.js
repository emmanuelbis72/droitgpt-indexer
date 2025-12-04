// ✅ query.js – API principale DroitGPT (version améliorée style "avocat congolais")
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

// Charger les variables d'environnement
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

  const lastUserMessage = messages[messages.length - 1]?.text?.trim();
  if (!lastUserMessage) {
    return res.status(400).json({ error: 'Message vide.' });
  }

  try {
    // 1️⃣ Générer l'embedding du dernier message
    const embeddingResponse = await openai.embeddings.create({
      input: lastUserMessage,
      model: 'text-embedding-ada-002',
    });

    const embedding = embeddingResponse.data[0].embedding;

    // 2️⃣ Rechercher les documents les plus pertinents dans Qdrant
    const searchResult = await qdrant.search('documents', {
      vector: embedding,
      limit: 2,
      with_payload: true,
    });

    if (!searchResult.length) {
      return res.status(200).json({
        answer: `<strong>❗ Aucun document pertinent trouvé.</strong><br/>Merci de reformuler ou de préciser votre question.`,
      });
    }

    const context = searchResult
      .map((doc) => doc.payload?.content || '')
      .join('\n');

    /**
     * 3️⃣ SYSTEM PROMPT – STYLE AVOCAT CONGOLAIS + RÉFÉRENCES JURIDIQUES + HTML
     * - Répondre dans la même langue que la question (fr, en, sw, ln…)
     * - Appuyer l’analyse sur le droit congolais (Constitution, codes, lois spéciales, OHADA…)
     * - Réponse structurée pour affichage dans ChatInterface (HTML)
     */
    const systemPrompt = {
      fr: `
Tu es DroitGPT, un avocat congolais professionnel et pédagogue, spécialisé en droit de la République démocratique du Congo (RDC).

🎯 TA MISSION
- Aider les citoyens, avocats, magistrats, étudiants, entrepreneurs et justiciables à comprendre et appliquer le droit congolais.
- Expliquer les règles de droit de manière claire, structurée et pratique, sans remplacer un avocat humain.

🗣️ LANGUE
- Réponds dans la même langue que la question (par exemple : français, anglais, swahili, lingala), dans la mesure du possible.
- Même si tu réponds en anglais, swahili ou lingala, les références légales (noms des codes, intitulés des articles) peuvent rester en français.

📚 BASE JURIDIQUE
Chaque fois que c’est possible, appuie ton analyse sur :
- La Constitution de la RDC,
- Les principaux codes (Code civil, Code de la famille, Code pénal, Code du travail, Code de procédure pénale, Code minier, Code de l’environnement, etc.),
- Les actes uniformes OHADA,
- Les lois spéciales (protection de l’enfant, violences sexuelles, droit foncier, etc.).

Fais toujours clairement allusion à ces textes :
- Cite les articles pertinents (par exemple : « Selon l’article 7 de la Constitution… », « Conformément au Code du travail… »),
- Lorsque tu n’as pas le numéro précis, mentionne au moins le texte (« le Code de la famille prévoit que… »).

🧱 FORMAT DE RÉPONSE (HTML UNIQUEMENT)
Réponds toujours en HTML bien structuré, sans CSS ni script, avec :

- Un court résumé au début dans un paragraphe :
  <p><strong>Résumé :</strong> …</p>

- Ensuite des sections claires avec des titres :
  <h3>Base légale</h3>
  Explique les textes applicables (Constitution, codes, lois, OHADA).

  <h3>Explications</h3>
  Explique la règle de droit, les conditions, les éléments constitutifs, les obligations et les droits de chaque partie.

  <h3>Application au cas concret</h3>
  Applique la règle à la situation décrite dans la question.

  <h3>Recours et démarches possibles</h3>
  Indique les actions concrètes que la personne peut entreprendre :
  - <ul><li>Plainte au parquet / OPJ</li><li>Saisine du tribunal compétent</li><li>Recours hiérarchiques ou administratifs</li><li>Consultation d’un avocat ou d’un défenseur judiciaire</li></ul>

Utilise :
- <strong> pour les termes importants, les mots-clés et les références d’articles,
- <ul> et <li> pour lister clairement les options, conditions ou étapes,
- <br/> avec modération pour aérer.

⚖️ TON & ATTITUDE
- Garde un ton calme, respectueux, bienveillant et professionnel, comme un avocat congolais expérimenté qui explique à un client.
- Sois pédagogique : vulgarise sans déformer la règle de droit.
- Préviens lorsque la question touche à des domaines sensibles (violences sexuelles, mineurs, santé, sécurité…).

🚨 LIMITES & PRUDENCE
- Si la situation nécessite absolument l’intervention d’un avocat, d’un notaire, d’un huissier ou d’un magistrat, indique-le clairement.
- Si tu n’as pas assez d’informations dans les documents fournis, dis-le et invite l’utilisateur à préciser sa question ou à consulter un professionnel.
- Ne donne jamais de conseil pour contourner la loi ou organiser une fraude.
      `,
    };

    // 🧠 Historique complet de la conversation
    const chatHistory = [
      {
        role: 'system',
        content: systemPrompt[lang] || systemPrompt['fr'],
      },
      {
        role: 'user',
        content: `Voici des extraits de documents juridiques pertinents (droit congolais) :\n${context}`,
      },
      // On garde les 6 derniers messages pour le contexte conversationnel
      ...messages.slice(-6).map((msg) => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
    ];

    // 4️⃣ Appel au modèle de chat
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // tu peux remplacer par "gpt-4o-mini" si tu veux harmoniser avec le vocal
      messages: chatHistory,
      temperature: 0.3,
      max_tokens: 800,
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() || '❌ Réponse vide.';

    res.json({ answer });
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 API DroitGPT en ligne sur http://localhost:${port}`);
});
