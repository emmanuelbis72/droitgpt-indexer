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

      // 🧠 Prompt + system améliorés
      const userPrompt = `
Le texte ci-dessous est un document juridique (contrat, lettre, décision, acte, etc.).
Tu dois l’analyser et produire un avis structuré, pédagogique et applicable au contexte congolais.

Document à analyser :
"""${shortText}"""
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu es un juriste congolais expérimenté, spécialisé dans l'analyse de contrats, décisions et actes juridiques. " +
              "Tu raisonnes selon le droit applicable en République Démocratique du Congo et, lorsque pertinent, le droit OHADA. " +
              "Tu expliques de façon claire, structurée et moderne, sans langage trop technique, mais en restant professionnel. " +
              "Lorsque c'est utile, tu fais des références générales aux textes (Code de la famille, Code du travail, Code pénal, Actes uniformes OHADA, etc.) " +
              "sans inventer de numéros d’articles que tu ne connais pas avec certitude. " +
              "Ta réponse doit obligatoirement être en HTML simple, adaptée à l’affichage dans une interface web et à la conversion en PDF.",
          },
          {
            role: "user",
            content: `
Analyse le document transmis et réponds en suivant STRICTEMENT le gabarit HTML ci-dessous :

<h2>Résumé des points juridiques clés</h2>
<p>Paragraphe(s) expliquant de manière synthétique l'objet du document, les parties concernées et les éléments principaux.</p>

<h3>Analyse des clauses et effets juridiques</h3>
<ul>
  <li><strong>Clause ou point important 1 :</strong> explication simple et impact pour la personne qui consulte.</li>
  <li><strong>Clause ou point important 2 :</strong> explication, conséquences juridiques possibles.</li>
</ul>

<h3>Risques et zones d'attention</h3>
<ul>
  <li>Risque 1 avec, si possible, référence générale au cadre légal congolais ou OHADA concerné.</li>
  <li>Risque 2, autres points de vigilance pratiques.</li>
</ul>

<h3>Recommandations pratiques</h3>
<ul>
  <li>Conseils concrets sur ce qu'il est conseillé de faire (négocier, modifier une clause, demander un écrit, consulter un avocat, etc.).</li>
</ul>

<h3>Conclusion</h3>
<p>Conclusion courte rappelant l'essentiel et la prudence à avoir.</p>

Règles importantes :
- Utilise uniquement les balises HTML suivantes : <p>, <h2>, <h3>, <ul>, <li>, <strong>.
- Rédige en français clair, avec des phrases plutôt courtes, compréhensibles même à l’oral.
- Ne génère AUCUN autre type de balise HTML (pas de tableaux, pas de styles inline, pas de <br> en série).
- Ne mets pas de disclaimer technique sur l’IA ; concentre-toi sur l’analyse juridique et les conseils pratiques.
- N’écris rien en dehors de cette structure HTML.
`,
          },
        ],
        temperature: 0.3,
        max_tokens: 1400,
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
