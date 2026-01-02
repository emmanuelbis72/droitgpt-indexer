// analyseDocument.js
// Analyse PDF/DOCX + OCR images (prétraitement + correction IA + confiance)

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");

const upload = multer({ dest: "uploads/" });

async function extractTextFromPdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || "";
}

function isImageExt(ext) {
  return [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"].includes(ext);
}

/**
 * ✅ Prétraitement scanner-like:
 * - rotation auto
 * - gris
 * - contraste + normalisation
 * - resize (améliore OCR)
 * - threshold (binarisation)
 */
async function preprocessImageToPng(inputPath) {
  const outPath = inputPath + "_pre.png";
  await sharp(inputPath)
    .rotate()
    .grayscale()
    .normalize()
    .linear(1.25, -10)
    .resize({ width: 2000, withoutEnlargement: true })
    .threshold(175) // très bon pour cahier/lignes; ajuste 165-190 si besoin
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  return outPath;
}

/**
 * Score "qualité OCR" (0..1) basé sur lettres/mots.
 */
function ocrQualityScore(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const total = t.length || 1;
  const words = (t.match(/\b[\wÀ-ÖØ-öø-ÿ]{2,}\b/g) || []).length;
  const letterRatio = letters / total; // 0..1
  const wordScore = Math.min(words / 50, 1); // 0..1
  return 0.7 * letterRatio + 0.3 * wordScore;
}

/**
 * OCR Tesseract + retour (text, tesseractConfidence)
 */
async function ocrImage(filePath, lang, psm = 6) {
  const { data } = await Tesseract.recognize(filePath, lang, {
    logger: () => {},
    // paramètres utiles
    tessedit_pageseg_mode: String(psm),
    user_defined_dpi: "300",
    preserve_interword_spaces: "1",
  });

  const text = (data && data.text) ? data.text : "";
  const tessConf = Number.isFinite(data?.confidence) ? data.confidence : null; // 0..100 (peut être null)
  return { text, tessConf };
}

/**
 * ✅ Correction IA contrôlée (sans invention).
 * - corrige erreurs évidentes
 * - si illisible: [ILLISIBLE]
 */
async function cleanOcrWithAI(openai, rawText) {
  const t = String(rawText || "").trim();
  if (!t) return t;

  const completion = await openai.chat.completions.create({
    model: process.env.OCR_CLEAN_MODEL || "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 1600,
    messages: [
      {
        role: "system",
        content:
          "Tu es un correcteur OCR juridique. Règles strictes: " +
          "(1) ne pas inventer du contenu absent, " +
          "(2) si un passage est illisible, le laisser tel quel ou écrire [ILLISIBLE], " +
          "(3) conserver dates, numéros, noms, ponctuation autant que possible, " +
          "(4) produire uniquement du texte brut, sans HTML.",
      },
      {
        role: "user",
        content:
          "Corrige ce texte OCR en français (parfois anglais). Ne rajoute aucune information.\n\n" +
          "TEXTE OCR:\n" +
          t.slice(0, 12000),
      },
    ],
  });

  return completion.choices?.[0]?.message?.content?.trim() || t;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Confidence (%) par page:
 * - combine tesseract confidence (si dispo) + notre score qualité
 */
function computeConfidencePercent(text, tessConf) {
  const q = ocrQualityScore(text); // 0..1
  const t = Number.isFinite(tessConf) ? clamp(tessConf / 100, 0, 1) : null;

  // si Tesseract ne donne pas de confidence fiable, on se base sur q
  const combined = t === null ? q : (0.75 * t + 0.25 * q);
  return Math.round(clamp(combined, 0, 1) * 100);
}

module.exports = function (openai) {
  const router = express.Router();

  /**
   * POST /analyse-document
   * FormData:
   * - file
   * - useOcr: "1" | "0"
   * - ocrLang: "fra+eng"
   * - useOcrPreprocess: "1" | "0"   ✅
   * - useOcrCleanup: "1" | "0"      ✅
   */
  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier envoyé." });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    const useOcr = String(req.body?.useOcr || "0") === "1";
    const ocrLang = String(req.body?.ocrLang || process.env.OCR_LANG || "fra+eng");

    // ✅ options demandées
    const useOcrPreprocess = String(req.body?.useOcrPreprocess || "1") === "1";
    const useOcrCleanup = String(req.body?.useOcrCleanup || "1") === "1";

    let prePath = null;

    try {
      let text = "";
      let ocrUsed = false;
      let ocrConfidence = null;

      if (ext === ".pdf") {
        text = await extractTextFromPdf(filePath);

        // PDF scanné: stable => on demande images
        if (useOcr && (!text || text.trim().length < 80)) {
          return res.status(422).json({
            error: "PDF scanné détecté",
            details:
              "Ce PDF semble être un scan (image). Exportez les pages en images (JPG/PNG) ou prenez des photos, puis uploadez en mode OCR multi-images.",
          });
        }
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || "";
      } else if (isImageExt(ext)) {
        ocrUsed = true;

        // ✅ prétraitement
        const inputForOcr = useOcrPreprocess ? await preprocessImageToPng(filePath) : filePath;
        if (useOcrPreprocess) prePath = inputForOcr;

        // OCR passe 1 (psm 6)
        let { text: ocr1, tessConf: conf1 } = await ocrImage(inputForOcr, ocrLang, 6);
        let c1 = computeConfidencePercent(ocr1, conf1);

        // OCR passe 2 si faible (psm 4)
        if (c1 < 45) {
          const { text: ocr2, tessConf: conf2 } = await ocrImage(inputForOcr, ocrLang, 4);
          const c2 = computeConfidencePercent(ocr2, conf2);
          if (c2 > c1) {
            ocr1 = ocr2;
            conf1 = conf2;
            c1 = c2;
          }
        }

        text = ocr1 || "";
        ocrConfidence = computeConfidencePercent(text, conf1);

        // ✅ correction IA contrôlée (si texte non vide)
        if (useOcrCleanup && text.trim().length > 20) {
          const cleaned = await cleanOcrWithAI(openai, text);

          // la correction IA peut améliorer la lisibilité; on augmente légèrement la confiance si elle est déjà décente
          if (cleaned && cleaned.trim().length > 20) {
            text = cleaned;
            ocrConfidence = clamp(ocrConfidence + 5, 0, 100);
          }
        }
      } else {
        return res.status(400).json({
          error: "Format non supporté.",
          details: "Formats acceptés: PDF, DOCX, JPG/PNG/WEBP/TIFF/BMP.",
        });
      }

      if (!text || text.trim().length < 50) {
        throw new Error(
          "Texte trop court/illisible après extraction/OCR. Conseil: meilleure lumière, zoom, page à plat."
        );
      }

      const shortText = text.slice(0, 12000);

      const completion = await openai.chat.completions.create({
        model: process.env.ANALYSE_MODEL || "gpt-4o-mini",
        temperature: Number(process.env.ANALYSE_TEMPERATURE || 0.3),
        max_tokens: Number(process.env.ANALYSE_MAX_TOKENS || 1400),
        messages: [
          {
            role: "system",
            content:
              "Tu es un juriste congolais expérimenté (RDC + OHADA si pertinent). " +
              "Réponds en HTML simple et clair, professionnel. N'invente pas des articles/numéros incertains.",
          },
          {
            role: "user",
            content: `
Analyse le texte suivant (issu d'un document). Réponds STRICTEMENT en HTML avec seulement : <p>, <h2>, <h3>, <ul>, <li>, <strong>.

<h2>Texte OCR extrait</h2>
<p>Reprends fidèlement les éléments principaux du texte (sans inventer).</p>

<h2>Résumé des points juridiques clés</h2>
<p>...</p>

<h3>Analyse</h3>
<ul><li>...</li></ul>

<h3>Risques</h3>
<ul><li>...</li></ul>

<h3>Recommandations</h3>
<ul><li>...</li></ul>

<h3>Conclusion</h3>
<p>...</p>

Texte:
"""${shortText}"""
`.trim(),
          },
        ],
      });

      const finalAnswer = completion.choices?.[0]?.message?.content || "<p>❌ Analyse vide.</p>";

      return res.json({
        analysis: finalAnswer,
        documentText: shortText,
        ocrUsed,
        ocrConfidence, // ✅ % par page
        ocrOptions: {
          useOcrPreprocess,
          useOcrCleanup,
          ocrLang,
        },
      });
    } catch (err) {
      console.error("❌ Erreur analyse :", err.message);
      return res.status(500).json({ error: "Erreur analyse", details: err.message || "Inconnue" });
    } finally {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (prePath && fs.existsSync(prePath)) fs.unlinkSync(prePath);
      } catch {}
    }
  });

  return router;
};
