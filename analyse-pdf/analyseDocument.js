// analyseDocument.js
// ✅ Analyse PDF/DOCX + OCR images (+ prétraitement + correction IA contrôlée)
// ✅ Texte extrait COMPLET (non tronqué par défaut) + nettoyage caractères illisibles
// ✅ Analyse sur TOUT le texte via chunking + merge final
// ✅ Pool parallélisé + timeout par chunk + stratégie auto (2 longs, 3 courts)
// ✅ Timeout global (3 min) + mode dégradé (fusion partielle si timeout)
// ✅ POST /text pour analyser un texte déjà extrait côté frontend
// ✅ skipAnalysis=1 pour faire uniquement extraction/OCR
// ✅ Endpoints JusticeLab: /extract + alias /analyse-document/extract
// ✅ Healthcheck: GET /health

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");

/* -----------------------------
   Upload config
------------------------------*/
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

// Assure le dossier uploads
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.error("❌ Impossible de créer le dossier uploads:", e?.message || e);
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024), // 25MB par défaut
  },
});

/* -----------------------------
   Utils
------------------------------*/
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeStr(s, max = 8000) {
  const t = String(s || "");
  return t.length > max ? t.slice(0, max) : t;
}

function cleanExtractedText(input) {
  let t = String(input || "");
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  t = t.replace(/\uFFFD/g, "");
  t = t.replace(/[ \u00A0]+/g, " ");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{4,}/g, "\n\n\n");
  return t.trim();
}

function isImageExt(ext) {
  return [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"].includes(ext);
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

/* -----------------------------
   Extraction PDF / DOCX
------------------------------*/
async function extractTextFromPdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || "";
}

/* -----------------------------
   OCR
------------------------------*/
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
    // Tesseract.js supporte la config tesseract via "tessedit_pageseg_mode" dans la pratique
    tessedit_pageseg_mode: String(psm),
    user_defined_dpi: "300",
    preserve_interword_spaces: "1",
  });
  const text = data?.text ? data.text : "";
  const tessConf = Number.isFinite(data?.confidence) ? data.confidence : null;
  return { text, tessConf };
}

async function preprocessSoft(inputPath) {
  const outPath = inputPath + "_soft.png";
  let img = sharp(inputPath).rotate().grayscale().normalize();
  img = img.linear(1.12, -6).sharpen();
  img = img.resize({ width: 2200, withoutEnlargement: true });
  await img.png({ compressionLevel: 9 }).toFile(outPath);
  return outPath;
}

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
          "Tu es un OCR juridique très strict. Transcris fidèlement, n’invente rien. " +
          "Si illisible: [ILLISIBLE]. Retourne uniquement du texte brut.",
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
          "Tu es un correcteur OCR juridique. Ne pas inventer. Conserver noms/dates/numéros. " +
          "Si illisible: [ILLISIBLE]. Sortie: texte brut.",
      },
      {
        role: "user",
        content: "Corrige ce texte OCR sans ajouter d'information.\n\nTEXTE OCR:\n" + t.slice(0, 12000),
      },
    ],
  });

  return completion.choices?.[0]?.message?.content?.trim() || t;
}

