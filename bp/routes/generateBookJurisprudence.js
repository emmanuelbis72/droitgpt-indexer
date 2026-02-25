import crypto from "node:crypto";

// routes/generateBookJurisprudence.js
// Express route — DroitGPT Editions: generate jurisprudence book PDF
// Supports sync and async mode (?async=1) similar pattern to NGO.

import { generateJurisprudenceBook } from '../core/bookOrchestrator.js';
import { writeJurisprudenceBookPdf } from '../core/bookPdfAssembler.js';

// In-memory job store (Render single-instance). For multi-instance use Redis/DB.
const JOBS = new Map();
const JOB_TTL_MS = Number(process.env.BOOK_JOB_TTL_MS || 2 * 60 * 60 * 1000); // 2h

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
    job.status = 'running';
    job.updatedAt = now();

    const result = await generateJurisprudenceBook({ lang: job.lang, ctx: job.ctx, lite: job.lite });

    job.status = 'done';
    job.updatedAt = now();
    job.result = result;
  } catch (e) {
    job.status = 'error';
    job.updatedAt = now();
    job.error = String(e?.message || e);
  }
}

export function registerGenerateBookJurisprudence(app) {
  if (!app) throw new Error('registerGenerateBookJurisprudence(app) required');

  // POST /generate-book/jurisprudence
  app.post('/generate-book/jurisprudence', async (req, res) => {
    cleanupJobs();

    const asyncMode = String(req.query.async || '') === '1';

    const body = req.body || {};
    const lang = body.lang || 'fr';
    const lite = Boolean(body.lite);
    const ctx = body.ctx || {};

    if (asyncMode) {
      const id = makeId();
      JOBS.set(id, {
        id,
        status: 'queued',
        createdAt: now(),
        updatedAt: now(),
        lang,
        lite,
        ctx,
        result: null,
        error: null,
      });

      // Fire and forget (within this request lifecycle)
      runJob(id);

      return res.json({ jobId: id, status: 'queued' });
    }

    try {
      const out = await generateJurisprudenceBook({ lang, ctx, lite });
      return writeJurisprudenceBookPdf({
        res,
        title: out.title,
        subtitle: out.subtitle,
        meta: out.meta,
        chapters: out.chapters,
        annexRows: out.annexRows,
        indexTerms: out.indexTerms,
      });
    } catch (e) {
      console.error('[BOOK] generation failed', { msg: String(e?.message || e), stack: e?.stack });
      return res.status(500).json({ error: 'BOOK_GENERATION_FAILED', message: String(e?.message || e) });
    }
  });

  // GET /generate-book/jurisprudence/jobs/:id
  app.get('/generate-book/jurisprudence/jobs/:id', (req, res) => {
    cleanupJobs();
    const id = req.params.id;
    const job = JOBS.get(id);
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });

    return res.json({
      jobId: id,
      status: job.status,
      error: job.error || null,
      updatedAt: job.updatedAt,
      createdAt: job.createdAt,
    });
  });

  // GET /generate-book/jurisprudence/jobs/:id/result
  app.get('/generate-book/jurisprudence/jobs/:id/result', (req, res) => {
    cleanupJobs();
    const id = req.params.id;
    const job = JOBS.get(id);
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    if (job.status !== 'done' || !job.result) {
      return res.status(409).json({ error: 'JOB_NOT_READY', status: job.status, message: job.error || null });
    }

    const out = job.result;
    return writeJurisprudenceBookPdf({
      res,
      title: out.title,
      subtitle: out.subtitle,
      meta: out.meta,
      chapters: out.chapters,
      annexRows: out.annexRows,
      indexTerms: out.indexTerms,
    });
  });
}
