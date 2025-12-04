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

Analyse le document suivant et fournis une réponse structurée et pédagogique, en faisant référence aux lois congolaises lorsqu'elles sont pertinentes (Code de la famille, Code pénal, Code du travail, OHADA, etc.).

Ta réponse doit obligatoirement être en HTML clair, selon le format suivant :

<h2>Résumé des points juridiques clés</h2>
<p>Paragraphe(s) expliquant les éléments essentiels du document.</p>

<h3>Analyse des clauses et effets juridiques</h3>
<ul>
  <li><strong>Clause X :</strong> explication simple et impact pour le client.</li>
  <li><strong>Clause Y :</strong> explication, risques, obligations.</li>
</ul>

<h3>Risques et zones d'attention</h3>
<ul>
  <li>Risque 1 avec référence aux textes juridiques congolais applicables.</li>
  <li>Risque 2, etc.</li>
</ul>

<h3>Recommandations pratiques</h3>
<ul>
  <li>Conseils concrets pour la personne qui consulte.</li>
</ul>

<h3>Conclusion</h3>
<p>Résumé final court, clair, qui rappelle les points essentiels.</p>

Règles importantes :
- Utilise des balises <p>, <h2>, <h3>, <ul>, <li>, <strong>.
- Évite les phrases trop longues, reste compréhensible à l'oral.
- N'ajoute pas d'autres balises HTML complexes (pas de tableaux, pas de CSS).
- Ne mets pas de disclaimer technique, reste focalisé sur l'analyse juridique.

Document à analyser :
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
