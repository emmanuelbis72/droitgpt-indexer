// business-plan-service/core/deepseekClient.js
// ✅ STRICT PROD: keep Business Plan behavior (OpenAI SDK) + add hardening for Render/DeepSeek transient failures.
// Key goals:
// - Reuse SDK client
// - Timeout support via AbortController signal
// - Retries on transient errors (429/5xx/network)
// - ✅ Fallback to direct fetch ONLY for the known intermittent SDK bug: "Cannot read properties of undefined (reading 'text')"
//   (prevents job failures without changing normal generation quality)

import OpenAI from "openai";

let _client = null;

function initKeepAliveOnce() {
  // No-op (avoid dependency on undici). Node 22 has global fetch.
  return;
}

export function createDeepSeekClient() {
  if (_client) return _client;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  initKeepAliveOnce();
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(fnTakesSignal, ms) {
  const t = Number(ms || 0);
  if (!t || !Number.isFinite(t) || t <= 0) return await fnTakesSignal(undefined);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), t);
  try {
    return await fnTakesSignal(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function isSdkUndefinedTextBug(err) {
  const msg = String(err?.message || err || "");
  return msg.includes("Cannot read properties of undefined (reading 'text')") || msg.includes("reading 'text'");
}

function isRetryableErrorMessage(msg) {
  const m = String(msg || "");
  return /429|rate|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|5\d\d/i.test(m);
}

// Direct fetch fallback (OpenAI-compatible) – used ONLY when SDK hits the known bug.
async function deepseekFetchFallback({ model, messages, temperature, max_tokens, timeoutMs }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  const url = `${String(baseURL).replace(/\/$/, "")}/v1/chat/completions`;

  return await withTimeout(async (signal) => {
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
      signal,
    });

    const bodyText = await resp.text();

    if (!resp.ok) {
      throw new Error(`DeepSeek HTTP ${resp.status}: ${bodyText?.slice(0, 400) || "no-body"}`);
    }

    let json = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error("DeepSeek fallback: non-JSON body");
    }

    return json?.choices?.[0]?.message?.content || "";
  }, timeoutMs);
}

export async function deepseekChat({ messages, temperature, max_tokens }) {
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const temp = typeof temperature === "number" ? temperature : 0.25;
  const maxT = typeof max_tokens === "number" ? max_tokens : 1600;

  const maxAttempts = Number(process.env.DEEPSEEK_RETRIES || 1) + 1; // default 2 attempts
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 120_000);
  const retryOnTimeout = Number(process.env.DEEPSEEK_RETRY_ON_TIMEOUT || 0) === 1;

  // Fallback is enabled by default (safe) but ONLY triggers on the SDK .text bug.
  const enableFallback = String(process.env.DEEPSEEK_FALLBACK_ON_SDK_BUG || "1") !== "0";

  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = createDeepSeekClient();

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

      const content = resp?.choices?.[0]?.message?.content || "";
      if (!content) {
        // If SDK returned an unexpected empty/shape, treat as transient.
        if (attempt < maxAttempts) {
          await sleep(350 * attempt);
          continue;
        }
      }
      return content;
    } catch (e) {
      lastErr = e;

      // Always log the stack server-side to make Render logs actionable.
      console.error("[DeepSeek] request failed", {
        attempt,
        msg: String(e?.message || e),
        stack: e?.stack,
      });

      // Timeout (AbortError) – retry only if enabled
      if (e?.name === "AbortError") {
        if (retryOnTimeout && attempt < maxAttempts) {
          await sleep(400 * attempt);
          continue;
        }
        throw e;
      }

      // Known SDK bug: fallback (fetch) OR retry with client reset
      if (isSdkUndefinedTextBug(e)) {
        // Reset SDK client (forces rebuild next attempt)
        try {
          _client = null;
        } catch {
          // ignore
        }

        if (enableFallback) {
          try {
            const out = await deepseekFetchFallback({
              model,
              messages,
              temperature: temp,
              max_tokens: maxT,
              timeoutMs,
            });
            return out || "";
          } catch (fallbackErr) {
            // If fallback fails, we keep retrying if possible, otherwise throw the fallback error.
            lastErr = fallbackErr;
          }
        }

        if (attempt < maxAttempts) {
          await sleep(450 * attempt);
          continue;
        }

        throw lastErr || e;
      }

      const msg = String(e?.message || e);
      const retryable = isRetryableErrorMessage(msg);

      if (!retryable || attempt >= maxAttempts) {
        throw e;
      }

      await sleep(350 * attempt);
    }
  }

  throw lastErr || new Error("DeepSeek request failed");
}
