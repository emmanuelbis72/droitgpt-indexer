// bp/routes/generateExcelApp.js
import express from "express";
import fs from "node:fs";
import path from "node:path";

import { generateExcelApp } from "../core/excelOrchestrator.js";
import { makeJobId, nowMs, putJob, getJob, patchJob } from "../core/jobStore.js";
import { consumePaymentForGeneration, verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";

const router = express.Router();

const JOB_TTL_MS = Number(process.env.EXCEL_JOB_TTL_MS || 1000 * 60 * 60 * 24 * 30); // 30 days

function tmpFilePath(id) {
  return path.join("/tmp", `droitgpt_excel_${id}.xlsx`);
}

async function runJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return;
  try {
    await patchJob(jobId, { status: "running", updatedAt: nowMs() }, { ttlMs: JOB_TTL_MS });

    const out = await generateExcelApp({ lang: job.lang, ctx: job.ctx });

    const filePath = tmpFilePath(jobId);
    fs.writeFileSync(filePath, out.xlsxBuffer);

    await patchJob(
      jobId,
      {
        status: "done",
        updatedAt: nowMs(),
        result: {
          fileNameBase: out.fileNameBase,
          blueprint: out.blueprint,
          filePath,
          xlsxBase64: out.xlsxBuffer.toString("base64"),
        },
      },
      { ttlMs: JOB_TTL_MS }
    );
  } catch (e) {
    await patchJob(
      jobId,
      { status: "error", updatedAt: nowMs(), error: String(e?.message || e) },
      { ttlMs: JOB_TTL_MS }
    );
  }
}

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

  if (asyncMode) {
    const id = makeJobId();
    await putJob(
      {
      id,
      status: "queued",
      createdAt: nowMs(),
      updatedAt: nowMs(),
      lang,
      ctx,
      result: null,
      error: null,
    },
      { ttlMs: JOB_TTL_MS }
    );

    runJob(id);
    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "excel_app",
      jobId: id,
    });
    return res.json({ jobId: id, status: "queued" });
  }

  try {
    const syncJobId = makeJobId();
    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "excel_app",
      jobId: syncJobId,
    });
    const out = await generateExcelApp({ lang, ctx });
    const fileName = `${out.fileNameBase || "excel-app"}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(out.xlsxBuffer);
  } catch (e) {
    console.error("[EXCEL] generation failed", { msg: String(e?.message || e), stack: e?.stack });
    return res.status(500).json({ error: "EXCEL_GENERATION_FAILED", message: String(e?.message || e) });
  }
});

// GET /generate-excel-app/jobs/:id
router.get("/jobs/:id", (req, res) => {
  const id = req.params.id;
  getJob(id)
    .then((job) => {
      if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
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
  getJob(id)
    .then((job) => {
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
    })
    .catch(() => res.status(500).json({ error: "JOB_STORE_ERROR" }));
});

export default router;
