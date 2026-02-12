// business-plan-service/core/deepseekClient.js
// ✅ STRICT PROD: optimize latency by reusing the client + keep-alive + timeouts.

import OpenAI from "openai";

let _client = null;

/**
 * IMPORTANT (Render / Node 22):
 * - Do NOT import "undici" as a dependency (not installed by default).
 * - Node 22 already provides global fetch internally backed by undici.
 * - Keep-alive is handled automatically by the runtime.
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

async function withTimeout(promise, ms) {
  const t = Number(ms || 0);
  if (!t || !Number.isFinite(t) || t <= 0) return promise;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), t);
  try {
    // OpenAI SDK supports passing { signal } for abort.
    return await promise(controller.signal);
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

      // If aborted (timeout), do not retry unless explicitly allowed.
      if (e?.name === "AbortError") {
        if (Number(process.env.DEEPSEEK_RETRY_ON_TIMEOUT || 0) === 1 && attempt < maxAttempts) {
          await sleep(400 * attempt);
          continue;
        }
        throw e;
      }

      // Best-effort: retry on rate limit / server errors.
      const retryable = /429|rate|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|5\d\d/i.test(msg);
      if (!retryable || attempt >= maxAttempts) throw e;
      await sleep(350 * attempt);
    }
  }

  throw lastErr || new Error("DeepSeek request failed");
}
