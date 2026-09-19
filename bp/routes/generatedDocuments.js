import express from "express";
import crypto from "node:crypto";
import {
  clearGeneratedDocuments,
  getGeneratedDocumentsStorageStatus,
  listGeneratedDocuments,
  patchGeneratedDocument,
  removeGeneratedDocument,
  resolveDocumentOwner,
  saveGeneratedDocument,
  supportGetGeneratedDocument,
  supportSearchGeneratedDocuments,
} from "../core/generatedDocumentsStore.js";

const router = express.Router();

function clean(value, max = 500) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getSupportSecret() {
  return clean(process.env.DOCUMENTS_SUPPORT_SECRET || process.env.SUPPORT_SECRET || process.env.CRON_SECRET || "", 1000);
}

function getSupportToken(req) {
  const auth = clean(req?.headers?.authorization || "", 1200);
  return clean(
    req?.headers?.["x-support-secret"] ||
      req?.headers?.["x-cron-secret"] ||
      (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "") ||
      "",
    1000
  );
}

function requireSupportAccess(req, res) {
  const secret = getSupportSecret();
  if (!secret) {
    res.status(503).json({
      ok: false,
      error: "SUPPORT_SECRET_NOT_CONFIGURED",
      details: "Configure DOCUMENTS_SUPPORT_SECRET ou SUPPORT_SECRET sur Render pour activer les outils support.",
    });
    return false;
  }
  if (!safeEqual(getSupportToken(req), secret)) {
    res.status(401).json({ ok: false, error: "SUPPORT_UNAUTHORIZED" });
    return false;
  }
  return true;
}

function getOwnerOrRespond(req, res) {
  const owner = resolveDocumentOwner(req);
  if (!owner.ok) {
    res.status(owner.statusCode || 401).json(owner.body || { ok: false, error: "UNAUTHORIZED" });
    return null;
  }
  return owner;
}

router.get("/health", (_req, res) => {
  return res.json({
    ok: true,
    module: "generated_documents",
    storage: getGeneratedDocumentsStorageStatus(),
  });
});

router.get("/", async (req, res) => {
  try {
    const owner = getOwnerOrRespond(req, res);
    if (!owner) return;
    const documents = await listGeneratedDocuments(owner, { limit: req.query?.limit });
    return res.json({ ok: true, documents, trustedOwner: owner.trusted });
  } catch (error) {
    console.error("[DOCUMENTS] list failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENTS_LIST_FAILED", details: String(error?.message || error) });
  }
});

router.get("/support/search", async (req, res) => {
  try {
    if (!requireSupportAccess(req, res)) return;
    const documents = await supportSearchGeneratedDocuments({
      email: req.query?.email,
      id: req.query?.id,
      jobId: req.query?.jobId,
      paymentOrderNumber: req.query?.paymentOrderNumber || req.query?.orderNumber,
      documentType: req.query?.documentType,
      status: req.query?.status,
      q: req.query?.q,
      limit: req.query?.limit,
    });
    return res.json({ ok: true, count: documents.length, documents });
  } catch (error) {
    console.error("[DOCUMENTS] support search failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENTS_SUPPORT_SEARCH_FAILED", details: String(error?.message || error) });
  }
});

router.get("/support/:id", async (req, res) => {
  try {
    if (!requireSupportAccess(req, res)) return;
    const document = await supportGetGeneratedDocument(req.params.id);
    if (!document) return res.status(404).json({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    return res.json({ ok: true, document });
  } catch (error) {
    console.error("[DOCUMENTS] support get failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENTS_SUPPORT_GET_FAILED", details: String(error?.message || error) });
  }
});

router.get("/support/:id/download", async (req, res) => {
  try {
    if (!requireSupportAccess(req, res)) return;
    const document = await supportGetGeneratedDocument(req.params.id);
    if (!document) return res.status(404).json({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    if (!document.resultUrl) return res.status(404).json({ ok: false, error: "DOCUMENT_RESULT_URL_MISSING" });

    const upstream = await fetch(document.resultUrl, {
      headers: {
        "X-DroitGPT-User": document.ownerKey || "",
        "X-Generation-User": document.ownerKey || "",
        ...(document.ownerEmail ? { "X-User-Email": document.ownerEmail } : {}),
        Accept: "application/pdf, application/msword, application/octet-stream, */*",
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({
        ok: false,
        error: "DOCUMENT_UPSTREAM_DOWNLOAD_FAILED",
        status: upstream.status,
        details: text.slice(0, 500),
      });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${clean(document.fileName || `${document.id}.pdf`, 180)}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("[DOCUMENTS] support download failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENTS_SUPPORT_DOWNLOAD_FAILED", details: String(error?.message || error) });
  }
});

router.post("/", async (req, res) => {
  try {
    const owner = getOwnerOrRespond(req, res);
    if (!owner) return;
    const document = await saveGeneratedDocument(req.body || {}, owner);
    return res.status(201).json({ ok: true, document, trustedOwner: owner.trusted });
  } catch (error) {
    console.error("[DOCUMENTS] save failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENT_SAVE_FAILED", details: String(error?.message || error) });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const owner = getOwnerOrRespond(req, res);
    if (!owner) return;
    const document = await patchGeneratedDocument(req.params.id, req.body || {}, owner);
    if (!document) return res.status(404).json({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    return res.json({ ok: true, document, trustedOwner: owner.trusted });
  } catch (error) {
    console.error("[DOCUMENTS] patch failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENT_PATCH_FAILED", details: String(error?.message || error) });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const owner = getOwnerOrRespond(req, res);
    if (!owner) return;
    const removed = await removeGeneratedDocument(req.params.id, owner);
    return res.json({ ok: true, removed });
  } catch (error) {
    console.error("[DOCUMENTS] delete failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENT_DELETE_FAILED", details: String(error?.message || error) });
  }
});

router.delete("/", async (req, res) => {
  try {
    const owner = getOwnerOrRespond(req, res);
    if (!owner) return;
    const removed = await clearGeneratedDocuments(owner);
    return res.json({ ok: true, removed });
  } catch (error) {
    console.error("[DOCUMENTS] clear failed", String(error?.message || error));
    return res.status(500).json({ ok: false, error: "DOCUMENT_CLEAR_FAILED", details: String(error?.message || error) });
  }
});

export default router;
