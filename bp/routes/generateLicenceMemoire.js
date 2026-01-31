// generateLicenceMemoire.js
import express from "express";
import { generateLicenceMemoire } from "../core/academicOrchestrator.js";
import { writeLicenceMemoirePdf } from "../core/academicPdfAssembler.js";

const router = express.Router();

router.options("/licence-memoire", (_req, res) => {
  // cors middleware gère normalement ceci, mais on garde une réponse propre
  return res.sendStatus(204);
});

router.get("/licence-memoire", (_req, res) => {
  res.json({ ok: true, message: "✅ Endpoint licence-memoire OK. Utilise POST pour générer le PDF." });
});

router.post("/licence-memoire", async (req, res) => {
  // ⏱️ DeepSeek Reasoner peut prendre longtemps : 45 minutes
  const ROUTE_TIMEOUT_MS = Number(process.env.ACAD_REQUEST_TIMEOUT_MS || 45 * 60 * 1000);
  req.setTimeout(ROUTE_TIMEOUT_MS);
  res.setTimeout(ROUTE_TIMEOUT_MS);


  try {
    const b = req.body || {};
    const lang = String(b.lang || b.language || "fr").toLowerCase() === "en" ? "en" : "fr";

    const ctx = {
      mode: b.mode === "droit_congolais" ? "droit_congolais" : "standard",
      citationStyle: b.citationStyle === "apa" ? "apa" : "footnotes",

      topic: String(b.topic || b.title || b.subject || "").trim(),
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
