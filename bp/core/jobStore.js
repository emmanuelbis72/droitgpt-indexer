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

export function makeJobId() {
  return crypto.randomUUID();
}

export function nowMs() {
  return Date.now();
}

export async function putJob(job, { ttlMs }) {
  const r = await getRedis();
  if (!r) {
    MEM.set(job.id, job);
    return;
  }
  const key = `exceljob:${job.id}`;
  await r.set(key, JSON.stringify(job), "PX", ttlMs);
}

export async function getJob(id) {
  const r = await getRedis();
  if (!r) return MEM.get(id) || null;
  const key = `exceljob:${id}`;
  const raw = await r.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function patchJob(id, patch, { ttlMs }) {
  const r = await getRedis();
  if (!r) {
    const cur = MEM.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    MEM.set(id, next);
    return next;
  }
  const cur = await getJob(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await putJob(next, { ttlMs });
  return next;
}

export async function deleteJob(id) {
  const r = await getRedis();
  if (!r) {
    MEM.delete(id);
    return;
  }
  await r.del(`exceljob:${id}`);
}
