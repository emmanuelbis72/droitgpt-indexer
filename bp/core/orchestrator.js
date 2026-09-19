// business-plan-service/core/orchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import { systemPrompt, sectionPrompt, SECTION_ORDER } from "./prompts.js";

/**
 * Premium orchestration:
 * - Generates each section (sequential for determinism + resource control)
 * - JSON sections are parsed + normalized (especially financials)
 * - Text sections are protected against truncation (END marker + smart local cleanup)
 * - SPEED: reduce output length + avoid extra IA calls (CONTINUE / retries)
 */
export async function generateBusinessPlanPremium({ lang, ctx, lite = false }) {
  const temperature = Number(process.env.BP_TEMPERATURE || 0.2);

  /**
   * ⚡ SPEED (production): biggest latency driver is output length (tokens).
   * Keep env overrides for "max detail".
   */
  const maxSectionTokensDefault = Number(process.env.BP_MAX_SECTION_TOKENS || 2800);

  // Text continuation (extra LLM calls) => keep to 0 by default
  const sectionRetries = Number(process.env.BP_SECTION_RETRIES || 0);

  // JSON retries (extra LLM calls) => keep to 1 by default
  const jsonRetries = Number(process.env.BP_JSON_RETRIES || 1);

  /**
   * Lower thresholds => fewer CONTINUE calls => faster
   * (still protects against broken endings with local cleanup)
   */
  const minSectionChars = Number(process.env.BP_MIN_SECTION_CHARS || 450);
  const longEnoughChars = Number(process.env.BP_LONG_ENOUGH_CHARS || 1100);

  // Per-section token budgets (still overridable via env)
  const sectionMaxTokens = (key) => {
    const k = String(key || "").toLowerCase();

    // JSON sections: smaller is enough (strict schema + compact tables)
    if (["financials_json", "canvas_json", "swot_json", "kpi_calendar_json"].includes(k)) {
      return Math.min(maxSectionTokensDefault, Number(process.env.BP_MAX_TOKENS_JSON || 1900));
    }

    // Executive summary: concise, standard (should NOT be huge)
    if (k === "executive_summary") {
      return Math.min(maxSectionTokensDefault, Number(process.env.BP_MAX_TOKENS_EXEC || 2000));
    }

    // Market / GTM / Ops: mid
    if (["market_analysis", "go_to_market", "operations"].includes(k)) {
      return Math.min(maxSectionTokensDefault, Number(process.env.BP_MAX_TOKENS_MID || 2200));
    }

    // Competition can be shorter
    if (k === "competition_analysis") {
      return Math.min(maxSectionTokensDefault, Number(process.env.BP_MAX_TOKENS_COMP || 1800));
    }

    // Risks + funding ask: keep compact
    if (["risks", "funding_ask", "strategic_partnerships"].includes(k)) {
      return Math.min(maxSectionTokensDefault, Number(process.env.BP_MAX_TOKENS_SHORT || 1700));
    }

    // Default text
    return Math.min(maxSectionTokensDefault, Number(process.env.BP_MAX_TOKENS_TEXT || 2000));
  };

  // ✅ Mode lite rapide (still international-structure-compatible)
  const order = lite
    ? ["executive_summary", "canvas_json", "swot_json", "financials_json", "funding_ask"]
    : SECTION_ORDER;

  const sections = [];

  for (const key of order) {
    console.log(`🧩 Génération section: ${key}...`);

    // JSON sections
    if (["financials_json", "canvas_json", "swot_json", "kpi_calendar_json"].includes(key)) {
      const raw = await generateJsonSectionWithRetry({
        key,
        lang,
        ctx,
        temperature,
        max_tokens: sectionMaxTokens(key),
        retries: jsonRetries,
      });

      const obj = safeJsonParse(extractJsonBlock(raw));

      const meta =
        key === "financials_json"
          ? { financials: normalizeFinancials(obj, ctx) }
          : key === "canvas_json"
          ? { canvas: normalizeCanvas(obj, ctx, lang) }
          : key === "swot_json"
          ? { swot: normalizeSwot(obj, ctx, lang) }
          : { kpiCalendar: normalizeKpiCalendar(obj, ctx, lang) };

      sections.push({
        key,
        title: titleFromKey(key, lang),
        content: "",
        meta,
      });

      console.log(`✅ OK: ${key} (json=${obj ? "yes" : "no"})`);
      continue;
    }

    // Text sections (fast + safe)
    let content = await generateTextSectionWithContinuation({
      key,
      lang,
      ctx,
      temperature,
      max_tokens: sectionMaxTokens(key),
      retries: sectionRetries,
      minChars: minSectionChars,
      longEnoughChars,
    });

    // Funding ask sometimes returns JSON by mistake -> auto-format
    if (key === "funding_ask" && looksLikeJsonText(content)) {
      const obj = safeJsonParse(extractJsonBlock(content));
      if (obj) content = formatFundingAskFromJson(obj, lang);
    }

    // Fallback if empty/too short even after continuation
    if (String(content || "").replace(/\s+/g, " ").length < 120) {
      content = fallbackTextSection({ key, lang, ctx }) || String(content || "");
    }

    sections.push({ key, title: titleFromKey(key, lang), content: String(content || "").trim() });

    console.log(`✅ OK: ${key}`);
  }

  const fullText = assembleText({ lang, ctx, sections });
  return { sections, fullText };
}

