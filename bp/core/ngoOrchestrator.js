// bp/core/ngoOrchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import {
  ngoSystemPrompt,
  ngoSectionPrompt,
  NGO_SECTION_ORDER,
  NGO_LITE_ORDER,
} from "./ngoPrompts.js";

export async function generateNgoProjectPremium({ lang, ctx, lite = false }) {
  const temperature = Number(process.env.NGO_TEMPERATURE || 0.25);

  // Recommended: 4200–6000 for speed, 6500–9000 for max detail
  const maxSectionTokens = Number(process.env.NGO_MAX_SECTION_TOKENS || 5200);

  const sectionRetries = Number(process.env.NGO_SECTION_RETRIES || 1);
  const minSectionChars = Number(process.env.NGO_MIN_SECTION_CHARS || 900);
  const longEnoughChars = Number(process.env.NGO_LONG_ENOUGH_CHARS || 2200);

  const jsonRetries = Number(process.env.NGO_JSON_RETRIES || 2);

  const order = lite ? NGO_LITE_ORDER : NGO_SECTION_ORDER;
  const sections = [];

  for (const key of order) {
    console.log(`🧩 ONG Premium - Génération section: ${key}...`);

    // JSON sections
    const isJson = [
      "stakeholder_analysis_json",
      "logframe_json",
      "me_plan_json",
      "sdg_alignment_json",
      "risk_matrix_json",
      "budget_json",
      "workplan_json",
    ].includes(key);

    if (isJson) {
      const raw = await generateJsonSectionWithRetry({
        key,
        lang,
        ctx,
        temperature,
        max_tokens: maxSectionTokens,
        retries: jsonRetries,
      });

      const obj = safeJsonParse(extractJsonBlock(raw));
      sections.push({
        key,
        title: titleFromKey(key, lang),
        content: "",
        meta: { json: obj || null },
      });

      console.log(`✅ ONG OK: ${key} (json=${obj ? "yes" : "no"})`);
      continue;
    }

    // Text sections (truncation-proof)
    const content = await generateTextSectionWithContinuation({
      key,
      lang,
      ctx,
      temperature,
      max_tokens: maxSectionTokens,
      retries: sectionRetries,
      minChars: minSectionChars,
      longEnoughChars,
    });

    sections.push({
      key,
      title: titleFromKey(key, lang),
      content: String(content || "").trim(),
    });

    console.log(`✅ ONG OK: ${key}`);
  }

  return { sections };
}

/* =========================================================
   TEXT (Truncation-proof) — same logic as BP
========================================================= */
async function generateTextSectionWithContinuation({
  key,
  lang,
  ctx,
  temperature,
  max_tokens,
  retries = 1,
  minChars = 900,
  longEnoughChars = 2200,
}) {
  const marker = `[[END_SECTION:${key}]]`;
  let prompt = buildTextPromptWithEndMarker({ lang, key, ctx, marker });

  let acc = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await deepseekChat({
      messages: [
        { role: "system", content: ngoSystemPrompt(lang) },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens,
    });

    const chunk = String(raw || "").trim();
    if (chunk) acc = (acc ? acc + "\n\n" : "") + chunk;

    const hasMarker = hasEndMarker(acc, marker);
    const cleaned = stripEndMarker(acc, marker);

    const len = cleaned.length;
    const longEnough = len >= longEnoughChars;

    const likelyTrunc = isLikelyTruncated(cleaned);
    const severeTrunc = isSeverelyTruncated(cleaned);

    const ok =
      (hasMarker && (longEnough || (!likelyTrunc && len >= minChars))) ||
      (!hasMarker && longEnough && !severeTrunc);

    if (ok) return finalizeText(cleaned).trim();

    const shouldContinue =
      len < minChars || severeTrunc || (!hasMarker && !longEnough);

    if (!shouldContinue) return finalizeText(cleaned).trim();

    const tail = cleaned.slice(-900);
    prompt = buildContinuePrompt({ key, lang, marker, tail });
  }

  return finalizeText(stripEndMarker(acc, marker)).trim();
}

function buildTextPromptWithEndMarker({ lang, key, ctx, marker }) {
  const base = ngoSectionPrompt({ lang, sectionKey: key, ctx });

  const rulesFR = `
RÈGLES IMPORTANTES (OBLIGATOIRES):
- La section doit être COMPLÈTE (pas de phrase coupée, pas de liste inachevée).
- Termine cette section par le marqueur EXACT: ${marker}
- N'écris absolument RIEN après le marqueur.
- Assure-toi que la section se termine par une ponctuation finale AVANT le marqueur.
`.trim();

  const rulesEN = `
IMPORTANT RULES:
- The section must be COMPLETE (no cut sentences, no unfinished lists).
- End the section with the EXACT marker: ${marker}
- Write NOTHING after the marker.
- Ensure it ends with final punctuation BEFORE the marker.
`.trim();

  return `${base}\n\n${lang === "en" ? rulesEN : rulesFR}`.trim();
}

