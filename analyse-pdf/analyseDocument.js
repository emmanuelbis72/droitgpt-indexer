// analyseDocument.js
// Analyse PDF/DOCX + OCR images
// ✅ Tesseract en 1er, ✅ fallback OpenAI Vision si texte trop court (vraie "IA" OCR)

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

// ✅ Prétraitement soft/hard
async function preprocessVariant(inputPath, variant = "soft") {
  const outPath = inputPath + (variant === "soft" ? "_soft.png" : "_hard.png");

  let img = sharp(inputPath).rotate().grayscale().normalize();
  img = img.linear(1.15, -8).sharpen();
  img = img.resize({ width: 3000, withoutEnlargement: true });

  if (variant === "hard") {
    img = img.threshold(150);
  }

  await img.png({ compressionLevel: 9 }).toFile(outPath);
  return outPath;
}

async function bestOcrFromVariants(filePath, ocrLang) {
  const softPath = await preprocessVariant(filePath, "soft");
  const hardPath = await preprocessVariant(filePath, "hard");

  const r1 = await ocrImage(softPath, ocrLang, 6);
  const c1 = computeConfidencePercent(r1.text, r1.tessConf);
  const len1 = (r1.text || "").trim().length;

  const r2 = await ocrImage(hardPath, ocrLang, 6);
  const c2 = computeConfidencePercent(r2.text, r2.tessConf);
  const len2 = (r2.text || "").trim().length;

  const choose2 = c2 > c1 + 3 || (c2 >= c1 && len2 > len1 + 80);

  return {
    bestText: choose2 ? r2.text : r1.text,
    bestTessConf: choose2 ? r2.tessConf : r1.tessConf,
    bestConfPct: choose2 ? c2 : c1,
    bestPath: choose2 ? hardPath : softPath,
    tempPaths: [softPath, hardPath],
  };
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

    // temporaires à supprimer
    let tempPaths = [];

    try {
      let text = "";
      let ocrUsed = false;
      let ocrConfidence = null;
      let ocrEngine = null; // "tesseract" | "vision"

      if (ext === ".pdf") {
        text = await extractTextFromPdf(filePath);

        // ✅ PDF scanné détecté
        if (useOcr && (!text || text.trim().length < 80)) {
          return res.status(422).json({
            error: "PDF scanné détecté",
            scannedPdf: true,
            details:
              "Ce PDF semble être un scan (image). Conversion des pages en images requise pour OCR.",
          });
        }
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || "";
      } else if (isImageExt(ext)) {
        ocrUsed = true;

        // 1) OCR Tesseract (prétraitement multi-essais)
        let rawOcrText = "";
        let confPct = 0;
        let bestPathForOcr = filePath;

        if (useOcrPreprocess) {
          const r = await bestOcrFromVariants(filePath, ocrLang);
          rawOcrText = r.bestText || "";
          confPct = r.bestConfPct || 0;
          bestPathForOcr = r.bestPath || filePath;
          tempPaths.push(...(r.tempPaths || []));
        } else {
          const r = await ocrImage(filePath, ocrLang, 6);
          rawOcrText = r.text || "";
          confPct = computeConfidencePercent(rawOcrText, r.tessConf);
        }

        // fallback PSM4 si faible
        if (confPct < 45 || rawOcrText.trim().length < 80) {
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

        // 2) ✅ Fallback OpenAI Vision si toujours trop court
        const allowVision = (process.env.OCR_VISION_FALLBACK || "1") === "1";
        if (allowVision && (!text || text.trim().length < 80)) {
          const visionText = await visionOcrWithOpenAI(openai, bestPathForOcr);
          if (visionText && visionText.trim().length >= 40) {
            text = visionText;
            ocrEngine = "vision";
            // confiance estimée heuristique (pas parfaite, mais utile)
            ocrConfidence = Math.max(ocrConfidence || 0, Math.round(40 + ocrQualityScore(text) * 60));
          }
        }

        // 3) Correction IA contrôlée (facultatif)
        if (useOcrCleanup && text.trim().length > 20) {
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

      // ✅ seuil minimal : si Vision a donné quelque chose, on accepte dès 40 chars
      const minLen = 50;
      if (!text || text.trim().length < minLen) {
        // IMPORTANT: on renvoie un peu de debug utile
        return res.status(500).json({
          error: "Erreur analyse",
          details:
            "Texte trop court/illisible après extraction/OCR. Conseil: meilleure lumière, zoom, page à plat.",
          debug: {
            len: (text || "").trim().length,
            engine: ocrEngine,
            confidence: ocrConfidence,
          },
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
