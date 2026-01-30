// academicOrchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import {
  academicSystemPrompt,
  buildMemoirePlanPrompt,
  buildMemoireSectionPrompt,
  // compat (older code)
  buildSectionPrompt,
} from "./academicPrompts.js";
import { searchCongoLawSources, formatPassagesForPrompt } from "./qdrantRag.js";

/**
 * ✅ Export attendu par la route:
 *   - generateLicenceMemoire
 */

async function generateSectionWithRetries({
  lang,
  ctx,
  title,
  passagesText,
  temperature,
  maxTokensPerSection,
}) {
  const attempts = Number(process.env.ACAD_SECTION_RETRIES || 2);
  const minChars = Number(process.env.ACAD_MIN_SECTION_CHARS || 2400);
  const hardMax = Number(process.env.ACAD_HARD_MAX_TOKENS || 5000);

  let last = "";
  for (let i = 0; i <= attempts; i++) {
    const boost = i === 0 ? 1 : 1.35;
    const mt = Math.min(Math.floor(maxTokensPerSection * boost), hardMax);

    const promptFn =
      typeof buildMemoireSectionPrompt === "function"
        ? buildMemoireSectionPrompt
        : buildSectionPrompt;

    const content = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang) },
        {
          role: "user",
          content: promptFn({
            lang,
            ctx,
            sectionTitle: title,
            sourcesText: passagesText,
          }),
        },
      ],
      temperature,
      max_tokens: mt,
    });

    last = String(content || "").trim();
    if (last.length >= minChars) return last;

    console.warn("[Memoire] Section too short/empty, retry", {
      title,
      attempt: i + 1,
      chars: last.length,
      max_tokens: mt,
    });
  }

  return (
    last ||
    `**${title}**\n\n(Contenu non généré : réponse vide du modèle. Veuillez relancer la génération.)\n`
  );
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

function extractWritingUnits(planText, lang) {
  const isEN = lang === "en";
  const text = String(planText || "").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const units = [];
  const push = (t) => {
    const s = String(t || "").trim();
    if (!s) return;
    if (s.length > 160) return;
    if (units.includes(s)) return;
    units.push(s);
  };

  for (const line of lines) {
    const t = line.replace(/^[-•\d.\s]+/, "");
    const up = t.toUpperCase();

    const match = isEN
      ? up.startsWith("GENERAL INTRO") ||
        up.startsWith("INTRO") ||
        up.startsWith("PART") ||
        up.startsWith("CHAPTER") ||
        up.startsWith("SECTION") ||
        up.startsWith("CONCLUSION") ||
        up.startsWith("BIBLIO") ||
        up.startsWith("ANNEX")
      : up.startsWith("INTRO") ||
        up.startsWith("PARTIE") ||
        up.startsWith("CHAP") ||
        up.startsWith("SECTION") ||
        up.startsWith("CONCLUSION") ||
        up.startsWith("BIBLIO") ||
        up.startsWith("ANNEX");

    if (match) push(t);
  }

  if (units.length < 12) {
    return isEN
      ? [
          "GENERAL INTRODUCTION",
          "CHAPTER I: Concepts, Definition and Theoretical Framework",
          "Section 1: The concept of the rule of law",
          "Section 2: Principles and indicators",
          "CHAPTER II: Constitutional foundations in the DRC",
          "Section 1: Supremacy of the Constitution and legality",
          "Section 2: Separation of powers and checks and balances",
          "CHAPTER III: Institutional implementation challenges",
          "Section 1: Judiciary independence and effectiveness",
          "Section 2: Constitutional justice and enforcement",
          "CHAPTER IV: Practical challenges and prospects",
          "Section 1: Rights protection in times of crisis",
          "Section 2: Governance, accountability and reforms",
          "GENERAL CONCLUSION",
          "BIBLIOGRAPHY (draft)",
          "ANNEXES (draft)",
        ]
      : [
          "INTRODUCTION GÉNÉRALE",
          "CHAPITRE I : Notion et théorie de l’État de droit",
          "Section 1 : Définition et approches doctrinales",
          "Section 2 : Principes et indicateurs",
          "CHAPITRE II : Fondements constitutionnels en RDC",
          "Section 1 : Suprématie de la Constitution et légalité",
          "Section 2 : Séparation des pouvoirs et contre-pouvoirs",
          "CHAPITRE III : Obstacles institutionnels à l’effectivité",
          "Section 1 : Indépendance et efficacité de la justice",
          "Section 2 : Justice constitutionnelle et exécution",
          "CHAPITRE IV : Défis pratiques et perspectives",
          "Section 1 : Droits fondamentaux en période de crise",
          "Section 2 : Gouvernance, redevabilité et réformes",
          "CONCLUSION GÉNÉRALE",
          "BIBLIOGRAPHIE (brouillon)",
          "ANNEXES (brouillon)",
        ];
  }

  return units.slice(0, 24);
}

