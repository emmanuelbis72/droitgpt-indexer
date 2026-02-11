// business-plan-service/core/orchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import { systemPrompt, sectionPrompt, SECTION_ORDER } from "./prompts.js";

/**
 * Premium orchestration:
 * - Generates each section
 * - JSON sections are parsed + normalized (especially financials)
 * - Text sections are protected against truncation (END marker + auto-continue)
 * - Returns sections + assembled plain text
 */
export async function generateBusinessPlanPremium({ lang, ctx, lite = false }) {
  const temperature = Number(process.env.BP_TEMPERATURE || 0.25);
  const maxSectionTokens = Number(process.env.BP_MAX_SECTION_TOKENS || 1800);

  // ✅ retries / minimal section size
  const sectionRetries = Number(process.env.BP_SECTION_RETRIES || 3);
  const minSectionChars = Number(process.env.BP_MIN_SECTION_CHARS || 1200);

  // ✅ Mode lite rapide
  const order = lite
    ? ["canvas_json", "swot_json", "kpi_calendar_json", "financials_json", "funding_ask"]
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
        max_tokens: maxSectionTokens,
        retries: sectionRetries,
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

    // Text sections (protected against truncation)
    let content = await generateTextSectionWithContinuation({
      key,
      lang,
      ctx,
      temperature,
      max_tokens: maxSectionTokens,
      retries: sectionRetries,
      minChars: minSectionChars,
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
   ✅ Truncation-proof generation (TEXT)
========================================================= */

async function generateTextSectionWithContinuation({
  key,
  lang,
  ctx,
  temperature,
  max_tokens,
  retries = 3,
  minChars = 1200,
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

    // If it has the marker and does not look truncated and is not too short -> accept
    const cleaned = stripEndMarker(acc, marker);

    const ok =
      hasEndMarker(acc, marker) &&
      !isLikelyTruncated(cleaned) &&
      cleaned.length >= Math.min(minChars, 8000); // avoid forcing giant sections

    if (ok) return cleaned.trim();

    // If missing marker OR likely truncated OR too short: continue
    const tail = cleaned.slice(-900);

    prompt = buildContinuePrompt({ key, lang, marker, tail });

    // Next attempt will append
  }

  // Final fallback: return whatever we have (without marker)
  return stripEndMarker(acc, marker).trim();
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

  // Ends with proper punctuation?
  const endsOk = /[.!?…»)\]]\s*$/.test(s);

  // Ends with colon/dash = suspicious
  const endsBad = /[:\-–—]\s*$/.test(s);

  // Last line short / mid-word cut
  const last = s.slice(-120);
  const midWord = /[A-Za-zÀ-ÿ]{2,}$/.test(last) && !endsOk;

  // A section can end without punctuation in some styles, but for BP we enforce punctuation.
  return !endsOk || endsBad || midWord;
}

/* =========================================================
   ✅ JSON generation with retry (no markers)
========================================================= */

async function generateJsonSectionWithRetry({ key, lang, ctx, temperature, max_tokens, retries = 3 }) {
  // First attempt: normal prompt
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

    // Retry prompt: enforce strict JSON
    prompt = `
${sectionPrompt({ lang, sectionKey: key, ctx })}

RÈGLES JSON STRICTES (OBLIGATOIRES):
- Réponds UNIQUEMENT avec du JSON valide.
- Si tu utilises un bloc, utilise \`\`\`json ... \`\`\`.
- Aucun texte avant/après le JSON.
- Pas de commentaires, pas de trailing commas.
`.trim();
  }

  // Return last raw; normalizers will fallback if null
  return "";
}

/* =========================================================
   Titles + assemble
========================================================= */

function titleFromKey(key, lang) {
  const fr = {
    executive_summary: "Executive Summary",
    market_analysis: "Analyse du marché",
    competition_analysis: "Analyse concurrentielle",
    business_model: "Modèle économique",
    canvas_json: "Business Model Canvas",
    swot_json: "Analyse SWOT",
    go_to_market: "Stratégie Go-To-Market",
    strategic_partnerships: "Partenariats stratégiques",
    kpi_calendar_json: "Calendrier et Indicateurs Clés de Performance (KPIs)",
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
    go_to_market: "Go-To-Market Strategy",
    strategic_partnerships: "Strategic Partnerships",
    kpi_calendar_json: "Execution Calendar & Key Performance Indicators (KPIs)",
    operations: "Operations Plan",
    risks: "Risks & Mitigation",
    financials_json: "Financial Plan (Tables)",
    funding_ask: "Funding Ask & Use of Funds",
  };

  return (lang === "en" ? en : fr)[key] || key;
}

