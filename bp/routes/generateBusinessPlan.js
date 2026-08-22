// bp/routes/generateBusinessPlan.js
// ✅ Handler Express (router) pour Premium + Rewrite
import express from "express";
import multer from "multer";
import path from "path";
import { generateBusinessPlanPremium } from "../core/orchestrator.js";
import { writeBusinessPlanPdfPremium } from "../core/pdfAssembler.js";
import { makeJobId, getJob } from "../core/jobStore.js";
import { enqueueGenerationJob } from "../core/generationQueue.js";
import { consumePaymentForGeneration, verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";
import { rememberGeneratedDocument } from "../core/generatedDocumentTracker.js";
import {
  normalizeLang,
  normalizeDocType,
  normalizeAudience,
  safeStr,
} from "../core/sanitize.js";

const router = express.Router();

/* =========================================================
   ✅ JOB MODE (optional) + shared concurrent queue
   Why: avoids browser timeouts and allows several users to generate
   documents at the same time, while blocking double-generation per user.
========================================================= */

const JOB_TTL_MS = Number(process.env.BP_JOB_TTL_MS || 1000 * 60 * 60 * 24 * 30); // 30 days
const JOB_NAMESPACE = "bp";

router.get("/premium/jobs/:id", async (req, res) => {
  const id = String(req.params.id || "");
  const j = await getJob(id, { namespace: JOB_NAMESPACE });
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  return res.json({
    jobId: id,
    status: j.status,
    createdAt: j.createdAt,
    startedAt: j.startedAt || null,
    doneAt: j.doneAt || null,
    error: j.error || null,
  });
});

router.get("/premium/jobs/:id/result", async (req, res) => {
  const id = String(req.params.id || "");
  const j = await getJob(id, { namespace: JOB_NAMESPACE });
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (j.status !== "done") {
    return res.status(409).json({ error: "JOB_NOT_READY", status: j.status });
  }
  const result = j.result;
  if (!result?.sections || !result?.ctx || !result?.title) {
    return res.status(500).json({ error: "JOB_RESULT_MISSING" });
  }

  const format = normalizeResultFormat(req.query?.format || req.query?.output || result.output || "pdf");
  if (format === "doc") {
    return writeBusinessPlanWordDoc({
      res,
      title: result.title,
      ctx: result.ctx,
      sections: result.sections,
    });
  }

  // ✅ One-pass PDF (render once here only)
  return writeBusinessPlanPdfPremium({
    res,
    title: result.title,
    ctx: result.ctx,
    sections: result.sections,
  });
});

// ✅ Upload (rewrite brouillon) – mémoire (Render-friendly)
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
  return t.slice(0, maxChars) + `\n\n[...TRONQUÉ: ${t.length - maxChars} caractères...]`;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "oui", "on"].includes(text);
}

function normalizeResultFormat(value) {
  const text = String(value || "pdf").trim().toLowerCase();
  if (["doc", "word", "docx"].includes(text)) return "doc";
  return "pdf";
}

