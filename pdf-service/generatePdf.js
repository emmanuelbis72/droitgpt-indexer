// 📄 generatePdf.js – Route de génération PDF (corrigée)
import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ✅ Chargement des variables d’environnement depuis le fichier .env local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const router = express.Router();

// ✅ Initialisation de l’API OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', async (req, res) => {
  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Type et données requises.' });
  }

  try {
    // ✅ Prompt pour GPT-4
    const prompt = `
Tu es un avocat congolais expert en rédaction juridique professionnelle.

Rédige un document juridique complet et détaillé de type : "${type}".
✅ Le document doit :
- être structuré comme un vrai document d’avocat
- contenir des clauses précises et bien formulées
- inclure toutes les informations pertinentes données
- être rédigé uniquement en français avec un langage juridique clair, rigoureux et complet

Voici les données à intégrer :
${JSON.stringify(data, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Tu es un avocat congolais spécialisé en rédaction juridique en français. Ton style est rigoureux, formel, sans fautes, et très détaillé.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const outputText = completion.choices[0]?.message?.content?.trim();
    if (!outputText) {
      return res.status(500).json({ error: 'Réponse vide de l’IA.' });
    }

    const today = new Date().toLocaleDateString('fr-FR');

    // ✅ Génération du fichier PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=document-${type}.pdf`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(14).text(`Document juridique – ${type}`, { align: 'center' });
    doc.moveDown();

    doc.font('Helvetica').fontSize(12).text(outputText, {
      align: 'justify',
      lineGap: 4,
    });

    doc.moveDown(4);
    doc.font('Helvetica').fontSize(11).text(`Fait à Kinshasa, le ${today}`, { align: 'left' });
    doc.text(`Signature : ____________________`, { align: 'left' });

    doc.end();
  } catch (err) {
    console.error('❌ Erreur génération de document :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
