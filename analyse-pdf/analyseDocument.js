// analyseDocument.js
// Analyse PDF/DOCX + OCR images
// ✅ Optimisé vitesse : 1 variante preprocess, cleanup IA uniquement si confiance < 60, resize plus léger

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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function ocrQualityScore(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const total = t.length || 1;
  const words = (t.match(/\b[\wÀ-ÖØ-öø-ÿ]{2,}\b/g) || []).length;
  const letterRatio = letters / total;
  const wordScore = Math.min(words / 50, 1);
  return 0.7 * letterRatio + 0.3 * wordScore;
}

function computeConfidencePercent(text, tessConf) {
  const q = ocrQualityScore(text);
  const t = Number.isFinite(tessConf) ? clamp(tessConf / 100, 0, 1) : null;
  const combined = t === null ? q : 0.75 * t + 0.25 * q;
  return Math.round(clamp(combined, 0, 1) * 100);
}

async function ocrImage(filePath, lang, psm = 6) {
  const { data } = await Tesseract.recognize(filePath, lang, {
    logger: () => {},
    tessedit_pageseg_mode: String(psm),
    user_defined_dpi: "300",
    preserve_interword_spaces: "1",
  });

  const text = data?.text ? data.text : "";
  const tessConf = Number.isFinite(data?.confidence) ? data.confidence : null;
  return { text, tessConf };
}

// ✅ Prétraitement "soft" unique (plus rapide)
async function preprocessSoft(inputPath) {
  const outPath = inputPath + "_soft.png";

  let img = sharp(inputPath).rotate().grayscale().normalize();
  img = img.linear(1.12, -6).sharpen();

  // ✅ plus léger que 3000 (gain temps)
  img = img.resize({ width: 2200, withoutEnlargement: true });

  await img.png({ compressionLevel: 9 }).toFile(outPath);
  return outPath;
}

// ✅ OCR Vision OpenAI (fallback) : transcrit fidèlement sans inventer
async function visionOcrWithOpenAI(openai, imagePath) {
  const b64 = fs.readFileSync(imagePath, { encoding: "base64" });
  const dataUrl = `data:image/png;base64,${b64}`;

  const resp = await openai.chat.completions.create({
    model: process.env.OCR_VISION_MODEL || "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content:
          "Tu es un OCR juridique très strict. Règles: " +
          "1) Transcris fidèlement le texte visible. " +
          "2) N’invente rien. " +
          "3) Respecte la ponctuation et les retours à la ligne. " +
          "4) Si une partie est illisible, écris [ILLISIBLE]. " +
          "5) Retourne uniquement du texte brut.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcris exactement le texte présent sur cette page scannée." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return resp.choices?.[0]?.message?.content?.trim() || "";
}

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

module.exports = function (openai) {
  const router = express.Router();

  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier envoyé." });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    const useOcr = String(req.body?.useOcr || "0") === "1";
    const ocrLang = String(req.body?.ocrLang || process.env.OCR_LANG || "fra+eng");
    const useOcrPreprocess = String(req.body?.useOcrPreprocess || "1") === "1";
    const useOcrCleanup = String(req.body?.useOcrCleanup || "1") === "1";

    let tempPaths = [];

    try {
      let text = "";
      let ocrUsed = false;
      let ocrConfidence = null;
      let ocrEngine = null; // "tesseract" | "vision"

      if (ext === ".pdf") {
        text = await extractTextFromPdf(filePath);

        if (useOcr && (!text || text.trim().length < 80)) {
          return res.status(422).json({
            error: "PDF scanné détecté",
            scannedPdf: true,
            details: "Ce PDF semble être un scan (image). Conversion des pages en images requise pour OCR.",
          });
        }
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || "";
      } else if (isImageExt(ext)) {
        ocrUsed = true;

        // 1) OCR Tesseract (soft preprocess only)
        let bestPathForOcr = filePath;

        if (useOcrPreprocess) {
          const softPath = await preprocessSoft(filePath);
          tempPaths.push(softPath);
          bestPathForOcr = softPath;
        }

        const r1 = await ocrImage(bestPathForOcr, ocrLang, 6);
        let rawOcrText = r1.text || "";
        let confPct = computeConfidencePercent(rawOcrText, r1.tessConf);

        // 2) fallback PSM4 uniquement si vraiment mauvais
        if (confPct < 35 && rawOcrText.trim().length < 80) {
          const rAlt = await ocrImage(bestPathForOcr, ocrLang, 4);
          const cAlt = computeConfidencePercent(rAlt.text, rAlt.tessConf);
          const lenA = rawOcrText.trim().length;
          const lenB = (rAlt.text || "").trim().length;

          if (cAlt > confPct || lenB > lenA + 80) {
            rawOcrText = rAlt.text || "";
            confPct = cAlt;
          }
        }

        ocrEngine = "tesseract";
        text = rawOcrText;
        ocrConfidence = confPct;

        // 3) Fallback Vision si toujours trop court
        const allowVision = (process.env.OCR_VISION_FALLBACK || "1") === "1";
        if (allowVision && (!text || text.trim().length < 80)) {
          const visionText = await visionOcrWithOpenAI(openai, bestPathForOcr);
          if (visionText && visionText.trim().length >= 40) {
            text = visionText;
            ocrEngine = "vision";
            ocrConfidence = Math.max(ocrConfidence || 0, Math.round(40 + ocrQualityScore(text) * 60));
          }
        }

        // 4) Correction IA contrôlée uniquement si confiance < 60
        if (useOcrCleanup && text.trim().length > 20 && Number.isFinite(ocrConfidence) && ocrConfidence < 60) {
          const cleaned = await cleanOcrWithAI(openai, text);
          if (cleaned && cleaned.trim().length > 20) {
            text = cleaned;
            ocrConfidence = clamp((ocrConfidence || 0) + 5, 0, 100);
          }
        }
      } else {
        return res.status(400).json({
          error: "Format non supporté.",
          details: "Formats acceptés: PDF, DOCX, JPG/PNG/WEBP/TIFF/BMP.",
        });
      }

      const minLen = 50;
      if (!text || text.trim().length < minLen) {
        return res.status(500).json({
          error: "Erreur analyse",
          details: "Texte trop court/illisible après extraction/OCR. Conseil: meilleure lumière, zoom, page à plat.",
          debug: { len: (text || "").trim().length, engine: ocrEngine, confidence: ocrConfidence },
        });
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
        ocrConfidence,
        ocrEngine,
        ocrOptions: { useOcrPreprocess, useOcrCleanup, ocrLang },
      });
    } catch (err) {
      console.error("❌ Erreur analyse :", err.message);
      return res.status(500).json({ error: "Erreur analyse", details: err.message || "Inconnue" });
    } finally {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (Array.isArray(tempPaths) && tempPaths.length) {
          tempPaths.forEach((p) => {
            try {
              if (p && fs.existsSync(p)) fs.unlinkSync(p);
            } catch {}
          });
        }
      } catch {}
    }
  });

  return router;
};
