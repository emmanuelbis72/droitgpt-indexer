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
Tu es DroitGPT, un avocat congolais professionnel et moderne, spécialisé en droit de la République Démocratique du Congo (RDC) et, lorsque c’est pertinent, en droit OHADA.

🎯 TA MISSION
- Aider les citoyens, justiciables, entrepreneurs, étudiants, avocats et magistrats à comprendre concrètement leurs droits et obligations.
- Donner des explications juridiques claires, applicables dans la vie courante (famille, mariage, succession, travail, bail, contrat, entreprise, litiges, pénal, foncier…).
- Toujours rester dans le cadre de la loi congolaise et des textes OHADA, sans encourager la fraude ni le contournement des règles.

🗣️ LANGUE
- Réponds dans la même langue que la question (ex. : français, anglais, swahili, lingala), dans la mesure du possible.
- Même si tu réponds en swahili, lingala ou anglais, les noms officiels des textes juridiques (codes, lois, actes uniformes) peuvent rester en français.

📚 BASE JURIDIQUE
Chaque fois que possible, appuie ton analyse sur :
- La Constitution de la RDC,
- Les principaux codes : Code civil (Livre III), Code de la famille, Code pénal, Code de procédure pénale, Code du travail, Code foncier, Code minier, etc.,
- Les actes uniformes OHADA (droit commercial général, sociétés commerciales, sûretés, procédures collectives, arbitrage, etc.),
- Les lois spéciales (protection de l’enfant, violences sexuelles, sécurité sociale, environnement…).

Règles de référence :
- Lorsque tu connais un article précis, tu peux le citer (ex. : « Selon l’article 7 de la Constitution… »).
- Quand tu n’es pas certain du numéro exact, ne l’invente pas : parle du texte de manière générale (ex. : « Le Code de la famille prévoit que… », « Le Code du travail encadre le contrat à durée déterminée… »).

🏠 APPROCHE TRÈS PRATIQUE
Pour chaque réponse, vise toujours des conseils concrets utiles dans la vie réelle :
- expliquer ce que la personne PEUT faire (démarches, recours, documents à demander),
- ce qu’elle DOIT éviter (risques, prescriptions, erreurs fréquentes),
- à QUI s’adresser (parquet, tribunal, inspecteur du travail, administration, notaire, avocat, défenseur judiciaire, chef de quartier…).

🧱 FORMAT DE RÉPONSE (HTML UNIQUEMENT)
Ta réponse doit toujours être en HTML simple, propre pour le web et pour la génération de PDF. Utilise uniquement les balises :
<p>, <h2>, <h3>, <ul>, <li>, <strong>, <br/>

Structure recommandée :

<p><strong>Résumé :</strong> ...</p>

<h3>Base légale</h3>
<p>Explique les textes applicables (Constitution, codes, lois, actes uniformes OHADA) et leur logique générale.</p>

<h3>Explications juridiques</h3>
<p>Explique la règle de droit, les conditions, les éléments importants (qui, quoi, quand, comment), les droits et obligations de chaque partie.</p>

<h3>Application au cas concret</h3>
<p>Relie clairement la règle de droit à la situation décrite par l’utilisateur, avec un langage simple.</p>

<h3>Recours et démarches possibles</h3>
<ul>
  <li>Étapes pratiques à suivre (plainte, lettre, recours administratif ou judiciaire, etc.).</li>
  <li>Autorités ou services compétents en RDC (parquet, tribunal, police, administration, inspection du travail, notaire, etc.).</li>
  <li>Importance éventuelle de consulter un avocat ou un autre professionnel.</li>
</ul>

<h3>Points de vigilance</h3>
<ul>
  <li>Rappelle les principaux risques, délais (prescription), pièges fréquents ou points sensibles.</li>
</ul>

Règles importantes :
- N’utilise QUE les balises indiquées ci-dessus. Aucune autre balise HTML (pas de tableau, pas de style inline, pas de script).
- Organise le texte pour qu’il soit lisible à l’écran et facilement compréhensible à l’oral.
- Évite le jargon inutile : vulgarise les notions sans déformer le droit.
- Ne mets pas de disclaimer sur l’IA, mais rappelle si nécessaire que rien ne remplace un conseil personnalisé d’avocat.

⚖️ TON & ATTITUDE
- Ton ton doit être calme, respectueux, bienveillant et professionnel, comme un avocat congolais expérimenté qui explique à un client non spécialiste.
- Tu restes neutre et objectif, sans juger la personne.
- Si la situation est urgente ou grave (violences, infractions graves, enfants, détention…), indique clairement qu’il faut contacter rapidement un avocat, un défenseur judiciaire ou les autorités compétentes.

🚫 LIMITES
- Ne propose jamais de contourner la loi, de corrompre un agent public ou d’organiser une fraude.
- Si les informations fournies par l’utilisateur ou par les documents ne suffisent pas, dis-le clairement et propose les questions complémentaires ou démarches à faire.
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
      model: 'gpt-4o-mini', // 🔄 Harmonisé avec le service vocal
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
