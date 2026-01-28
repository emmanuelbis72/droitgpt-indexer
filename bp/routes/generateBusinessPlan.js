// business-plan-service/routes/generateBusinessPlan.js
import express from "express";
import { generateBusinessPlanPremium } from "../core/orchestrator.js";
import { writeBusinessPlanPdfPremium } from "../core/pdfAssembler.js";
import {
  normalizeLang,
  normalizeDocType,
  normalizeAudience,
  safeStr,
} from "../core/sanitize.js";

const router = express.Router();

/**
 * GET /generate-business-plan/premium
 * Utile pour test navigateur (évite "Cannot GET")
 */
router.get("/premium", (_req, res) => {
  res.json({
    ok: true,
    message: "✅ Endpoint premium OK. Utilise POST pour générer le business plan (pdf/json).",
    example: {
      method: "POST",
      url: "/generate-business-plan/premium",
      body: { lang: "fr", companyName: "TEST", output: "json" },
    },
  });
});

/**
 * POST /generate-business-plan/premium
 * Body:
 * {
 *   lang: "fr" | "en",
 *   docType: "startup" | "agri" | "ngo" | "industry",
 *   audience: "investor" | "bank" | "incubator" | "donor",
 *   companyName, country, city, sector, stage,
 *   product, customers, businessModel, traction, competition, risks,
 *   finAssumptions, fundingAsk,
 *   output: "pdf" | "json",
 *   lite: true/false (lite => Canvas+SWOT+Finances seulement)
 *   test: true (retour instantané)
 * }
 */
router.post("/premium", async (req, res) => {
  try {
    const b = req.body || {};

    // ✅ mode test instantané (debug)
    if (b?.test === true) {
      return res.json({ ok: true, message: "✅ Route premium OK (test mode)" });
    }

    const lang = normalizeLang(b.lang || process.env.BP_LANG_DEFAULT || "fr");

    const ctx = {
      companyName: safeStr(b.companyName || "Projet", 120),
      country: safeStr(b.country || "RDC", 80),
      city: safeStr(b.city || "Kinshasa / Lubumbashi", 120),
      sector: safeStr(b.sector || "Multi-secteur", 120),
      stage: safeStr(b.stage || "Early-stage", 60),

      docType: normalizeDocType(b.docType),
      audience: normalizeAudience(b.audience),

      product: safeStr(b.product, 2500),
      customers: safeStr(b.customers, 2500),
      businessModel: safeStr(b.businessModel, 2500),
      traction: safeStr(b.traction, 2500),
      competition: safeStr(b.competition, 2500),
      risks: safeStr(b.risks, 2500),

      finAssumptions: safeStr(b.finAssumptions, 3500),
      fundingAsk: safeStr(b.fundingAsk, 2500),
    };

    const title =
      lang === "en"
        ? `${ctx.companyName} — Business Plan (Premium)`
        : `${ctx.companyName} — Plan d’affaires (Premium)`;

    const output = String(b.output || "pdf").toLowerCase();
    const lite = Boolean(b.lite);

    // ✅ Génération orchestrée (inclut Financials en JSON structuré)
    const { sections, fullText } = await generateBusinessPlanPremium({
      lang,
      ctx,
      lite,
    });

    if (output === "json") {
      return res.json({ title, lang, ctx, lite, sections, fullText });
    }

    // ✅ PDF Premium (TOC, pages, tableaux Canvas/SWOT/Finances)
    return writeBusinessPlanPdfPremium({
      res,
      title,
      ctx,
      sections,
    });
  } catch (e) {
    console.error("❌ /generate-business-plan/premium error:", e);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(e?.message || e),
    });
  }
});

export default router;
