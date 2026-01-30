// generateLicenceMemoire.js
import express from "express";
import { generateLicenceMemoire } from "../core/academicOrchestrator.js";
import { writeLicenceMemoirePdf } from "../core/academicPdfAssembler.js";

const router = express.Router();

// ===== CORS (route-level) =====
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/droitgpt-ui\.vercel\.app$/i,
  /^https:\/\/www\.droitgpt\.com$/i,
];
function isAllowedOrigin(origin) {
  if (!origin) return true;
  return allowedOriginPatterns.some((p) => p.test(origin));
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

router.options("/licence-memoire", (req, res) => {
  applyCors(req, res);
  return res.sendStatus(204);
});
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}


router.get("/licence-memoire", (_req, res) => {
  res.json({ ok: true, message: "✅ Endpoint licence-memoire OK. Utilise POST pour générer le PDF." });
});

router.post("/licence-memoire", async (req, res) => {
  applyCors(req, res);

  req.setTimeout(15 * 60 * 1000);
  res.setTimeout(15 * 60 * 1000);

  try {
    const b = req.body || {};
    const lang = String(b.language || "fr").toLowerCase() === "en" ? "en" : "fr";

    const ctx = {
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
      lengthPagesTarget: Number(b.lengthPagesTarget || 45),

      studentName: String(b.studentName || "").trim(),
      supervisorName: String(b.supervisorName || "").trim(),
    };

    const title = lang === "en" ? `${ctx.topic || "Bachelor Dissertation"}` : `${ctx.topic || "Mémoire de licence"}`;

    const { plan, sections, sourcesUsed } = await generateLicenceMemoire({ lang, ctx });

    // Attach sources to ctx so the PDF assembler can print footnotes/notes section
    ctx.sourcesUsed = Array.isArray(sourcesUsed) ? sourcesUsed : [];

    // Expose header for frontend (sources list)
    res.setHeader("Access-Control-Expose-Headers", "x-sources-used");
    if (ctx.mode === "droit_congolais" && Array.isArray(sourcesUsed) && sourcesUsed.length) {
      res.setHeader("x-sources-used", JSON.stringify(sourcesUsed.slice(0, 20)));
    } else {
      res.setHeader("x-sources-used", JSON.stringify([]));
    }

    return writeLicenceMemoirePdf({ res, title, ctx, plan, sections });
  } catch (e) {
    console.error("❌ /generate-academic/licence-memoire error:", e);
    return res.status(500).json({ error: "Erreur serveur", details: String(e?.message || e) });
  }
});

export default router;