/* =========================================================
   ✅ Truncation-proof generation (TEXT) — FAST MODE
========================================================= */

async function generateTextSectionWithContinuation({
  key,
  lang,
  ctx,
  temperature,
  max_tokens,
  retries = 0,
  minChars = 450,
  longEnoughChars = 1100,
}) {
  const marker = `[[END_SECTION:${key}]]`;

  // 1) initial prompt with strict end marker
  let prompt = buildTextPromptWithEndMarker({ lang, key, ctx, marker });

  let acc = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await deepseekChat({
      messages: [
        { role: "system", content: systemPrompt(lang) },
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

    // ✅ Accept conditions (FAST):
    const ok =
      (hasMarker && (longEnough || (!likelyTrunc && len >= minChars))) ||
      (!hasMarker && longEnough && !severeTrunc);

    if (ok) {
      const fixed = finalizeText(cleaned, { longEnough, likelyTrunc, severeTrunc });
      return fixed.trim();
    }

    // CONTINUE only when really necessary (extra IA call)
    const shouldContinue = len < minChars || severeTrunc || (!hasMarker && !longEnough);

    if (!shouldContinue) {
      return finalizeText(cleaned, { longEnough, likelyTrunc, severeTrunc }).trim();
    }

    const tail = cleaned.slice(-900);
    prompt = buildContinuePrompt({ key, lang, marker, tail });
  }

  return finalizeText(stripEndMarker(acc, marker), {
    longEnough: true,
    likelyTrunc: true,
    severeTrunc: true,
  }).trim();
}

function buildTextPromptWithEndMarker({ lang, key, ctx, marker }) {
  const base = sectionPrompt({ lang, sectionKey: key, ctx });

  return `
${base}

RÈGLES IMPORTANTES (OBLIGATOIRES):
- Cette section doit être COMPLÈTE (pas de phrase coupée, pas de liste inachevée).
- Termine cette section par le marqueur EXACT: ${marker}
- N'écris absolument RIEN après le marqueur.
- Assure-toi que la section se termine par une ponctuation finale (., !, ?, …) AVANT le marqueur.
`.trim();
}

function buildContinuePrompt({ key, lang, marker, tail }) {
  const isEN = lang === "en";
  return `
${isEN ? "You started a section but it is incomplete." : "Tu as commencé une section mais elle est incomplète."}
${isEN ? "CONTINUE exactly from where it stopped. Do NOT repeat." : "CONTINUE exactement là où ça s'est arrêté. Ne répète pas."}

${isEN ? "Last words:" : "Derniers mots:"}
"""${tail}"""

RÈGLES:
- Ne répète pas ce qui a déjà été écrit.
- Termine la section complètement (conclusion + transitions si nécessaire).
- Termine obligatoirement par: ${marker}
- N'écris rien après le marqueur.
`.trim();
}

function hasEndMarker(text, marker) {
  return String(text || "").includes(marker);
}

function stripEndMarker(text, marker) {
  return String(text || "").replace(marker, "").trim();
}

function isLikelyTruncated(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  const endsOk = /[.!?…»)\]]\s*$/.test(s);
  const endsBad = /[:\-–—]\s*$/.test(s);
  const last = s.slice(-120);
  const midWord = /[A-Za-zÀ-ÿ]{2,}$/.test(last) && !endsOk;
  return !endsOk || endsBad || midWord;
}

function isSeverelyTruncated(text) {
  const s = String(text || "").trim();
  if (!s) return true;

  const tail = s.slice(-220);
  const hasPunctNearEnd = /[.!?…»)\]]/.test(tail);

  const endsBad = /[:\-–—]\s*$/.test(s);
  const endsOk = /[.!?…»)\]]\s*$/.test(s);
  const midWord = /[A-Za-zÀ-ÿ]{2,}$/.test(s.slice(-40)) && !endsOk;

  return (endsBad || midWord) && !hasPunctNearEnd;
}

