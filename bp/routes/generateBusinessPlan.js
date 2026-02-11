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

// -------------------------------
// ✅ Async JOB store (anti-veille)
// - Keeps legacy sync PDF response intact
// - ?async=1 returns { jobId, statusUrl, downloadUrl }
// -------------------------------
const BP_JOB_TTL_MS = Number(process.env.BP_JOB_TTL_MS || 2 * 60 * 60 * 1000); // 2h
const bpJobs = new Map();

function newJobId() {
  return `bp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function setJob(jobId, patch) {
  const cur = bpJobs.get(jobId) || {};
  bpJobs.set(jobId, { ...cur, ...patch });
}

function getJob(jobId) {
  const j = bpJobs.get(jobId);
  if (!j) return null;
  const age = Date.now() - (j.createdAtMs || 0);
  if (j.createdAtMs && age > BP_JOB_TTL_MS) {
    // cleanup expired
    try {
      if (j.filePath) {
        // best effort
        import("fs").then(({ default: fs }) => fs.unlink(j.filePath, () => {})).catch(() => {});
      }
    } catch {}
    bpJobs.delete(jobId);
    return null;
  }
  return j;
}

function cleanupJobs() {
  const t = Date.now();
  for (const [id, j] of bpJobs.entries()) {
    if (j?.createdAtMs && t - j.createdAtMs > BP_JOB_TTL_MS) {
      bpJobs.delete(id);
    }
  }
}
setInterval(cleanupJobs, 15 * 60 * 1000).unref();


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


async function runBusinessPlanJob({ jobId, lang, ctx, lite }) {
  const fsMod = await import("fs");
  const fs = fsMod.default || fsMod;
  const osMod = await import("os");
  const os = osMod.default || osMod;
  const tmpDir = os.tmpdir ? os.tmpdir() : "/tmp";
  const safeBase = safeFilenameBase(ctx?.companyName || "business-plan");
  const filePath = path.join(tmpDir, `${jobId}_${safeBase}.pdf`);

  try {
    setJob(jobId, { status: "running", progress: 5, message: "Génération des sections...", updatedAt: nowIso() });

    
    // ✅ Async mode (anti-veille): return jobId immediately
    const asyncMode =
      String(req.query?.async || "").trim() === "1" ||
      String(req.query?.async || "").trim().toLowerCase() === "true" ||
      b?.async === true;

    if (asyncMode) {
      const jobId = newJobId();
      setJob(jobId, {
        id: jobId,
        kind: "business_plan_premium",
        status: "queued",
        progress: 1,
        message: "En file d'attente...",
        createdAt: nowIso(),
        createdAtMs: Date.now(),
        updatedAt: nowIso(),
      });

      // Fire-and-forget generation in-process
      runBusinessPlanJob({ jobId, lang, ctx, lite: Boolean(b?.lite) }).catch((e) => {
        setJob(jobId, {
          status: "error",
          progress: 100,
          message: "Erreur génération.",
          updatedAt: nowIso(),
          error: String(e?.message || e),
        });
      });

      return res.status(202).json({
        ok: true,
        async: true,
        jobId,
        statusUrl: `/generate-business-plan/jobs/${jobId}/status`,
        downloadUrl: `/generate-business-plan/jobs/${jobId}/download`,
      });
    }

const { sections, fullText } = await generateBusinessPlanPremium({ lang, ctx, lite });

    setJob(jobId, { progress: 70, message: "Assemblage PDF...", updatedAt: nowIso(), sectionsCount: sections?.length || 0 });

    const pdfBuffer = await writeBusinessPlanPdfPremium({
      lang,
      ctx,
      sections,
      fullText,
    });

    fs.writeFileSync(filePath, pdfBuffer);

    setJob(jobId, {
      status: "done",
      progress: 100,
      message: "PDF prêt.",
      updatedAt: nowIso(),
      doneAt: nowIso(),
      filePath,
      fileName: `${safeBase}.pdf`,
      bytes: pdfBuffer?.length || 0,
    });
  } catch (e) {
    setJob(jobId, {
      status: "error",
      progress: 100,
      message: "Erreur génération.",
      updatedAt: nowIso(),
      error: String(e?.message || e),
    });
  }
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


// -------------------------------
// ✅ JOB endpoints (status + download)
// -------------------------------
async function jobStatus(req, res) {
  const jobId = String(req.params.jobId || "").trim();
  const j = getJob(jobId);
  if (!j) {
    return res.status(404).json({ error: "JOB_NOT_FOUND", jobId });
  }
  return res.json({
    ok: true,
    jobId,
    status: j.status,
    progress: Number(j.progress || 0),
    message: j.message || "",
    error: j.error || null,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    doneAt: j.doneAt || null,
    bytes: j.bytes || null,
  });
}

async function jobDownload(req, res) {
  const jobId = String(req.params.jobId || "").trim();
  const j = getJob(jobId);
  if (!j) {
    return res.status(404).json({ error: "JOB_NOT_FOUND", jobId });
  }
  if (j.status !== "done" || !j.filePath) {
    return res.status(409).json({
      error: "JOB_NOT_READY",
      jobId,
      status: j.status,
      progress: Number(j.progress || 0),
      message: j.message || "",
    });
  }

  try {
    const fsMod = await import("fs");
    const fs = fsMod.default || fsMod;

    if (!fs.existsSync(j.filePath)) {
      return res.status(410).json({ error: "JOB_FILE_MISSING", jobId });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${j.fileName || "business-plan.pdf"}"`);
    res.setHeader("x-job-id", jobId);

    const stream = fs.createReadStream(j.filePath);
    stream.on("error", (e) => {
      console.error("jobDownload stream error:", e);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (e) {
    return res.status(500).json({ error: "DOWNLOAD_FAILED", details: String(e?.message || e) });
  }
}

router.get(["/jobs/:jobId/status", "/premium/jobs/:jobId/status"], jobStatus);
router.get(["/jobs/:jobId/download", "/premium/jobs/:jobId/download"], jobDownload);

export default router;
