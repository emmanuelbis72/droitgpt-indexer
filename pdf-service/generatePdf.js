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
    return res.status(400).json({ error: 'Le titre et le contenu sont requis.' });
  }

  try {
    // 🧠 Prompt pour OpenAI avec le contenu obligatoire
    const prompt = `
Tu es un avocat congolais expert en rédaction juridique.

Rédige un document juridique professionnel et complet ayant pour **titre** :
"${title}"

Le document doit :
- respecter les normes juridiques congolaises
- être structuré et formel
- contenir obligatoirement les informations suivantes : "${content}"
- inclure toutes les clauses et formulations nécessaires au type de document

Le style doit être : rigoureux, clair, sans fautes, professionnel et uniquement en français.
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Tu es un avocat congolais spécialisé en rédaction juridique. Tu rédiges des documents très structurés, précis, et conformes à la loi congolaise.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const outputText = completion.choices[0]?.message?.content?.trim();
    if (!outputText) {
      return res.status(500).json({ error: 'Réponse vide de l’IA.' });
    }

    const today = new Date().toLocaleDateString('fr-FR');

    // 📄 Génération PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${title.replace(/\s+/g, '_')}.pdf`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
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
    console.error('❌ Erreur génération :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
