// bp/routes/generateNgoProject.js
import express from "express";
import crypto from "crypto";
import { generateNgoProjectPremium } from "../core/ngoOrchestrator.js";
import { buildNgoProjectPdfBufferPremium, writeNgoProjectPdfPremium } from "../core/ngoPdfAssembler.js";
import { normalizeLang, safeStr } from "../core/sanitize.js";

const router = express.Router();

/* =========================================================
   ✅ JOB MODE + Anti-concurrency lock

   Root cause of your errors:
   - JOB_NOT_FOUND: jobs are stored only in RAM (Map). On Render, an instance can restart
     (deploy, sleep/wake, memory pressure, crash). When that happens the Map is cleared.
     Frontend keeps polling a jobId that no longer exists => 404 JOB_NOT_FOUND.
   - 500 + "Cannot read properties of undefined (reading 'text')" on client: triggered after
     the backend returns 500/404 and the client tries to parse an unexpected body.

   Minimal fix:
   - During async generation, pre-build the PDF buffer and store it in the job.
   - /result becomes a lightweight response that ONLY streams the already-built PDF.
   - If job is gone (instance restarted), frontend will show a clear error.
========================================================= */

const JOB_TTL_MS = Number(process.env.NGO_JOB_TTL_MS || 1000 * 60 * 60); // 1h
const MAX_JOBS = Number(process.env.NGO_MAX_JOBS || 25);

// id -> { status, createdAt, startedAt, doneAt, error, pdf: { title, bytes, mime } }
const jobs = new Map();

let generationInFlight = false;

function now() {
  return Date.now();
}

function newJobId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function pruneJobs() {
  const t = now();
  for (const [id, j] of jobs.entries()) {
    const createdAt = Number(j?.createdAt || 0);
    if (createdAt && t - createdAt > JOB_TTL_MS) jobs.delete(id);
  }

  if (jobs.size <= MAX_JOBS) return;
  const arr = Array.from(jobs.entries()).sort(
    (a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0)
  );
  const toDrop = Math.max(0, arr.length - MAX_JOBS);
  for (let i = 0; i < toDrop; i++) jobs.delete(arr[i][0]);
}

router.get("/premium", (_req, res) => {
  res.json({
    ok: true,
    message: "✅ Endpoint ONG Premium OK. Utilise POST pour générer le PDF.",
    example: {
      method: "POST",
      url: "/generate-ngo-project/premium",
      body: {
        lang: "fr",
        ctx: {
          projectTitle: "Projet ONG: ...",
          organization: "ONG ...",
          country: "RDC",
          provinceCity: "Goma",
          durationMonths: 12,
          budgetTotal: "USD 250,000",
          donorStyle: "UN",
        },
      },
    },
  });
});

