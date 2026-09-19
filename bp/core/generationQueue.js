// bp/core/generationQueue.js
// Persistent document-generation queue for production.
// Redis/BullMQ is used when REDIS_URL is configured; memory queue remains as local fallback.

import crypto from "node:crypto";
import { getJob, nowMs, patchJob, putJob } from "./jobStore.js";
import { runGenerationProcessor } from "./generationProcessors.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_PENDING = 100;
const DEFAULT_NAMESPACE = "excel";

const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.GENERATION_CONCURRENCY || process.env.BP_GENERATION_CONCURRENCY || DEFAULT_CONCURRENCY)
);
const MAX_PENDING = Math.max(1, Number(process.env.GENERATION_QUEUE_MAX_PENDING || DEFAULT_MAX_PENDING));
const QUEUE_NAME = process.env.GENERATION_QUEUE_NAME || "droitgpt-generation";
const USER_LOCK_TTL_MS = Math.max(10 * 60 * 1000, Number(process.env.GENERATION_USER_LOCK_TTL_MS || 6 * 60 * 60 * 1000));
const SYNC_WAIT_MS = Math.max(30 * 1000, Number(process.env.GENERATION_SYNC_WAIT_MS || 45 * 60 * 1000));
const BULL_RETENTION_AGE_SECONDS = Math.max(3600, Number(process.env.GENERATION_QUEUE_RETENTION_SECONDS || 7 * 24 * 60 * 60));
const BULL_RETENTION_COUNT = Math.max(100, Number(process.env.GENERATION_QUEUE_RETENTION_COUNT || 3000));

const queue = [];
const activeUsers = new Map();
const queuedUsers = new Map();
let running = 0;

let bullInitPromise = null;
let bullQueue = null;
let bullQueueEvents = null;
let bullWorker = null;
let bullLockRedis = null;
let bullDisabled = false;
let bullStarted = false;

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const s = String(value || "").trim();
    if (s) return s;
  }
  return "";
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function resolveGenerationUserKey(req) {
  const b = req?.body || {};
  const raw = firstNonEmpty(
    req?.headers?.["x-generation-user"],
    req?.headers?.["x-user-id"],
    req?.headers?.["x-client-id"],
    req?.headers?.["x-session-id"],
    b.userId,
    b.userEmail,
    b.email,
    req?.headers?.authorization,
    req?.ip,
    req?.socket?.remoteAddress
  );

  return `u:${hashValue(raw || "anonymous")}`;
}

function userHasWork(userKey) {
  return activeUsers.has(userKey) || queuedUsers.has(userKey);
}

function buildConflict(job, activeJobId = null) {
  return {
    accepted: false,
    statusCode: 429,
    body: {
      ok: false,
      error: "USER_GENERATION_IN_PROGRESS",
      details: "Une generation est deja en cours pour cet utilisateur. Attends la fin avant d'en lancer une autre.",
      activeJobId: activeJobId || activeUsers.get(job.userKey) || queuedUsers.get(job.userKey) || null,
    },
  };
}

function buildQueueFull() {
  return {
    accepted: false,
    statusCode: 503,
    body: {
      ok: false,
      error: "GENERATION_QUEUE_FULL",
      details: "La file de generation est pleine. Reessaie dans quelques minutes.",
    },
  };
}

function makeCompletion() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function canUseBullMQ({ processor } = {}) {
  if (bullDisabled) return false;
  if (!processor) return false;
  if (!process.env.REDIS_URL) return false;
  return !envBool("GENERATION_QUEUE_DISABLE_BULLMQ", false);
}

