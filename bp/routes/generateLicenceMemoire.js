import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import { PassThrough } from "stream";
import { createReadStream, promises as fsp } from "fs";
import path from "path";
import crypto from "crypto";

import { generateLicenceMemoire, reviseLicenceMemoireFromDraft } from "../core/academicOrchestrator.js";
import { writeLicenceMemoirePdf } from "../core/academicPdfAssembler.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * ---------------------------------------------------------
 * Async Job Store (in-memory + /tmp pdf file)
 * - Fixes: downloads lost when device sleeps
 * - Frontend can poll status + re-download without regeneration
 * ---------------------------------------------------------
 */
const JOB_TTL_MS = Number(process.env.ACAD_JOB_TTL_MS || 2 * 60 * 60 * 1000); // default 2h
const jobs = new Map(); // jobId -> { status, progress, createdAt, updatedAt, filePath, fileName, error, sourcesUsed }

function now() {
  return Date.now();
}

function newJobId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(crypto.randomBytes(16).toString("hex")));
}

function setJob(jobId, patch) {
  const prev = jobs.get(jobId) || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: now(),
  };
  jobs.set(jobId, next);
  return next;
}

async function cleanupJobs() {
  const t = now();
  for (const [id, j] of jobs.entries()) {
    if (!j?.createdAt) {
      jobs.delete(id);
      continue;
    }
    if (t - j.createdAt > JOB_TTL_MS) {
      if (j.filePath) {
        try { await fsp.unlink(j.filePath); } catch {}
      }
      jobs.delete(id);
    }
  }
}

// periodic cleanup (non-blocking)
setInterval(() => {
  cleanupJobs().catch(() => {});
}, Math.max(30_000, Math.min(JOB_TTL_MS, 10 * 60_000))).unref?.();

/**
 * Render PDF to Buffer without changing academicPdfAssembler
 */
async function renderLicenceMemoirePdfBuffer({ title, ctx, plan, sections }) {
  const headers = {};
  const stream = new PassThrough();

  const resLike = {
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = String(v);
    },
    // pdfkit will call .write/.end via piping; PassThrough handles those
    write: (...args) => stream.write(...args),
    end: (...args) => stream.end(...args),
    on: (...args) => stream.on(...args),
    once: (...args) => stream.once(...args),
    emit: (...args) => stream.emit(...args),
  };

  const chunks = [];
  stream.on("data", (c) => chunks.push(Buffer.from(c)));
  const done = new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  // call assembler (pipes to our PassThrough)
  writeLicenceMemoirePdf({ res: resLike, title, ctx, plan, sections });

  await done;
  return { buffer: Buffer.concat(chunks), headers };
}

