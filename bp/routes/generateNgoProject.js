// bp/routes/generateNgoProject.js
import express from "express";
import { generateNgoProjectPremium } from "../core/ngoOrchestrator.js";
import { writeNgoProjectPdfPremium } from "../core/ngoPdfAssembler.js";
import { normalizeLang, safeStr } from "../core/sanitize.js";
import { makeJobId, getJob } from "../core/jobStore.js";
import { enqueueGenerationJob } from "../core/generationQueue.js";
import { consumePaymentForGeneration, verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";

const router = express.Router();

/* =========================================================
   ✅ JOB MODE + shared concurrent queue
========================================================= */
const JOB_TTL_MS = Number(process.env.NGO_JOB_TTL_MS || 1000 * 60 * 60 * 24 * 30); // 30 days
const JOB_NAMESPACE = "ngo";

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
    // Provide explicit info when the job finished in error/rejected.
    if (j.status === "error" || j.status === "rejected") {
      return res.status(409).json({
        error: j.status === "error" ? "JOB_ERROR" : "JOB_REJECTED",
        status: j.status,
        details: j.error || null,
      });
    }
    return res.status(409).json({ error: "JOB_NOT_READY", status: j.status });
  }
  const result = j.result;
  if (!result?.sections || !result?.ctx || !result?.title) {
    return res.status(500).json({ error: "JOB_RESULT_MISSING" });
  }

  try {
    return writeNgoProjectPdfPremium({
      res,
      title: result.title,
      ctx: result.ctx,
      sections: result.sections,
    });
  } catch (e) {
    console.error("[NGO] PDF generation failed", e);
    if (!res.headersSent) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
    try {
      return res.end();
    } catch (_) {
      return;
    }
  }
});

/**
 * POST /generate-ngo-project/premium
 * Query: ?async=1 (optional)
 */
router.post("/premium", async (req, res) => {
  try {
    const wantAsync = String(req.query?.async || "") === "1";

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

    const paymentCheck = await verifyPaidPaymentForRequest(req, "ngo_project");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
    }

    const title =
      lang === "en"
        ? `${ctx.projectTitle} — NGO Project Proposal (Premium)`
        : `${ctx.projectTitle} — Projet ONG (Premium)`;

    const id = makeJobId();
    const queued = await enqueueGenerationJob({
      req,
      jobId: id,
      namespace: JOB_NAMESPACE,
      ttlMs: JOB_TTL_MS,
      meta: { documentType: "ngo_project" },
      task: async () => {
        const result = await generateNgoProjectPremium({ lang, ctx, lite });
        return {
          title,
          ctx,
          sections: result?.sections || [],
        };
      },
    });

    if (!queued.accepted) {
      return res.status(queued.statusCode || 429).json(queued.body);
    }

    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "ngo_project",
      jobId: id,
    });

    // ✅ JOB mode
    if (wantAsync) {
      return res.status(202).json({
        ok: true,
        jobId: id,
        status: "queued",
        queue: queued.queue,
        next: {
          status: `/generate-ngo-project/premium/jobs/${id}`,
          result: `/generate-ngo-project/premium/jobs/${id}/result`,
        },
      });
    }

    const doneJob = await queued.completion;
    const result = doneJob?.result;
    if (!result?.sections) return res.status(500).json({ error: "JOB_RESULT_MISSING" });

    return writeNgoProjectPdfPremium({
      res,
      title: result.title,
      ctx: result.ctx,
      sections: result.sections,
    });
  } catch (e) {
    console.error("[NGO] generation failed", { msg: String(e?.message || e), stack: e?.stack });
    return res.status(500).json({
      error: "NGO_GENERATION_FAILED",
      details: String(e?.message || e),
    });
  }
});

export default router;
