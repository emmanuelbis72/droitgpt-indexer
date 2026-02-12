import express from "express";
import multer from "multer";
import path from "path";

import { generateBusinessPlanPremium } from "../core/orchestrator.js";
import { writeBusinessPlanPdfPremium } from "../core/pdfAssembler.js";
import {
  normalizeLang,
  normalizeDocType,
  normalizeAudience,
  safeStr,
} from "../core/sanitize.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.BP_DRAFT_MAX_BYTES || 15 * 1024 * 1024) },
});

function safeFilenameBase(name) {
  return String(name || "Business_Plan")
    .trim()
    .slice(0, 80)
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function truncateText(s, maxChars) {
  const t = String(s || "").replace(/\u0000/g, "");
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + `\n\n[...TRONQUE: ${t.length - maxChars} caracteres...]`;
}

async function extractDraftTextFromUpload(file) {
  if (!file || !file.buffer) return "";
  const original = String(file.originalname || "");
  const ext = path.extname(original).toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();

  if (ext === ".txt" || mime.includes("text/plain")) {
    return file.buffer.toString("utf-8");
  }

  if (ext === ".docx" || mime.includes("officedocument.wordprocessingml")) {
    try {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: file.buffer });
      return String(out?.value || "");
    } catch (e) {
      const msg = String(e?.message || e);
      throw new Error(
        `DOCX_EXTRACT_FAILED: ${msg}. Installe 'mammoth' (npm i mammoth) ou colle le texte.`
      );
    }
  }

  if (ext === ".pdf" || mime.includes("pdf")) {
    try {
      const mod = await import("pdf-parse");
      const pdfParse = mod.default || mod;
      const data = await pdfParse(file.buffer);
      return String(data?.text || "");
    } catch (e) {
      const msg = String(e?.message || e);
      throw new Error(
        `PDF_EXTRACT_FAILED: ${msg}. Installe 'pdf-parse' (npm i pdf-parse) ou exporte en DOCX/TXT.`
      );
    }
  }

  return file.buffer.toString("utf-8");
}

function premiumHealth(_req, res) {
  res.json({
    ok: true,
    message: "Endpoint premium OK. Utilise POST pour generer le business plan (pdf/json).",
    example: {
      method: "POST",
      url: "/generate-business-plan/premium",
      body: { lang: "fr", companyName: "TEST", output: "json" },
    },
  });
}

async function premiumGenerate(req, res) {
  try {
    const b = req.body || {};

    if (b?.test === true) {
      return res.json({ ok: true, message: "Route premium OK (test mode)" });
    }

    const lang = normalizeLang(b.lang || process.env.BP_LANG_DEFAULT || "fr");

    const ctx = {
      companyName: safeStr(b.companyName || "Projet", 120),
      country: safeStr(b.country || "RDC", 80),
      city: safeStr(b.city || "Kinshasa / Lubumbashi", 120),
      sector: safeStr(b.sector || "Multi-secteur", 120),
      stage: safeStr(b.stage || "Early-stage", 60),
      docType: normalizeDocType(b.docType),
      audience: normalizeAudience(b.audience),
      product: safeStr(b.product, 2500),
      customers: safeStr(b.customers, 2500),
      businessModel: safeStr(b.businessModel, 2500),
      traction: safeStr(b.traction, 2500),
      competition: safeStr(b.competition, 2500),
      risks: safeStr(b.risks, 2500),
      finAssumptions: safeStr(b.finAssumptions, 3500),
      fundingAsk: safeStr(b.fundingAsk, 2500),
    };

    const title =
      lang === "en"
        ? `${ctx.companyName} - Business Plan (Premium)`
        : `${ctx.companyName} - Plan d'affaires (Premium)`;

    const output = String(b.output || "pdf").toLowerCase();
    const lite = Boolean(b.lite);

    const { sections, fullText } = await generateBusinessPlanPremium({
      lang,
      ctx,
      lite,
    });

    if (output === "json") {
      return res.json({ title, lang, ctx, lite, sections, fullText });
    }

    return writeBusinessPlanPdfPremium({
      res,
      title,
      ctx,
      sections,
    });
  } catch (e) {
    console.error("/generate-business-plan error:", e);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(e?.message || e),
    });
  }
}

async function premiumRewrite(req, res) {
  try {
    const b = req.body || {};

    const lang = normalizeLang(b.lang || process.env.BP_LANG_DEFAULT || "fr");

    let draftText = "";
    if (req.file) draftText = await extractDraftTextFromUpload(req.file);
    else draftText = String(b.text || "");

    draftText = truncateText(draftText, Number(process.env.BP_DRAFT_MAX_CHARS || 14000)).trim();

    if (!draftText) {
      return res.status(400).json({
        error: "BROUILLON_VIDE",
        details: "Importe un fichier (PDF/DOCX/TXT) OU colle le texte du brouillon dans le champ 'text'.",
      });
    }

    const ctx = {
      companyName: safeStr(b.companyName || "Projet", 120),
      country: safeStr(b.country || "RDC", 80),
      city: safeStr(b.city || "Kinshasa / Lubumbashi", 120),
      sector: safeStr(b.sector || "Multi-secteur", 120),
      stage: safeStr(b.stage || "Early-stage", 60),
      docType: normalizeDocType(b.docType),
      audience: normalizeAudience(b.audience),
      product: safeStr(b.product, 2500),
      customers: safeStr(b.customers, 2500),
      businessModel: safeStr(b.businessModel, 2500),
      traction: safeStr(b.traction, 2500),
      competition: safeStr(b.competition, 2500),
      risks: safeStr(b.risks, 2500),
      finAssumptions: safeStr(b.finAssumptions, 3500),
      fundingAsk: safeStr(b.fundingAsk, 2500),
      draftText,
      rewriteNotes: safeStr(b.notes || "", 2500),
      mode: "rewrite",
    };

    const safeName = safeFilenameBase(ctx.companyName);
    const title =
      lang === "en"
        ? `${safeName} - Business Plan (Premium, Revised)`
        : `${safeName} - Plan d'affaires (Premium, corrige)`;

    const { sections } = await generateBusinessPlanPremium({
      lang,
      ctx,
      lite: false,
    });

    res.setHeader("X-BP-Mode", "rewrite");
    return writeBusinessPlanPdfPremium({
      res,
      title,
      ctx,
      sections,
    });
  } catch (e) {
    console.error("/generate-business-plan/rewrite error:", e);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(e?.message || e),
    });
  }
}

router.get(["/", "/premium"], premiumHealth);
router.post(["/", "/premium"], premiumGenerate);
router.post(["/rewrite", "/premium/rewrite"], upload.single("file"), premiumRewrite);

export default router;
