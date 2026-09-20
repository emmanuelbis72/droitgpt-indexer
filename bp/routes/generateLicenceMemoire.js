import express from "express";
import multer from "multer";
import mammoth from "mammoth";

import { generateLicenceMemoire, reviseLicenceMemoireFromDraft } from "../core/academicOrchestrator.js";
import { writeLicenceMemoirePdf } from "../core/academicPdfAssembler.js";
import { writeLicenceMemoireWord } from "../core/academicWordAssembler.js";
import { makeJobId, getJob } from "../core/jobStore.js";
import { enqueueGenerationJob } from "../core/generationQueue.js";
import { ensureJobAccess } from "../core/jobAccess.js";
import { consumePaymentForGeneration, verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";
import { rememberGeneratedDocument } from "../core/generatedDocumentTracker.js";

const router = express.Router();
const JOB_TTL_MS = Number(process.env.MEMOIRE_JOB_TTL_MS || 1000 * 60 * 60 * 24 * 30); // 30 days
const JOB_NAMESPACE = "memoire";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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
    try {
      const mod = await import("pdf-parse");
      const pdfParse = mod.default || mod;
      const data = await pdfParse(file.buffer);
      return String(data?.text || "").trim();
    } catch (localError) {
      const extractUrl = process.env.ANALYSE_PDF_EXTRACT_URL;
      if (!extractUrl) {
        throw new Error(
          `Extraction PDF echouee: ${String(localError?.message || localError)}. Utilise un DOCX/TXT si le PDF est scanne.`
        );
      }

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
  }

  throw new Error("Format de brouillon non supporte. Utilise .docx ou .txt (PDF seulement si ANALYSE_PDF_EXTRACT_URL est configure). ");
}

