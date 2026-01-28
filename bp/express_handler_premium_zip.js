/**
 * Express handler: returns ZIP containing PDF + DOCX
 * Endpoint example: POST /generate-business-plan/premium
 *
 * Install:
 *   npm i archiver docx
 *
 * Uses:
 *   generateBusinessPlanArtifacts from ./core/orchestrator.js
 */
import archiver from "archiver";
import { generateBusinessPlanArtifacts } from "./core/orchestrator.js";

export async function generateBusinessPlanPremiumZipHandler(req, res) {
  try {
    const body = req.body || {};
    const lang = body.lang || "fr";

    const ctx = {
      docType: body.docType,
      audience: body.audience, // "bank" | "incubator" | "fund" | "investor"
      companyName: body.companyName,
      country: body.country,
      city: body.city,
      sector: body.sector,
      stage: body.stage,
      product: body.product,
      customers: body.customers,
      businessModel: body.businessModel,
      traction: body.traction,
      competition: body.competition,
      risks: body.risks,
      finAssumptions: body.finAssumptions,
      fundingAsk: body.fundingAsk
    };

    const { pdfBuffer, docxBuffer } = await generateBusinessPlanArtifacts({ lang, ctx, lite: false });

    const safeName = String(ctx.companyName || "Business_Plan").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const zipName = `${safeName}_BusinessPlan_Premium.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error(err);
      if (!res.headersSent) return res.status(500).json({ error: "ZIP_ERROR" });
      res.end();
    });

    archive.pipe(res);
    archive.append(pdfBuffer, { name: `${safeName}_BusinessPlan_Premium.pdf` });
    archive.append(docxBuffer, { name: `${safeName}_BusinessPlan_Premium.docx` });
    await archive.finalize();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || "SERVER_ERROR") });
  }
}
