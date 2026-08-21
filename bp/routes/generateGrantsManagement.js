// bp/routes/generateGrantsManagement.js
import express from "express";
import { generateGrantsManagementWorkspace, buildDemoGrantsWorkspace } from "../core/grantsOrchestrator.js";
import { writeGrantsManagementPdf } from "../core/grantsPdfAssembler.js";
import { normalizeLang, safeStr } from "../core/sanitize.js";
import { makeJobId, getJob } from "../core/jobStore.js";
import { enqueueGenerationJob } from "../core/generationQueue.js";
import { consumePaymentForGeneration, verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";
import { rememberGeneratedDocument } from "../core/generatedDocumentTracker.js";
import grantsDiscoveryRoute from "./grantsDiscovery.js";

const router = express.Router();

const JOB_TTL_MS = Number(process.env.GRANTS_JOB_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const JOB_NAMESPACE = "grants";

router.use("/", grantsDiscoveryRoute);

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "AI Assisted Grants Management endpoint OK.",
    endpoints: {
      sync: "POST /generate-grants-management",
      async: "POST /generate-grants-management?async=1",
      jobStatus: "GET /generate-grants-management/jobs/:id",
      jobResultPdf: "GET /generate-grants-management/jobs/:id/result",
    },
    body: {
      lang: "fr",
      output: "json|pdf",
      projectName: "Programme education rurale",
      organizationType: "ONG",
      country: "RDC",
      sector: "Education",
      goal: "Ameliorer l'acces a l'education...",
      donor: "Union Europeenne / appel X",
      requestedAmount: "USD 250,000",
      deadline: "2026-06-15",
      callText: "Coller ici le texte de l'appel a propositions",
    },
  });
});

router.get("/jobs/:id", async (req, res) => {
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

router.get("/jobs/:id/result", async (req, res) => {
  const id = String(req.params.id || "");
  const j = await getJob(id, { namespace: JOB_NAMESPACE });
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (j.status !== "done") return res.status(409).json({ error: "JOB_NOT_READY", status: j.status });

  const result = j.result;
  if (!result?.workspace || !result?.ctx || !result?.title) {
    return res.status(500).json({ error: "JOB_RESULT_MISSING" });
  }

  return writeGrantsManagementPdf({
    res,
    title: result.title,
    ctx: result.ctx,
    workspace: result.workspace,
  });
});

router.post("/", async (req, res) => {
  try {
    const wantAsync = String(req.query?.async || "") === "1";
    const lang = normalizeLang(req.body?.lang || "fr");
    const output = String(req.body?.output || "pdf").toLowerCase() === "json" ? "json" : "pdf";
    const ctx = normalizeGrantsContext(req.body || {});
    const title =
      lang === "en"
        ? `${ctx.projectName} - AI Assisted Grants Management`
        : `${ctx.projectName} - Gestion de subventions assistee par IA`;

    if (req.body?.test === true) {
      const workspace = buildDemoGrantsWorkspace(ctx);
      if (output === "json") return res.json({ ok: true, title, lang, ctx, workspace });
      return writeGrantsManagementPdf({ res, title, ctx, workspace });
    }

    if (!ctx.projectName || !ctx.goal) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        details: "Champs requis: projectName et goal. Ajoute donor/callText pour une analyse plus precise.",
      });
    }

    const paymentCheck = await verifyPaidPaymentForRequest(req, "grants_management");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
    }

    const id = makeJobId();
    const queued = await enqueueGenerationJob({
      req,
      jobId: id,
      namespace: JOB_NAMESPACE,
      ttlMs: JOB_TTL_MS,
      meta: { documentType: "grants_management" },
      task: async () => {
        const workspace = await generateGrantsManagementWorkspace({ lang, ctx });
        return { title, lang, ctx, workspace };
      },
    });

    if (!queued.accepted) {
      return res.status(queued.statusCode || 429).json(queued.body);
    }

    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "grants_management",
      jobId: id,
    });
    await rememberGeneratedDocument(req, {
      jobId: id,
      documentType: "grants_management",
      label: "Gestion de subventions",
      title,
      fileName: "gestion-subventions.pdf",
      paymentOrderNumber: paymentCheck.orderNumber,
      regenerationBody: req.body || {},
      regeneratePath: "/generate-grants-management?async=1",
      statusPath: `/generate-grants-management/jobs/${id}`,
      resultPath: `/generate-grants-management/jobs/${id}/result`,
      statusTemplate: "/generate-grants-management/jobs/{jobId}",
      resultTemplate: "/generate-grants-management/jobs/{jobId}/result",
    });

    if (wantAsync) {
      return res.status(202).json({
        ok: true,
        jobId: id,
        status: "queued",
        queue: queued.queue,
        next: {
          status: `/generate-grants-management/jobs/${id}`,
          result: `/generate-grants-management/jobs/${id}/result`,
        },
      });
    }

    const doneJob = await queued.completion;
    const result = doneJob?.result;
    if (!result?.workspace) return res.status(500).json({ error: "JOB_RESULT_MISSING" });

    if (output === "json") {
      return res.json({
        ok: true,
        title: result.title,
        lang,
        ctx: result.ctx,
        workspace: result.workspace,
      });
    }

    return writeGrantsManagementPdf({
      res,
      title: result.title,
      ctx: result.ctx,
      workspace: result.workspace,
    });
  } catch (e) {
    return res.status(500).json({
      error: "GRANTS_GENERATION_FAILED",
      details: String(e?.message || e),
    });
  }
});

function normalizeGrantsContext(b) {
  return {
    projectName: safeStr(b.projectName || b.organization || "Grant Workspace", 160),
    organizationType: safeStr(b.organizationType || "ONG", 80),
    country: safeStr(b.country || "RDC", 100),
    sector: safeStr(b.sector || "Multi-secteur", 140),
    goal: safeStr(b.goal || b.projectGoal || "", 3500),
    donor: safeStr(b.donor || b.opportunity || "", 500),
    requestedAmount: safeStr(b.requestedAmount || b.budget || "", 120),
    deadline: safeStr(b.deadline || "", 80),
    duration: safeStr(b.duration || "", 80),
    callText: safeStr(b.callText || b.rfpText || b.criteria || "", 9000),
    capacity: safeStr(b.capacity || b.experience || b.partners || "", 3500),
    constraints: safeStr(b.constraints || b.risks || "", 2500),
    userNeed: safeStr(b.userNeed || "Simplifier la preparation, la conformite et le pilotage de la demande de subvention.", 800),
  };
}

export default router;
