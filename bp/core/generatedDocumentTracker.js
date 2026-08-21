import { resolveDocumentOwner, saveGeneratedDocument } from "./generatedDocumentsStore.js";

function clean(value, max = 500) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function getPublicBaseUrl(req) {
  const configured = clean(process.env.PUBLIC_BP_API_BASE || process.env.RENDER_EXTERNAL_URL || "", 800);
  if (configured) return configured.replace(/\/$/, "");

  const proto = clean(req?.headers?.["x-forwarded-proto"] || req?.protocol || "https", 20).split(",")[0];
  const host = clean(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "", 300).split(",")[0];
  return host ? `${proto}://${host}`.replace(/\/$/, "") : "";
}

function absoluteUrl(base, pathname) {
  const raw = clean(pathname, 1200);
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!base || !raw) return "";
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export async function rememberGeneratedDocument(req, options = {}) {
  try {
    const owner = resolveDocumentOwner(req);
    if (!owner.ok) return null;

    const base = getPublicBaseUrl(req);
    const jobId = clean(options.jobId, 160);
    if (!base || !jobId) return null;

    const statusPath = clean(options.statusPath, 1000);
    const resultPath = clean(options.resultPath, 1000);
    const regeneratePath = clean(options.regeneratePath, 1000);

    return await saveGeneratedDocument(
      {
        documentType: clean(options.documentType, 80) || "document",
        label: clean(options.label, 120) || "Document",
        title: clean(options.title, 240) || "Document en generation",
        fileName: clean(options.fileName, 180) || "document.pdf",
        jobId,
        status: "queued",
        statusUrl: absoluteUrl(base, statusPath),
        resultUrl: absoluteUrl(base, resultPath),
        apiBase: base,
        paymentOrderNumber: clean(options.paymentOrderNumber, 160),
        regeneration: {
          method: "POST",
          url: absoluteUrl(base, regeneratePath),
          body: options.regenerationBody || null,
          statusUrlTemplate: absoluteUrl(base, options.statusTemplate || statusPath.replace(jobId, "{jobId}")),
          resultUrlTemplate: absoluteUrl(base, options.resultTemplate || resultPath.replace(jobId, "{jobId}")),
        },
      },
      owner
    );
  } catch (error) {
    console.warn("[DOCUMENTS] generation tracking skipped:", String(error?.message || error));
    return null;
  }
}
