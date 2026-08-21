import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPaidPaymentForRequest } from "../core/flexpayPayments.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZIP_PATH = path.join(__dirname, "..", "assets", "business-plan-pack", "droitgpt-business-plans-pack.zip");
const DOWNLOAD_NAME = "DroitGPT-Pack-248-Business-Plans.zip";
const SAMPLES_DIR = path.join(__dirname, "..", "assets", "business-plan-pack", "samples");

const FREE_SAMPLES = [
  {
    id: "cafe-arabica-minova",
    title: "Production et transformation du café Arabica à Minova",
    sector: "Agro-industrie",
    fileName: "modele-bp-cafe-arabica-minova.docx",
    downloadName: "Modele-BP-Cafe-Arabica-Minova.docx",
  },
  {
    id: "porte-monnaie-electronique-rdc",
    title: "Porte-monnaie électronique en RDC",
    sector: "Fintech",
    fileName: "modele-bp-porte-monnaie-electronique-rdc.docx",
    downloadName: "Modele-BP-Porte-Monnaie-Electronique-RDC.docx",
  },
  {
    id: "pyrolyse-dechets-plastiques-kinshasa",
    title: "Pyrolyse des déchets plastiques à Kinshasa",
    sector: "Économie verte",
    fileName: "modele-bp-pyrolyse-dechets-plastiques-kinshasa.docx",
    downloadName: "Modele-BP-Pyrolyse-Dechets-Plastiques-Kinshasa.docx",
  },
];

function samplePayload(sample) {
  const filePath = path.join(SAMPLES_DIR, sample.fileName);
  const exists = fs.existsSync(filePath);
  return {
    id: sample.id,
    title: sample.title,
    sector: sample.sector,
    format: "DOCX",
    available: exists,
    bytes: exists ? fs.statSync(filePath).size : 0,
    downloadUrl: `/business-plan-pack/samples/${sample.id}/download`,
  };
}

router.get("/health", (_req, res) => {
  const exists = fs.existsSync(ZIP_PATH);
  const size = exists ? fs.statSync(ZIP_PATH).size : 0;
  return res.json({
    ok: true,
    module: "business_plan_pack",
    available: exists,
    fileName: DOWNLOAD_NAME,
    bytes: size,
    freeSamples: FREE_SAMPLES.map(samplePayload),
  });
});

router.get("/samples", (_req, res) => {
  return res.json({
    ok: true,
    samples: FREE_SAMPLES.map(samplePayload),
  });
});

router.get("/samples/:id/download", (req, res) => {
  const sample = FREE_SAMPLES.find((item) => item.id === req.params.id);
  if (!sample) {
    return res.status(404).json({ ok: false, error: "SAMPLE_NOT_FOUND" });
  }

  const filePath = path.join(SAMPLES_DIR, sample.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(503).json({ ok: false, error: "SAMPLE_NOT_AVAILABLE" });
  }

  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Content-Disposition", `attachment; filename="${sample.downloadName}"`);

  return fs.createReadStream(filePath).pipe(res);
});

router.get("/download", async (req, res) => {
  try {
    const paymentCheck = await verifyPaidPaymentForRequest(req, "businessplan_pack");
    if (!paymentCheck.ok) {
      return res.status(paymentCheck.statusCode || 402).json(paymentCheck.body);
    }

    if (!fs.existsSync(ZIP_PATH)) {
      return res.status(503).json({
        ok: false,
        error: "PACK_NOT_AVAILABLE",
        details: "Le pack business plans n'est pas encore disponible sur le serveur.",
      });
    }

    const stat = fs.statSync(ZIP_PATH);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Content-Disposition", `attachment; filename="${DOWNLOAD_NAME}"`);

    return fs.createReadStream(ZIP_PATH).pipe(res);
  } catch (error) {
    console.error("[BUSINESS_PLAN_PACK] download failed", String(error?.message || error));
    return res.status(500).json({
      ok: false,
      error: "PACK_DOWNLOAD_FAILED",
      details: String(error?.message || error),
    });
  }
});

export default router;