function truncateText(value, maxChars) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[...TRONQUE: ${text.length - maxChars} caracteres non inclus mot pour mot...]`;
}

async function extractOptionalDraftText(req) {
  let draftText = "";
  if (req.file) draftText = await extractDraftText(req.file);
  else draftText = String(req.body?.draftText || req.body?.text || "").trim();
  return truncateText(draftText, Number(process.env.MEMOIRE_DRAFT_MAX_CHARS || 60000));
}

function normalizeOutput(value) {
  const text = String(value || "pdf").trim().toLowerCase();
  if (["doc", "word", "docx"].includes(text)) return "doc";
  if (text === "both") return "both";
  return "pdf";
}

function normalizeResultFormat(value) {
  const text = String(value || "pdf").trim().toLowerCase();
  if (["doc", "word", "docx"].includes(text)) return "doc";
  return "pdf";
}

function safeFileName(value) {
  return String(value || "memoire")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80) || "memoire";
}

function isLawMemoireRequest(body = {}) {
  const haystack = [
    body.mode,
    body.discipline,
    body.field,
    body.faculty,
    body.department,
    body.topic,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /droit|jurid|juris|law|legal/.test(haystack);
}

function memoireHealth(_req, res) {
  res.json({ ok: true, message: "Endpoint licence-memoire OK. Utilise POST pour generer le PDF." });
}

function buildMemoireRequest(body = {}) {
  const lang = String(body.language || "fr").toLowerCase() === "en" ? "en" : "fr";
  const output = normalizeOutput(body.output);

  const ctx = {
    mode: body.mode === "droit_congolais" || isLawMemoireRequest(body) ? "droit_congolais" : "standard",
    citationStyle: body.citationStyle === "apa" ? "apa" : "footnotes",
    topic: String(body.topic || "").trim(),
    // ✅ Multi-disciplines: when not in congo law mode, use this to steer prompts (ex: Sociologie)
    discipline: String(body.discipline || body.field || body.faculty || body.department || "").trim(),
    university: String(body.university || "").trim(),
    faculty: String(body.faculty || "").trim(),
    department: String(body.department || "").trim(),
    academicYear: String(body.academicYear || "").trim(),
    problemStatement: String(body.problemStatement || "").trim(),
    objectives: String(body.objectives || "").trim(),
    methodology: String(
      body.methodology || (body.mode === "droit_congolais" ? "doctrinale" : "qualitative")
    ).trim(),
    plan: String(body.plan || "").trim(),
    // ✅ ensure >= 50 pages; allow UI override; cap to keep generation stable
    lengthPagesTarget: Math.min(90, Math.max(50, Number(body.lengthPagesTarget || 55))),
    studentName: String(body.studentName || "").trim(),
    supervisorName: String(body.supervisorName || "").trim(),
    draftText: String(body.draftText || "").trim(),
    draftFileName: String(body.draftFileName || "").trim(),
  };

  const title = lang === "en" ? `${ctx.topic || "Bachelor Dissertation"}` : `${ctx.topic || "Memoire de licence"}`;
  return { lang, ctx, title, output };
}

function setMemoireSourcesHeader(res, result) {
  const ctx = result?.ctx || {};
  const sourcesUsed = Array.isArray(result?.sourcesUsed)
    ? result.sourcesUsed
    : Array.isArray(ctx.sourcesUsed)
      ? ctx.sourcesUsed
      : [];

  res.setHeader("Access-Control-Expose-Headers", "x-sources-used");
  if (ctx.mode === "droit_congolais" && sourcesUsed.length) {
    res.setHeader("x-sources-used", JSON.stringify(sourcesUsed.slice(0, 20)));
  } else {
    res.setHeader("x-sources-used", JSON.stringify([]));
  }
}

function writeMemoireJobResult(req, res, result) {
  if (!result?.sections || !result?.ctx || !result?.title) {
    return res.status(500).json({ error: "JOB_RESULT_MISSING" });
  }
  setMemoireSourcesHeader(res, result);
  const format = normalizeResultFormat(req.query?.format || req.query?.output || result.output || "pdf");
  if (format === "doc") {
    return writeLicenceMemoireWord({
      res,
      title: result.title,
      ctx: result.ctx,
      plan: result.plan,
      sections: result.sections,
    });
  }
  return writeLicenceMemoirePdf({
    res,
    title: result.title,
    ctx: result.ctx,
    plan: result.plan,
    sections: result.sections,
  });
}

async function getMemoireJob(req, res) {
  const id = String(req.params.id || "");
  const j = await getJob(id, { namespace: JOB_NAMESPACE });
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (!ensureJobAccess(req, res, j)) return;
  return res.json({
    jobId: id,
    status: j.status,
    createdAt: j.createdAt,
    startedAt: j.startedAt || null,
    doneAt: j.doneAt || null,
    error: j.error || null,
  });
}

async function getMemoireJobResult(req, res) {
  const id = String(req.params.id || "");
  const j = await getJob(id, { namespace: JOB_NAMESPACE });
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  if (!ensureJobAccess(req, res, j)) return;
  if (j.status !== "done") {
    return res.status(409).json({ error: "JOB_NOT_READY", status: j.status, details: j.error || null });
  }
  return writeMemoireJobResult(req, res, j.result);
}

async function generateMemoire(req, res) {
  req.setTimeout(46 * 60 * 1000);
  res.setTimeout(46 * 60 * 1000);

  try {
    const wantAsync = String(req.query?.async || "") === "1";
    const draftText = await extractOptionalDraftText(req);
    const { lang, ctx, title, output } = buildMemoireRequest({
      ...(req.body || {}),
      draftText,
      draftFileName: req.file?.originalname || "",
    });
    const resultFormat = normalizeResultFormat(output);

    const paymentCheck = await verifyPaidPaymentForRequest(req, "memoire");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
    }

    const jobId = makeJobId();

    const queued = await enqueueGenerationJob({
      req,
      jobId,
      namespace: JOB_NAMESPACE,
      ttlMs: JOB_TTL_MS,
      meta: { documentType: "licence_memoire" },
      processor: "memoire",
      payload: { title, lang, ctx, output },
      task: async () => {
        const { plan, sections, sourcesUsed } = await generateLicenceMemoire({ lang, ctx });
        const nextCtx = {
          ...ctx,
          sourcesUsed: Array.isArray(sourcesUsed) ? sourcesUsed : [],
        };
        return { title, lang, ctx: nextCtx, output, plan, sections, sourcesUsed: nextCtx.sourcesUsed };
      },
    });

    if (!queued.accepted) {
      return res.status(queued.statusCode || 429).json(queued.body);
    }

    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "memoire",
      jobId,
    });
    await rememberGeneratedDocument(req, {
      jobId,
      documentType: "memoire",
      label: "Memoire",
      title,
      fileName: `${safeFileName(title)}.${resultFormat === "doc" ? "doc" : "pdf"}`,
      paymentOrderNumber: paymentCheck.orderNumber,
      regenerationBody: { ...(req.body || {}), output, draftText: draftText || undefined },
      regeneratePath: "/generate-academic/licence-memoire?async=1",
      statusPath: `/generate-academic/licence-memoire/jobs/${jobId}`,
      resultPath: `/generate-academic/licence-memoire/jobs/${jobId}/result${resultFormat === "doc" ? "?format=doc" : ""}`,
      statusTemplate: "/generate-academic/licence-memoire/jobs/{jobId}",
      resultTemplate: `/generate-academic/licence-memoire/jobs/{jobId}/result${resultFormat === "doc" ? "?format=doc" : ""}`,
    });

    if (wantAsync) {
      return res.status(202).json({
        ok: true,
        jobId,
        status: "queued",
        queue: queued.queue,
        next: {
          status: `/generate-academic/licence-memoire/jobs/${jobId}`,
          result: `/generate-academic/licence-memoire/jobs/${jobId}/result`,
        },
      });
    }

    const doneJob = await queued.completion;
    return writeMemoireJobResult(req, res, doneJob?.result);
  } catch (e) {
    console.error("/generate-memoire error:", e);
    return res.status(500).json({ error: "Erreur serveur", details: String(e?.message || e) });
  }
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

    const paymentCheck = await verifyPaidPaymentForRequest(req, "memoire");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
    }

    const reviseJobId = makeJobId();
    await consumePaymentForGeneration(paymentCheck.orderNumber, {
      documentType: "memoire",
      jobId: reviseJobId,
    });

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

router.get(["/", "/licence-memoire"], memoireHealth);
router.get(["/jobs/:id", "/licence-memoire/jobs/:id"], getMemoireJob);
router.get(["/jobs/:id/result", "/licence-memoire/jobs/:id/result"], getMemoireJobResult);
router.post(["/", "/licence-memoire"], upload.single("file"), generateMemoire);
router.options(["/revise", "/licence-memoire/revise"], (_req, res) => res.sendStatus(204));
router.post(["/revise", "/licence-memoire/revise"], upload.single("file"), reviseMemoire);

export default router;
