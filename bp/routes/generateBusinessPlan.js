// bp/routes/generateBusinessPlan.js
// ✅ Handler Express (router) pour Premium + Rewrite
import express from "express";
import multer from "multer";
import path from "path";
import { generateBusinessPlanPremium } from "../core/orchestrator.js";
import { writeBusinessPlanPdfPremium } from "../core/pdfAssembler.js";
import { makeJobId, nowMs, putJob, getJob, patchJob } from "../core/jobStore.js";
import {
  normalizeLang,
  normalizeDocType,
  normalizeAudience,
  safeStr,
} from "../core/sanitize.js";

const router = express.Router();

/* =========================================================
   ✅ JOB MODE (optional) + Anti-concurrency lock
   Why: prevents browser timeout/veille AND prevents parallel generations
   that make a 11 min run become 17+ min on small Render instances.
========================================================= */

const JOB_TTL_MS = Number(process.env.BP_JOB_TTL_MS || 1000 * 60 * 60); // 1h
const JOB_NAMESPACE = "bp";
let generationInFlight = false; // per-instance lock (Render)

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
    message: "✅ Endpoint premium OK. Utilise POST pour générer le business plan (pdf/json).",
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
 *   output: "pdf" | "json",
 *   lite: true/false (lite => Canvas+SWOT+Finances seulement)
 *   test: true (retour instantané)
 * }
 */
router.post("/premium", async (req, res) => {
  try {
    const b = req.body || {};

    const wantAsync = String(req.query?.async || "") === "1";

    // ✅ Prevent parallel generations on a single Render instance
    // Parallel runs are the #1 reason a 11 min generation becomes 17+ min.
    if (generationInFlight) {
      return res.status(429).json({
        error: "BUSY",
        details:
          "Une génération est déjà en cours sur le serveur. Réessaie dans quelques minutes.",
      });
    }

    // ✅ mode test instantané (debug)
    if (b?.test === true) {
      return res.json({ ok: true, message: "✅ Route premium OK (test mode)" });
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

    const output = String(b.output || "pdf").toLowerCase();
    const lite = Boolean(b.lite);

    // ✅ JOB mode: return quickly with jobId, run generation in background
    if (wantAsync) {
      const jobId = makeJobId();
      await putJob(
        { id: jobId, status: "queued", createdAt: nowMs(), error: null, result: null },
        { ttlMs: JOB_TTL_MS, namespace: JOB_NAMESPACE }
      );

      // IMPORTANT: set lock BEFORE replying to avoid race conditions
      generationInFlight = true;

      res.status(202).json({ ok: true, jobId });

      // background run
      (async () => {
        const j = await getJob(jobId, { namespace: JOB_NAMESPACE });
        if (!j) {
          generationInFlight = false;
          return;
        }

        await patchJob(
          jobId,
          { status: "running", startedAt: nowMs() },
          { ttlMs: JOB_TTL_MS, namespace: JOB_NAMESPACE }
        );

        try {
          const { sections } = await generateBusinessPlanPremium({ lang, ctx, lite });
          await patchJob(
            jobId,
            {
              result: { title, lang, ctx, lite, sections },
              status: "done",
              doneAt: nowMs(),
            },
            { ttlMs: JOB_TTL_MS, namespace: JOB_NAMESPACE }
          );
        } catch (e) {
          await patchJob(
            jobId,
            { status: "error", error: String(e?.message || e), doneAt: nowMs() },
            { ttlMs: JOB_TTL_MS, namespace: JOB_NAMESPACE }
          );
        } finally {
          generationInFlight = false;
        }
      })();

      return;
    }

    // ✅ Sync mode (legacy)
    generationInFlight = true;

    // Best-effort stop if client disconnects
    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
    });

    const { sections, fullText } = await generateBusinessPlanPremium({ lang, ctx, lite });

    if (clientClosed) {
      generationInFlight = false;
      return;
    }

    if (output === "json") {
      generationInFlight = false;
      return res.json({ title, lang, ctx, lite, sections, fullText });
    }

    // ✅ PDF Premium (TOC, pages, tableaux Canvas/SWOT/Finances)
    // Ensure lock is released when stream finishes
    res.on("finish", () => {
      generationInFlight = false;
    });
    res.on("close", () => {
      generationInFlight = false;
    });

    return writeBusinessPlanPdfPremium({ res, title, ctx, sections });
  } catch (e) {
    console.error("❌ /generate-business-plan/premium error:", e);
    generationInFlight = false;
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
 * Sortie: PDF (stable) — même assembleur que /premium
 */
router.post("/premium/rewrite", upload.single("file"), async (req, res) => {
  try {
    const b = req.body || {};

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

    // 2) Génération orchestrée Premium (mêmes sections, mais prompts peuvent tenir compte du brouillon)
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
    console.error("❌ /generate-business-plan/premium/rewrite error:", e);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(e?.message || e),
    });
  }
});


export default router;