function finalizeText(text, { longEnough, likelyTrunc, severeTrunc }) {
  let s = String(text || "").trim();
  if (!s) return s;

  if ((severeTrunc || likelyTrunc) && longEnough) {
    s = trimToLastSentenceEnd(s, 500) || s;
  }

  s = ensureNiceEnding(s);
  return s;
}

function trimToLastSentenceEnd(text, lookback = 500) {
  const s = String(text || "");
  const start = Math.max(0, s.length - lookback);
  const chunk = s.slice(start);
  const idx = Math.max(chunk.lastIndexOf("."), chunk.lastIndexOf("!"), chunk.lastIndexOf("?"), chunk.lastIndexOf("…"));
  if (idx === -1) return null;
  return s.slice(0, start + idx + 1).trim();
}

function ensureNiceEnding(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  if (/[.!?…»)\]]\s*$/.test(s)) return s;
  return s + ".";
}

/* =========================================================
   ✅ JSON generation with retry (no markers)
========================================================= */

async function generateJsonSectionWithRetry({ key, lang, ctx, temperature, max_tokens, retries = 1 }) {
  let prompt = sectionPrompt({ lang, sectionKey: key, ctx });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await deepseekChat({
      messages: [
        { role: "system", content: systemPrompt(lang) },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens,
    });

    const txt = String(raw || "").trim();
    const obj = safeJsonParse(extractJsonBlock(txt));
    if (obj && typeof obj === "object") return txt;

    prompt = `
${sectionPrompt({ lang, sectionKey: key, ctx })}

RÈGLES JSON STRICTES (OBLIGATOIRES):
- Réponds UNIQUEMENT avec du JSON valide.
- Aucun texte avant/après le JSON.
- Pas de commentaires, pas de trailing commas.
`.trim();
  }

  return "";
}

/* =========================================================
   Titles + assemble
========================================================= */

function titleFromKey(key, lang) {
  const fr = {
    executive_summary: "Résumé exécutif",
    market_analysis: "Analyse du marché",
    competition_analysis: "Analyse concurrentielle",
    business_model: "Modèle économique",
    canvas_json: "Business Model Canvas",
    swot_json: "Analyse SWOT",
    go_to_market: "Stratégie Go-To-Market (Marketing & Ventes)",
    strategic_partnerships: "Partenariats stratégiques",
    kpi_calendar_json: "Plan d’exécution & KPIs",
    operations: "Plan d’opérations",
    risks: "Risques & mitigations",
    financials_json: "Plan financier (Tableaux)",
    funding_ask: "Besoin de financement & utilisation des fonds",
  };

  const en = {
    executive_summary: "Executive Summary",
    market_analysis: "Market Analysis",
    competition_analysis: "Competitive Analysis",
    business_model: "Business Model",
    canvas_json: "Business Model Canvas",
    swot_json: "SWOT Analysis",
    go_to_market: "Go-To-Market (Marketing & Sales)",
    strategic_partnerships: "Strategic Partnerships",
    kpi_calendar_json: "Execution Plan & KPIs",
    operations: "Operations Plan",
    risks: "Risks & Mitigation",
    financials_json: "Financial Plan (Tables)",
    funding_ask: "Funding Ask & Use of Funds",
  };

  return (lang === "en" ? en : fr)[key] || key;
}

function assembleText({ lang, ctx, sections }) {
  const header = lang === "en" ? `${ctx.companyName}\nBUSINESS PLAN (Premium)\n` : `${ctx.companyName}\nPLAN D’AFFAIRES (Premium)\n`;

  const toc = sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n");

  const body = sections
    .map((s, i) => {
      if (["financials_json", "canvas_json", "swot_json", "kpi_calendar_json"].includes(s.key)) {
        return `\n\n${i + 1}. ${s.title}\n${"-".repeat(40)}\n[Tables rendered in PDF]\n`;
      }
      return `\n\n${i + 1}. ${s.title}\n${"-".repeat(40)}\n${s.content}\n`;
    })
    .join("");

  return `${header}\nTABLE DES MATIÈRES\n${toc}\n${body}`;
}

/* -------------------------
   JSON helpers
------------------------- */
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonBlock(s) {
  const txt = String(s || "").trim();
  const m = txt.match(/```json\s*([\s\S]*?)\s*```/i) || txt.match(/```\s*([\s\S]*?)\s*```/);
  return m ? String(m[1] || "").trim() : txt;
}

/* -------------------------
   Normalizers (robust production) — UNCHANGED
------------------------- */
function isObj(o) {
  return !!o && typeof o === "object" && !Array.isArray(o);
}

