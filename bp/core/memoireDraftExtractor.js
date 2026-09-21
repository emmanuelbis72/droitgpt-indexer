import mammoth from "mammoth";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function extensionOf(name = "") {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function isImageFile(file, ext, mime) {
  return mime.startsWith("image/") || IMAGE_EXTENSIONS.includes(ext);
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || "Operation"} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function callExternalTextExtractor(file, purpose = "ocr") {
  const extractUrl =
    process.env.MEMOIRE_OCR_EXTRACT_URL ||
    process.env.OCR_EXTRACT_URL ||
    process.env.ANALYSE_PDF_EXTRACT_URL;

  if (!extractUrl) return "";

  const fd = new FormData();
  fd.append("file", new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }), file.originalname || "draft");
  fd.append("purpose", purpose);

  const timeoutMs = Number(process.env.MEMOIRE_OCR_SERVICE_TIMEOUT_MS || 120000);
  const resp = await withTimeout(fetch(extractUrl, { method: "POST", body: fd }), timeoutMs, "OCR service");
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OCR_SERVICE_FAILED: ${resp.status} ${t.slice(0, 240)}`);
  }

  const ct = String(resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    const json = await resp.json();
    return cleanText(json?.text || json?.content || json?.ocrText || "");
  }
  return cleanText(await resp.text());
}

async function extractImageWithTesseract(file) {
  const maxBytes = Number(process.env.MEMOIRE_OCR_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
  if (file.buffer.length > maxBytes) {
    const err = new Error(
      `OCR_IMAGE_TOO_LARGE: Image trop lourde pour l'OCR local (${Math.round(file.buffer.length / 1024 / 1024)} MB). ` +
      "Compressez l'image ou utilisez un service OCR externe."
    );
    err.statusCode = 400;
    throw err;
  }

  const timeoutMs = Number(process.env.MEMOIRE_OCR_TIMEOUT_MS || 180000);
  const lang = process.env.MEMOIRE_OCR_LANG || "fra+eng";

  try {
    const mod = await import("tesseract.js");
    const recognize = mod.recognize || mod.default?.recognize;
    if (typeof recognize !== "function") throw new Error("tesseract.js recognize unavailable");
    const result = await withTimeout(
      recognize(file.buffer, lang, {
        logger: process.env.MEMOIRE_OCR_LOGS === "true" ? (m) => console.log("[MEMOIRE OCR]", m) : undefined,
      }),
      timeoutMs,
      "OCR"
    );
    return cleanText(result?.data?.text || "");
  } catch (error) {
    const external = await callExternalTextExtractor(file, "image_ocr").catch(() => "");
    if (external) return external;
    const err = new Error(
      `OCR_FAILED: Impossible de lire le manuscrit/image. ${String(error?.message || error)}. ` +
      "Collez le texte en vrac dans le champ brouillon ou configurez MEMOIRE_OCR_EXTRACT_URL."
    );
    err.statusCode = 400;
    throw err;
  }
}

async function extractPdfText(file) {
  const minChars = Number(process.env.MEMOIRE_PDF_TEXT_MIN_CHARS || 120);
  let localText = "";
  let localError = null;

  try {
    const mod = await import("pdf-parse");
    const pdfParse = mod.default || mod;
    const data = await pdfParse(file.buffer);
    localText = cleanText(data?.text || "");
  } catch (error) {
    localError = error;
  }

  if (localText.length >= minChars) return localText;

  const external = await callExternalTextExtractor(file, "pdf_ocr").catch((error) => {
    if (localError) throw new Error(`${String(localError?.message || localError)}; ${String(error?.message || error)}`);
    throw error;
  });
  if (external) return external;

  if (localText) return localText;

  const err = new Error(
    "BROUILLON_OCR_REQUIRED: Le PDF semble scanné ou manuscrit et ne contient pas de texte extractible. " +
    "Uploadez une photo lisible du manuscrit (JPG/PNG/WEBP), collez le texte en vrac, ou configurez MEMOIRE_OCR_EXTRACT_URL pour OCR PDF."
  );
  err.statusCode = 400;
  throw err;
}

export async function extractMemoireDraftFile(file) {
  if (!file) throw new Error("Aucun fichier brouillon recu.");
  const fileName = String(file.originalname || "brouillon").trim();
  const ext = extensionOf(fileName);
  const mime = String(file.mimetype || "").toLowerCase();

  if (ext === ".docx" || mime.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return { text: cleanText(result.value || ""), method: "docx", fileName };
  }

  if (ext === ".txt" || mime.startsWith("text/")) {
    return { text: cleanText(file.buffer.toString("utf-8")), method: "txt", fileName };
  }

  if (ext === ".pdf" || mime === "application/pdf") {
    return { text: await extractPdfText(file), method: "pdf_or_ocr_service", fileName };
  }

  if (isImageFile(file, ext, mime)) {
    return { text: await extractImageWithTesseract(file), method: "image_ocr", fileName };
  }

  const err = new Error(
    "FORMAT_BROUILLON_NON_SUPPORTE: Formats acceptes pour le brouillon memoire: DOCX, TXT, PDF texte, JPG, PNG, WEBP. " +
    "Pour PDF scanne, configurez MEMOIRE_OCR_EXTRACT_URL ou collez le texte en vrac."
  );
  err.statusCode = 400;
  throw err;
}

function truncateText(value, maxChars) {
  const text = cleanText(value);
  if (text.length <= maxChars) return { text, truncated: false, omittedChars: 0 };
  return {
    text: `${text.slice(0, maxChars)}\n\n[...TRONQUE: ${text.length - maxChars} caracteres non inclus mot pour mot...]`,
    truncated: true,
    omittedChars: text.length - maxChars,
  };
}

export async function extractOptionalMemoireDraft(req) {
  const pieces = [];
  const meta = {
    hasFile: Boolean(req.file),
    hasPastedText: false,
    fileName: req.file?.originalname || "",
    extractionMethods: [],
    warnings: [],
  };

  if (req.file) {
    const extracted = await extractMemoireDraftFile(req.file);
    meta.extractionMethods.push(extracted.method);
    if (extracted.text) {
      pieces.push(`[BROUILLON FICHIER: ${extracted.fileName} | extraction: ${extracted.method}]\n${extracted.text}`);
    } else {
      meta.warnings.push("Le fichier importe n'a produit aucun texte exploitable.");
    }
  }

  const pasted = cleanText(req.body?.draftText || req.body?.roughDraftText || req.body?.text || "");
  if (pasted) {
    meta.hasPastedText = true;
    meta.extractionMethods.push("pasted_rough_text");
    pieces.push(`[TEXTE COLLE / NOTES EN VRAC]\n${pasted}`);
  }

  const combined = cleanText(pieces.join("\n\n---\n\n"));
  const maxChars = Number(process.env.MEMOIRE_DRAFT_MAX_CHARS || 60000);
  const truncated = truncateText(combined, maxChars);

  meta.charCount = combined.length;
  meta.truncated = truncated.truncated;
  meta.omittedChars = truncated.omittedChars;
  meta.kind = meta.extractionMethods.includes("image_ocr") ? "ocr_manuscript_or_image" : meta.hasPastedText ? "rough_text" : meta.hasFile ? "uploaded_file" : "";

  if (req.file && !truncated.text) {
    const err = new Error(
      "BROUILLON_VIDE: Le fichier importe ne contient pas de texte exploitable. " +
      "Essayez une image plus nette, un DOCX/TXT, ou collez le texte en vrac dans le champ brouillon."
    );
    err.statusCode = 400;
    throw err;
  }

  return { text: truncated.text, meta };
}