async function createRedisConnection() {
  const { default: IORedis } = await import("ioredis");
  return new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

async function initBullMQ({ startWorker = true } = {}) {
  if (!process.env.REDIS_URL || bullDisabled) return null;
  if (!bullInitPromise) {
    bullInitPromise = (async () => {
      try {
        const { Queue, QueueEvents, Worker } = await import("bullmq");
        bullQueue = new Queue(QUEUE_NAME, {
          connection: await createRedisConnection(),
          defaultJobOptions: {
            attempts: Math.max(1, Number(process.env.GENERATION_JOB_ATTEMPTS || 1)),
            removeOnComplete: { age: BULL_RETENTION_AGE_SECONDS, count: BULL_RETENTION_COUNT },
            removeOnFail: { age: BULL_RETENTION_AGE_SECONDS, count: BULL_RETENTION_COUNT },
          },
        });
        bullQueueEvents = new QueueEvents(QUEUE_NAME, { connection: await createRedisConnection() });
        await bullQueueEvents.waitUntilReady();

        bullLockRedis = await createRedisConnection();

        const workerEnabled = startWorker && envBool("GENERATION_QUEUE_WORKER_ENABLED", true);
        if (workerEnabled && !bullWorker) {
          bullWorker = new Worker(QUEUE_NAME, processBullJob, {
            connection: await createRedisConnection(),
            concurrency: MAX_CONCURRENT,
            lockDuration: Math.max(60_000, Number(process.env.GENERATION_JOB_LOCK_DURATION_MS || 300_000)),
            stalledInterval: Math.max(30_000, Number(process.env.GENERATION_STALLED_INTERVAL_MS || 60_000)),
            maxStalledCount: Math.max(1, Number(process.env.GENERATION_MAX_STALLED_COUNT || 1)),
          });
          bullWorker.on("completed", (job) => {
            console.log("[QUEUE] job completed", { jobId: job?.data?.jobId, namespace: job?.data?.namespace });
          });
          bullWorker.on("failed", (job, err) => {
            console.error("[QUEUE] job failed", {
              jobId: job?.data?.jobId,
              namespace: job?.data?.namespace,
              error: String(err?.message || err),
            });
          });
          bullWorker.on("error", (err) => {
            console.error("[QUEUE] worker error", String(err?.message || err));
          });
        }

        bullStarted = true;
        console.log("[QUEUE] BullMQ enabled", { queue: QUEUE_NAME, concurrency: MAX_CONCURRENT, worker: Boolean(bullWorker) });
        return { queue: bullQueue, events: bullQueueEvents, worker: bullWorker };
      } catch (error) {
        bullDisabled = true;
        console.warn("[QUEUE] BullMQ disabled, falling back to memory queue:", String(error?.message || error));
        return null;
      }
    })();
  }
  return bullInitPromise;
}

export async function startPersistentGenerationWorker() {
  if (!process.env.REDIS_URL) {
    console.warn("[QUEUE] REDIS_URL missing; using memory queue. Configure Redis for restart-safe jobs.");
    return false;
  }
  const started = await initBullMQ({ startWorker: true });
  return Boolean(started);
}

async function acquireBullUserLock(userKey, jobId) {
  if (!bullLockRedis) return { ok: true };
  const key = userLockKey(userKey);
  const result = await bullLockRedis.set(key, jobId, "PX", USER_LOCK_TTL_MS, "NX");
  if (result === "OK") return { ok: true };
  const activeJobId = await bullLockRedis.get(key).catch(() => null);
  return { ok: false, activeJobId };
}

async function releaseBullUserLock(userKey, jobId) {
  if (!bullLockRedis || !userKey) return;
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await bullLockRedis.eval(script, 1, userLockKey(userKey), String(jobId || "")).catch(() => {});
}

function userLockKey(userKey) {
  return `generation:user-lock:${userKey}`;
}

function bullJobId(namespace, jobId) {
  return `${namespace || DEFAULT_NAMESPACE}__${jobId}`;
}

async function processBullJob(job) {
  const data = job?.data || {};
  const jobId = String(data.jobId || "");
  const namespace = data.namespace || DEFAULT_NAMESPACE;
  const ttlMs = Number(data.ttlMs || 0) || undefined;
  const userKey = data.userKey || "";

  try {
    const current = await getJob(jobId, { namespace });
    if (!current) throw new Error("JOB_RECORD_MISSING");

    await patchJob(
      jobId,
      { status: "running", startedAt: current.startedAt || nowMs(), updatedAt: nowMs(), bullJobId: job.id },
      { ttlMs, namespace }
    );

    const result = await runGenerationProcessor(data.processor, data.payload || {});
    await patchJob(
      jobId,
      {
        status: "done",
        result,
        doneAt: nowMs(),
        updatedAt: nowMs(),
        error: null,
        bullJobId: job.id,
      },
      { ttlMs, namespace }
    );

    await releaseBullUserLock(userKey, jobId);
    return { ok: true, jobId, namespace };
  } catch (e) {
    const err = String(e?.message || e);
    await patchJob(
      jobId,
      {
        status: "error",
        error: err,
        doneAt: nowMs(),
        updatedAt: nowMs(),
        bullJobId: job.id,
      },
      { ttlMs, namespace }
    ).catch(() => null);
    await releaseBullUserLock(userKey, jobId);
    throw e;
  }
}

async function enqueueBullGenerationJob({ req, jobId, namespace, ttlMs, processor, payload, meta = {} }) {
  const bull = await initBullMQ({ startWorker: true });
  if (!bull?.queue || !bull?.events) return null;

  const counts = await bull.queue.getJobCounts("waiting", "delayed", "prioritized", "paused");
  const pending = Number(counts.waiting || 0) + Number(counts.delayed || 0) + Number(counts.prioritized || 0) + Number(counts.paused || 0);
  if (pending >= MAX_PENDING) return buildQueueFull();

  const userKey = resolveGenerationUserKey(req);
  const job = { userKey, jobId };
  const lock = await acquireBullUserLock(userKey, jobId);
  if (!lock.ok) return buildConflict(job, lock.activeJobId);

  const createdAt = nowMs();
  const ns = namespace || DEFAULT_NAMESPACE;

  try {
    await putJob(
      {
        id: jobId,
        status: "queued",
        createdAt,
        updatedAt: createdAt,
        error: null,
        result: null,
        namespace: ns,
        userKey,
        processor,
        queueBackend: "bullmq",
        ...meta,
      },
      { ttlMs, namespace: ns }
    );

    const bullJob = await bull.queue.add(
      "generation",
      { jobId, namespace: ns, ttlMs, userKey, processor, payload: payload || {} },
      {
        jobId: bullJobId(ns, jobId),
        removeOnComplete: { age: BULL_RETENTION_AGE_SECONDS, count: BULL_RETENTION_COUNT },
        removeOnFail: { age: BULL_RETENTION_AGE_SECONDS, count: BULL_RETENTION_COUNT },
      }
    );

    const completion = bullJob
      .waitUntilFinished(bull.events, SYNC_WAIT_MS)
      .then(() => getJob(jobId, { namespace: ns }))
      .catch(async (error) => {
        const current = await getJob(jobId, { namespace: ns });
        if (current?.status === "done" || current?.status === "error") return current;
        throw error;
      });
    completion.catch(() => {});

    return {
      accepted: true,
      jobId,
      status: "queued",
      completion,
      queue: await getBullQueueSnapshot(bull.queue),
    };
  } catch (error) {
    await releaseBullUserLock(userKey, jobId);
    throw error;
  }
}

async function getBullQueueSnapshot(q = bullQueue) {
  if (!q) return getGenerationQueueSnapshot();
  const counts = await q.getJobCounts("waiting", "active", "delayed", "prioritized", "paused", "failed", "completed");
  return {
    backend: "bullmq",
    queue: QUEUE_NAME,
    concurrency: MAX_CONCURRENT,
    maxPending: MAX_PENDING,
    waiting: Number(counts.waiting || 0),
    active: Number(counts.active || 0),
    delayed: Number(counts.delayed || 0),
    failed: Number(counts.failed || 0),
    completed: Number(counts.completed || 0),
  };
}

async function runQueuedJob(item) {
  running += 1;
  queuedUsers.delete(item.userKey);
  activeUsers.set(item.userKey, item.jobId);

  try {
    const current = await getJob(item.jobId, { namespace: item.namespace });
    if (!current) {
      item.completion.resolve(null);
      return;
    }

    await patchJob(
      item.jobId,
      { status: "running", startedAt: nowMs(), updatedAt: nowMs() },
      { ttlMs: item.ttlMs, namespace: item.namespace }
    );

    const result = item.processor
      ? await runGenerationProcessor(item.processor, item.payload || {})
      : await item.task();

    const doneJob = await patchJob(
      item.jobId,
      {
        status: "done",
        result,
        doneAt: nowMs(),
        updatedAt: nowMs(),
        error: null,
      },
      { ttlMs: item.ttlMs, namespace: item.namespace }
    );

    item.completion.resolve(doneJob);
  } catch (e) {
    const err = String(e?.message || e);
    const failedJob = await patchJob(
      item.jobId,
      {
        status: "error",
        error: err,
        doneAt: nowMs(),
        updatedAt: nowMs(),
      },
      { ttlMs: item.ttlMs, namespace: item.namespace }
    );
    item.completion.reject(Object.assign(new Error(err), { job: failedJob }));
  } finally {
    activeUsers.delete(item.userKey);
    running = Math.max(0, running - 1);
    drainQueue();
  }
}

function drainQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    void runQueuedJob(item);
  }
}

