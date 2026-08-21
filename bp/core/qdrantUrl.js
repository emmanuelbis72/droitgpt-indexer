// bp/core/qdrantUrl.js

export function normalizeQdrantBaseUrl(rawValue = process.env.QDRANT_URL) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = "";
    url.search = "";
    url.hash = "";

    // Qdrant Cloud REST endpoints use port 6333. The dashboard URL or a
    // cluster host without this port commonly returns "404 page not found".
    if (/cloud\.qdrant\.io$/i.test(url.hostname) && !url.port) {
      url.port = "6333";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

export function qdrantUrlInfo(rawValue = process.env.QDRANT_URL) {
  const normalized = normalizeQdrantBaseUrl(rawValue);
  if (!normalized) {
    return { configured: false, normalized: "", host: "", port: "", likelyDashboardUrl: false };
  }

  try {
    const url = new URL(normalized);
    return {
      configured: true,
      normalized,
      host: url.hostname,
      port: url.port,
      likelyDashboardUrl: /dashboard|cloud\.qdrant\.io\/dashboard/i.test(String(rawValue || "")),
    };
  } catch {
    return { configured: true, normalized, host: "", port: "", likelyDashboardUrl: false };
  }
}

export function qdrantUrlErrorHint(text = "") {
  if (!String(text || "").includes("404 page not found")) return "";
  return " Check QDRANT_URL: use the Qdrant REST cluster endpoint, not the dashboard URL. For Qdrant Cloud, the REST endpoint usually ends with cloud.qdrant.io:6333.";
}
