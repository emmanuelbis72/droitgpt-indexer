// bp/core/jobStore.js
// Optional Redis-backed job store for multi-instance Render.
// If REDIS_URL is not set, falls back to in-memory Map.

import crypto from "node:crypto";

let redis = null;

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
  } catch (e) {
    // If ioredis isn't installed or Redis unreachable, silently disable.
    redis = null;
    return null;
  }
}

const MEM = new Map();

function buildKey(namespace, id) {
  return `job:${namespace || "default"}:${id}`;
}

function getNamespace(options = {}) {
  return options.namespace || "excel";
}

function pruneExpiredMemoryJobs() {
  const t = nowMs();
  for (const [key, value] of MEM.entries()) {
    if (value?.expiresAt && value.expiresAt <= t) MEM.delete(key);
  }
}

export function makeJobId() {
  return crypto.randomUUID();
}

export function nowMs() {
  return Date.now();
}

export async function putJob(job, { ttlMs, namespace = "excel" } = {}) {
  const r = await getRedis();
  const ns = getNamespace({ namespace });
  if (!r) {
    pruneExpiredMemoryJobs();
    MEM.set(buildKey(ns, job.id), {
      job,
      expiresAt: ttlMs ? nowMs() + Number(ttlMs) : null,
    });
    return;
  }
  const key = buildKey(ns, job.id);
  await r.set(key, JSON.stringify(job), "PX", ttlMs);
}

export async function getJob(id, { namespace = "excel" } = {}) {
  const r = await getRedis();
  const ns = getNamespace({ namespace });
  const key = buildKey(ns, id);
  if (!r) {
    pruneExpiredMemoryJobs();
    return MEM.get(key)?.job || null;
  }
  const raw = await r.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function patchJob(id, patch, { ttlMs, namespace = "excel" } = {}) {
  const r = await getRedis();
  const ns = getNamespace({ namespace });
  if (!r) {
    pruneExpiredMemoryJobs();
    const key = buildKey(ns, id);
    const cur = MEM.get(key)?.job;
    if (!cur) return null;
    const next = { ...cur, ...patch };
    MEM.set(key, {
      job: next,
      expiresAt: ttlMs ? nowMs() + Number(ttlMs) : null,
    });
    return next;
  }
  const cur = await getJob(id, { namespace: ns });
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await putJob(next, { ttlMs, namespace: ns });
  return next;
}

export async function deleteJob(id, { namespace = "excel" } = {}) {
  const r = await getRedis();
  const ns = getNamespace({ namespace });
  const key = buildKey(ns, id);
  if (!r) {
    MEM.delete(key);
    return;
  }
  await r.del(key);
}
