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
    const prompt = `Rédige un document juridique de type "${type}" conforme aux standards professionnels d’un avocat congolais.

📝 Données à intégrer : 
${JSON.stringify(data, null, 2)}

📌 Format attendu :
1. En-tête formel
2. Paragraphes bien structurés
3. Titres et sous-titres en gras
4. Signature et date en bas du document
5. Une traduction anglaise équivalente à la fin`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'Tu es un avocat congolais expert en rédaction juridique bilingue (FR/EN). Génère des documents professionnels, bien présentés, dans un style clair et structuré.',
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

    if (!outputText || outputText.length < 100) {
      return res.status(500).json({
        error: 'Réponse insuffisante ou vide de l’IA.',
      });
    }

    const now = new Date().toLocaleDateString('fr-FR');

    // === Format PDF ===
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
      doc.fontSize(14).text(`📄 Document généré : ${type}`, { align: 'center' });
      doc.moveDown(2);

      doc.font('Times-Roman').fontSize(12).text(outputText, {
        align: 'justify',
      });

      doc.moveDown(4);
      doc.text(`Fait à Kinshasa, le ${now}`, { align: 'right' });
      doc.text('Signature : ____________________', { align: 'right' });

      doc.end();
    }

    // === Format DOCX ===
    else if (format === 'docx') {
      const formattedParagraphs = outputText
        .split('\n')
        .filter(line => line.trim())
        .map(line =>
          new Paragraph({
            children: [
              new TextRun({
                text: line.trim(),
                break: 1,
              }),
            ],
            spacing: { after: 200 },
          })
        );

      const wordDoc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                alignment: 'center',
                children: [
                  new TextRun({
                    text: 'CABINET JURIDIQUE – DROIT CONGOLAIS',
                    bold: true,
                    size: 28,
                  }),
                ],
              }),
              new Paragraph({}),
              ...formattedParagraphs,
              new Paragraph({}),
              new Paragraph({
                alignment: 'right',
                children: [
                  new TextRun(`Fait à Kinshasa, le ${now}`),
                ],
              }),
              new Paragraph({
                alignment: 'right',
                children: [
                  new TextRun('Signature : ____________________'),
                ],
              }),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(wordDoc);

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

    // === Format Invalide ===
    else {
      return res.status(400).json({ error: 'Format non supporté. Utilisez "pdf" ou "docx".' });
    }
  } catch (err) {
    console.error('❌ Erreur génération de document :', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
