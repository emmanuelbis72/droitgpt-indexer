// academicOrchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import {
  academicSystemPrompt,
  buildMemoirePlanPrompt,
  buildMemoireSectionPrompt,
} from "./academicPrompts.js";
import { searchCongoLawSources, formatPassagesForPrompt } from "./qdrantRag.js";
async function generateSectionWithRetries({ lang, ctx, title, passagesText, temperature, maxTokensPerSection }) {
  const attempts = Number(process.env.ACAD_SECTION_RETRIES || 2);
  const minChars = Number(process.env.ACAD_MIN_SECTION_CHARS || 1200);

  let last = "";
  for (let i = 0; i <= attempts; i++) {
    const boost = i === 0 ? 1 : 1.4; // increase tokens on retry
    const mt = Math.min(Math.floor(maxTokensPerSection * boost), Number(process.env.ACAD_HARD_MAX_TOKENS || 5000));

    const content = await generateSectionWithRetries({
  lang,
  ctx: { ...ctx, plan },
  title,
  passagesText,
  temperature,
  maxTokensPerSection,
});

sections.push({ title, content });
  }

  return { plan, sections, sourcesUsed: dedupeSources(sourcesUsed) };
}

/* ---------------- Helpers ---------------- */

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

/**
 * Extraire des unités de rédaction assez nombreuses:
 * - Intro (générale)
 * - Part I : Chap 1 + Chap 2 (avec sections)
 * - Part II : Chap 3 + Chap 4 (avec sections)
 * - Conclusion générale
 * - Bibliographie (draft)
 * - Annexes (draft)
 */
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
    if (!t) continue;
    const up = t.toUpperCase();

    const match =
      isEN
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

  // Si plan trop court, fallback robuste (16 unités)
  if (units.length < 10) {
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

  // Garder assez d'unités pour viser 70 pages
  return units.slice(0, 18);
}
