import express from 'express';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import pkg from 'openai'; // ✅ Compatible avec openai@5.1.1
const OpenAI = pkg.default;

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/generate-pdf', async (req, res) => {
  const { type, data, format = 'pdf' } = req.body;

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

    // === PDF ===
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=document-${type}.pdf`);

      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      doc.fontSize(18).text('CABINET JURIDIQUE – DROIT CONGOLAIS', {
        align: 'center',
        underline: true,
      });

      doc.moveDown();
      doc.fontSize(14).text(`📄 Document : ${type}`, { align: 'center' });
      doc.moveDown(2);

      doc.font('Times-Roman').fontSize(12).text(outputText, {
        align: 'justify',
        lineGap: 5,
      });

      doc.moveDown(3);
      doc.fontSize(11).text(`Fait à Kinshasa, le ${today}`, {
        align: 'right',
      });
      doc.text('Signature : ____________________', {
        align: 'right',
      });

      doc.end();
    }

    // === DOCX ===
    else if (format === 'docx') {
      const paragraphs = outputText
        .split('\n')
        .filter(line => line.trim())
        .map(line =>
          new Paragraph({
            children: [new TextRun({ text: line.trim(), break: 1 })],
            spacing: { after: 100 },
          })
        );

      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'CABINET JURIDIQUE – DROIT CONGOLAIS',
                    bold: true,
                    size: 28,
                    underline: {},
                  }),
                ],
                alignment: 'center',
              }),
              new Paragraph({}),
              ...paragraphs,
              new Paragraph({}),
              new Paragraph({
                alignment: 'right',
                children: [
                  new TextRun(`Fait à Kinshasa, le ${today}`),
                  new TextRun({ text: '\nSignature : ____________________' }),
                ],
              }),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Disposition', `attachment; filename=document-${type}.docx`);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.send(buffer);
    }

    // === Format non reconnu ===
    else {
      return res.status(400).json({ error: 'Format non supporté. Utilisez "pdf" ou "docx".' });
    }
  } catch (err) {
    console.error('❌ Erreur génération de document :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
