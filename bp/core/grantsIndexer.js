// bp/core/grantsIndexer.js
import crypto from "node:crypto";
import { normalizeQdrantBaseUrl } from "./qdrantUrl.js";

const COLLECTION = process.env.QDRANT_GRANTS_COLLECTION || "grants_opportunities";
const VECTOR_SIZE = 384;

export async function indexOpportunity(opportunity = {}) {
  if (!process.env.QDRANT_URL) return { ok: false, skipped: true, reason: "QDRANT_NOT_CONFIGURED" };

  try {
    await ensureCollection();
    const vector = hashVector([
      opportunity.title,
      opportunity.summary,
      opportunity.description,
      opportunity.eligibility,
      (opportunity.countries || []).join(" "),
      (opportunity.sectors || []).join(" "),
      opportunity.organization,
      opportunity.sourceUrl,
      opportunity.deadline,
    ].filter(Boolean).join(" "));

    const pointId = pointIdFromOpportunity(opportunity);
    const payload = {
      ...opportunity,
      id: pointId,
      recordKind: "opportunity",
      countries: opportunity.countries || [],
      sectors: opportunity.sectors || [],
      searchText: [
        opportunity.title,
        opportunity.organization,
        opportunity.summary,
        opportunity.description,
        opportunity.eligibility,
        (opportunity.countries || []).join(" "),
        (opportunity.sectors || []).join(" "),
      ].filter(Boolean).join(" ").slice(0, 12000),
    };

    const response = await qdrantFetch(`/collections/${COLLECTION}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points: [{ id: pointId, vector, payload }] }),
    });
    return { ok: response.ok, pointId };
  } catch (e) {
    console.warn("[GRANTS] error", { index: String(e?.message || e) });
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function searchIndexedOpportunities(query, { limit = 10 } = {}) {
  if (!process.env.QDRANT_URL) return { ok: false, results: [], reason: "QDRANT_NOT_CONFIGURED" };
  try {
    await ensureCollection();
    const response = await qdrantFetch(`/collections/${COLLECTION}/points/search`, {
      method: "POST",
      body: JSON.stringify({
        vector: hashVector(query),
        limit: Math.max(1, Math.min(Number(limit) || 10, 50)),
        with_payload: true,
      }),
    });
    if (!response.ok) return { ok: false, results: [] };
    const json = await response.json();
    return { ok: true, results: Array.isArray(json?.result) ? json.result : [] };
  } catch (e) {
    return { ok: false, results: [], error: String(e?.message || e) };
  }
}

async function ensureCollection() {
  const response = await qdrantFetch(`/collections/${COLLECTION}`, { method: "GET" });
  if (response.ok) return;
  await qdrantFetch(`/collections/${COLLECTION}`, {
    method: "PUT",
    body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: "Cosine" } }),
  });
}

async function qdrantFetch(path, options = {}) {
  const base = normalizeQdrantBaseUrl();
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}),
      ...(options.headers || {}),
    },
  });
}

function hashVector(text) {
  const vector = new Array(VECTOR_SIZE).fill(0);
  const tokens = String(text || "").toLowerCase().split(/[^a-z0-9\u00c0-\u017f]+/i).filter((x) => x.length >= 2);
  for (const token of tokens) {
    const hash = crypto.createHash("sha256").update(token).digest();
    const idx = hash.readUInt16BE(0) % VECTOR_SIZE;
    const sign = hash[2] % 2 === 0 ? 1 : -1;
    vector[idx] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function pointIdFromOpportunity(opportunity = {}) {
  if (isUuid(opportunity.id)) return opportunity.id;
  return stableUuid(opportunity.sourceUrl || opportunity.title || JSON.stringify(opportunity));
}

function stableUuid(seed) {
  const hex = crypto.createHash("sha256").update(String(seed || crypto.randomUUID())).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