export async function enqueueGenerationJob({
  req,
  jobId,
  namespace,
  ttlMs,
  task,
  processor,
  payload,
  meta = {},
}) {
  if (canUseBullMQ({ processor })) {
    const persisted = await enqueueBullGenerationJob({ req, jobId, namespace, ttlMs, processor, payload, meta });
    if (persisted) return persisted;
  }

  const userKey = resolveGenerationUserKey(req);
  const job = { userKey, jobId };
  const ns = namespace || DEFAULT_NAMESPACE;

  if (userHasWork(userKey)) return buildConflict(job);
  if (queue.length >= MAX_PENDING) return buildQueueFull();

  const completion = makeCompletion();
  completion.promise.catch(() => {});
  const createdAt = nowMs();

  await putJob(
    {
      id: jobId,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      error: null,
      result: null,
      namespace: ns,
      userKey,
      processor: processor || null,
      queueBackend: "memory",
      ...meta,
    },
    { ttlMs, namespace: ns }
  );

  queuedUsers.set(userKey, jobId);
  queue.push({ jobId, namespace: ns, ttlMs, task, processor, payload, userKey, completion });
  drainQueue();

  return {
    accepted: true,
    jobId,
    status: "queued",
    completion: completion.promise,
    queue: getGenerationQueueSnapshot(),
  };
}

export function getGenerationQueueSnapshot() {
  return {
    backend: bullStarted ? "bullmq" : "memory",
    running,
    pending: queue.length,
    concurrency: MAX_CONCURRENT,
    maxPending: MAX_PENDING,
  };
}
