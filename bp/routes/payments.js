// bp/routes/payments.js
import express from "express";
import {
  getPaymentConfig,
  getPaymentStatus,
  handleFlexPayCallback,
  initiateMobileMoneyPayment,
  paymentErrorResponse,
} from "../core/flexpayPayments.js";

const router = express.Router();

router.get("/health", (_req, res) => {
  const config = getPaymentConfig();
  return res.json({
    ok: true,
    module: "payments",
    provider: "flexpay",
    configured: config.configured,
    requiresPayment: config.requiresPayment,
  });
});

router.get("/config", (_req, res) => {
  const config = getPaymentConfig();
  // Never expose provider credentials to the browser.
  return res.json({
    ok: true,
    provider: config.provider,
    enabled: config.enabled,
    configured: config.configured,
    requiresPayment: config.requiresPayment,
    currency: config.currency,
    methods: config.methods,
    documents: config.documents,
    missing: config.configured ? undefined : config.missing,
  });
});

router.post("/mobile-money", async (req, res) => {
  try {
    const payment = await initiateMobileMoneyPayment({
      documentType: req.body?.documentType,
      phone: req.body?.phone,
      customerName: req.body?.customerName,
      customerEmail: req.body?.customerEmail,
    });

    return res.status(202).json({
      ok: true,
      payment,
      message: "Transaction Mobile Money envoyee. Valide le push sur le telephone.",
    });
  } catch (error) {
    console.error("[PAYMENTS] mobile money init failed", String(error?.message || error));
    const out = paymentErrorResponse(error);
    return res.status(out.statusCode).json(out.body);
  }
});

router.get("/status/:orderNumber", async (req, res) => {
  try {
    const payment = await getPaymentStatus(req.params.orderNumber);
    if (!payment) return res.status(404).json({ ok: false, error: "PAYMENT_NOT_FOUND" });
    return res.json({ ok: true, payment });
  } catch (error) {
    console.error("[PAYMENTS] status check failed", String(error?.message || error));
    const out = paymentErrorResponse(error);
    return res.status(out.statusCode).json(out.body);
  }
});

router.post("/flexpay/callback", async (req, res) => {
  try {
    const payment = await handleFlexPayCallback(req.body || {});
    return res.json({ ok: true, payment });
  } catch (error) {
    console.error("[PAYMENTS] callback failed", String(error?.message || error));
    const out = paymentErrorResponse(error);
    return res.status(out.statusCode).json(out.body);
  }
});

export default router;
