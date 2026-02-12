import express from "express";
import multer from "multer";
import mammoth from "mammoth";

import { generateLicenceMemoire, reviseLicenceMemoireFromDraft } from "../core/academicOrchestrator.js";
import { writeLicenceMemoirePdf } from "../core/academicPdfAssembler.js";

const router = express.Router();

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
    const extractUrl = process.env.ANALYSE_PDF_EXTRACT_URL;
    if (!extractUrl) {
      throw new Error(
        "Import PDF non active. Configure ANALYSE_PDF_EXTRACT_URL (service d'extraction) ou utilise un DOCX."
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

  throw new Error("Format de brouillon non supporte. Utilise .docx ou .txt (PDF seulement si ANALYSE_PDF_EXTRACT_URL est configure). ");
}

function memoireHealth(_req, res) {
  res.json({ ok: true, message: "Endpoint licence-memoire OK. Utilise POST pour generer le PDF." });
}

async function generateMemoire(req, res) {
  req.setTimeout(46 * 60 * 1000);
  res.setTimeout(46 * 60 * 1000);

  try {
    const b = req.body || {};
    const lang = String(b.language || "fr").toLowerCase() === "en" ? "en" : "fr";

    const ctx = {
      mode: b.mode === "droit_congolais" ? "droit_congolais" : "standard",
      citationStyle: b.citationStyle === "apa" ? "apa" : "footnotes",
      topic: String(b.topic || "").trim(),
      // ✅ Multi-disciplines: when not in congo law mode, use this to steer prompts (ex: Sociologie)
      discipline: String(b.discipline || b.field || b.faculty || b.department || "").trim(),
      university: String(b.university || "").trim(),
      faculty: String(b.faculty || "").trim(),
      department: String(b.department || "").trim(),
      academicYear: String(b.academicYear || "").trim(),
      problemStatement: String(b.problemStatement || "").trim(),
      objectives: String(b.objectives || "").trim(),
      methodology: String(
        b.methodology || (b.mode === "droit_congolais" ? "doctrinale" : "qualitative")
      ).trim(),
      plan: String(b.plan || "").trim(),
      // ✅ ensure >= 50 pages; allow UI override; cap to keep generation stable
      lengthPagesTarget: Math.min(90, Math.max(50, Number(b.lengthPagesTarget || 55))),
      studentName: String(b.studentName || "").trim(),
      supervisorName: String(b.supervisorName || "").trim(),
    };

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

router.get(["/", "/licence-memoire"], memoireHealth);
router.post(["/", "/licence-memoire"], generateMemoire);
router.options(["/revise", "/licence-memoire/revise"], (_req, res) => res.sendStatus(204));
router.post(["/revise", "/licence-memoire/revise"], upload.single("file"), reviseMemoire);

export default router;
