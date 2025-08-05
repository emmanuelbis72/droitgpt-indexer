import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import pkg from 'pdf2json';

const PDFParser = pkg;

const upload = multer({ dest: 'uploads/' });

function extractTextFromPdf(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", err => {
      console.error('❌ Erreur PDFParser :', err.parserError);
      reject(err.parserError);
    });

    pdfParser.on("pdfParser_dataReady", pdfData => {
      try {
        const text = pdfData.formImage.Pages.flatMap(page =>
          page.Texts.map(t => decodeURIComponent(t.R[0].T))
        ).join(" ");
        resolve(text);
      } catch (e) {
        console.error('❌ Erreur lors de l’extraction du texte PDF :', e.message);
        reject(e);
      }
    });

    pdfParser.loadPDF(filePath);
  });
}

export default function (openai) {
  const router = express.Router();

  router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
      console.error('❌ Aucun fichier reçu');
      return res.status(400).json({ error: 'Aucun fichier envoyé.' });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    try {
      let text = '';

      if (ext === '.pdf') {
        text = await extractTextFromPdf(filePath);
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || '';
      } else {
        console.error('❌ Format de fichier non pris en charge');
        return res.status(400).json({ error: 'Format non supporté. PDF ou DOCX requis.' });
      }

      console.log('📝 Texte extrait (début) :', text.slice(0, 500));
      if (!text || text.length < 50) {
        throw new Error('Texte trop court ou vide après extraction.');
      }

      const prompt = `
Tu es un juriste congolais spécialisé dans l'analyse de documents juridiques.

Analyse le document suivant et fournis :
- Un résumé des points juridiques clés
- Une évaluation des clauses principales
- Des recommandations éventuelles

Document :
"""${text.slice(0, 4000)}"""
      `;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1200,
      });

      const finalAnswer = completion.choices[0].message.content;
      console.log('✅ Réponse OpenAI :', finalAnswer);

      res.json({ analysis: finalAnswer });
    } catch (err) {
      console.error('❌❌ Erreur complète analyse OpenAI :', JSON.stringify(err, null, 2));
      res.status(500).json({ error: 'Erreur analyse', details: err.message });
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  return router;
}
