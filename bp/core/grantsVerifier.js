// bp/core/grantsVerifier.js
import crypto from "node:crypto";
import { normalizeGrantStatus, normalizeGrantType } from "./grantsSources.js";

export function verifyOpportunity(raw = {}) {
  const now = new Date().toISOString();
  const sourceUrl = cleanUrl(raw.sourceUrl || raw.url || raw.link || raw.applicationUrl);
  const applicationUrl = cleanUrl(raw.applicationUrl || raw.applyUrl || sourceUrl);
  const title = clean(raw.title, 300);
  const organization = clean(raw.organization || raw.organisme || raw.donor || raw.sourceName, 220);
  const deadlineInfo = normalizeDeadline(raw.deadline || raw.deadlineText || raw.closeDate);
  const countries = normalizeArray(raw.countries || raw.country);
  const sectors = normalizeArray(raw.sectors || raw.sector);
  const type = normalizeGrantType(raw.type || raw.opportunityType || raw.category);
  const notes = [];
  let score = 0;

  if (sourceUrl) score += 22;
  else notes.push("sourceUrl manquant.");

  if (title) score += 16;
  else notes.push("Titre manquant.");

  if (organization) score += 12;
  else notes.push("Organisme non confirme.");

  if (applicationUrl) score += 8;
  if (clean(raw.summary || raw.description, 80)) score += 10;
  if (countries.length) score += 6;
  if (sectors.length) score += 6;
  if (type !== "other") score += 6;

  if (deadlineInfo.date) {
    score += 18;
    if (deadlineInfo.expired) notes.push("Deadline passee.");
  } else {
    notes.push("Deadline absente ou non parseable.");
  }

  if (raw.aiReliabilityScore !== undefined && raw.aiReliabilityScore !== null) {
    const aiScore = clampInt(raw.aiReliabilityScore, 0, 100, 0);
    score = Math.round((score * 0.72) + (aiScore * 0.28));
  }

  score = clampInt(raw.reliabilityScore ?? score, 0, 100, score);

  let status = normalizeGrantStatus(raw.status || "draft_review");
  if (deadlineInfo.expired) status = "expired";
  else if (!sourceUrl || !title || !organization) status = "draft_review";
  else if (!deadlineInfo.date) status = score >= 75 ? "unknown" : "draft_review";
  else if (score >= 70) status = "open";
  else status = "draft_review";

  const verificationNotes = [
    clean(raw.verificationNotes, 1200),
    ...notes,
    `Score de fiabilite: ${score}/100.`,
  ].filter(Boolean).join(" ");

  return {
    id: raw.id || stableUuid(sourceUrl || `${title}|${organization}|${Date.now()}`),
    title: title || "Opportunite a verifier",
    organization,
    type,
    summary: clean(raw.summary, 900),
    description: clean(raw.description || raw.rawContent, 6000),
    eligibility: clean(raw.eligibility, 2500),
    countries,
    region: clean(raw.region, 120),
    sectors,
    amount: clean(raw.amount, 160),
    currency: clean(raw.currency, 24),
    deadline: deadlineInfo.date ? deadlineInfo.date.toISOString() : null,
    deadlineText: clean(raw.deadlineText || raw.deadline || raw.closeDate, 220),
    applicationUrl,
    sourceUrl,
    sourceName: clean(raw.sourceName, 180),
    language: clean(raw.language || "unknown", 20),
    status,
    reliabilityScore: score,
    verificationNotes,
    rawContent: clean(raw.rawContent, 18000),
    extractedAt: raw.extractedAt || now,
    lastCheckedAt: now,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function normalizeDeadline(value) {
  const raw = clean(value, 220);
  const date = parseGrantDate(raw);
  const end = date ? endOfDay(date) : null;
  return {
    raw,
    date: end,
    expired: end ? end.getTime() < Date.now() : false,
  };
}

export function parseGrantDate(value) {
  const raw = clean(value, 220);
  if (!raw) return null;
  const s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return dateFromParts(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = normalizeYear(Number(m[3]));
    const dayFirst = a > 12 || b <= 12;
    return dayFirst ? dateFromParts(y, b, a) : dateFromParts(y, a, b);
  }

  const months = monthMap();
  const monthPattern = Object.keys(months).join("|");
  m = s.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})\\b`, "i"));
  if (m) return dateFromParts(Number(m[3]), months[m[2].toLowerCase()], Number(m[1]));

  m = s.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  if (m) return dateFromParts(Number(m[3]), months[m[1].toLowerCase()], Number(m[2]));

  if (!/\b\d{4}\b/.test(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function clean(value, max = 1000) {
  if (Array.isArray(value)) return value.map((v) => clean(v, max)).filter(Boolean).join("; ").slice(0, max);
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, max);
    } catch {
      return "";
    }
  }
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanUrl(value) {
  const raw = clean(value, 900);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return "";
  }
}

export function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((v) => clean(v, 120)).filter(Boolean).slice(0, 30);
  return clean(value, 600).split(/[,;|]/).map((v) => clean(v, 120)).filter(Boolean).slice(0, 30);
}

function stableUuid(seed) {
  const hex = crypto.createHash("sha256").update(String(seed || "")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function normalizeYear(year) {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function dateFromParts(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

function monthMap() {
  return {
    jan: 1, january: 1, janvier: 1,
    feb: 2, february: 2, fevrier: 2,
    mar: 3, march: 3, mars: 3,
    apr: 4, april: 4, avril: 4,
    may: 5, mai: 5,
    jun: 6, june: 6, juin: 6,
    jul: 7, july: 7, juillet: 7,
    aug: 8, august: 8, aout: 8,
    sep: 9, sept: 9, september: 9, septembre: 9,
    oct: 10, october: 10, octobre: 10,
    nov: 11, november: 11, novembre: 11,
    dec: 12, december: 12, decembre: 12,
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