function buildContinuePrompt({ key, lang, marker, tail }) {
  const isEN = lang === "en";
  return `
${isEN ? "You started a section but it is incomplete." : "Tu as commencé une section mais elle est incomplète."}
${isEN ? "CONTINUE exactly from where it stopped. Do NOT repeat." : "CONTINUE exactement là où ça s'est arrêté. Ne répète pas."}

${isEN ? "Last words:" : "Derniers mots:"}
"""${tail}"""

RÈGLES:
- ${isEN ? "Do not repeat." : "Ne répète pas."}
- ${isEN ? "Finish the section completely." : "Termine complètement la section."}
- ${isEN ? "End with:" : "Termine par:"} ${marker}
- ${isEN ? "Write nothing after the marker." : "N'écris rien après le marqueur."}
`.trim();
}

function hasEndMarker(text, marker) {
  return String(text || "").includes(marker);
}

function stripEndMarker(text, marker) {
  return String(text || "").replace(marker, "").trim();
}

function isLikelyTruncated(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length < 200) return true;
  const last = t.slice(-1);
  return ![".", "!", "?", "…", "”", '"', "»"].includes(last);
}

function isSeverelyTruncated(text) {
  const t = String(text || "").trim();
  if (t.length < 350) return true;
  return isLikelyTruncated(t) && /[:,;\-]\s*$/.test(t);
}

function finalizeText(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  // small cleanup: avoid ending with orphan punctuation
  return t.replace(/\s+\n/g, "\n");
}

/* =========================================================
   JSON generation + parsing
========================================================= */
async function generateJsonSectionWithRetry({
  key,
  lang,
  ctx,
  temperature,
  max_tokens,
  retries = 2,
}) {
  const prompt = ngoSectionPrompt({ lang, sectionKey: key, ctx });

  let last = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await deepseekChat({
      messages: [
        { role: "system", content: ngoSystemPrompt(lang) },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens,
    });

    last = String(raw || "").trim();
    const jsonText = extractJsonBlock(last);
    const obj = safeJsonParse(jsonText);
    if (obj) return last;

    // Retry with stricter instruction
    const strict = `
${prompt}

IMPORTANT: Return STRICT JSON ONLY.
- No markdown
- No backticks
- No comments
- Must start with { and end with }
`.trim();

    last = await deepseekChat({
      messages: [
        { role: "system", content: ngoSystemPrompt(lang) },
        { role: "user", content: strict },
      ],
      temperature: Math.min(0.2, temperature),
      max_tokens,
    });
  }
  return last;
}

function extractJsonBlock(raw) {
  const s = String(raw || "").trim();
  if (!s) return s;

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s;
}

function safeJsonParse(s) {
  try {
    const txt = String(s || "").trim();
    if (!txt) return null;
    const obj = JSON.parse(txt);
    if (obj && typeof obj === "object") return obj;
    return null;
  } catch {
    return null;
  }
}

function titleFromKey(key, lang) {
  const fr = {
    cover_pack: "Fiche projet",
    executive_summary: "Résumé exécutif",
    context_justification: "Contexte et justification",
    problem_analysis: "Analyse du problème",
    stakeholder_analysis_json: "Analyse des parties prenantes",
    theory_of_change: "Théorie du changement",
    objectives_results: "Objectifs et résultats attendus",
    logframe_json: "Cadre logique (LogFrame)",
    implementation_plan: "Plan de mise en œuvre",
    me_plan_json: "Plan de Suivi-Évaluation (M&E)",
    sdg_alignment_json: "Alignement ODD (SDGs)",
    risk_matrix_json: "Analyse des risques et mitigation",
    budget_json: "Budget détaillé",
    workplan_json: "Chronogramme (Plan de travail)",
    sustainability_exit: "Durabilité et stratégie de sortie",
    governance_capacity: "Gouvernance, capacités et gestion fiduciaire",
    annexes_list: "Annexes",
  };

  const en = {
    cover_pack: "Project Factsheet",
    executive_summary: "Executive Summary",
    context_justification: "Context and Rationale",
    problem_analysis: "Problem Analysis",
    stakeholder_analysis_json: "Stakeholder Analysis",
    theory_of_change: "Theory of Change",
    objectives_results: "Objectives and Expected Results",
    logframe_json: "Logical Framework (LogFrame)",
    implementation_plan: "Implementation Plan",
    me_plan_json: "Monitoring & Evaluation (M&E) Plan",
    sdg_alignment_json: "SDG Alignment",
    risk_matrix_json: "Risk Analysis and Mitigation",
    budget_json: "Detailed Budget",
    workplan_json: "Workplan",
    sustainability_exit: "Sustainability and Exit Strategy",
    governance_capacity: "Governance, Capacity and Fiduciary Management",
    annexes_list: "Annexes",
  };

  const map = lang === "en" ? en : fr;
  return map[key] || key;
}