/* -----------------------------
   Analyse (chunking)
------------------------------*/
function chunkText(text, chunkSize = 9000, overlap = 400) {
  const t = String(text || "");
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(i + chunkSize, t.length);
    chunks.push(t.slice(i, end));
    if (end >= t.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

function withTimeout(promise, ms, label = "operation") {
  const timeoutMs = Number(ms);
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => {
        clearTimeout(t);
        reject(new Error(`Timeout ${label} après ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

async function runPool(items, concurrency, worker, onResult) {
  const results = new Array(items.length);
  let idx = 0;

  async function next() {
    const current = idx++;
    if (current >= items.length) return;
    const value = await worker(items[current], current);
    results[current] = value;
    try {
      if (typeof onResult === "function") onResult(value, current);
    } catch {}
    return next();
  }

  const starters = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(starters);
  return results;
}

async function analyseChunk(openai, chunk, index, total) {
  const completion = await openai.chat.completions.create({
    model: process.env.ANALYSE_MODEL || "gpt-4o-mini",
    temperature: Number(process.env.ANALYSE_TEMPERATURE || 0.2),
    max_tokens: Number(process.env.ANALYSE_CHUNK_MAX_TOKENS || 900),
    messages: [
      {
        role: "system",
        content:
          "Tu es un juriste congolais expérimenté (RDC + OHADA si pertinent). " +
          "Tu analyses une PARTIE d'un document. " +
          "Retourne STRICTEMENT un JSON valide (pas de markdown). " +
          "N'invente pas. Si incertain: indique 'incertain'.",
      },
      {
        role: "user",
        content: `Partie ${index + 1}/${total}.
Retourne un JSON:
{
  "faits": ["..."],
  "questions_juridiques": ["..."],
  "points_cles": ["..."],
  "risques": ["..."],
  "recommandations": ["..."]
}

Texte:
"""${chunk}"""`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {
      faits: [],
      questions_juridiques: [],
      points_cles: ["(Extraction partielle: JSON non valide)"],
      risques: [],
      recommandations: [],
      _raw: raw.slice(0, 1500),
    };
  }
}

async function mergeAnalysesToHtml(openai, all, fullTextLen, chunksCount) {
  const completion = await openai.chat.completions.create({
    model: process.env.ANALYSE_MERGE_MODEL || process.env.ANALYSE_MODEL || "gpt-4o-mini",
    temperature: Number(process.env.ANALYSE_TEMPERATURE || 0.2),
    max_tokens: Number(process.env.ANALYSE_MERGE_MAX_TOKENS || 1600),
    messages: [
      {
        role: "system",
        content:
          "Tu es un juriste congolais expérimenté (RDC + OHADA si pertinent). " +
          "Tu fusionnes des analyses partielles en un rapport unique. " +
          "Réponds STRICTEMENT en HTML simple avec seulement: <p>, <h2>, <h3>, <ul>, <li>, <strong>. " +
          "N'invente pas. Si incertain: le dire.",
      },
      {
        role: "user",
        content: `
Tu as ${chunksCount} analyses de sections d'un document (longueur totale ${fullTextLen} caractères).
Fusionne et déduplique. Ne répète pas les mêmes points.

Structure attendue:
<h2>Résumé global</h2>
<p>...</p>

<h2>Faits essentiels</h2>
<ul><li>...</li></ul>

<h2>Questions juridiques</h2>
<ul><li>...</li></ul>

<h2>Analyse</h2>
<ul><li>...</li></ul>

<h2>Risques</h2>
<ul><li>...</li></ul>

<h2>Recommandations</h2>
<ul><li>...</li></ul>

<h2>Conclusion</h2>
<p>...</p>

Analyses JSON:
${JSON.stringify(all).slice(0, 30000)}
`.trim(),
      },
    ],
  });

  return completion.choices?.[0]?.message?.content || "<p>❌ Analyse vide.</p>";
}

function autoConcurrency(chunksCount) {
  return chunksCount <= 6 ? 3 : 2;
}

async function analyseFullText(openai, fullTextRaw) {
  const fullText = cleanExtractedText(fullTextRaw);

  if (!fullText || fullText.trim().length < 50) {
    const err = new Error("Texte trop court/illisible après extraction/OCR.");
    err.code = "TEXT_TOO_SHORT";
    throw err;
  }

  const CHUNK_SIZE = Number(process.env.ANALYSE_CHUNK_SIZE || 9000);
  const OVERLAP = Number(process.env.ANALYSE_CHUNK_OVERLAP || 400);
  const MAX_CHUNKS = Number(process.env.ANALYSE_MAX_CHUNKS || 30);

  const CHUNK_TIMEOUT_MS = Number(process.env.ANALYSE_CHUNK_TIMEOUT_MS || 45000);
  const GLOBAL_TIMEOUT_MS = Number(process.env.ANALYSE_GLOBAL_TIMEOUT_MS || 180000);

  const chunks = chunkText(fullText, CHUNK_SIZE, OVERLAP).slice(0, MAX_CHUNKS);
  const concurrency = process.env.ANALYSE_CHUNK_CONCURRENCY
    ? Number(process.env.ANALYSE_CHUNK_CONCURRENCY)
    : autoConcurrency(chunks.length);

  const startedAt = Date.now();
  const partials = new Array(chunks.length).fill(null);
  let degradedMode = false;

  const worker = async (chunk, i) => {
    if (Date.now() - startedAt > GLOBAL_TIMEOUT_MS) {
      degradedMode = true;
      throw new Error("Global timeout");
    }
    try {
      const p = analyseChunk(openai, chunk, i, chunks.length);
      return await withTimeout(p, CHUNK_TIMEOUT_MS, `chunk ${i + 1}/${chunks.length}`);
    } catch (e) {
      return {
        faits: [],
        questions_juridiques: [],
        points_cles: [`(Chunk ${i + 1}/${chunks.length} échoué: ${e?.message || "erreur"})`],
        risques: [],
        recommandations: [],
      };
    }
  };

  try {
    await withTimeout(
      runPool(chunks, concurrency, worker, (val, i) => (partials[i] = val)),
      GLOBAL_TIMEOUT_MS + 1500,
      "global"
    );
  } catch {
    degradedMode = true;
  }

  const usable = partials.filter(Boolean);
  if (usable.length < chunks.length) degradedMode = true;

  const finalHtml = await mergeAnalysesToHtml(openai, usable, fullText.length, usable.length || 1);

  return {
    analysisHtml: finalHtml,
    documentText: fullText,
    meta: {
      fullTextLength: fullText.length,
      chunks: chunks.length,
      chunksUsed: usable.length,
      chunkSize: CHUNK_SIZE,
      overlap: OVERLAP,
      maxChunks: MAX_CHUNKS,
      concurrency,
      chunkTimeoutMs: CHUNK_TIMEOUT_MS,
      globalTimeoutMs: GLOBAL_TIMEOUT_MS,
      degradedMode,
    },
  };
}

/* -----------------------------
   Extraction depuis upload (pdf/docx/image)
------------------------------*/
async function extractTextFromUpload(openai, filePath, originalName, body) {
  const ext = path.extname(originalName).toLowerCase();

  const useOcr = String(body?.useOcr || "0") === "1";
  const ocrLang = String(body?.ocrLang || process.env.OCR_LANG || "fra+eng");
  const useOcrPreprocess = String(body?.useOcrPreprocess || "1") === "1";
  const useOcrCleanup = String(body?.useOcrCleanup || "1") === "1";

  let tempPaths = [];
  let text = "";
  let ocrUsed = false;
  let ocrConfidence = null;
  let ocrEngine = null;

  if (ext === ".pdf") {
    text = await extractTextFromPdf(filePath);

    // PDF scanné -> on laisse le frontend convertir en images (pdf.js)
    if (useOcr && (!text || text.trim().length < 80)) {
      const err = new Error("PDF scanné détecté");
      err.code = "SCANNED_PDF";
      err.scannedPdf = true;
      throw err;
    }
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value || "";
  } else if (isImageExt(ext)) {
    ocrUsed = true;

    let bestPath = filePath;
    if (useOcrPreprocess) {
      const p = await preprocessSoft(filePath);
      tempPaths.push(p);
      bestPath = p;
    }

    const r1 = await ocrImage(bestPath, ocrLang, 6);
    let raw = r1.text || "";
    let conf = computeConfidencePercent(raw, r1.tessConf);

    if (conf < 35 && raw.trim().length < 80) {
      const r2 = await ocrImage(bestPath, ocrLang, 4);
      const conf2 = computeConfidencePercent(r2.text, r2.tessConf);
      if (conf2 > conf || (r2.text || "").trim().length > raw.trim().length + 80) {
        raw = r2.text || "";
        conf = conf2;
      }
    }

    ocrEngine = "tesseract";
    text = raw;
    ocrConfidence = conf;

    const allowVision = (process.env.OCR_VISION_FALLBACK || "1") === "1";
    if (allowVision && (!text || text.trim().length < 80)) {
      const visionText = await visionOcrWithOpenAI(openai, bestPath);
      if (visionText && visionText.trim().length >= 40) {
        text = visionText;
        ocrEngine = "vision";
        ocrConfidence = Math.max(conf || 0, Math.round(40 + ocrQualityScore(text) * 60));
      }
    }

    if (useOcrCleanup && text.trim().length > 20 && Number.isFinite(ocrConfidence) && ocrConfidence < 60) {
      const cleaned = await cleanOcrWithAI(openai, text);
      if (cleaned && cleaned.trim().length > 20) {
        text = cleaned;
        ocrConfidence = clamp((ocrConfidence || 0) + 5, 0, 100);
      }
    }
  } else {
    const err = new Error("Format non supporté");
    err.code = "UNSUPPORTED_FORMAT";
    throw err;
  }

  return {
    fullText: cleanExtractedText(text),
    ocrUsed,
    ocrConfidence,
    ocrEngine,
    ocrOptions: { ocrLang, useOcrPreprocess, useOcrCleanup },
    tempPaths,
    ext,
  };
}

/* -----------------------------
   Router
------------------------------*/
module.exports = function (openai) {
  const router = express.Router();

  // ✅ Healthcheck
  router.get("/health", (req, res) => {
    return res.json({ ok: true, service: "analyse", ts: new Date().toISOString() });
  });

  // Handler extraction brute (JusticeLab import)
  async function handleExtract(req, res) {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier envoyé." });

    const filePath = req.file.path;
    const originalName = req.file.originalname || "document";
    const ext = path.extname(originalName).toLowerCase();

    try {
      let text = "";

      if (ext === ".pdf") {
        text = await extractTextFromPdf(filePath);
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || "";
      } else {
        return res.status(400).json({ error: "Format non supporté. PDF ou DOCX requis." });
      }

      text = cleanExtractedText(text);
      if (!text || text.length < 50) {
        return res.status(400).json({ error: "Texte trop court ou vide après extraction." });
      }

      // Par défaut: pas de troncature. Si besoin: EXTRACT_MAX_CHARS > 0
      const MAX_CHARS = Number(process.env.EXTRACT_MAX_CHARS || 0);
      const truncated = MAX_CHARS > 0 && text.length > MAX_CHARS;
      const documentText = truncated ? text.slice(0, MAX_CHARS) : text;

      return res.json({
        documentText, // ✅ attendu par JusticeLab
        filename: originalName,
        ext,
        truncated,
        chars: documentText.length,
        meta: truncated ? { maxChars: MAX_CHARS, length: text.length } : { length: text.length },
      });
    } catch (err) {
      console.error("❌ Erreur extraction /extract :", err?.message || err);
      return res.status(500).json({ error: "Erreur extraction", details: err?.message || "Inconnue" });
    } finally {
      safeUnlink(filePath);
    }
  }

  // ✅ Routes extraction compatibles
  router.post("/extract", upload.single("file"), handleExtract);
  
  // ✅ Alias (frontend historique): /analyse/extract
  router.post("/analyse/extract", upload.single("file"), handleExtract);
router.post("/analyse-document/extract", upload.single("file"), handleExtract);

  // POST / -> extraction + (option) analyse
  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier envoyé." });

    const filePath = req.file.path;
    const originalName = req.file.originalname || "document";
    const documentTitle = originalName;

    const skipAnalysis = String(req.body?.skipAnalysis || "0") === "1";
    let tempPaths = [];

    try {
      const extracted = await extractTextFromUpload(openai, filePath, originalName, req.body || {});
      tempPaths = extracted.tempPaths || [];

      if (skipAnalysis) {
        return res.json({
          analysis: null,
          documentTitle,
          documentText: extracted.fullText,
          ocrUsed: extracted.ocrUsed,
          ocrConfidence: extracted.ocrConfidence,
          ocrEngine: extracted.ocrEngine,
          ocrOptions: extracted.ocrOptions,
          meta: { skippedAnalysis: true, ext: extracted.ext },
        });
      }

      const analysed = await analyseFullText(openai, extracted.fullText);

      return res.json({
        analysis: analysed.analysisHtml,
        documentTitle,
        documentText: analysed.documentText,
        ocrUsed: extracted.ocrUsed,
        ocrConfidence: extracted.ocrConfidence,
        ocrEngine: extracted.ocrEngine,
        ocrOptions: extracted.ocrOptions,
        meta: { ...analysed.meta, ext: extracted.ext },
      });
    } catch (err) {
      if (err?.code === "SCANNED_PDF" || err?.scannedPdf) {
        return res.status(422).json({
          error: "PDF scanné détecté",
          scannedPdf: true,
          details: "Ce PDF semble être un scan (image). Conversion pages→images requise pour OCR (frontend).",
        });
      }
      if (err?.code === "UNSUPPORTED_FORMAT") {
        return res.status(400).json({
          error: "Format non supporté.",
          details: "Formats acceptés: PDF, DOCX, JPG/PNG/WEBP/TIFF/BMP.",
        });
      }
      if (err?.code === "TEXT_TOO_SHORT") {
        return res.status(500).json({
          error: "Erreur analyse",
          details: "Texte trop court/illisible après extraction/OCR.",
        });
      }

      console.error("❌ Erreur analyse :", err?.message || err);
      return res.status(500).json({ error: "Erreur analyse", details: err?.message || "Inconnue" });
    } finally {
      safeUnlink(filePath);
      try {
        if (Array.isArray(tempPaths) && tempPaths.length) tempPaths.forEach((p) => safeUnlink(p));
      } catch {}
    }
  });

  // POST /text -> analyse globale d'un texte déjà extrait/OCR
  router.post("/text", express.json({ limit: process.env.ANALYSE_TEXT_JSON_LIMIT || "2mb" }), async (req, res) => {
    try {
      const text = cleanExtractedText(req.body?.text || "");
      const analysed = await analyseFullText(openai, text);
      return res.json({
        analysis: analysed.analysisHtml,
        documentTitle: req.body?.documentTitle || "Texte importé",
        documentText: analysed.documentText,
        meta: { ...analysed.meta, ext: "text" },
      });
    } catch (err) {
      if (err?.code === "TEXT_TOO_SHORT") {
        return res.status(500).json({ error: "Erreur analyse", details: "Texte trop court/illisible." });
      }
      console.error("❌ Erreur analyse /text :", err?.message || err);
      return res.status(500).json({ error: "Erreur analyse", details: err?.message || "Inconnue" });
    }
  });

  return router;
};
