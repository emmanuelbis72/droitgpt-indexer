// analyseDocument.js
// Route d'analyse de documents (PDF / DOCX) pour DroitGPT

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse"); // ✅ en CommonJS

// Dossier temporaire pour les uploads
const upload = multer({ dest: "uploads/" });

// Extraction texte PDF
async function extractTextFromPdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || "";
}

module.exports = function (openai) {
  const router = express.Router();

  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
      console.error("❌ Aucun fichier reçu");
      return res.status(400).json({ error: "Aucun fichier envoyé." });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    try {
      let text = "";

      if (ext === ".pdf") {
        text = await extractTextFromPdf(filePath);
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || "";
      } else {
        console.error("❌ Format non supporté :", ext);
        return res
          .status(400)
          .json({ error: "Format non supporté. PDF ou DOCX requis." });
      }

      if (!text || text.length < 50) {
        throw new Error("Texte trop court ou vide après extraction.");
      }

      // On limite la taille pour éviter d'exploser le contexte du modèle
      const shortText = text.slice(0, 8000);

      const prompt = `
Tu es un juriste congolais spécialisé dans l'analyse de documents juridiques (droit de la RDC).

Analyse le document suivant et fournis :
- Un résumé des points juridiques clés
- Une évaluation des clauses principales
- Les principaux risques ou zones d'attention
- Des recommandations éventuelles pour la personne qui te consulte

Document :
"""${shortText}"""
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1200,
      });

      const finalAnswer = completion.choices[0].message.content;

      // ✅ On renvoie aussi le texte du document
      //    pour permettre le "chat avec ce document" côté frontend
      res.json({
        analysis: finalAnswer,
        documentText: shortText,
      });
    } catch (err) {
      console.error("❌ Erreur analyse :", err.message);
      res
        .status(500)
        .json({ error: "Erreur analyse", details: err.message || "Inconnue" });
    } finally {
      // On nettoie le fichier temporaire
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  return router;
};
