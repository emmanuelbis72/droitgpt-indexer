import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai';
import { Document, Packer, Paragraph, TextRun } from 'docx';

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
- Un en-tête formel
- Des sections bien structurées
- Des titres et sous-titres en gras
- Une clause de signature avec date et lieu
- Une version anglaise équivalente à la fin

Voici les données à insérer :
${JSON.stringify(data, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Tu es un avocat congolais expérimenté en rédaction juridique bilingue (FR/EN). Tu produis des documents soignés, bien formatés, avec un ton professionnel.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const outputText = completion.choices[0]?.message?.content?.trim();

    if (!outputText) {
      return res.status(500).json({ error: 'Réponse vide de l’IA.' });
    }

    // --- Format PDF ---
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=document-${type}.pdf`);

      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      doc.fontSize(18).text('CABINET JURIDIQUE – DROIT CONGOLAIS', { align: 'center', underline: true });
      doc.moveDown();
      doc.fontSize(14).text(`📄 Document : ${type}`, { align: 'center' });
      doc.moveDown(2);

      doc.font('Times-Roman').fontSize(12).text(outputText, {
        align: 'justify',
      });

      doc.moveDown(4);
      doc.text(`Fait à Kinshasa, le ${new Date().toLocaleDateString('fr-FR')}`, {
        align: 'right',
      });
      doc.text(`Signature : ____________________`, { align: 'right' });

      doc.end();
    }

    // --- Format Word (.docx) ---
    else if (format === 'docx') {
      const paragraphs = outputText
        .split('\n')
        .filter(line => line.trim())
        .map(line =>
          new Paragraph({
            children: [new TextRun({ text: line.trim(), break: 1 })],
          })
        );

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'CABINET JURIDIQUE – DROIT CONGOLAIS',
                    bold: true,
                    size: 28,
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
                  new TextRun(`Fait à Kinshasa, le ${new Date().toLocaleDateString('fr-FR')}`),
                ],
              }),
              new Paragraph({
                alignment: 'right',
                children: [new TextRun('Signature : ____________________')],
              }),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=document-${type}.docx`
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.send(buffer);
    }

    // --- Format non pris en charge ---
    else {
      return res.status(400).json({ error: 'Format non supporté. Utilisez "pdf" ou "docx".' });
    }
  } catch (err) {
    console.error('❌ Erreur génération de document :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
