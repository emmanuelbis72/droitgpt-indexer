// bp/core/generationQueue.js
// Shared document-generation queue for Render single-instance services.
// It allows limited global concurrency while keeping one active generation per user.

import crypto from "node:crypto";
import { getJob, nowMs, patchJob, putJob } from "./jobStore.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_PENDING = 100;

const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.GENERATION_CONCURRENCY || process.env.BP_GENERATION_CONCURRENCY || DEFAULT_CONCURRENCY)
);
const MAX_PENDING = Math.max(1, Number(process.env.GENERATION_QUEUE_MAX_PENDING || DEFAULT_MAX_PENDING));

const queue = [];
const activeUsers = new Map();
const queuedUsers = new Map();
let running = 0;

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

function buildConflict(job) {
  return {
    accepted: false,
    statusCode: 429,
    body: {
      ok: false,
      error: "USER_GENERATION_IN_PROGRESS",
      details: "Une generation est deja en cours pour cet utilisateur. Attends la fin avant d'en lancer une autre.",
      activeJobId: activeUsers.get(job.userKey) || queuedUsers.get(job.userKey) || null,
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

    const result = await item.task();

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
  meta = {},
}) {
  const userKey = resolveGenerationUserKey(req);
  const job = { userKey, jobId };

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
      namespace,
      userKey,
      ...meta,
    },
    { ttlMs, namespace }
  );

  queuedUsers.set(userKey, jobId);
  queue.push({ jobId, namespace, ttlMs, task, userKey, completion });
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
    running,
    pending: queue.length,
    concurrency: MAX_CONCURRENT,
    maxPending: MAX_PENDING,
  };
}
