// academicOrchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import { academicSystemPrompt, buildMemoirePlanPrompt, buildSectionPrompt } from "./academicPrompts.js";
import { searchCongoLawSources, formatPassagesForPrompt } from "./qdrantRag.js";

export async function generateLicenceMemoire({ lang, ctx }) {
  const temperature = Number(process.env.ACAD_TEMPERATURE || 0.35);
  const maxTokens = Number(process.env.ACAD_MAX_TOKENS || 1800);

  // 1) Plan (use user plan if provided)
  let plan = String(ctx.plan || "").trim();
  if (!plan) {
    plan = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang) },
        { role: "user", content: buildMemoirePlanPrompt({ lang, ctx }) },
      ],
      temperature,
      max_tokens: 900,
    });
  }

  // 2) Sections (stable set)
  const sectionTitles = extractSectionTitles(plan, lang);

  const sections = [];
  const sourcesUsed = [];

  for (const title of sectionTitles) {
    let passagesText = "";
    if (ctx.mode === "droit_congolais") {
      const { sources, passages } = await searchCongoLawSources({ query: `${ctx.topic}\n${title}`, limit: 7 });
      (sources || []).forEach((s) => sourcesUsed.push(s));
      passagesText = formatPassagesForPrompt(passages);
    }

    const content = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang) },
        { role: "user", content: buildSectionPrompt({ lang, ctx: { ...ctx, plan }, sectionTitle: title, sourcesText: passagesText }) },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    sections.push({ title, content });
  }

  const uniqueSources = dedupeSources(sourcesUsed);
  return { plan, sections, sourcesUsed: uniqueSources };
}

function dedupeSources(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const key = `${s?.title || s?.source || ""}::${s?.year || ""}::${s?.author || ""}`.toLowerCase();
    if (!key.trim()) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function extractSectionTitles(planText, lang) {
  const isEN = lang === "en";
  const text = String(planText || "").trim();
  const titles = [];

  text.split("\n").forEach((line) => {
    const t = line.trim().replace(/^[-•\d.\s]+/, "");
    if (!t) return;
    const up = t.toUpperCase();

    const looks = isEN
      ? up.startsWith("INTRO") || up.startsWith("CHAPTER") || up.startsWith("CONCLUSION")
      : up.startsWith("INTRO") || up.startsWith("CHAP") || up.startsWith("CONCLUSION");

    if (looks && t.length <= 120) titles.push(t);
  });

  if (titles.length < 4) {
    return isEN
      ? [
          "General Introduction",
          "Chapter 1: Concepts and Legal Framework",
          "Chapter 2: Congolese Legal Analysis",
          "General Conclusion",
          "Bibliography (draft)",
        ]
      : [
          "Introduction générale",
          "Chapitre 1 : Cadre conceptuel et juridique",
          "Chapitre 2 : Analyse en droit congolais",
          "Conclusion générale",
          "Bibliographie (brouillon)",
        ];
  }

  return titles.slice(0, 8);
}
