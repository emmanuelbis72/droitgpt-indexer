// business-plan-service/core/deepseekClient.js
// ✅ STRICT PROD: reuse client + timeouts + small retry.
// ✅ SAFETY: keep existing OpenAI-SDK path (used by Business Plan) but add a fetch fallback
//           for the specific intermittent SDK failure: "Cannot read properties of undefined (reading 'text')".

import OpenAI from "openai";

let _client = null;

/**
 * IMPORTANT (Render / Node 22):
 * - Do NOT import "undici" as a dependency (not installed by default).
 * - Node 22 already provides global fetch internally backed by undici.
 */
function initKeepAliveOnce() {
  // No-op on purpose (avoid hard dependency on undici).
  return;
}

export function createDeepSeekClient() {
  if (_client) return _client;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  initKeepAliveOnce();

  // DeepSeek est compatible OpenAI: on change juste baseURL + model.
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wrap an SDK call that accepts an AbortSignal.
 * `fn(signal)` must return a Promise.
 */
async function withTimeout(fn, ms) {
  const t = Number(ms || 0);
  if (!t || !Number.isFinite(t) || t <= 0) return await fn(undefined);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), t);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseURL(baseURL) {
  // Ensures URL join works even if baseURL has /v1 or trailing slash
  const b = String(baseURL || "").trim().replace(/\/$/, "");
  return b;
}

function looksLikeSdkUndefinedTextError(msg) {
  return String(msg || "").includes("Cannot read properties of undefined (reading 'text')");
}

async function deepseekFetchFallback({ messages, temperature, max_tokens, model, timeoutMs }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = normalizeBaseURL(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");

  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  // DeepSeek OpenAI-compatible endpoint
  // Most deployments expect /v1/chat/completions
  const url = new URL("/v1/chat/completions", baseURL).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || 120_000));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Read safely; never assume res.text exists (but it should)
      let body = "";
      try {
        body = await res.text();
      } catch (e) {
        body = String(e?.message || e);
      }
      throw new Error(`DeepSeek HTTP ${res.status}: ${body || res.statusText || "ERROR"}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("DeepSeek timeout (fetch fallback)");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function deepseekChat({ messages, temperature, max_tokens }) {
  const client = createDeepSeekClient();
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const temp = typeof temperature === "number" ? temperature : 0.25;
  const maxT = typeof max_tokens === "number" ? max_tokens : 1600;

  // ✅ Small retry for transient 429/5xx (keeps success rate high on small instances)
  const maxAttempts = Number(process.env.DEEPSEEK_RETRIES || 1) + 1;
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 120_000);

  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Primary path (keeps Business Plan behavior)
      const resp = await withTimeout(
        (signal) =>
          client.chat.completions.create({
            model,
            messages,
            temperature: temp,
            max_tokens: maxT,
            signal,
          }),
        timeoutMs
      );

      return resp?.choices?.[0]?.message?.content || "";
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);

      // ✅ Known transient SDK bug seen on Render: internal code tries to read `.text()` on undefined
      const sdkTextBug = msg.includes("Cannot read properties of undefined (reading 'text')");

      // 🔧 Special case: intermittent SDK internal error (undefined response -> .text())
      // We do a single fallback via fetch to avoid crashing NGO jobs, without changing BP prompts/orchestration.
      if (looksLikeSdkUndefinedTextError(msg)) {
        try {
          const out = await deepseekFetchFallback({
            messages,
            temperature: temp,
            max_tokens: maxT,
            model,
            timeoutMs,
          });
          return out || "";
        } catch (fallbackErr) {
          lastErr = fallbackErr;
          // Continue to normal retry logic below (if configured)
        }
      }

      // If aborted (timeout), do not retry unless explicitly allowed.
      if (e?.name === "AbortError") {
        if (Number(process.env.DEEPSEEK_RETRY_ON_TIMEOUT || 0) === 1 && attempt < maxAttempts) {
          await sleep(400 * attempt);
          continue;
        }
        throw e;
      }

      // Best-effort: retry on rate limit / server errors.
      const retryable = sdkTextBug || /429|rate|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|5\d\d/i.test(msg);
      if (!retryable || attempt >= maxAttempts) throw lastErr;
      await sleep(350 * attempt);
    }
  }

  throw lastErr || new Error("DeepSeek request failed");
}
