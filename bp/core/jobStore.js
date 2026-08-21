// bp/core/jobStore.js
// Redis first, Qdrant second, in-memory last.
// This keeps paid generation jobs recoverable after browser disconnects and Render restarts.

import crypto from "node:crypto";
import zlib from "node:zlib";

const DEFAULT_NAMESPACE = "excel";
const QDRANT_COLLECTION = process.env.QDRANT_GENERATION_JOBS_COLLECTION || "droitgpt_generation_jobs";
const QDRANT_VECTOR_SIZE = 4;

let redis = null;
let qdrantInitPromise = null;
let qdrantDisabled = false;

const MEM = new Map();

async function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function buildKey(namespace, id) {
  return `job:${namespace || DEFAULT_NAMESPACE}:${id}`;
}

function getNamespace(options = {}) {
  return options.namespace || DEFAULT_NAMESPACE;
}

function pruneExpiredMemoryJobs() {
  const t = nowMs();
  for (const [key, value] of MEM.entries()) {
    if (value?.expiresAt && value.expiresAt <= t) MEM.delete(key);
  }
}

function cacheMemory(job, { ttlMs, namespace = DEFAULT_NAMESPACE } = {}) {
  pruneExpiredMemoryJobs();
  MEM.set(buildKey(namespace, job.id), {
    job,
    expiresAt: ttlMs ? nowMs() + Number(ttlMs) : null,
  });
}

export function makeJobId() {
  return crypto.randomUUID();
}

export function nowMs() {
  return Date.now();
}

export async function putJob(job, { ttlMs, namespace = DEFAULT_NAMESPACE } = {}) {
  const ns = getNamespace({ namespace });
  cacheMemory(job, { ttlMs, namespace: ns });

  const r = await getRedis();
  if (r) {
    if (ttlMs) await r.set(buildKey(ns, job.id), JSON.stringify(job), "PX", ttlMs);
    else await r.set(buildKey(ns, job.id), JSON.stringify(job));
    return;
  }

  await qdrantSaveJobSafe(job, { namespace: ns });
}

