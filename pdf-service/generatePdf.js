// 📄 pdf-service/generatePdf.js
import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai'; // Compatible avec openai@5.1.1

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', async (req, res) => {
  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Type et données requises.' });
  }

  try {
    const prompt = `
Tu es un avocat congolais expert en rédaction juridique professionnelle.

Rédige un document juridique complet et détaillé de type : "${type}".
✅ Le document doit :
- être structuré comme un vrai document d’avocat
- contenir des clauses précises et bien formulées
- inclure toutes les informations pertinentes données
- être écrit avec un langage juridique clair et complet
- inclure une version équivalente en anglais à la fin

Voici les données à intégrer :
${JSON.stringify(data, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Tu es un avocat congolais spécialisé en rédaction juridique. Ton style est rigoureux, formel, sans fautes, et très détaillé.',
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=document-${type}.pdf`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // En-tête simple
    doc.fontSize(14).text(`Document juridique – ${type}`, { align: 'center' });
    doc.moveDown();

    // Contenu principal
    doc.fontSize(12).font('Times-Roman').text(outputText, {
      align: 'justify',
      lineGap: 4,
    });

    // Clause de signature
    doc.moveDown(4);
    doc.fontSize(11).text(`Fait à Kinshasa, le ${today}`, { align: 'left' });
    doc.text(`Signature : ____________________`, { align: 'left' });

    doc.end();
  } catch (err) {
    console.error('❌ Erreur génération de document :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
