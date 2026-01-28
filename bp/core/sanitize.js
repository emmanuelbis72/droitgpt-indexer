// business-plan-service/core/sanitize.js
export function safeStr(v, max = 4000) {
  return String(v ?? "").trim().slice(0, max);
}

export function safeEnum(v, allowed, fallback) {
  const s = String(v ?? "").toLowerCase().trim();
  return allowed.includes(s) ? s : fallback;
}

export function normalizeLang(lang) {
  const l = String(lang ?? "").toLowerCase().trim();
  return l === "en" ? "en" : "fr";
}

export function normalizeDocType(docType) {
  // startup | agri | ngo | industry
  return safeEnum(docType, ["startup", "agri", "ngo", "industry"], "startup");
}

export function normalizeAudience(audience) {
  // investor | bank | incubator | donor
  return safeEnum(audience, ["investor", "bank", "incubator", "donor"], "investor");
}