function normalizeCanvas(obj, ctx, lang) {
  const c = isObj(obj) ? obj : {};
  const out = {
    partenaires_cles: toArr(c.partenaires_cles || c.key_partners),
    activites_cles: toArr(c.activites_cles || c.key_activities),
    ressources_cles: toArr(c.ressources_cles || c.key_resources),
    propositions_de_valeur: toArr(c.propositions_de_valeur || c.value_propositions),
    relations_clients: toArr(c.relations_clients || c.customer_relationships),
    canaux: toArr(c.canaux || c.channels),
    segments_clients: toArr(c.segments_clients || c.customer_segments),
    structure_de_couts: toArr(c.structure_de_couts || c.cost_structure),
    sources_de_revenus: toArr(c.sources_de_revenus || c.revenue_streams),
  };

  const isEmpty = Object.values(out).every((v) => Array.isArray(v) && v.length === 0);
  return isEmpty ? buildFallbackCanvas({ ctx, lang }) : out;
}

function normalizeSwot(obj, ctx, lang) {
  const s = isObj(obj) ? obj : {};
  return {
    forces: toArr(s.forces || s.strengths),
    faiblesses: toArr(s.faiblesses || s.weaknesses),
    opportunites: toArr(s.opportunites || s.opportunities),
    menaces: toArr(s.menaces || s.threats),
    interpretation: String(s.interpretation || "").trim(),
  };
}

function normalizeKpiCalendar(obj, ctx, lang) {
  const d = isObj(obj) ? obj : {};
  const calendrier = Array.isArray(d.calendrier || d.calendar) ? d.calendrier || d.calendar : [];
  const kpis = Array.isArray(d.kpis) ? d.kpis : [];

  const out = {
    calendrier: calendrier.map((r) => ({
      periode: String(r?.periode || r?.period || "").trim(),
      jalons: toArr(r?.jalons || r?.milestones),
      livrables: toArr(r?.livrables || r?.deliverables),
      responsable: String(r?.responsable || r?.owner || "").trim(),
    })),
    kpis: kpis.map((r) => ({
      kpi: String(r?.kpi || "").trim(),
      definition: String(r?.definition || "").trim(),
      cible_12m: String(r?.cible_12m || r?.target_12m || "").trim(),
      frequence: String(r?.frequence || r?.frequency || "").trim(),
      responsable: String(r?.responsable || r?.owner || "").trim(),
    })),
  };

  const isCalEmpty = !out.calendrier.length;
  const isKpiEmpty = !out.kpis.length;
  return isCalEmpty && isKpiEmpty ? buildFallbackKpiCalendar({ ctx, lang }) : out;
}

function normalizeFinancials(obj, ctx) {
  const fin0 = isObj(obj) ? obj : {};
  const years = ["Y1", "Y2", "Y3", "Y4", "Y5"];
  const currency = String(fin0.currency || "USD").trim() || "USD";
  const explicitInputs = hasExplicitFinancialInputs(ctx);

  const normalizeTable = (arr, defaultFormat = "money") => {
    const rows = Array.isArray(arr) ? arr : [];
    return rows
      .map((row) => {
        const r = isObj(row) ? { ...row } : {};
        const out = { label: String(r.label || "").trim(), __format: String(r.__format || defaultFormat) };

        for (const [k, v] of Object.entries(r)) {
          const y = normalizeYearKey(k);
          if (y) out[y] = parseNumber(v);
        }
        for (const y of years) {
          if (out[y] === undefined) out[y] = null;
        }
        return out;
      })
      .filter((r) => r.label);
  };

  const assumptions = Array.isArray(fin0.assumptions) ? fin0.assumptions : [];
  const revenue_drivers = normalizeTable(fin0.revenue_drivers, "number");
  const pnl = normalizeTable(fin0.pnl, "money");
  const cashflow = normalizeTable(fin0.cashflow, "money");
  const balance_sheet = normalizeTable(fin0.balance_sheet, "money");

  ensureRow(pnl, "Revenue", years, "money");
  ensureRow(pnl, "COGS", years, "money");
  ensureRow(pnl, "OPEX", years, "money");

  const break_even = isObj(fin0.break_even)
    ? {
        metric: String(fin0.break_even.metric || "months").trim() || "months",
        estimate: parseNumber(fin0.break_even.estimate),
        explanation: String(fin0.break_even.explanation || "").trim(),
      }
    : { metric: "months", estimate: null, explanation: "" };

  const use_of_funds = Array.isArray(fin0.use_of_funds)
    ? fin0.use_of_funds
        .map((u) => ({
          label: String(u?.label || "").trim(),
          amount: parseNumber(u?.amount),
          notes: String(u?.notes || "").trim(),
        }))
        .filter((u) => u.label)
    : [];

  const scenarios = Array.isArray(fin0.scenarios)
    ? fin0.scenarios
        .map((s) => ({
          name: String(s?.name || "").trim(),
          note: String(s?.note || "").trim(),
        }))
        .filter((s) => s.name)
    : [];

  const fin = {
    currency,
    years,
    assumptions: assumptions
      .map((a) => ({
        label: String(a?.label || "").trim(),
        value: String(a?.value || "").trim(),
      }))
      .filter((a) => a.label),
    revenue_drivers,
    pnl,
    cashflow,
    balance_sheet,
    break_even,
    use_of_funds,
    scenarios,
  };

  const rev = findRow(fin.pnl, ["revenue", "ventes", "chiffre"]);
  const hasPositiveRevenue = rev ? years.some((y) => isFiniteNumber(rev[y]) && Number(rev[y]) > 0) : false;

  if (!explicitInputs || !hasPositiveRevenue) {
    return buildMissingFinancials({
      ctx,
      currency,
      years,
      reason: !explicitInputs
        ? "Aucune hypothese financiere explicite n'a ete fournie par l'utilisateur."
        : "La generation IA n'a pas produit de chiffre d'affaires positif verifiable.",
    });
  }

  return applyFinancialQualityControl(fin);
}

