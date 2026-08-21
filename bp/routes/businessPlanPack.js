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

router.get("/health", (_req, res) => {
  const exists = fs.existsSync(ZIP_PATH);
  const size = exists ? fs.statSync(ZIP_PATH).size : 0;
  return res.json({
    ok: true,
    module: "business_plan_pack",
    available: exists,
    fileName: DOWNLOAD_NAME,
    bytes: size,
  });
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
