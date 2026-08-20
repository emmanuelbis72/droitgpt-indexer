import express from "express";
import {
  clearGeneratedDocuments,
  getGeneratedDocumentsStorageStatus,
  listGeneratedDocuments,
  patchGeneratedDocument,
  removeGeneratedDocument,
  resolveDocumentOwner,
  saveGeneratedDocument,
} from "../core/generatedDocumentsStore.js";

const router = express.Router();

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