export async function generateLicenceMemoire({ lang, ctx }) {
  const temperature = Number(process.env.ACAD_TEMPERATURE || 0.35);
  const safeCtx = { ...(ctx || {}) };
  safeCtx.lengthPagesTarget = 70;

  const isCongoLawMode = ["droit_congolais", "qdrantLaw", "congo_law", "droitcongolais"].includes(
    String(safeCtx.mode || "").trim()
  );

  let plan = String(safeCtx.plan || "").trim();
  if (!plan) {
    plan = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang) },
        { role: "user", content: buildMemoirePlanPrompt({ lang, ctx: safeCtx }) },
      ],
      temperature,
      max_tokens: Number(process.env.ACAD_PLAN_MAX_TOKENS || 1400),
    });
  }

  const sectionTitles = extractWritingUnits(plan, lang);

  const tokensPerPage = Number(process.env.ACAD_TOKENS_PER_PAGE || 420);
  const totalBudget = 70 * tokensPerPage;
  const perSectionBudget = Math.floor(totalBudget / Math.max(sectionTitles.length, 1));
  const hardMaxTokensPerSection = Number(process.env.ACAD_MAX_TOKENS_PER_SECTION || 4200);
  const maxTokensPerSection = Math.max(1800, Math.min(hardMaxTokensPerSection, perSectionBudget));

  const sections = [];
  const sourcesUsed = [];

  for (const title of sectionTitles) {
    let passagesText = "";
    if (isCongoLawMode) {
      const { sources, passages } = await searchCongoLawSources({
        query: `${safeCtx.topic || ""}\n${title}`,
        limit: 8,
      });
      (sources || []).forEach((s) => sourcesUsed.push(s));
      passagesText = formatPassagesForPrompt(passages);
    }

    const content = await generateSectionWithRetries({
      lang,
      ctx: { ...safeCtx, plan },
      title,
      passagesText,
      temperature,
      maxTokensPerSection,
    });

    sections.push({ title, content });
  }

  const totalChars = sections.reduce((acc, s) => acc + String(s?.content || "").length, 0);
  const minTotalChars = Number(process.env.ACAD_MIN_TOTAL_CHARS || 140000);
  if (totalChars < minTotalChars) {
    const extras = [
      "ANNEXE A : Tableaux et indicateurs (brouillon)",
      "ANNEXE B : Jurisprudence et décisions pertinentes (brouillon)",
      "ANNEXE C : Textes légaux cités (brouillon)",
      "ANNEXE D : Synthèse et recommandations opérationnelles (brouillon)",
    ];
    for (const t of extras) {
      const content = await generateSectionWithRetries({
        lang,
        ctx: { ...safeCtx, plan },
        title: t,
        passagesText: "",
        temperature,
        maxTokensPerSection,
      });
      sections.push({ title: t, content });
    }
  }

  return { plan, sections, sourcesUsed: dedupeSources(sourcesUsed) };
}