function assembleText({ lang, ctx, sections }) {
  const header =
    lang === "en"
      ? `${ctx.companyName}\nBUSINESS PLAN (Premium)\n`
      : `${ctx.companyName}\nPLAN D’AFFAIRES (Premium)\n`;

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

// deepseek may return ```json ... ``` or raw json
function extractJsonBlock(s) {
  const txt = String(s || "").trim();
  const m =
    txt.match(/```json\s*([\s\S]*?)\s*```/i) ||
    txt.match(/```\s*([\s\S]*?)\s*```/);
  return m ? String(m[1] || "").trim() : txt;
}

/* -------------------------
   Normalizers (robust production)
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
  const calendrier = Array.isArray(d.calendrier || d.calendar) ? (d.calendrier || d.calendar) : [];
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

  // Canonical years: Y1..Y5
  const years = ["Y1", "Y2", "Y3", "Y4", "Y5"];
  const currency = String(fin0.currency || "USD").trim() || "USD";

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
          if (out[y] === undefined) out[y] = 0;
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
    : { metric: "months", estimate: 0, explanation: "" };

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
  const hasNonZero = rev ? years.some((y) => Number(rev[y] || 0) > 0) : false;

  if (!hasNonZero) {
    return buildFallbackFinancials({ ctx, currency, years });
  }

  return fin;
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
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;

  const cleaned = s.replace(/[^\d,.\-]/g, "").replace(/\s+/g, "");

  let num = 0;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    num = Number(cleaned.replace(/,/g, ""));
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    const parts = cleaned.split(",");
    num = parts.length > 2 ? Number(parts.join("")) : Number(parts.join("."));
  } else {
    num = Number(cleaned);
  }
  if (!Number.isFinite(num)) num = 0;
  return num;
}

function toArr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof v === "string") return v.split("\n").map((x) => x.trim()).filter(Boolean);
  return [];
}

function ensureRow(table, label, years, fmt) {
  const exists =
    Array.isArray(table) &&
    table.some((r) => String(r?.label || "").toLowerCase() === String(label).toLowerCase());
  if (exists) return;
  const row = { label, __format: fmt };
  for (const y of years) row[y] = 0;
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

function buildFallbackFinancials({ ctx, currency = "USD", years }) {
  const ys = Array.isArray(years) && years.length ? years : ["Y1", "Y2", "Y3", "Y4", "Y5"];

  const baseRevenueY1 = 120000;
  const growth = [1, 1.35, 1.7, 2.05, 2.45];
  const revenue = ys.map((_, i) => Math.round(baseRevenueY1 * growth[i]));
  const cogs = revenue.map((r) => Math.round(r * 0.45));
  const opex = revenue.map((r) => Math.round(r * 0.30));
  const capex = [35000, 12000, 8000, 8000, 8000];
  const financing = [60000, 0, 0, 0, 0];

  const pnl = [rowFrom("Revenue", revenue, ys, "money"), rowFrom("COGS", cogs, ys, "money"), rowFrom("OPEX", opex, ys, "money")];

  const cashflow = [
    rowFrom("Operating Cashflow", revenue.map((r, i) => r - cogs[i] - opex[i]), ys, "money"),
    rowFrom("Investing Cashflow (CAPEX)", capex.map((c) => -c), ys, "money"),
    rowFrom("Financing Cashflow", financing, ys, "money"),
  ];

  const balance_sheet = [
    rowFrom("Cash", revenue.map((r, i) => Math.max(0, r - cogs[i] - opex[i] - capex[i] + financing[i])), ys, "money"),
    rowFrom("Inventory", revenue.map((r) => Math.round(r * 0.05)), ys, "money"),
    rowFrom("Total Assets", revenue.map((r) => Math.round(r * 0.40)), ys, "money"),
    rowFrom("Total Liabilities", revenue.map((r) => Math.round(r * 0.18)), ys, "money"),
    rowFrom("Equity", revenue.map((r) => Math.round(r * 0.22)), ys, "money"),
  ];

  return {
    currency: String(currency || "USD"),
    years: ys,
    assumptions: [
      { label: "Base revenus Y1", value: `${baseRevenueY1} ${currency}` },
      { label: "COGS (% revenus)", value: "45%" },
      { label: "OPEX (% revenus)", value: "30%" },
      { label: "Croissance", value: "conservative (ramp-up + distribution)" },
      { label: "CAPEX initial", value: `${capex[0]} ${currency}` },
      { label: "Contexte", value: String(ctx?.country || "—") },
    ],
    revenue_drivers: [rowFrom("Volumes / ventes (index)", [100, 135, 170, 205, 245], ys, "number"), rowFrom("Prix moyen (index)", [100, 102, 104, 106, 108], ys, "number")],
    pnl,
    cashflow,
    balance_sheet,
    break_even: { metric: "months", estimate: 18, explanation: "Estimation conservative basée sur ramp-up et capacité de distribution." },
    use_of_funds: [
      { label: "Équipements & installation", amount: 45000, notes: "Unité de production / hygiène / packaging" },
      { label: "Fonds de roulement", amount: 15000, notes: "Stock initial, logistique, distribution" },
    ],
    scenarios: [
      { name: "Base", note: "Rythme de croissance modéré, exécution standard." },
      { name: "Optimistic", note: "Accords B2B rapides + distribution élargie." },
      { name: "Conservative", note: "Adoption plus lente + pression sur coûts." },
    ],
  };
}

function rowFrom(label, arr, years, fmt) {
  const r = { label, __format: fmt };
  years.forEach((y, i) => {
    r[y] = Number(arr[i] || 0);
  });
  return r;
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
    partenaires_cles: bullets([isEN ? "Suppliers & producers" : "Fournisseurs & producteurs", isEN ? "Distribution partners" : "Partenaires de distribution", isEN ? "Regulators & compliance" : "Autorités & conformité", isEN ? "Financial partners" : "Partenaires financiers"]),
    activites_cles: bullets([isEN ? "Production / service delivery" : "Production / délivrance du service", isEN ? "Quality control & standards" : "Contrôle qualité & standards", isEN ? "Sales & distribution" : "Vente & distribution", isEN ? "Marketing & customer support" : "Marketing & support client"]),
    ressources_cles: bullets([isEN ? "Team & know-how" : "Équipe & savoir-faire", isEN ? "Facilities & equipment" : "Infrastructure & équipements", isEN ? "Brand & channels" : "Marque & canaux", isEN ? "Processes & SOPs" : "Processus & procédures"]),
    propositions_de_valeur: bullets([
      product
        ? (isEN ? "Natural / premium offering" : "Offre premium") + ": " + product.slice(0, 140) + (product.length > 140 ? "…" : "")
        : isEN
        ? "High-quality, reliable delivery"
        : "Qualité élevée et livraison fiable",
      isEN ? "Compliance, traceability, and consistency" : "Conformité, traçabilité, constance",
      isEN ? "Better customer experience & measurable outcomes" : "Expérience client + résultats mesurables",
    ]),
    relations_clients: bullets([isEN ? "B2B contracts & SLAs" : "Contrats B2B & engagements", isEN ? "Customer support and feedback loop" : "Support client + boucle feedback", isEN ? "Loyalty & retention programs" : "Fidélisation & rétention"]),
    canaux: bullets([isEN ? "Retail & distributors" : "Retail & distributeurs", isEN ? "Direct sales (B2B)" : "Vente directe (B2B)", isEN ? "Digital & partnerships" : "Digital & partenariats"]),
    segments_clients: bullets([customers ? customers.slice(0, 160) + (customers.length > 160 ? "…" : "") : isEN ? "Urban households & B2B buyers" : "Ménages urbains & acheteurs B2B", isEN ? "Institutional accounts" : "Comptes institutionnels"]),
    structure_de_couts: bullets([isEN ? "Inputs / raw materials" : "Intrants / matières premières", isEN ? "Labor & operations" : "Main-d’œuvre & opérations", isEN ? "Logistics & distribution" : "Logistique & distribution", isEN ? "Marketing & compliance" : "Marketing & conformité"]),
    sources_de_revenus: bullets([bm ? bm.slice(0, 170) + (bm.length > 170 ? "…" : "") : isEN ? "Product sales / contracts" : "Ventes / contrats", isEN ? "B2B recurring supply" : "Approvisionnement récurrent B2B", isEN ? "Wholesale / reseller margins" : "Grossistes / marges revendeurs"]),
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

/* -------------------------
   Funding Ask JSON Formatter (auto-clean)
------------------------- */
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