function normalizeYearKey(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return null;

  let m = k.match(/^y\s*([1-9])$/);
  if (m) return `Y${m[1]}`;
  m = k.match(/^year\s*([1-9])$/);
  if (m) return `Y${m[1]}`;

  m = k.match(/^([1-9])$/);
  if (m) return `Y${m[1]}`;

  m = k.match(/^y\s*([1-9])[^0-9]*/);
  if (m) return `Y${m[1]}`;
  m = k.match(/^year\s*([1-9])[^0-9]*/);
  if (m) return `Y${m[1]}`;

  m = k.match(/^year\s+([1-9])$/);
  if (m) return `Y${m[1]}`;

  return null;
}

function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s || /^(-|—|n\/a|na|null|undefined|a renseigner|à renseigner)$/i.test(s)) return null;

  const cleaned = s.replace(/[^\d,.\-]/g, "").replace(/\s+/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") return null;

  let num = null;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    num = Number(cleaned.replace(/,/g, ""));
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    const parts = cleaned.split(",");
    num = parts.length > 2 ? Number(parts.join("")) : Number(parts.join("."));
  } else {
    num = Number(cleaned);
  }
  return Number.isFinite(num) ? num : null;
}

function toArr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof v === "string") return v.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

function ensureRow(table, label, years, fmt) {
  const exists = Array.isArray(table) && table.some((r) => String(r?.label || "").toLowerCase() === String(label).toLowerCase());
  if (exists) return;
  const row = { label, __format: fmt };
  for (const y of years) row[y] = null;
  table.push(row);
}

function findRow(rows, needles) {
  const rr = Array.isArray(rows) ? rows : [];
  const ns = (needles || []).map((n) => String(n).toLowerCase());
  for (const r of rr) {
    const label = String(r?.label || "").toLowerCase();
    if (ns.some((n) => label.includes(n))) return r;
  }
  return null;
}

function buildMissingFinancials({ ctx, currency = "USD", years, reason }) {
  const ys = Array.isArray(years) && years.length ? years : ["Y1", "Y2", "Y3", "Y4", "Y5"];
  const missing = ys.map(() => null);

  const pnl = [
    rowFrom("Revenue", missing, ys, "money"),
    rowFrom("COGS", missing, ys, "money"),
    rowFrom("OPEX", missing, ys, "money"),
  ];

  const cashflow = [
    rowFrom("Operating Cashflow", missing, ys, "money"),
    rowFrom("Investing Cashflow (CAPEX)", missing, ys, "money"),
    rowFrom("Financing Cashflow", missing, ys, "money"),
  ];

  const balance_sheet = [
    rowFrom("Cash", missing, ys, "money"),
    rowFrom("Inventory", missing, ys, "money"),
    rowFrom("Total Assets", missing, ys, "money"),
    rowFrom("Total Liabilities", missing, ys, "money"),
    rowFrom("Equity", missing, ys, "money"),
  ];

  return {
    currency: String(currency || "USD"),
    years: ys,
    missingData: true,
    qualityStatus: "missing_inputs",
    qualityNotes: [
      reason || "Les hypotheses financieres manquent ou sont insuffisantes.",
      "Aucun chiffre de secours n'a ete injecte par DroitGPT.",
      "Completer les volumes, prix, couts, charges, investissements et financement demande avant validation bancaire.",
    ],
    assumptions: [
      { label: "Chiffre d'affaires Y1", value: "a renseigner" },
      { label: "Volumes vendus / clients", value: "a renseigner" },
      { label: "Prix moyen", value: "a renseigner" },
      { label: "Couts variables / COGS", value: "a renseigner" },
      { label: "Charges fixes / OPEX", value: "a renseigner" },
      { label: "Investissements / CAPEX", value: "a renseigner" },
      { label: "Besoin de financement", value: String(ctx?.fundingAsk || "").trim() || "a renseigner" },
      { label: "Contexte", value: String(ctx?.country || "-") },
    ],
    revenue_drivers: [
      rowFrom("Volumes / ventes", missing, ys, "number"),
      rowFrom("Prix moyen", missing, ys, "number"),
    ],
    pnl,
    cashflow,
    balance_sheet,
    break_even: {
      metric: "months",
      estimate: null,
      explanation: "A renseigner apres validation des revenus, couts variables et charges fixes.",
    },
    use_of_funds: [
      { label: "Equipements & installation", amount: null, notes: "A renseigner" },
      { label: "Fonds de roulement", amount: null, notes: "A renseigner" },
    ],
    scenarios: [
      { name: "Base", note: "A construire apres validation des hypotheses." },
      { name: "Optimistic", note: "A construire apres validation des hypotheses." },
      { name: "Conservative", note: "A construire apres validation des hypotheses." },
    ],
  };
}

