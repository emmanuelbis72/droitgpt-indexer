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

    pdfParser.on("pdfParser_dataError", err => reject(err.parserError || new Error("Erreur lecture PDF")));

    pdfParser.on("pdfParser_dataReady", pdfData => {
      try {
        const pages = pdfData?.formImage?.Pages;
        if (!pages || !Array.isArray(pages)) {
          return reject(new Error("Ce fichier PDF ne contient aucun texte détectable. Il s'agit peut-être d'un scan ou d'une image."));
        }

        const text = pages.flatMap(page =>
          page.Texts.map(t => decodeURIComponent(t.R[0].T))
        ).join(" ");

        if (!text.trim()) {
          return reject(new Error("Ce fichier PDF est vide ou ne contient pas de texte lisible."));
        }

        resolve(text);
      } catch (err) {
        reject(new Error("Erreur lors du traitement du fichier PDF"));
      }
    });

    pdfParser.loadPDF(filePath);
  });
}

export default function (openai) {
  const router = express.Router();

  router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
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
        return res.status(400).json({ error: 'Format non supporté. Utilisez un fichier PDF ou DOCX.' });
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

      res.json({ analysis: completion.choices[0].message.content });
    } catch (err) {
      console.error('❌ Erreur analyse :', err.message);
      res.status(500).json({ error: 'Erreur analyse', details: err.message });
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  return router;
}