export async function getJob(id, { namespace = DEFAULT_NAMESPACE } = {}) {
  const ns = getNamespace({ namespace });
  const key = buildKey(ns, id);

  const r = await getRedis();
  if (r) {
    const raw = await r.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  pruneExpiredMemoryJobs();
  const cached = MEM.get(key)?.job || null;
  if (cached) return cached;

  const remote = await qdrantGetJobSafe(id, { namespace: ns });
  if (remote) cacheMemory(remote, { namespace: ns });
  return remote;
}

export async function patchJob(id, patch, { ttlMs, namespace = DEFAULT_NAMESPACE } = {}) {
  const ns = getNamespace({ namespace });
  const cur = await getJob(id, { namespace: ns });
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await putJob(next, { ttlMs, namespace: ns });
  return next;
}

export async function deleteJob(id, { namespace = DEFAULT_NAMESPACE } = {}) {
  const ns = getNamespace({ namespace });
  MEM.delete(buildKey(ns, id));

  const r = await getRedis();
  if (r) {
    await r.del(buildKey(ns, id));
    return;
  }

  await qdrantDeleteJobSafe(id, { namespace: ns });
}

function isQdrantConfigured() {
  return Boolean(process.env.QDRANT_URL) && !envBool("GENERATION_JOBS_DISABLE_QDRANT_STORE", false) && !qdrantDisabled;
}

function normalizeQdrantBaseUrl() {
  const raw = String(process.env.QDRANT_URL || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

async function qdrantFetch(pathname, options = {}) {
  const base = normalizeQdrantBaseUrl();
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
  const hint = text.includes("404 page not found")
    ? " Check QDRANT_URL: use the Qdrant REST cluster endpoint, not the dashboard URL."
    : "";
  throw new Error(`${message}: HTTP ${response.status} ${text.slice(0, 300)}${hint}`);
}

async function ensureQdrantJobsCollection() {
  if (!isQdrantConfigured()) return false;
  if (!qdrantInitPromise) {
    qdrantInitPromise = (async () => {
      const name = encodeURIComponent(QDRANT_COLLECTION);
      const existing = await qdrantFetch(`/collections/${name}`, { method: "GET" });
      if (existing.ok) return true;
      if (existing.status !== 404) await throwQdrantError(existing, "Qdrant generation jobs collection check failed");

      const created = await qdrantFetch(`/collections/${name}`, {
        method: "PUT",
        body: JSON.stringify({ vectors: { size: QDRANT_VECTOR_SIZE, distance: "Cosine" } }),
      });
      if (!created.ok) await throwQdrantError(created, "Qdrant generation jobs collection create failed");
      return true;
    })().catch((error) => {
      qdrantDisabled = true;
      console.warn("[JOBS] Qdrant job store disabled, falling back to memory:", String(error?.message || error));
      return false;
    });
  }
  return qdrantInitPromise;
}

async function qdrantSaveJobSafe(job, { namespace = DEFAULT_NAMESPACE } = {}) {
  if (!isQdrantConfigured() || !(await ensureQdrantJobsCollection())) return false;
  try {
    const response = await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({
        points: [
          {
            id: jobPointId(namespace, job.id),
            vector: jobVector(job),
            payload: {
              recordKind: "generation_job",
              namespace,
              jobId: job.id,
              status: job.status || "queued",
              documentType: job.documentType || null,
              createdAt: job.createdAt || null,
              updatedAt: job.updatedAt || null,
              jobGzipBase64: encodeJob(job),
            },
          },
        ],
      }),
    });
    if (!response.ok) await throwQdrantError(response, "Qdrant generation job upsert failed");
    return true;
  } catch (error) {
    qdrantDisabled = true;
    console.warn("[JOBS] Qdrant job write failed, falling back to memory:", String(error?.message || error));
    return false;
  }
}

async function qdrantGetJobSafe(id, { namespace = DEFAULT_NAMESPACE } = {}) {
  if (!isQdrantConfigured() || !(await ensureQdrantJobsCollection())) return null;
  try {
    const response = await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points`, {
      method: "POST",
      body: JSON.stringify({
        ids: [jobPointId(namespace, id)],
        with_payload: true,
        with_vector: false,
      }),
    });
    if (!response.ok) await throwQdrantError(response, "Qdrant generation job retrieve failed");
    const json = await response.json();
    return decodeJob(json?.result?.[0]?.payload) || null;
  } catch (error) {
    qdrantDisabled = true;
    console.warn("[JOBS] Qdrant job read failed, falling back to memory:", String(error?.message || error));
    return null;
  }
}

async function qdrantDeleteJobSafe(id, { namespace = DEFAULT_NAMESPACE } = {}) {
  if (!isQdrantConfigured() || !(await ensureQdrantJobsCollection())) return false;
  try {
    const response = await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/delete?wait=true`, {
      method: "POST",
      body: JSON.stringify({ points: [jobPointId(namespace, id)] }),
    });
    if (!response.ok) await throwQdrantError(response, "Qdrant generation job delete failed");
    return true;
  } catch (error) {
    qdrantDisabled = true;
    console.warn("[JOBS] Qdrant job delete failed:", String(error?.message || error));
    return false;
  }
}

function encodeJob(job) {
  const json = JSON.stringify(job || {});
  return zlib.gzipSync(Buffer.from(json, "utf8")).toString("base64");
}

function decodeJob(payload = {}) {
  try {
    if (payload?.jobGzipBase64) {
      const raw = zlib.gunzipSync(Buffer.from(payload.jobGzipBase64, "base64")).toString("utf8");
      return JSON.parse(raw);
    }
    return payload?.record || null;
  } catch {
    return null;
  }
}

function jobPointId(namespace, id) {
  return deterministicUuid(`generation-job:${namespace}:${id}`);
}

function jobVector(job = {}) {
  const statusScore = job.status === "done" ? 1 : job.status === "error" ? -1 : job.status === "running" ? 0.5 : 0;
  const created = Number(job.createdAt || Date.now());
  const recency = Math.max(0, Math.min(1, created / 4102444800000)); // 2100-01-01
  const typeScore = Math.min(1, String(job.documentType || job.namespace || "").length / 80);
  return [1, statusScore, recency, typeScore];
}

function deterministicUuid(value) {
  const hash = crypto.createHash("sha1").update(String(value || "")).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}