function normalizeOutput(value) {
  const text = String(value || "pdf").trim().toLowerCase();
  if (["doc", "word", "docx"].includes(text)) return "doc";
  if (text === "both") return "both";
  if (text === "json") return "json";
  return "pdf";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sectionText(section) {
  const content = String(section?.content || "").trim();
  if (content) return content;
  if (section?.meta) return JSON.stringify(section.meta, null, 2);
  return "";
}

function buildBusinessPlanWordHtml({ title, ctx, sections }) {
  const rows = [
    ["Entreprise", ctx?.companyName],
    ["Pays", ctx?.country],
    ["Ville(s)", ctx?.city],
    ["Secteur", ctx?.sector],
    ["Audience", ctx?.audience],
    ["Type", ctx?.docType],
    ["Stade", ctx?.stage],
    ["Date", new Date().toLocaleDateString("fr-FR")],
  ].filter(([, value]) => String(value || "").trim());

  const metaRows = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  const body = (Array.isArray(sections) ? sections : [])
    .map((section) => {
      const heading = escapeHtml(section?.title || section?.key || "Section");
      const text = escapeHtml(sectionText(section))
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n/g, "<br>");
      return `<section><h2>${heading}</h2><p>${text || "Information non precisee."}</p></section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || "Business Plan")}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #111827; line-height: 1.45; margin: 42px; }
    h1 { color: #064e3b; font-size: 28px; margin-bottom: 10px; }
    h2 { color: #065f46; font-size: 19px; margin-top: 28px; border-bottom: 1px solid #d1fae5; padding-bottom: 6px; }
    table { border-collapse: collapse; margin: 18px 0 26px; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { width: 150px; background: #ecfdf5; color: #064e3b; }
    p { margin: 10px 0; }
    .note { color: #64748b; font-size: 12px; margin-top: 22px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title || "Business Plan")}</h1>
  <table>${metaRows}</table>
  ${body}
  <p class="note">Document genere automatiquement par DroitGPT a partir des informations fournies. Verifier les chiffres avant tout depot officiel.</p>
</body>
</html>`;
}

function writeBusinessPlanWordDoc({ res, title, ctx, sections }) {
  const filename = `${safeFilenameBase(title || ctx?.companyName || "business-plan")}.doc`;
  res.setHeader("Content-Type", "application/msword; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(Buffer.from(`\ufeff${buildBusinessPlanWordHtml({ title, ctx, sections })}`, "utf8"));
}

async function extractDraftTextFromUpload(file) {
  if (!file || !file.buffer) return "";
  const original = String(file.originalname || "");
  const ext = path.extname(original).toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();

  // TXT
  if (ext === ".txt" || mime.includes("text/plain")) {
    return file.buffer.toString("utf-8");
  }

  // DOCX (mammoth)
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

  // PDF (pdf-parse)
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

  // Fallback: try utf-8
  return file.buffer.toString("utf-8");
}


/**
 * GET /generate-business-plan/premium
 * Utile pour test navigateur (évite "Cannot GET")
 */
router.get("/premium", (_req, res) => {
  res.json({
    ok: true,
    message: "✅ Endpoint premium OK. Utilise POST pour générer le business plan (pdf/doc/json).",
    example: {
      method: "POST",
      url: "/generate-business-plan/premium",
      body: { lang: "fr", companyName: "TEST", output: "json" },
    },
  });
});

/**
 * POST /generate-business-plan/premium
 * Body:
 * {
 *   lang: "fr" | "en",
 *   docType: "startup" | "agri" | "ngo" | "industry",
 *   audience: "investor" | "bank" | "incubator" | "donor",
 *   companyName, country, city, sector, stage,
 *   product, customers, businessModel, traction, competition, risks,
 *   finAssumptions, fundingAsk,
 *   output: "pdf" | "doc" | "both" | "json",
 *   lite: true/false (lite => Canvas+SWOT+Finances seulement)
 *   test: true (retour instantané)
 * }
 */
router.post("/premium", async (req, res) => {
  try {
    const b = req.body || {};

    const wantAsync = String(req.query?.async || "") === "1";

    // ✅ mode test instantané (debug)
    if (b?.test === true) {
      return res.json({ ok: true, message: "✅ Route premium OK (test mode)" });
    }

    const paymentCheck = await verifyPaidPaymentForRequest(req, "businessplan");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
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
        ? `${ctx.companyName} — Business Plan (Premium)`
        : `${ctx.companyName} — Plan d’affaires (Premium)`;

    const output = normalizeOutput(b.output);
    const lite = normalizeBoolean(b.lite);
    const resultFormat = normalizeResultFormat(output);

    const jobId = makeJobId();
    const queued = await enqueueGenerationJob({
      req,
      jobId,
      namespace: JOB_NAMESPACE,
      ttlMs: JOB_TTL_MS,
      meta: { documentType: "businessplan" },
      task: async () => {
        const { sections, fullText } = await generateBusinessPlanPremium({ lang, ctx, lite });
        return { title, lang, ctx, lite, output, sections, fullText };
      },
    });

    if (!queued.accepted) {
      return res.status(queued.statusCode || 429).json(queued.body);
    }

    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "businessplan",
      jobId,
    });
    await rememberGeneratedDocument(req, {
      jobId,
      documentType: "businessplan",
      label: "Business Plan",
      title,
      fileName: `${safeFilenameBase(ctx.companyName || "business-plan")}.${resultFormat === "doc" ? "doc" : "pdf"}`,
      paymentOrderNumber: paymentCheck.orderNumber,
      regenerationBody: { ...b, output, lite },
      regeneratePath: "/generate-business-plan/premium?async=1",
      statusPath: `/generate-business-plan/premium/jobs/${jobId}`,
      resultPath: `/generate-business-plan/premium/jobs/${jobId}/result${resultFormat === "doc" ? "?format=doc" : ""}`,
      statusTemplate: "/generate-business-plan/premium/jobs/{jobId}",
      resultTemplate: `/generate-business-plan/premium/jobs/{jobId}/result${resultFormat === "doc" ? "?format=doc" : ""}`,
    });

    // ✅ JOB mode: return quickly with jobId, run generation in queue
    if (wantAsync) {
      res.status(202).json({
        ok: true,
        jobId,
        status: "queued",
        queue: queued.queue,
        next: {
          status: `/generate-business-plan/premium/jobs/${jobId}`,
          result: `/generate-business-plan/premium/jobs/${jobId}/result`,
        },
      });
      return;
    }

    // ✅ Sync mode (legacy): still goes through the same queue.
    const doneJob = await queued.completion;
    const result = doneJob?.result;
    if (!result?.sections) return res.status(500).json({ error: "JOB_RESULT_MISSING" });

    if (output === "json") {
      return res.json(result);
    }

    if (resultFormat === "doc") {
      return writeBusinessPlanWordDoc({
        res,
        title: result.title,
        ctx: result.ctx,
        sections: result.sections,
      });
    }

    // ✅ PDF Premium (TOC, pages, tableaux Canvas/SWOT/Finances)
    return writeBusinessPlanPdfPremium({
      res,
      title: result.title,
      ctx: result.ctx,
      sections: result.sections,
    });
  } catch (e) {
    console.error("❌ /generate-business-plan/premium error:", e);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(e?.message || e),
    });
  }
});


