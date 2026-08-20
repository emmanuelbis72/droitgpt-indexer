import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.GENERATED_DOCUMENTS_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.GENERATED_DOCUMENTS_DB_PATH || path.join(DATA_DIR, "generated-documents.json");
const COLLECTION = process.env.QDRANT_GENERATED_DOCUMENTS_COLLECTION || "droitgpt_generated_documents";
const VECTOR_SIZE = 4;

const DEFAULT_DB = {
  version: 1,
  documents: [],
  meta: { createdAt: null, updatedAt: null },
};

let writeQueue = Promise.resolve();
let qdrantInitPromise = null;
let qdrantDisabled = false;

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function clean(value, max = 500) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function isIsoDate(value) {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function cleanDate(value) {
  return isIsoDate(value) ? new Date(value).toISOString() : null;
}

function cleanUrl(value, max = 1200) {
  const url = clean(value, max);
  return /^https?:\/\//i.test(url) ? url : "";
}

function deterministicUuid(value) {
  const hash = crypto.createHash("sha1").update(String(value || "")).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function base64UrlToBuffer(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function parseJwtPayload(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) return null;
  try {
    return JSON.parse(base64UrlToBuffer(payload).toString("utf8"));
  } catch {
    return null;
  }
}

function verifyHs256Jwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  let header;
  try {
    header = JSON.parse(base64UrlToBuffer(parts[0]).toString("utf8"));
  } catch {
    return null;
  }
  if (header?.alg && header.alg !== "HS256") return null;

  const signature = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  const expected = Buffer.from(signature);
  const received = Buffer.from(parts[2]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

  const payload = parseJwtPayload(token);
  if (!payload) return null;
  if (payload.exp && Date.now() >= Number(payload.exp) * 1000) return null;
  return payload;
}

function getBearerToken(req) {
  const auth = req?.headers?.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function normalizeOwnerKey(value) {
  const raw = clean(value, 300);
  if (!raw) return "";
  if (/^(user|email|phone|client):/i.test(raw)) return raw;
  return `client:${raw}`;
}

export function resolveDocumentOwner(req) {
  const token = getBearerToken(req);
  const secret = process.env.JWT_ACCESS_SECRET || process.env.AUTH_JWT_SECRET || "";

  if (token && secret) {
    const payload = verifyHs256Jwt(token, secret);
    if (!payload) {
      return {
        ok: false,
        statusCode: 401,
        body: { ok: false, error: "INVALID_TOKEN", details: "Session invalide ou expiree." },
      };
    }

    const identity = clean(payload.sub || payload.email || payload.phone, 260);
    if (!identity) {
      return {
        ok: false,
        statusCode: 401,
        body: { ok: false, error: "INVALID_TOKEN", details: "Identite utilisateur absente du token." },
      };
    }

    return {
      ok: true,
      trusted: true,
      ownerKey: `user:${identity}`,
      user: {
        id: clean(payload.sub, 260),
        email: clean(payload.email, 260),
        phone: clean(payload.phone, 80),
        fullName: clean(payload.fullName, 160),
        role: clean(payload.role, 40) || "user",
      },
    };
  }

  const headerUser = clean(
    req?.headers?.["x-droitgpt-user"] ||
      req?.headers?.["x-generation-user"] ||
      req?.headers?.["x-user-id"] ||
      req?.headers?.["x-user-email"] ||
      "",
    300
  );

  if (!headerUser) {
    return {
      ok: false,
      statusCode: 401,
      body: { ok: false, error: "DOCUMENT_OWNER_REQUIRED", details: "Utilisateur requis pour l'historique des documents." },
    };
  }

  return {
    ok: true,
    trusted: false,
    ownerKey: normalizeOwnerKey(headerUser),
    user: {
      id: clean(req?.headers?.["x-user-id"], 260),
      email: clean(req?.headers?.["x-user-email"], 260),
      phone: "",
      fullName: "",
      role: "user",
    },
  };
}

function normalizeStatus(value) {
  const status = clean(value, 40).toLowerCase();
  return ["queued", "running", "done", "error", "rejected", "cancelled"].includes(status) ? status : "queued";
}

function normalizeRecord(input = {}, owner) {
  const now = nowIso();
  const jobId = clean(input.jobId, 160);
  const documentType = clean(input.documentType, 80) || "document";
  const id = clean(input.id || (jobId ? `${documentType}:${jobId}` : crypto.randomUUID()), 220);

  return {
    id,
    ownerKey: owner.ownerKey,
    ownerEmail: clean(owner.user?.email || input.ownerEmail, 260),
    ownerPhone: clean(owner.user?.phone || input.ownerPhone, 80),
    ownerName: clean(owner.user?.fullName || input.ownerName, 160),
    documentType,
    label: clean(input.label, 120),
    title: clean(input.title, 240) || "Document en generation",
    fileName: clean(input.fileName, 180) || "document.pdf",
    jobId,
    status: normalizeStatus(input.status),
    statusUrl: cleanUrl(input.statusUrl),
    resultUrl: cleanUrl(input.resultUrl),
    apiBase: cleanUrl(input.apiBase, 500),
    paymentOrderNumber: clean(input.paymentOrderNumber, 160),
    error: clean(input.error, 1000) || null,
    createdAt: cleanDate(input.createdAt) || now,
    updatedAt: now,
    doneAt: cleanDate(input.doneAt),
    downloadedAt: cleanDate(input.downloadedAt),
  };
}

function publicRecord(record = {}) {
  if (!record) return null;
  const {
    ownerKey,
    ...safe
  } = record;
  return safe;
}

function recordPointId(ownerKey, id) {
  return deterministicUuid(`generated-document:${ownerKey}:${id}`);
}

function recordVector(record = {}) {
  const statusScore = record.status === "done" ? 1 : record.status === "error" ? -1 : 0;
  const created = record.createdAt ? new Date(record.createdAt).getTime() : Date.now();
  const recency = Math.max(0, Math.min(1, created / 4102444800000)); // 2100-01-01
  const typeScore = Math.min(1, clean(record.documentType, 80).length / 80);
  return [1, statusScore, recency, typeScore];
}

function isQdrantConfigured() {
  return Boolean(process.env.QDRANT_URL) && !envBool("GENERATED_DOCUMENTS_DISABLE_QDRANT_STORE", false) && !qdrantDisabled;
}

async function qdrantFetch(pathname, options = {}) {
  const base = String(process.env.QDRANT_URL || "").replace(/\/$/, "");
  const timeoutMs = Math.max(5000, Number(process.env.QDRANT_TIMEOUT_MS || 15000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function throwQdrantError(response, message) {
  const text = await response.text().catch(() => "");
  throw new Error(`${message}: HTTP ${response.status} ${text.slice(0, 300)}`);
}

async function ensureQdrantCollection() {
  if (!isQdrantConfigured()) return false;
  if (!qdrantInitPromise) {
    qdrantInitPromise = (async () => {
      const name = encodeURIComponent(COLLECTION);
      const existing = await qdrantFetch(`/collections/${name}`, { method: "GET" });
      if (existing.ok) return true;
      if (existing.status !== 404) await throwQdrantError(existing, "Qdrant documents collection check failed");

      const created = await qdrantFetch(`/collections/${name}`, {
        method: "PUT",
        body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: "Cosine" } }),
      });
      if (!created.ok) await throwQdrantError(created, "Qdrant documents collection create failed");
      return true;
    })().catch((error) => {
      qdrantDisabled = true;
      console.warn("[DOCUMENTS] Qdrant store disabled, falling back to JSON:", String(error?.message || error));
      return false;
    });
  }
  return qdrantInitPromise;
}

async function qdrantScrollAll(limit = 5000) {
  const ready = await ensureQdrantCollection();
  if (!ready) throw new Error("QDRANT_DOCUMENTS_NOT_READY");
  const out = [];
  let offset = null;
  while (out.length < limit) {
    const response = await qdrantFetch(`/collections/${encodeURIComponent(COLLECTION)}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        limit: Math.min(256, limit - out.length),
        with_payload: true,
        with_vector: false,
        ...(offset ? { offset } : {}),
      }),
    });
    if (!response.ok) await throwQdrantError(response, "Qdrant documents scroll failed");
    const json = await response.json();
    const points = Array.isArray(json?.result?.points) ? json.result.points : [];
    out.push(...points);
    offset = json?.result?.next_page_offset || null;
    if (!offset || !points.length) break;
  }
  return out;
}

async function qdrantListDocuments(owner) {
  const points = await qdrantScrollAll(Number(process.env.QDRANT_GENERATED_DOCUMENTS_SCROLL_LIMIT || 5000));
  return points
    .map((point) => point?.payload?.record)
    .filter((record) => record?.ownerKey === owner.ownerKey)
    .sort(sortDocuments);
}

async function qdrantUpsertDocument(record) {
  const ready = await ensureQdrantCollection();
  if (!ready) throw new Error("QDRANT_DOCUMENTS_NOT_READY");
  const response = await qdrantFetch(`/collections/${encodeURIComponent(COLLECTION)}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: [
        {
          id: recordPointId(record.ownerKey, record.id),
          vector: recordVector(record),
          payload: {
            recordKind: "generated_document",
            ownerKey: record.ownerKey,
            jobId: record.jobId,
            documentType: record.documentType,
            record,
          },
        },
      ],
    }),
  });
  if (!response.ok) await throwQdrantError(response, "Qdrant documents upsert failed");
}

async function qdrantDeleteDocument(record) {
  const ready = await ensureQdrantCollection();
  if (!ready) throw new Error("QDRANT_DOCUMENTS_NOT_READY");
  const response = await qdrantFetch(`/collections/${encodeURIComponent(COLLECTION)}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ points: [recordPointId(record.ownerKey, record.id)] }),
  });
  if (!response.ok) await throwQdrantError(response, "Qdrant documents delete failed");
}

async function readDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const db = JSON.parse(raw);
    return {
      ...DEFAULT_DB,
      ...db,
      documents: Array.isArray(db?.documents) ? db.documents : [],
      meta: db?.meta || DEFAULT_DB.meta,
    };
  } catch {
    const now = nowIso();
    return { ...DEFAULT_DB, meta: { createdAt: now, updatedAt: now } };
  }
}

async function updateDb(mutator) {
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    const next = (await mutator(db)) || db;
    next.meta = {
      ...(next.meta || {}),
      createdAt: next.meta?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(next, null, 2));
    return next;
  });
  return writeQueue;
}

function findMatchingRecord(records, idOrJobId) {
  const key = clean(idOrJobId, 220);
  return records.find((doc) => doc.id === key || doc.jobId === key) || null;
}

function sortDocuments(a, b) {
  return String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""));
}

async function safeQdrant(operation) {
  if (!isQdrantConfigured()) return null;
  try {
    return await operation();
  } catch (error) {
    qdrantDisabled = true;
    console.warn("[DOCUMENTS] Qdrant failed, falling back to JSON:", String(error?.message || error));
    return null;
  }
}

export async function listGeneratedDocuments(owner, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit || 200)));
  const remote = await safeQdrant(() => qdrantListDocuments(owner));
  if (remote) return remote.slice(0, limit).map(publicRecord);

  const db = await readDb();
  return db.documents
    .filter((doc) => doc.ownerKey === owner.ownerKey)
    .sort(sortDocuments)
    .slice(0, limit)
    .map(publicRecord);
}

export async function saveGeneratedDocument(input = {}, owner) {
  const normalized = normalizeRecord(input, owner);
  let record = normalized;

  const remote = await safeQdrant(async () => {
    const docs = await qdrantListDocuments(owner);
    const existing = findMatchingRecord(docs, normalized.id) || (normalized.jobId ? findMatchingRecord(docs, normalized.jobId) : null);
    const merged = existing
      ? {
          ...existing,
          ...normalized,
          id: existing.id,
          createdAt: existing.createdAt || normalized.createdAt,
          updatedAt: nowIso(),
        }
      : normalized;
    await qdrantUpsertDocument(merged);
    return merged;
  });
  if (remote) return publicRecord(remote);

  await updateDb((db) => {
    const idx = db.documents.findIndex(
      (doc) => doc.ownerKey === owner.ownerKey && (doc.id === normalized.id || (normalized.jobId && doc.jobId === normalized.jobId))
    );
    if (idx >= 0) {
      record = {
        ...db.documents[idx],
        ...normalized,
        id: db.documents[idx].id,
        createdAt: db.documents[idx].createdAt || normalized.createdAt,
        updatedAt: nowIso(),
      };
      db.documents[idx] = record;
    } else {
      db.documents.unshift(record);
    }
    db.documents = db.documents.slice(0, 10000);
    return db;
  });

  return publicRecord(record);
}

export async function patchGeneratedDocument(idOrJobId, patch = {}, owner) {
  const key = clean(idOrJobId, 220);
  if (!key) return null;

  const remote = await safeQdrant(async () => {
    const docs = await qdrantListDocuments(owner);
    const existing = findMatchingRecord(docs, key);
    if (!existing) return null;
    const merged = normalizeRecord({ ...existing, ...patch, id: existing.id, jobId: existing.jobId }, owner);
    merged.createdAt = existing.createdAt || merged.createdAt;
    await qdrantUpsertDocument(merged);
    return merged;
  });
  if (remote) return publicRecord(remote);

  let record = null;
  await updateDb((db) => {
    const idx = db.documents.findIndex((doc) => doc.ownerKey === owner.ownerKey && (doc.id === key || doc.jobId === key));
    if (idx < 0) return db;
    record = normalizeRecord({ ...db.documents[idx], ...patch, id: db.documents[idx].id, jobId: db.documents[idx].jobId }, owner);
    record.createdAt = db.documents[idx].createdAt || record.createdAt;
    db.documents[idx] = record;
    return db;
  });
  return publicRecord(record);
}

export async function removeGeneratedDocument(idOrJobId, owner) {
  const key = clean(idOrJobId, 220);
  if (!key) return false;

  const remote = await safeQdrant(async () => {
    const docs = await qdrantListDocuments(owner);
    const existing = findMatchingRecord(docs, key);
    if (!existing) return false;
    await qdrantDeleteDocument(existing);
    return true;
  });
  if (remote !== null) return Boolean(remote);

  let removed = false;
  await updateDb((db) => {
    const before = db.documents.length;
    db.documents = db.documents.filter((doc) => !(doc.ownerKey === owner.ownerKey && (doc.id === key || doc.jobId === key)));
    removed = db.documents.length !== before;
    return db;
  });
  return removed;
}

export async function clearGeneratedDocuments(owner) {
  const remote = await safeQdrant(async () => {
    const docs = await qdrantListDocuments(owner);
    for (const doc of docs) await qdrantDeleteDocument(doc);
    return docs.length;
  });
  if (remote !== null) return Number(remote || 0);

  let removed = 0;
  await updateDb((db) => {
    const before = db.documents.length;
    db.documents = db.documents.filter((doc) => doc.ownerKey !== owner.ownerKey);
    removed = before - db.documents.length;
    return db;
  });
  return removed;
}

export function getGeneratedDocumentsStorageStatus() {
  return {
    qdrantConfigured: Boolean(process.env.QDRANT_URL),
    qdrantEnabled: isQdrantConfigured(),
    collection: COLLECTION,
    fallback: "json",
  };
}
