import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai'; // ✅ Compatible avec openai@5.1.1

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/generate-pdf', async (req, res) => {
  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Type et données requises.' });
  }

  try {
    const prompt = `Rédige un document juridique de type "${type}" conforme aux normes professionnelles d’un avocat congolais.
Inclure :
- Un en-tête formel et juridiquement valable
- Des sections claires, structurées et titrées
- Une clause de signature avec date et lieu
- Une version équivalente en anglais à la fin

Voici les données à insérer :
${JSON.stringify(data, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Tu es un avocat congolais expérimenté. Tu rédiges des documents juridiques bilingues (FR/EN) avec style, rigueur et exactitude.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1800,
    });

    const outputText = completion.choices[0]?.message?.content?.trim();
    if (!outputText) {
      return res.status(500).json({ error: 'Réponse vide de l’IA.' });
    }

    const today = new Date().toLocaleDateString('fr-FR');

    // === Génération PDF ===
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=document-${type}.pdf`);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Document Juridique – ${type}`,
        Author: 'DroitGPT – www.droitgpt.com',
      },
    });

    doc.pipe(res);

    // En-tête
    doc
      .fontSize(16)
      .fillColor('#1a1a1a')
      .font('Helvetica-Bold')
      .text('CABINET JURIDIQUE – DROIT CONGOLAIS', { align: 'center' })
      .moveDown(0.5)
      .fontSize(12)
      .font('Helvetica')
      .text('www.droitgpt.com – Assistance Juridique Intelligente', { align: 'center' })
      .moveDown(1);

    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor('#444444')
      .lineWidth(1)
      .stroke()
      .moveDown(1);

    // Titre du document
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(`📄 Document généré : ${type.toUpperCase()}`, {
        align: 'left',
        underline: true,
      })
      .moveDown(1);

    // Contenu généré
    doc
      .font('Times-Roman')
      .fontSize(12)
      .fillColor('black')
      .text(outputText, {
        align: 'justify',
        lineGap: 5,
      });

    // Signature
    doc.moveDown(3);
    doc
      .fontSize(11)
      .text(`Fait à Kinshasa, le ${today}`, { align: 'right' })
      .text(`Signature : ____________________`, { align: 'right' });

    doc.end();
  } catch (err) {
    console.error('❌ Erreur génération de document :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
