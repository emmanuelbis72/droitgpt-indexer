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



function looksLikeSdkUndefinedTextError(msg) {
  const m = String(msg || "");
  return m.includes("Cannot read properties of undefined (reading 'text')") || m.includes("reading 'text'");
}

async function deepseekFetchFallback({ messages, temperature, max_tokens, model, timeoutMs }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  const url = `${String(baseURL).replace(/\/$/, "")}/v1/chat/completions`;

  const controller = new AbortController();
  const t = Number(timeoutMs || 0);
  const timer = t > 0 ? setTimeout(() => controller.abort(), t) : null;

  try {
    const resp = await fetch(url, {
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

    const bodyText = await resp.text();

    if (!resp.ok) {
      throw new Error(`DeepSeek HTTP ${resp.status}: ${bodyText?.slice(0, 300) || "no-body"}`);
    }

    let j = null;
    try {
      j = JSON.parse(bodyText);
    } catch {
      throw new Error("DeepSeek fallback returned non-JSON body");
    }

    return j?.choices?.[0]?.message?.content || "";
  } finally {
    if (timer) clearTimeout(timer);
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

      // 🔧 Special case: intermittent SDK internal error (undefined response -> .text())
      // Fallback via fetch to avoid job crash, without changing Business Plan behavior.
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
          // If fallback also fails, continue to retry logic below.
        }

        // Recreate the SDK client on next attempt
        try { _client = null; } catch { /* ignore */ }
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
      const retryable = looksLikeSdkUndefinedTextError(msg) || /429|rate|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|5\d\d/i.test(msg);
      if (!retryable || attempt >= maxAttempts) throw e;
      await sleep(350 * attempt);
    }
  }

  throw lastErr || new Error("DeepSeek request failed");
}
