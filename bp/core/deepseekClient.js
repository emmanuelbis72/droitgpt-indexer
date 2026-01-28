// business-plan-service/core/deepseekClient.js
import OpenAI from "openai";

export function createDeepSeekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

  if (!apiKey) throw new Error("DEEPSEEK_API_KEY manquant.");

  // DeepSeek est compatible OpenAI: on change juste baseURL + model name.
  return new OpenAI({ apiKey, baseURL });
}

export async function deepseekChat({ messages, temperature, max_tokens }) {
  const client = createDeepSeekClient();

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.25,
    max_tokens: typeof max_tokens === "number" ? max_tokens : 1600,
  });

  return resp?.choices?.[0]?.message?.content || "";
}
