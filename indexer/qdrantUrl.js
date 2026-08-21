export function normalizeQdrantUrl(rawValue = process.env.QDRANT_URL) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    if (/cloud\.qdrant\.io$/i.test(url.hostname) && !url.port) {
      url.port = "6333";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}