async function extractDraftText(file) {
  if (!file) throw new Error("Aucun fichier brouillon recu.");
  const name = String(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();

  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const r = await mammoth.extractRawText({ buffer: file.buffer });
    return String(r.value || "").trim();
  }

  if (name.endsWith(".txt") || mime.startsWith("text/")) {
    return String(file.buffer.toString("utf-8") || "").trim();
  }

  if (name.endsWith(".pdf") || mime === "application/pdf") {
    const extractUrl = process.env.ANALYSE_PDF_EXTRACT_URL;
    if (!extractUrl) {
      throw new Error(
        "Import PDF non active. Configure ANALYSE_PDF_EXTRACT_URL (service d'extraction) ou utilise un DOCX."
      );
    }

    // Node 22 has fetch/FormData/Blob; if not, the route will throw clearly.
    const fd = new FormData();
    fd.append("file", new Blob([file.buffer], { type: "application/pdf" }), file.originalname || "draft.pdf");

    const resp = await fetch(extractUrl, { method: "POST", body: fd });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Extraction PDF echouee: ${resp.status} ${t.slice(0, 200)}`);
    }

    const j = await resp.json();
    const txt = j?.text || j?.content || "";
    return String(txt || "").trim();
  }

  throw new Error(
    "Format de brouillon non supporte. Utilise .docx ou .txt (PDF seulement si ANALYSE_PDF_EXTRACT_URL est configure). "
  );
}

function memoireHealth(_req, res) {
  res.json({
    ok: true,
    message: "Endpoint licence-memoire OK.",
    asyncMode: "POST /licence-memoire?async=1 returns {jobId}. Then GET /jobs/:jobId/status and /jobs/:jobId/download.",
  });
}

function wantsAsync(req) {
  const q = String(req.query?.async || "").trim();
  const b = req.body || {};
  const h = String(req.headers["x-prefer-async"] || req.headers["prefer"] || "").toLowerCase();
  return q === "1" || q === "true" || b?.async === true || b?.async === "true" || h.includes("respond-async") || h === "1";
}

function buildCtxFromBody(b) {
  return {
    mode: b.mode === "droit_congolais" ? "droit_congolais" : "standard",
    citationStyle: b.citationStyle === "apa" ? "apa" : "footnotes",
    topic: String(b.topic || "").trim(),
    university: String(b.university || "").trim(),
    faculty: String(b.faculty || "").trim(),
    department: String(b.department || "").trim(),
    academicYear: String(b.academicYear || "").trim(),
    problemStatement: String(b.problemStatement || "").trim(),
    objectives: String(b.objectives || "").trim(),
    methodology: String(b.methodology || "doctrinale").trim(),
    plan: String(b.plan || "").trim(),
    lengthPagesTarget: Number(b.lengthPagesTarget || 70),
    studentName: String(b.studentName || "").trim(),
    supervisorName: String(b.supervisorName || "").trim(),
  };
}

async function runMemoireJob({ jobId, lang, ctx }) {
  try {
    setJob(jobId, { status: "running", progress: 5, message: "Génération du plan et des sections…" });

    const title = lang === "en" ? `${ctx.topic || "Bachelor Dissertation"}` : `${ctx.topic || "Memoire de licence"}`;

    const { plan, sections, sourcesUsed } = await generateLicenceMemoire({ lang, ctx });
    ctx.sourcesUsed = Array.isArray(sourcesUsed) ? sourcesUsed : [];

    setJob(jobId, {
      progress: 85,
      message: "Assemblage PDF…",
      sourcesUsed: Array.isArray(sourcesUsed) ? sourcesUsed.slice(0, 50) : [],
      title,
    });

    const { buffer } = await renderLicenceMemoirePdfBuffer({ title, ctx, plan, sections });

    const fileNameBase = String(title || "memoire")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "memoire";

    const filePath = path.join("/tmp", `memoire_${jobId}.pdf`);
    await fsp.writeFile(filePath, buffer);

    setJob(jobId, {
      status: "done",
      progress: 100,
      message: "Terminé",
      filePath,
      fileName: `${fileNameBase}.pdf`,
      sizeBytes: buffer.length,
      doneAt: now(),
    });
  } catch (e) {
    console.error("[MemoireJob] error:", e);
    setJob(jobId, {
      status: "error",
      progress: 100,
      error: String(e?.message || e),
      message: "Erreur",
    });
  }
}

async function generateMemoire(req, res) {
  req.setTimeout(46 * 60 * 1000);
  res.setTimeout(46 * 60 * 1000);

  try {
    const b = req.body || {};
    const lang = String(b.language || "fr").toLowerCase() === "en" ? "en" : "fr";
    const ctx = buildCtxFromBody(b);

    // ✅ Async mode (recommended for web: survives device sleep)
    if (wantsAsync(req)) {
      const jobId = newJobId();
      setJob(jobId, { status: "queued", progress: 0, createdAt: now(), message: "En file…" });

      // fire and forget
      runMemoireJob({ jobId, lang, ctx }).catch(() => {});

      const base = `${req.protocol}://${req.get("host")}`;
      return res.status(202).json({
        ok: true,
        jobId,
        statusUrl: `${base}/generate-academic/jobs/${jobId}/status`,
        downloadUrl: `${base}/generate-academic/jobs/${jobId}/download`,
      });
    }

    // ✅ Legacy sync mode: stream PDF directly (keeps compatibility)
    const title = lang === "en" ? `${ctx.topic || "Bachelor Dissertation"}` : `${ctx.topic || "Memoire de licence"}`;

    const { plan, sections, sourcesUsed } = await generateLicenceMemoire({ lang, ctx });
    ctx.sourcesUsed = Array.isArray(sourcesUsed) ? sourcesUsed : [];

    res.setHeader("Access-Control-Expose-Headers", "x-sources-used");
    if (ctx.mode === "droit_congolais" && Array.isArray(sourcesUsed) && sourcesUsed.length) {
      res.setHeader("x-sources-used", JSON.stringify(sourcesUsed.slice(0, 20)));
    } else {
      res.setHeader("x-sources-used", JSON.stringify([]));
    }

    return writeLicenceMemoirePdf({ res, title, ctx, plan, sections });
  } catch (e) {
    console.error("/generate-memoire error:", e);
    return res.status(500).json({ error: "Erreur serveur", details: String(e?.message || e) });
  }
}