/**
 * POST /generate-business-plan/premium/rewrite
 * Multipart form-data:
 *  - file: PDF/DOCX/TXT (optional)
 *  - text: texte brut (si pas de fichier)
 *  - notes: consignes (optionnel)
 *  - + champs habituels (companyName, country, ... docType, audience, lang)
 *
 * Sortie: PDF ou Word — même contenu que /premium
 */
router.post("/premium/rewrite", upload.single("file"), async (req, res) => {
  try {
    const b = req.body || {};
    const wantAsync = String(req.query?.async || "") === "1";

    const lang = normalizeLang(b.lang || process.env.BP_LANG_DEFAULT || "fr");

    // 1) extraction texte brouillon (fichier OU texte collé)
    let draftText = "";
    if (req.file) {
      draftText = await extractDraftTextFromUpload(req.file);
    } else {
      draftText = String(b.text || "");
    }

    draftText = truncateText(draftText, Number(process.env.BP_DRAFT_MAX_CHARS || 14000)).trim();

    if (!draftText) {
      return res.status(400).json({
        error: "BROUILLON_VIDE",
        details:
          "Importe un fichier (PDF/DOCX/TXT) OU colle le texte du brouillon dans le champ 'text'.",
      });
    }

    const paymentCheck = await verifyPaidPaymentForRequest(req, "businessplan");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
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

      // ✅ Ajouts non cassants (utilisés par prompts si présents)
      draftText,
      rewriteNotes: safeStr(b.notes || "", 2500),
      mode: "rewrite",
    };

    const safeName = safeFilenameBase(ctx.companyName);
    const title =
      lang === "en"
        ? `${safeName} — Business Plan (Premium, Revised)`
        : `${safeName} — Plan d’affaires (Premium, corrigé)`;
    const output = normalizeOutput(b.output);
    const resultFormat = normalizeResultFormat(output);

    // 2) Génération orchestrée Premium via la queue partagée.
    const jobId = makeJobId();
    const queued = await enqueueGenerationJob({
      req,
      jobId,
      namespace: JOB_NAMESPACE,
      ttlMs: JOB_TTL_MS,
      meta: { documentType: "businessplan_rewrite" },
      task: async () => {
        const { sections } = await generateBusinessPlanPremium({
          lang,
          ctx,
          lite: false,
        });
        return { title, lang, ctx, lite: false, output, sections };
      },
    });

    if (!queued.accepted) {
      return res.status(queued.statusCode || 429).json(queued.body);
    }

    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "businessplan",
      jobId,
    });
    await rememberGeneratedDocument(req, {
      jobId,
      documentType: "businessplan_rewrite",
      label: "Business Plan corrige",
      title,
      fileName: `${safeName || "business-plan-corrige"}.${resultFormat === "doc" ? "doc" : "pdf"}`,
      paymentOrderNumber: paymentCheck.orderNumber,
      regenerationBody: { ...b, output, text: draftText },
      regeneratePath: "/generate-business-plan/premium/rewrite?async=1",
      statusPath: `/generate-business-plan/premium/jobs/${jobId}`,
      resultPath: `/generate-business-plan/premium/jobs/${jobId}/result${resultFormat === "doc" ? "?format=doc" : ""}`,
      statusTemplate: "/generate-business-plan/premium/jobs/{jobId}",
      resultTemplate: `/generate-business-plan/premium/jobs/{jobId}/result${resultFormat === "doc" ? "?format=doc" : ""}`,
    });

    if (wantAsync) {
      return res.status(202).json({
        ok: true,
        jobId,
        status: "queued",
        queue: queued.queue,
        next: {
          status: `/generate-business-plan/premium/jobs/${jobId}`,
          result: `/generate-business-plan/premium/jobs/${jobId}/result`,
        },
      });
    }

    const doneJob = await queued.completion;
    const result = doneJob?.result;
    if (!result?.sections) return res.status(500).json({ error: "JOB_RESULT_MISSING" });

    res.setHeader("X-BP-Mode", "rewrite");
    if (resultFormat === "doc") {
      return writeBusinessPlanWordDoc({
        res,
        title: result.title,
        ctx: result.ctx,
        sections: result.sections,
      });
    }

    return writeBusinessPlanPdfPremium({
      res,
      title: result.title,
      ctx: result.ctx,
      sections: result.sections,
    });
  } catch (e) {
    console.error("❌ /generate-business-plan/premium/rewrite error:", e);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(e?.message || e),
    });
  }
});


export default router;
