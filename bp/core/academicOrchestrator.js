// academicOrchestrator.js

function endsWithCompleteSentence(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return /[\.!\?…]$/.test(t);
}

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

  // Base outline (fallback) – long enough to reach ~70 pages when expanded.
  const base = isEN
    ? [
        "GENERAL INTRODUCTION",
        "PART I: Conceptual and Theoretical Framework",
        "CHAPTER I: Concepts, definition and indicators",
        "Section 1: Definitions and doctrinal approaches",
        "Section 2: Principles and indicators of the rule of law",
        "Section 3: Comparative benchmarks and measurement limits",
        "CHAPTER II: Historical and political context of the DRC",
        "Section 1: Constitutional evolution and major reforms",
        "Section 2: Institutional dynamics and governance patterns",
        "Section 3: Security context, crisis and resilience factors",
        "PART II: Constitutional Foundations and Legal Mechanisms",
        "CHAPTER III: Supremacy of the Constitution and legality",
        "Section 1: Hierarchy of norms and constitutional review",
        "Section 2: Legislative process and normative control",
        "Section 3: Administrative legality and regulatory power",
        "CHAPTER IV: Separation of powers and checks and balances",
        "Section 1: Executive power and accountability",
        "Section 2: Parliament and oversight tools",
        "Section 3: Independent institutions and oversight bodies",
        "PART III: Implementation Challenges and Perspectives",
        "CHAPTER V: Judiciary independence and effectiveness",
        "Section 1: Status of judges and institutional safeguards",
        "Section 2: Practical obstacles and reforms",
        "Section 3: Access to justice and quality of decisions",
        "CHAPTER VI: Constitutional justice and enforcement",
        "Section 1: Role and limits of constitutional jurisdiction",
        "Section 2: Execution of decisions and political compliance",
        "Section 3: Human rights litigation and remedies",
        "CHAPTER VII: Governance, rights protection and reforms",
        "Section 1: Transparency, anti-corruption and public finance",
        "Section 2: Rights protection in times of crisis",
        "Section 3: Reform roadmap and realistic prospects",
        "GENERAL CONCLUSION",
        "BIBLIOGRAPHY (draft)",
        "ANNEXES (draft)",
      ]
    : [
        "INTRODUCTION GÉNÉRALE",
        "PARTIE I : Cadre conceptuel et théorique",
        "CHAPITRE I : Notion, définition et indicateurs de l’État de droit",
        "Section 1 : Définitions et approches doctrinales",
        "Section 2 : Principes et indicateurs de l’État de droit",
        "Section 3 : Repères comparés et limites de mesure",
        "CHAPITRE II : Contexte historique et politico-institutionnel de la RDC",
        "Section 1 : Évolution constitutionnelle et réformes majeures",
        "Section 2 : Dynamiques institutionnelles et gouvernance",
        "Section 3 : Contexte sécuritaire, crise et résilience",
        "PARTIE II : Fondements constitutionnels et mécanismes juridiques",
        "CHAPITRE III : Suprématie de la Constitution et principe de légalité",
        "Section 1 : Hiérarchie des normes et contrôle de constitutionnalité",
        "Section 2 : Production de la norme et contrôle de la loi",
        "Section 3 : Légalité administrative et pouvoir réglementaire",
        "CHAPITRE IV : Séparation des pouvoirs et contre-pouvoirs",
        "Section 1 : Pouvoir exécutif et redevabilité",
        "Section 2 : Parlement et instruments de contrôle",
        "Section 3 : Institutions d’appui à la démocratie et contrôle",
        "PARTIE III : Défis de mise en œuvre et perspectives",
        "CHAPITRE V : Indépendance et efficacité du pouvoir judiciaire",
        "Section 1 : Statut des magistrats et garanties institutionnelles",
        "Section 2 : Obstacles pratiques et pistes de réforme",
        "Section 3 : Accès à la justice et qualité de la décision",
        "CHAPITRE VI : Justice constitutionnelle et effectivité des décisions",
        "Section 1 : Rôle, limites et enjeux de la Cour constitutionnelle",
        "Section 2 : Exécution des décisions et contraintes politiques",
        "Section 3 : Contentieux des droits fondamentaux et réparations",
        "CHAPITRE VII : Gouvernance, protection des droits et réformes",
        "Section 1 : Transparence, lutte contre la corruption et finances publiques",
        "Section 2 : Protection des droits en période de crise",
        "Section 3 : Feuille de route des réformes et perspectives réalistes",
        "CONCLUSION GÉNÉRALE",
        "BIBLIOGRAPHIE (brouillon)",
        "ANNEXES (brouillon)",
      ];

  // If the plan is short or noisy, merge with base to guarantee enough units.
  const merged = [...units];
  for (const t of base) {
    if (!merged.includes(t)) merged.push(t);
  }

  // Final target: enough sections to fill ~70 pages.
  const target = 34;
  return merged.slice(0, target);
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
