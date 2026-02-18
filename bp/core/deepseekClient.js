// business-plan-service/core/deepseekClient.js
// ✅ STRICT PROD: keep OpenAI-SDK path (used by Business Plan) but harden against transient failures on Render.
// - Reuse client instance
// - Small retry with backoff
// - Special-case the intermittent SDK bug: "Cannot read properties of undefined (reading 'text')" by recreating the client

import OpenAI from "openai";

let _client = null;

export function createDeepSeekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  if (_client) return _client;

  // DeepSeek est compatible OpenAI: on change juste baseURL + model name.
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableErrorMessage(msg) {
  const s = String(msg || "");
  // Known transient SDK internal error (seen on Render): undefined response -> tries to read `.text()`
  if (s.includes("Cannot read properties of undefined (reading 'text')") || s.includes("reading 'text'")) return true;

  // Common transient/network/rate issues
  return /429|rate|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|5\d\d/i.test(s);
}

/**
 * deepseekChat: returns assistant text content
 * - Keeps the same signature as before (messages, temperature, max_tokens)
 * - Adds retries WITHOUT changing business plan prompts or orchestration
 */
export async function deepseekChat({ messages, temperature, max_tokens }) {
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const temp = typeof temperature === "number" ? temperature : 0.25;
  const maxT = typeof max_tokens === "number" ? max_tokens : 1600;

  // Default: 2 attempts total (1 retry). Override via env if needed.
  const maxAttempts = Number(process.env.DEEPSEEK_MAX_ATTEMPTS || 2);

  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = createDeepSeekClient();

      const resp = await client.chat.completions.create({
        model,
        messages,
        temperature: temp,
        max_tokens: maxT,
      });

      return resp?.choices?.[0]?.message?.content || "";
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);

      // Log stack for Render diagnostics (doesn't change API output)
      console.error("[DeepSeek] request failed", { attempt, msg, stack: e?.stack });

      // If SDK hits the `.text()` bug, recreate client for next attempt
      const sdkTextBug =
        msg.includes("Cannot read properties of undefined (reading 'text')") || msg.includes("reading 'text'");
      if (sdkTextBug) {
        try {
          _client = null;
        } catch {
          // ignore
        }
      }

      const retryable = isRetryableErrorMessage(msg);
      if (!retryable || attempt >= maxAttempts) break;

      await sleep(350 * attempt);
      continue;
    }
  }

  throw lastErr || new Error("DeepSeek request failed");
}
