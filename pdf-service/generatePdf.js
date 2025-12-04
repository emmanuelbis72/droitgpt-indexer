// generatePdf.js
import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res
      .status(400)
      .json({ error: 'Le titre et le contenu sont requis.' });
  }

  try {
    // 🧠 Prompt pour OpenAI avec le contenu obligatoire
    const prompt = `
Rédige un document juridique complet dont le Titre est :
"${title}"

Le document doit impérativement :
- respecter les usages et le langage du droit congolais et, lorsque pertinent, du droit OHADA ;
- être rédigé en français administratif et juridique, clair, précis et formel ;
- être structuré de manière professionnelle : préambule, identification des parties, définitions éventuelles, articles numérotés (ARTICLE 1, ARTICLE 2, etc.), clauses finales (durée, résiliation, juridiction compétente, droit applicable, dispositions diverses) ;
- intégrer de façon cohérente les informations suivantes, considérées comme des instructions factuelles à insérer dans le texte :
"${content}"
- faire, lorsque c'est utile, des références générales au cadre légal (par exemple : "conformément au Code du travail congolais", "conformément aux dispositions applicables de l’Acte uniforme OHADA"), sans inventer de numéro d’article ou de référence précise si tu n’en es pas sûr ;
- rester neutre, équilibré entre les parties, et prudent dans les formulations (clause de responsabilité, obligations réciproques, etc.) ;
- ne contenir AUCUNE balise HTML ni Markdown (pas de **, pas de #, pas de listes en tirets), uniquement du texte brut avec des sauts de ligne classiques.

Commence par un en-tête clair (par exemple "Contrat de ..." ou "Acte de ..."), puis un préambule, puis développe le document article par article ou paragraphe par paragraphe, jusqu’aux formules finales.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            "Tu es un avocat congolais expérimenté, spécialisé en rédaction de contrats, conventions, actes juridiques et correspondances administratives. " +
            "Tes documents respectent les bonnes pratiques du droit de la République Démocratique du Congo et, lorsque c'est pertinent, du droit OHADA. " +
            "Tu rédiges toujours dans un style formel, précis, sans familiarité, avec une structure claire (préambule, parties, articles numérotés, clauses finales). " +
            "Tu peux faire référence de manière générale aux textes applicables (Code civil Livre III, Code du travail, Actes uniformes OHADA, etc.) " +
            "mais tu n'inventes jamais de numéros d’articles ou de références que tu ne connais pas avec certitude. " +
            "Tu n'utilises jamais de balises HTML ni de Markdown : uniquement du texte brut, adapté à être imprimé ou intégré dans un PDF juridique.",
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1800,
    });

    const outputText =
      completion.choices?.[0]?.message?.content ||
      'Document juridique généré par DroitGPT.';

    // 🔐 Nom de fichier sécurisé pour le header HTTP
    const safeFilename =
      (title || 'document')
        .toString()
        .normalize('NFD') // sépare les accents
        .replace(/[\u0300-\u036f]/g, '') // supprime les accents
        .replace(/[^a-zA-Z0-9_-]/g, '_') // remplace tout ce qui n'est pas alphanumérique
        .slice(0, 60) || 'document';

    res.setHeader('Content-Type', 'application/pdf');
    // ⚠️ on met le nom entre guillemets + version sécurisée
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}.pdf"`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // Titre
    doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
    doc.moveDown();

    // Corps du document
    doc.font('Helvetica').fontSize(12).text(outputText, {
      align: 'justify',
      lineGap: 4,
    });

    doc.moveDown(4);
    const today = new Date().toLocaleDateString('fr-FR');
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(`Fait à Kinshasa, le ${today}`, { align: 'left' });
    doc.text(`Signature : ____________________`, { align: 'left' });

    doc.end();
  } catch (err) {
    console.error('❌ Erreur génération :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