router.get("/premium/jobs/:id", (req, res) => {
  pruneJobs();
  const id = String(req.params.id || "");
  const j = jobs.get(id);
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

router.get("/premium/jobs/:id/result", (req, res) => {
  pruneJobs();
  const id = String(req.params.id || "");
  const j = jobs.get(id);
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (j.status !== "done") {
    return res.status(409).json({ error: "JOB_NOT_READY", status: j.status });
  }

  // ✅ Preferred path: stream stored PDF
  if (j.pdf?.bytes && Buffer.isBuffer(j.pdf.bytes)) {
    res.setHeader("Content-Type", j.pdf.mime || "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizeFilename(j.pdf.title || "ngo_project")}.pdf"`
    );
    return res.status(200).send(j.pdf.bytes);
  }

  // Fallback: if pdf missing, do not crash; return explicit error
  return res.status(500).json({ error: "JOB_PDF_MISSING" });
});

/**
 * POST /generate-ngo-project/premium
 * Query: ?async=1 (optional)
 */
router.post("/premium", async (req, res) => {
  const wantAsync = String(req.query?.async || "") === "1";

  // ✅ Prevent parallel generations on one Render instance
  if (generationInFlight && !wantAsync) {
    return res.status(429).json({
      error: "BUSY",
      details: "Une génération ONG est déjà en cours sur le serveur. Réessaie dans quelques minutes.",
    });
  }

  const lang = normalizeLang(req.body?.lang || "fr");
  const lite = Boolean(req.body?.lite);

  const ctx = {
    projectTitle: safeStr(req.body?.ctx?.projectTitle, 160),
    organization: safeStr(req.body?.ctx?.organization, 160),
    country: safeStr(req.body?.ctx?.country || "RDC", 80),
    provinceCity: safeStr(req.body?.ctx?.provinceCity, 120),
    donorStyle: safeStr(req.body?.ctx?.donorStyle, 40),
    sector: safeStr(req.body?.ctx?.sector, 120),
    problem: safeStr(req.body?.ctx?.problem, 3500),
    targetGroups: safeStr(req.body?.ctx?.targetGroups, 2500),
    overallGoal: safeStr(req.body?.ctx?.overallGoal, 1200),
    specificObjectives: safeStr(req.body?.ctx?.specificObjectives, 1800),
    durationMonths: Number(req.body?.ctx?.durationMonths || 0) || null,
    budgetTotal: safeStr(req.body?.ctx?.budgetTotal, 60),
    startDate: safeStr(req.body?.ctx?.startDate, 40),
    assumptions: safeStr(req.body?.ctx?.assumptions, 2500),
    risks: safeStr(req.body?.ctx?.risks, 2500),
    partners: safeStr(req.body?.ctx?.partners, 1500),
    implementationApproach: safeStr(req.body?.ctx?.implementationApproach, 2000),
    sustainability: safeStr(req.body?.ctx?.sustainability, 2000),
    safeguarding: safeStr(req.body?.ctx?.safeguarding, 1200),
  };

  if (!ctx.projectTitle || !ctx.organization) {
    return res.status(400).json({
      error: "INVALID_INPUT",
      details: "Champs requis: ctx.projectTitle et ctx.organization.",
    });
  }

  const title =
    lang === "en"
      ? `${ctx.projectTitle} — NGO Project Proposal (Premium)`
      : `${ctx.projectTitle} — Projet ONG (Premium)`;

  // ✅ JOB mode
  if (wantAsync) {
    pruneJobs();
    const id = newJobId();
    jobs.set(id, { status: "queued", createdAt: now() });

    (async () => {
      const j = jobs.get(id);
      if (!j) return;

      if (generationInFlight) {
        j.status = "rejected";
        j.error = "GENERATION_IN_FLIGHT";
        j.doneAt = now();
        return;
      }

      generationInFlight = true;
      j.status = "running";
      j.startedAt = now();

      try {
        const result = await generateNgoProjectPremium({ lang, ctx, lite });
        const sections = result?.sections || [];

        // ✅ Build PDF once, store bytes
        const pdfBytes = await buildNgoProjectPdfBufferPremium({
          title,
          ctx,
          sections,
        });

        j.status = "done";
        j.pdf = { title, bytes: pdfBytes, mime: "application/pdf" };
        j.doneAt = now();
      } catch (e) {
        j.status = "error";
        j.error = String(e?.message || e);
        j.doneAt = now();
      } finally {
        generationInFlight = false;
      }
    })();

    return res.status(202).json({
      ok: true,
      jobId: id,
      status: "queued",
      next: {
        status: `/generate-ngo-project/premium/jobs/${id}`,
        result: `/generate-ngo-project/premium/jobs/${id}/result`,
      },
    });
  }

  generationInFlight = true;
  try {
    const result = await generateNgoProjectPremium({ lang, ctx, lite });
    return writeNgoProjectPdfPremium({
      res,
      title,
      ctx,
      sections: result?.sections || [],
    });
  } catch (e) {
    return res.status(500).json({
      error: "NGO_GENERATION_FAILED",
      details: String(e?.message || e),
    });
  } finally {
    generationInFlight = false;
  }
});

export default router;

function sanitizeFilename(name) {
  return String(name || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 100);
}
