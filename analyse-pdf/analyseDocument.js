// analyseDocument.js
// ✅ PATCH: Analyse IA sur TOUT le texte (chunking + merge final)
// ✅ documentText renvoie le texte COMPLET (non tronqué)
// ✅ Parallélisation: analyse des chunks avec un pool
// ✅ Timeout par chunk + stratégie auto concurrency (3 courts, 2 longs)
// ✅ Timeout GLOBAL (3 minutes par défaut) + MODE DÉGRADÉ (retour partiel si timeout)

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
          "Tu es un OCR juridique très strict. " +
          "Transcris fidèlement, n’invente rien. Si illisible: [ILLISIBLE]. Retourne uniquement du texte brut.",
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
          "Tu es un correcteur OCR juridique. " +
          "Ne pas inventer. Conserver noms/dates/numéros. Si illisible: [ILLISIBLE]. Sortie: texte brut.",
      },
      {
        role: "user",
        content:
          "Corrige ce texte OCR sans ajouter d'information.\n\nTEXTE OCR:\n" + t.slice(0, 12000),
      },
    ],
  });

  return completion.choices?.[0]?.message?.content?.trim() || t;
}

// ✅ Découpe texte en chunks (avec overlap)
function chunkText(text, chunkSize = 9000, overlap = 400) {
  const t = String(text || "");
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(i + chunkSize, t.length);
    const slice = t.slice(i, end);
    chunks.push(slice);
    if (end >= t.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

// ✅ Timeout wrapper (n’annule pas l’appel OpenAI, mais empêche le blocage logique)
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

// ✅ Pool de promesses: exécute N tâches en parallèle + callback onResult
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

// ✅ Analyse un chunk → JSON structuré
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
          "Tu dois retourner STRICTEMENT un JSON valide (pas de markdown, pas de texte autour). " +
          "N'invente pas. Si incertain: indique 'incertain'.",
      },
      {
        role: "user",
        content: `
Partie ${index + 1}/${total}.
Retourne un JSON avec ces champs:
{
  "faits": ["..."],
  "questions_juridiques": ["..."],
  "points_cles": ["..."],
  "risques": ["..."],
  "recommandations": ["..."]
}

Texte:
"""${chunk}"""
`.trim(),
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "";
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

// ✅ Fusion finale IA → HTML unique
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

Structure attendue en HTML:
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

// ✅ Fusion LOCALE (mode dégradé) : sans IA, à partir des chunks déjà analysés
function fallbackMergeToHtml(partials, meta = {}) {
  const uniq = (arr) => Array.from(new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean)));

  const facts = [];
  const questions = [];
  const points = [];
  const risks = [];
  const recos = [];

  for (const p of partials || []) {
    if (!p) continue;
    facts.push(...(p.faits || []));
    questions.push(...(p.questions_juridiques || []));
    points.push(...(p.points_cles || []));
    risks.push(...(p.risques || []));
    recos.push(...(p.recommandations || []));
  }

  // Limites pour éviter des pages énormes
  const LIMIT = Number(process.env.ANALYSE_DEGRADED_LIST_LIMIT || 18);

  const f = uniq(facts).slice(0, LIMIT);
  const q = uniq(questions).slice(0, LIMIT);
  const p = uniq(points).slice(0, LIMIT);
  const r = uniq(risks).slice(0, LIMIT);
  const c = uniq(recos).slice(0, LIMIT);

  const safeUl = (items) => `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
  const note =
    `<p><strong>Mode dégradé:</strong> analyse partielle (temps limite atteint). ` +
    `Chunks traités: ${meta.processedChunks || 0}/${meta.totalChunks || 0}. ` +
    `Certains éléments peuvent manquer.</p>`;

  return [
    "<h2>Résumé global</h2>",
    note,
    "<h2>Faits essentiels</h2>",
    safeUl(f.length ? f : ["(non disponible / partiel)"]),
    "<h2>Questions juridiques</h2>",
    safeUl(q.length ? q : ["(non disponible / partiel)"]),
    "<h2>Analyse</h2>",
    safeUl(p.length ? p : ["(non disponible / partiel)"]),
    "<h2>Risques</h2>",
    safeUl(r.length ? r : ["(non disponible / partiel)"]),
    "<h2>Recommandations</h2>",
    safeUl(c.length ? c : ["(non disponible / partiel)"]),
    "<h2>Conclusion</h2>",
    "<p>Résultat partiel — relance avec moins de pages ou augmente la limite si nécessaire.</p>",
  ].join("\n");
}

// petite protection HTML
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ✅ Stratégie auto de concurrence (3 courts, 2 longs)
function autoConcurrency(chunksCount) {
  return chunksCount <= 6 ? 3 : 2;
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

    // ✅ Timeouts
    const GLOBAL_TIMEOUT_MS = Number(process.env.ANALYSE_GLOBAL_TIMEOUT_MS || 180000);
    const CHUNK_TIMEOUT_MS = Number(process.env.ANALYSE_CHUNK_TIMEOUT_MS || 45000);
    const MERGE_TIMEOUT_MS = Number(process.env.ANALYSE_MERGE_TIMEOUT_MS || 35000);

    // ✅ “marge” pour pouvoir renvoyer une réponse propre avant le hard timeout
    const SAFETY_MARGIN_MS = Number(process.env.ANALYSE_GLOBAL_SAFETY_MARGIN_MS || 8000);

    // ✅ état pour mode dégradé
    let startedAt = Date.now();
    let deadline = startedAt + GLOBAL_TIMEOUT_MS;
    let degraded = false;
    let partialsSoFar = []; // sera rempli au fil du pool
    let totalChunks = 0;

    const timeLeft = () => deadline - Date.now();

    try {
      // ✅ Process principal qu’on “race” avec un timeout global
      const mainProcess = (async () => {
        let text = "";
        let ocrUsed = false;
        let ocrConfidence = null;
        let ocrEngine = null; // "tesseract" | "vision"

        if (ext === ".pdf") {
          text = await extractTextFromPdf(filePath);

          if (useOcr && (!text || text.trim().length < 80)) {
            return {
              status: 422,
              body: {
                error: "PDF scanné détecté",
                scannedPdf: true,
                details: "Ce PDF semble être un scan (image). Conversion des pages en images requise pour OCR.",
              },
            };
          }
        } else if (ext === ".docx") {
          const result = await mammoth.extractRawText({ path: filePath });
          text = result.value || "";
        } else if (isImageExt(ext)) {
          ocrUsed = true;

          let bestPathForOcr = filePath;

          if (useOcrPreprocess) {
            const softPath = await preprocessSoft(filePath);
            tempPaths.push(softPath);
            bestPathForOcr = softPath;
          }

          const r1 = await ocrImage(bestPathForOcr, ocrLang, 6);
          let rawOcrText = r1.text || "";
          let confPct = computeConfidencePercent(rawOcrText, r1.tessConf);

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

          const allowVision = (process.env.OCR_VISION_FALLBACK || "1") === "1";
          if (allowVision && (!text || text.trim().length < 80)) {
            const visionText = await visionOcrWithOpenAI(openai, bestPathForOcr);
            if (visionText && visionText.trim().length >= 40) {
              text = visionText;
              ocrEngine = "vision";
              ocrConfidence = Math.max(ocrConfidence || 0, Math.round(40 + ocrQualityScore(text) * 60));
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
          return {
            status: 400,
            body: { error: "Format non supporté.", details: "Formats acceptés: PDF, DOCX, JPG/PNG/WEBP/TIFF/BMP." },
          };
        }

        const minLen = 50;
        if (!text || text.trim().length < minLen) {
          return {
            status: 500,
            body: {
              error: "Erreur analyse",
              details: "Texte trop court/illisible après extraction/OCR. Conseil: meilleure lumière, zoom, page à plat.",
              debug: { len: (text || "").trim().length, engine: ocrEngine, confidence: ocrConfidence },
            },
          };
        }

        const fullText = String(text || "").trim();

        // ✅ Chunking
        const CHUNK_SIZE = Number(process.env.ANALYSE_CHUNK_SIZE || 9000);
        const OVERLAP = Number(process.env.ANALYSE_CHUNK_OVERLAP || 400);
        const MAX_CHUNKS = Number(process.env.ANALYSE_MAX_CHUNKS || 30);

        const FORCE_CONCURRENCY = process.env.ANALYSE_CHUNK_CONCURRENCY;
        const chunks = chunkText(fullText, CHUNK_SIZE, OVERLAP).slice(0, MAX_CHUNKS);

        totalChunks = chunks.length;
        const concurrency = FORCE_CONCURRENCY ? Number(FORCE_CONCURRENCY) : autoConcurrency(chunks.length);

        // tableau partagé, rempli au fil de l’eau (utile en mode dégradé)
        partialsSoFar = new Array(chunks.length).fill(null);

        // ✅ Pool: on ne lance pas de nouveaux chunks si le temps est trop court
        const worker = async (chunk, i) => {
          // si on est proche du timeout global, on n’attaque pas ce chunk
          if (timeLeft() < SAFETY_MARGIN_MS + 1500) {
            degraded = true;
            return {
              faits: [],
              questions_juridiques: [],
              points_cles: [`(Chunk ${i + 1}/${chunks.length} sauté: temps limite proche)`],
              risques: [],
              recommandations: [],
              _skipped: true,
            };
          }

          try {
            const p = analyseChunk(openai, chunk, i, chunks.length);
            // timeout chunk, MAIS on évite d’aller au-delà du global
            const ms = Math.max(3000, Math.min(CHUNK_TIMEOUT_MS, timeLeft() - SAFETY_MARGIN_MS));
            return await withTimeout(p, ms, `chunk ${i + 1}/${chunks.length}`);
          } catch (e) {
            degraded = true;
            return {
              faits: [],
              questions_juridiques: [],
              points_cles: [`(Chunk ${i + 1}/${chunks.length} échoué: ${e?.message || "erreur inconnue"})`],
              risques: [],
              recommandations: [],
              _failed: true,
            };
          }
        };

        const onResult = (val, idx) => {
          partialsSoFar[idx] = val;
        };

        await runPool(chunks, concurrency, worker, onResult);

        // ✅ “partials prêts” (non null)
        const donePartials = partialsSoFar.filter(Boolean);

        // ✅ Merge IA si possible, sinon fallback local
        let analysisHtml = "";
        const remainingForMerge = timeLeft() - SAFETY_MARGIN_MS;

        if (remainingForMerge > 4000) {
          try {
            const mergeMs = Math.max(3000, Math.min(MERGE_TIMEOUT_MS, remainingForMerge));
            analysisHtml = await withTimeout(
              mergeAnalysesToHtml(openai, donePartials, fullText.length, donePartials.length),
              mergeMs,
              "merge"
            );
          } catch (e) {
            degraded = true;
            analysisHtml = fallbackMergeToHtml(donePartials, {
              processedChunks: donePartials.length,
              totalChunks: chunks.length,
            });
          }
        } else {
          degraded = true;
          analysisHtml = fallbackMergeToHtml(donePartials, {
            processedChunks: donePartials.length,
            totalChunks: chunks.length,
          });
        }

        const processed = donePartials.length;
        const skipped = partialsSoFar.filter((x) => x && x._skipped).length;

        return {
          status: degraded ? 206 : 200,
          body: {
            analysis: analysisHtml,
            documentText: fullText,
            ocrUsed,
            ocrConfidence,
            ocrEngine,
            degraded,
            ocrOptions: { useOcrPreprocess, useOcrCleanup, ocrLang },
            meta: {
              fullTextLength: fullText.length,
              chunks: chunks.length,
              processedChunks: processed,
              skippedChunks: skipped,
              chunkSize: CHUNK_SIZE,
              overlap: OVERLAP,
              maxChunks: MAX_CHUNKS,
              concurrency,
              chunkTimeoutMs: CHUNK_TIMEOUT_MS,
              mergeTimeoutMs: MERGE_TIMEOUT_MS,
              globalTimeoutMs: GLOBAL_TIMEOUT_MS,
              safetyMarginMs: SAFETY_MARGIN_MS,
              concurrencyMode: FORCE_CONCURRENCY ? "forced" : "auto",
            },
          },
        };
      })();

      // ✅ Hard global race: si timeout, on renvoie mode dégradé avec ce qu’on a
      const result = await Promise.race([
        mainProcess,
        new Promise((resolve) => {
          setTimeout(() => {
            degraded = true;

            const donePartials = (partialsSoFar || []).filter(Boolean);
            const processed = donePartials.length;
            const skipped = (partialsSoFar || []).filter((x) => x && x._skipped).length;

            resolve({
              status: 206,
              body: {
                error: "Timeout analyse",
                details:
                  "Analyse interrompue (limite 3 minutes). Résultat partiel renvoyé (mode dégradé).",
                degraded: true,
                analysis: fallbackMergeToHtml(donePartials, {
                  processedChunks: processed,
                  totalChunks: totalChunks || (partialsSoFar || []).length,
                }),
                // On renvoie ce qu’on a (si extraction déjà faite, sinon vide)
                documentText: "",
                meta: {
                  processedChunks: processed,
                  skippedChunks: skipped,
                  totalChunks: totalChunks || (partialsSoFar || []).length,
                  globalTimeoutMs: GLOBAL_TIMEOUT_MS,
                },
              },
            });
          }, GLOBAL_TIMEOUT_MS);
        }),
      ]);

      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error("❌ Erreur analyse :", err?.message || err);
      return res.status(500).json({ error: "Erreur analyse", details: err?.message || "Inconnue" });
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
