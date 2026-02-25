import crypto from "node:crypto";
import express from "express";

// routes/generateScientificArticle.js
// Generates a scientific article (PDF) with optional RAG for Congolese law.
// Supports sync and async (?async=1) with in-memory jobs (single Render instance).

import { generateScientificArticle } from "../core/articleOrchestrator.js";
import { writeScientificArticlePdf } from "../core/articlePdfAssembler.js";

const router = express.Router();

const JOBS = new Map();
const JOB_TTL_MS = Number(process.env.ARTICLE_JOB_TTL_MS || 2 * 60 * 60 * 1000); // 2h

function now() {
  return Date.now();
}

function cleanupJobs() {
  const t = now();
  for (const [id, j] of JOBS.entries()) {
    if (t - (j.updatedAt || j.createdAt || t) > JOB_TTL_MS) JOBS.delete(id);
  }
}

function makeId() {
  return crypto.randomUUID();
}

async function runJob(jobId) {
  const job = JOBS.get(jobId);
  if (!job) return;

  try {
    job.status = "running";
    job.updatedAt = now();

    const result = await generateScientificArticle({
      lang: job.lang,
      mode: job.mode,
      ctx: job.ctx,
      lite: job.lite,
    });

    job.status = "done";
    job.updatedAt = now();
    job.result = result;
  } catch (e) {
    job.status = "error";
    job.updatedAt = now();
    job.error = String(e?.message || e);
  }
}

// POST /generate-article
router.post("/", async (req, res) => {
  cleanupJobs();
  const asyncMode = String(req.query.async || "") === "1";

  const body = req.body || {};
  const lang = body.lang || "fr";
  const lite = Boolean(body.lite);
  // mode: "law_rag" | "scientific"
  const mode = body.mode === "law_rag" ? "law_rag" : "scientific";
  const ctx = body.ctx || {};

  if (asyncMode) {
    const id = makeId();
    JOBS.set(id, {
      id,
      status: "queued",
      createdAt: now(),
      updatedAt: now(),
      lang,
      lite,
      mode,
      ctx,
      result: null,
      error: null,
    });

    runJob(id);
    return res.json({ jobId: id, status: "queued" });
  }

  try {
    const out = await generateScientificArticle({ lang, mode, ctx, lite });
    return writeScientificArticlePdf({ res, ...out });
  } catch (e) {
    console.error("[ARTICLE] generation failed", { msg: String(e?.message || e), stack: e?.stack });
    return res.status(500).json({ error: "ARTICLE_GENERATION_FAILED", message: String(e?.message || e) });
  }
});

// GET /generate-article/jobs/:id
router.get("/jobs/:id", (req, res) => {
  cleanupJobs();
  const id = req.params.id;
  const job = JOBS.get(id);
  if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });

  return res.json({
    jobId: id,
    status: job.status,
    error: job.error || null,
    updatedAt: job.updatedAt,
    createdAt: job.createdAt,
  });
});

// GET /generate-article/jobs/:id/result
router.get("/jobs/:id/result", (req, res) => {
  cleanupJobs();
  const id = req.params.id;
  const job = JOBS.get(id);
  if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (job.status !== "done" || !job.result) {
    return res.status(409).json({ error: "JOB_NOT_READY", status: job.status, message: job.error || null });
  }

  return writeScientificArticlePdf({ res, ...job.result });
});

export default router;