function rowFrom(label, arr, years, fmt) {
  const r = { label, __format: fmt };
  years.forEach((y, i) => {
    r[y] = isFiniteNumber(arr?.[i]) ? Number(arr[i]) : null;
  });
  return r;
}

function hasExplicitFinancialInputs(ctx = {}) {
  const text = [
    ctx?.finAssumptions,
    ctx?.fundingAsk,
    ctx?.draftText,
    ctx?.businessModel,
    ctx?.traction,
  ]
    .map((x) => String(x || ""))
    .join("\n")
    .toLowerCase();

  if (!/\d/.test(text)) return false;
  return /(usd|\$|fc|cdf|eur|€|dollar|franc|chiffre|revenu|vente|prix|cout|coût|charge|marge|capex|opex|budget|financement|investissement|tresorerie|trésorerie|cash)/i.test(text);
}

function applyFinancialQualityControl(fin) {
  const years = Array.isArray(fin?.years) ? fin.years : ["Y1", "Y2", "Y3", "Y4", "Y5"];
  const notes = [];
  const cash = findRow(fin.balance_sheet, ["cash", "tresorerie", "trésorerie"]);
  const assets = findRow(fin.balance_sheet, ["total assets", "total actif"]);
  const liabilities = findRow(fin.balance_sheet, ["total liabilities", "total passif"]);
  const equity = findRow(fin.balance_sheet, ["equity", "capitaux propres"]);

  for (const y of years) {
    const cashValue = optionalNumber(cash?.[y]);
    const assetsValue = optionalNumber(assets?.[y]);
    const liabilitiesValue = optionalNumber(liabilities?.[y]);
    const equityValue = optionalNumber(equity?.[y]);

    if (cashValue != null && assetsValue != null && cashValue > assetsValue) {
      notes.push(`${y}: tresorerie superieure au total actif; les hypotheses doivent etre verifiees.`);
    }

    if (assetsValue != null && liabilitiesValue != null && equityValue != null) {
      const balanceGap = Math.abs(assetsValue - (liabilitiesValue + equityValue));
      const tolerance = Math.max(1, Math.abs(assetsValue) * 0.05);
      if (balanceGap > tolerance) {
        notes.push(`${y}: bilan non equilibre; actif ${assetsValue}, passif+capitaux propres ${liabilitiesValue + equityValue}.`);
      }
    }
  }

  return {
    ...fin,
    missingData: false,
    qualityStatus: notes.length ? "needs_review" : "validated",
    qualityNotes: notes.length
      ? notes
      : ["Controle financier automatique: aucune incoherence majeure detectee sur les tableaux fournis."],
  };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isFiniteNumber(value) {
  return optionalNumber(value) !== null;
}

/* -------------------------
   Fallback generators (non-empty output)
------------------------- */
function fallbackTextSection({ key, lang, ctx }) {
  const isEN = lang === "en";

  if (key === "competition_analysis") {
    return isEN
      ? [
          "## Competitive landscape",
          "- Direct competitors: " + (ctx?.competition || "—"),
          "- Differentiation: quality, compliance, network/distribution, and service reliability.",
          "- Positioning: premium and consistent execution with measurable KPIs.",
          "- Competitive risks: price pressure, informal players, and supply constraints.",
          "- Response: focus on brand, partnerships, quality controls, and execution discipline.",
        ].join("\n")
      : [
          "## Paysage concurrentiel",
          "- Concurrents directs : " + (ctx?.competition || "—"),
          "- Différenciation : qualité, conformité, réseau/distribution, et fiabilité d’exécution.",
          "- Positionnement : premium + standardisation + indicateurs mesurables.",
          "- Risques concurrentiels : pression prix, informel, contraintes d’approvisionnement.",
          "- Réponse : marque, partenariats, contrôle qualité, discipline d’exécution.",
        ].join("\n");
  }

  if (key === "strategic_partnerships") {
    return isEN
      ? [
          "## Strategic partnerships",
          "- Suppliers: secure contracts for inputs to reduce volatility.",
          "- Distribution: supermarkets, B2B accounts, digital channels, and institutional buyers.",
          "- Compliance & quality: labs, certification bodies, and regulatory support.",
          "- Finance: banking partners for equipment and working capital.",
          "- Marketing: influencers, events, and corporate agreements.",
        ].join("\n")
      : [
          "## Partenariats stratégiques",
          "- Fournisseurs : contrats sécurisés d’intrants pour limiter la volatilité.",
          "- Distribution : supermarchés, comptes B2B, canaux digitaux, acheteurs institutionnels.",
          "- Conformité & qualité : laboratoires, organismes de certification, accompagnement réglementaire.",
          "- Finance : banque/IMF pour équipements et fonds de roulement.",
          "- Marketing : influence locale, événements, accords corporate.",
        ].join("\n");
  }

  const blocks = [
    ctx?.product ? (isEN ? "Product/Service" : "Produit/Service") + ": " + ctx.product : null,
    ctx?.customers ? (isEN ? "Customers" : "Clients") + ": " + ctx.customers : null,
    ctx?.businessModel ? (isEN ? "Business model" : "Modèle économique") + ": " + ctx.businessModel : null,
    ctx?.traction ? (isEN ? "Traction" : "Traction") + ": " + ctx.traction : null,
    ctx?.competition ? (isEN ? "Competition" : "Concurrence") + ": " + ctx.competition : null,
    ctx?.risks ? (isEN ? "Risks" : "Risques") + ": " + ctx.risks : null,
  ].filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : "";
}

function buildFallbackCanvas({ ctx, lang }) {
  const isEN = lang === "en";
  const product = String(ctx?.product || "").trim();
  const customers = String(ctx?.customers || "").trim();
  const bm = String(ctx?.businessModel || "").trim();

  const bullets = (arr) => arr.filter(Boolean);

  return {
    partenaires_cles: bullets([
      isEN ? "Suppliers & producers" : "Fournisseurs & producteurs",
      isEN ? "Distribution partners" : "Partenaires de distribution",
      isEN ? "Regulators & compliance" : "Autorités & conformité",
      isEN ? "Financial partners" : "Partenaires financiers",
    ]),
    activites_cles: bullets([
      isEN ? "Production / service delivery" : "Production / délivrance du service",
      isEN ? "Quality control & standards" : "Contrôle qualité & standards",
      isEN ? "Sales & distribution" : "Vente & distribution",
      isEN ? "Marketing & customer support" : "Marketing & support client",
    ]),
    ressources_cles: bullets([
      isEN ? "Team & know-how" : "Équipe & savoir-faire",
      isEN ? "Facilities & equipment" : "Infrastructure & équipements",
      isEN ? "Brand & channels" : "Marque & canaux",
      isEN ? "Processes & SOPs" : "Processus & procédures",
    ]),
    propositions_de_valeur: bullets([
      product
        ? (isEN ? "Natural / premium offering" : "Offre premium") + ": " + product.slice(0, 140) + (product.length > 140 ? "…" : "")
        : isEN
        ? "High-quality, reliable delivery"
        : "Qualité élevée et livraison fiable",
      isEN ? "Compliance, traceability, and consistency" : "Conformité, traçabilité, constance",
      isEN ? "Better customer experience & measurable outcomes" : "Expérience client + résultats mesurables",
    ]),
    relations_clients: bullets([
      isEN ? "B2B contracts & SLAs" : "Contrats B2B & engagements",
      isEN ? "Customer support and feedback loop" : "Support client + boucle feedback",
      isEN ? "Loyalty & retention programs" : "Fidélisation & rétention",
    ]),
    canaux: bullets([isEN ? "Retail & distributors" : "Retail & distributeurs", isEN ? "Direct sales (B2B)" : "Vente directe (B2B)", isEN ? "Digital & partnerships" : "Digital & partenariats"]),
    segments_clients: bullets([
      customers ? customers.slice(0, 160) + (customers.length > 160 ? "…" : "") : isEN ? "Urban households & B2B buyers" : "Ménages urbains & acheteurs B2B",
      isEN ? "Institutional accounts" : "Comptes institutionnels",
    ]),
    structure_de_couts: bullets([isEN ? "Inputs / raw materials" : "Intrants / matières premières", isEN ? "Labor & operations" : "Main-d’œuvre & opérations", isEN ? "Logistics & distribution" : "Logistique & distribution", isEN ? "Marketing & compliance" : "Marketing & conformité"]),
    sources_de_revenus: bullets([
      bm ? bm.slice(0, 170) + (bm.length > 170 ? "…" : "") : isEN ? "Product sales / contracts" : "Ventes / contrats",
      isEN ? "B2B recurring supply" : "Approvisionnement récurrent B2B",
      isEN ? "Wholesale / reseller margins" : "Grossistes / marges revendeurs",
    ]),
  };
}

function buildFallbackKpiCalendar({ ctx, lang }) {
  const isEN = lang === "en";
  return {
    calendrier: [
      { periode: "M1–M3", jalons: [isEN ? "Pilot launch" : "Lancement pilote", isEN ? "Quality SOPs" : "Procédures qualité"], livrables: [isEN ? "Pilot production" : "Production pilote", isEN ? "Initial distribution" : "Première distribution"], responsable: isEN ? "Operations" : "Opérations" },
      { periode: "M4–M6", jalons: [isEN ? "B2B contracts" : "Contrats B2B", isEN ? "Retail onboarding" : "Référencement retail"], livrables: [isEN ? "Stable monthly volume" : "Volume mensuel stable", isEN ? "Reporting" : "Reporting"], responsable: isEN ? "Sales" : "Ventes" },
      { periode: "M7–M12", jalons: [isEN ? "Scale production" : "Montée en capacité", isEN ? "New channels" : "Nouveaux canaux"], livrables: [isEN ? "Profitability path" : "Trajectoire rentabilité", isEN ? "KPIs dashboard" : "Tableau de bord KPIs"], responsable: isEN ? "Management" : "Direction" },
    ],
    kpis: [
      { kpi: isEN ? "Monthly revenue" : "Chiffre d’affaires mensuel", definition: isEN ? "Total sales per month" : "Ventes totales par mois", cible_12m: isEN ? ">= target based on ramp-up" : ">= cible selon montée en charge", frequence: isEN ? "Monthly" : "Mensuel", responsable: isEN ? "Finance" : "Finance" },
      { kpi: isEN ? "Gross margin %" : "Marge brute %", definition: isEN ? "(Revenue-COGS)/Revenue" : "(CA-COGS)/CA", cible_12m: ">= 40%", frequence: isEN ? "Monthly" : "Mensuel", responsable: isEN ? "Finance" : "Finance" },
      { kpi: isEN ? "On-time delivery" : "Livraison à temps", definition: isEN ? "% deliveries on time" : "% livraisons à temps", cible_12m: ">= 95%", frequence: isEN ? "Weekly" : "Hebdomadaire", responsable: isEN ? "Operations" : "Opérations" },
      { kpi: isEN ? "Active B2B accounts" : "Comptes B2B actifs", definition: isEN ? "Number of recurring buyers" : "Nombre d’acheteurs récurrents", cible_12m: "10–20", frequence: isEN ? "Monthly" : "Mensuel", responsable: isEN ? "Sales" : "Ventes" },
    ],
  };
}

// ===== Funding Ask JSON Formatter (auto-clean) =====
function looksLikeJsonText(txt) {
  const s = String(txt || "").trim();
  return s.startsWith("{") || s.startsWith("[") || /```json/i.test(s);
}

function formatFundingAskFromJson(obj, lang) {
  const isEN = lang === "en";
  const root = obj && typeof obj === "object" ? obj : {};
  const bf = root.besoin_financement || root.funding_need || root.funding_ask || {};
  const uf = root.utilisation_des_fonds || root.use_of_funds || root.utilisation_fonds || {};

  const money = (n, cur) => {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v === 0) return "—";
    return `${Math.round(v).toLocaleString("en-US")} ${cur || ""}`.trim();
  };

  const cur = bf.devise || bf.currency || "USD";
  const lines = [];

  lines.push(isEN ? "## Funding Need" : "## Besoin de financement");
  lines.push(isEN ? `- Total: **${money(bf.montant_total, cur)}**` : `- Montant total : **${money(bf.montant_total, cur)}**`);

  if (bf.objectif_principal) {
    lines.push(isEN ? `- Objective: ${bf.objectif_principal}` : `- Objectif : ${bf.objectif_principal}`);
  }

  if (Array.isArray(bf.options_structure)) {
    lines.push("");
    lines.push(isEN ? "### Structure options" : "### Options de structure");
    bf.options_structure.forEach((o) => lines.push(`- ${o}`));
  }

  lines.push("");
  lines.push(isEN ? "## Use of Funds" : "## Utilisation des fonds");

  if (Array.isArray(uf.postes)) {
    uf.postes.forEach((p) => {
      lines.push(`- ${p.poste}: **${money(p.montant, cur)}**`);
    });
  }

  return lines.join("\n");
}
