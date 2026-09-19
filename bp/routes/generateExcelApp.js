// bp/routes/generateExcelApp.js
import express from "express";
import fs from "node:fs";

import { generateExcelApp } from "../core/excelOrchestrator.js";
import { makeJobId, getJob } from "../core/jobStore.js";
import { enqueueGenerationJob } from "../core/generationQueue.js";
import { ensureJobAccess } from "../core/jobAccess.js";
import { consumePaymentForGeneration, verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";
import { rememberGeneratedDocument } from "../core/generatedDocumentTracker.js";

const router = express.Router();

const JOB_TTL_MS = Number(process.env.EXCEL_JOB_TTL_MS || 1000 * 60 * 60 * 24 * 30); // 30 days
const JOB_NAMESPACE = "excel";

// POST /generate-excel-app?async=1
router.post("/", async (req, res) => {
  const asyncMode = String(req.query.async || "") === "1";

  const body = req.body || {};
  const lang = body.lang || "fr";
  const ctx = body.ctx || {};

  const paymentCheck = await verifyPaidPaymentForRequest(req, "excel_app");
  if (!paymentCheck.ok) {
    return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
  }

  try {
    const id = makeJobId();
    const title = ctx?.appName || "Progiciel Excel";
    const queued = await enqueueGenerationJob({
      req,
      jobId: id,
      namespace: JOB_NAMESPACE,
      ttlMs: JOB_TTL_MS,
      meta: { documentType: "excel_app" },
      processor: "excel_app",
      payload: { lang, ctx },
      task: async () => {
        const out = await generateExcelApp({ lang, ctx });
        return {
          fileNameBase: out.fileNameBase,
          blueprint: out.blueprint,
          xlsxBase64: out.xlsxBuffer.toString("base64"),
        };
      },
    });

    if (!queued.accepted) {
      return res.status(queued.statusCode || 429).json(queued.body);
    }

    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "excel_app",
      jobId: id,
    });
    await rememberGeneratedDocument(req, {
      jobId: id,
      documentType: "excel_app",
      label: "Progiciel Excel",
      title,
      fileName: "progiciel-excel.xlsx",
      paymentOrderNumber: paymentCheck.orderNumber,
      regenerationBody: { lang, ctx },
      regeneratePath: "/generate-excel-app?async=1",
      statusPath: `/generate-excel-app/jobs/${id}`,
      resultPath: `/generate-excel-app/jobs/${id}/result`,
      statusTemplate: "/generate-excel-app/jobs/{jobId}",
      resultTemplate: "/generate-excel-app/jobs/{jobId}/result",
    });

    if (asyncMode) return res.status(202).json({ jobId: id, status: "queued", queue: queued.queue });

    const doneJob = await queued.completion;
    return writeExcelJobResult(res, doneJob);
  } catch (e) {
    console.error("[EXCEL] generation failed", { msg: String(e?.message || e), stack: e?.stack });
    return res.status(500).json({ error: "EXCEL_GENERATION_FAILED", message: String(e?.message || e) });
  }
});

// GET /generate-excel-app/jobs/:id
router.get("/jobs/:id", (req, res) => {
  const id = req.params.id;
  getJob(id, { namespace: JOB_NAMESPACE })
    .then((job) => {
      if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
      if (!ensureJobAccess(req, res, job)) return;
      return res.json({
        jobId: id,
        status: job.status,
        error: job.error || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
    })
    .catch(() => res.status(500).json({ error: "JOB_STORE_ERROR" }));
});

// GET /generate-excel-app/jobs/:id/result
router.get("/jobs/:id/result", (req, res) => {
  const id = req.params.id;
  getJob(id, { namespace: JOB_NAMESPACE })
    .then((job) => {
      if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
      if (!ensureJobAccess(req, res, job)) return;
      return writeExcelJobResult(res, job);
    })
    .catch(() => res.status(500).json({ error: "JOB_STORE_ERROR" }));
});

function writeExcelJobResult(res, job) {
  if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (job.status !== "done" || (!job.result?.filePath && !job.result?.xlsxBase64)) {
    return res.status(409).json({ error: "JOB_NOT_READY", status: job.status, message: job.error || null });
  }

  const fp = job.result.filePath;
  const buffer = fp && fs.existsSync(fp) ? fs.readFileSync(fp) : job.result.xlsxBase64 ? Buffer.from(job.result.xlsxBase64, "base64") : null;
  if (!buffer) {
    return res.status(410).json({ error: "RESULT_EXPIRED" });
  }

  const fileName = `${job.result.fileNameBase || "excel-app"}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.status(200).send(buffer);
}

export default router;