async function jobStatus(req, res) {
  const jobId = String(req.params.jobId || "").trim();
  const j = jobs.get(jobId);
  if (!j) return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });

  return res.json({
    ok: true,
    jobId,
    status: j.status || "queued",
    progress: Number(j.progress || 0),
    message: j.message || "",
    error: j.error || null,
    fileName: j.fileName || null,
    sizeBytes: j.sizeBytes || null,
    createdAt: j.createdAt || null,
    updatedAt: j.updatedAt || null,
  });
}

async function jobDownload(req, res) {
  const jobId = String(req.params.jobId || "").trim();
  const j = jobs.get(jobId);
  if (!j) return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });

  if (j.status !== "done" || !j.filePath) {
    return res.status(409).json({
      ok: false,
      error: "JOB_NOT_READY",
      status: j.status || "queued",
      progress: Number(j.progress || 0),
      message: j.message || "",
    });
  }

  // Ensure file exists
  try {
    await fsp.access(j.filePath);
  } catch {
    return res.status(410).json({ ok: false, error: "FILE_EXPIRED" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${j.fileName || "memoire.pdf"}"`);
  res.setHeader("Cache-Control", "no-store");

  // expose sources if available (useful for UI)
  res.setHeader("Access-Control-Expose-Headers", "x-sources-used, Content-Disposition");
  res.setHeader("x-sources-used", JSON.stringify(Array.isArray(j.sourcesUsed) ? j.sourcesUsed.slice(0, 20) : []));

  const rs = createReadStream(j.filePath);
  rs.on("error", (e) => {
    console.error("download stream error:", e);
    if (!res.headersSent) res.status(500).end("Stream error");
  });
  return rs.pipe(res);
}

async function reviseMemoire(req, res) {
  req.setTimeout(46 * 60 * 1000);
  res.setTimeout(46 * 60 * 1000);

  try {
    const b = req.body || {};
    const lang = String(b.language || b.lang || "fr");
    const title = String(b.title || b.topic || "Memoire (version corrigee)");
    const ctx = b.ctx ? (typeof b.ctx === "string" ? JSON.parse(b.ctx) : b.ctx) : {};

    const draftText = await extractDraftText(req.file);

    const result = await reviseLicenceMemoireFromDraft({ lang, title, ctx, draftText });

    res.setHeader("Access-Control-Expose-Headers", "x-sources-used");
    res.setHeader("x-sources-used", JSON.stringify([]));

    return writeLicenceMemoirePdf({
      res,
      title: result.title,
      ctx: result.ctx,
      plan: result.plan,
      sections: result.sections,
    });
  } catch (err) {
    console.error("reviseLicenceMemoire error:", err);
    return res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
}

// Routes
router.get(["/", "/licence-memoire"], memoireHealth);
router.post(["/", "/licence-memoire"], generateMemoire);

// Async job endpoints
router.get("/jobs/:jobId/status", jobStatus);
router.get("/jobs/:jobId/download", jobDownload);

router.options(["/revise", "/licence-memoire/revise"], (_req, res) => res.sendStatus(204));
router.post(["/revise", "/licence-memoire/revise"], upload.single("file"), reviseMemoire);

export default router;
