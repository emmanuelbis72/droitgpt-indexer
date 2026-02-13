// academicOrchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import {
  academicSystemPrompt,
  buildMemoirePlanPrompt,
  buildMemoireSectionPrompt,
  buildSectionPrompt,
  buildMemoireRevisionPrompt,
} from "./academicPrompts.js";
import { searchCongoLawSources, formatPassagesForPrompt } from "./qdrantRag.js";

function slugifyTitle(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section"
  );
}

function stripEndMarker(text, marker) {
  return String(text || "").replace(marker, "").trim();
}

function ensureNiceEnding(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  if (/[.!?…»)\]]\s*$/.test(s)) return s;
  return s + ".";
}

function trimToLastPunct(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  const m = s.match(/[\s\S]*[.!?…»)\]]/);
  return m ? m[0].trim() : s;
}

function isLikelyTruncated(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  const endsOk = /[.!?…»)\]]\s*$/.test(s);
  const endsBad = /[:\-–—]\s*$/.test(s);
  return !endsOk || endsBad;
}

function buildContinuePrompt({ lang, title, marker, tail }) {
  const isEN = lang === "en";
  return `
${isEN ? "You started the dissertation section below but it is incomplete." : "Tu as commencé la section de mémoire ci-dessous mais elle est incomplète."}

${isEN ? "Section title:" : "Titre de section :"} ${title}

${isEN ? "Continue EXACTLY from where it stopped. Do NOT repeat." : "Continue EXACTEMENT là où ça s'est arrêté. Ne répète pas."}

${isEN ? "Last words:" : "Derniers mots :"}
"""${tail}"""

RULES:
- ${isEN ? "Do not repeat." : "Ne répète pas."}
- ${isEN ? "Finish the section with a mini-conclusion." : "Termine la section avec une mini-conclusion."}
- ${isEN ? "End with the exact marker:" : "Termine par le marqueur EXACT :"} ${marker}
- ${isEN ? "Write NOTHING after the marker." : "N'écris RIEN après le marqueur."}
`.trim();
}

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
  const attempts = Number(process.env.ACAD_SECTION_RETRIES || 1); // faster
  const minChars = Number(process.env.ACAD_MIN_SECTION_CHARS || 1600);
  const hardMax = Number(process.env.ACAD_HARD_MAX_TOKENS || 6500);

  // FAST guardrails (avoid too many extra calls)
  const longEnoughChars = Number(process.env.ACAD_LONG_ENOUGH_CHARS || 2200);

  const sectionId = slugifyTitle(title);
  const marker = `[[END_SECTION:${sectionId}]]`;

  let acc = "";

  for (let i = 0; i <= attempts; i++) {
    const boost = i === 0 ? 1 : 1.2;
    const mt = Math.min(Math.floor(maxTokensPerSection * boost), hardMax);

    const promptFn =
      typeof buildMemoireSectionPrompt === "function"
        ? buildMemoireSectionPrompt
        : buildSectionPrompt;

    const prompt = promptFn({
      lang,
      ctx,
      sectionTitle: title,
      sourcesText: passagesText,
      endMarker: marker,
    });

    const content = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang, ctx) },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: mt,
    });

    const last = String(content || "").trim();
    if (!last) continue;

    // ✅ FIX: safe concatenation (no raw newlines inside quotes)
    acc = (acc ? acc + "\n\n" : "") + last;

    const cleaned = stripEndMarker(acc, marker);
    const hasMarker = acc.includes(marker);
    const truncated = isLikelyTruncated(cleaned);

    // ✅ If already long enough, finish locally (avoid extra model call)
    if (cleaned.length >= longEnoughChars && (!hasMarker || truncated)) {
      return ensureNiceEnding(trimToLastPunct(cleaned));
    }

    // ✅ Complete enough
    if (hasMarker && !truncated && cleaned.length >= minChars) {
      return ensureNiceEnding(cleaned);
    }

    // Otherwise: do ONE continuation attempt in this loop iteration
    const tail = cleaned.slice(-900);
    const continuePrompt = buildContinuePrompt({ lang, title, marker, tail });

    const cont = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang, ctx) },
        { role: "user", content: continuePrompt },
      ],
      temperature,
      max_tokens: Math.min(Math.floor(mt * 0.6), hardMax),
    });

    const contTxt = String(cont || "").trim();
    if (contTxt) {
      // ✅ FIX: safe concatenation
      acc = acc + "\n\n" + contTxt;
    }

    const cleaned2 = stripEndMarker(acc, marker);
    const hasMarker2 = acc.includes(marker);
    const truncated2 = isLikelyTruncated(cleaned2);

    if (cleaned2.length >= longEnoughChars && (!hasMarker2 || truncated2)) {
      return ensureNiceEnding(trimToLastPunct(cleaned2));
    }
    if (hasMarker2 && !truncated2 && cleaned2.length >= minChars) {
      return ensureNiceEnding(cleaned2);
    }

    console.warn("[Memoire] Section incomplete, retrying", {
      title,
      attempt: i + 1,
      chars: cleaned2.length,
      max_tokens: mt,
    });
  }

  const finalText = stripEndMarker(acc, marker);
  return (
    ensureNiceEnding(trimToLastPunct(finalText)) ||
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
          "CHAPTER I: Literature Review and Theoretical Framework",
          "Section 1: Key concepts and definitions",
          "Section 2: Theoretical approaches and research model",
          "CHAPTER II: Research Methodology",
          "Section 1: Design, population, sampling",
          "Section 2: Data collection and analysis plan",
          "CHAPTER III: Results / Findings",
          "Section 1: Descriptive results",
          "Section 2: Thematic/analytical results",
          "CHAPTER IV: Discussion and Recommendations",
          "Section 1: Interpretation and comparison with literature",
          "Section 2: Practical implications and recommendations",
          "GENERAL CONCLUSION",
          "BIBLIOGRAPHY (draft)",
          "ANNEXES (draft)",
        ]
      : [
          "INTRODUCTION GÉNÉRALE",
          "CHAPITRE I : Revue de littérature et cadre théorique",
          "Section 1 : Concepts clés et définitions",
          "Section 2 : Approches théoriques et modèle d’analyse",
          "CHAPITRE II : Méthodologie de recherche",
          "Section 1 : Design, population, échantillonnage",
          "Section 2 : Collecte des données et plan d’analyse",
          "CHAPITRE III : Résultats / constats",
          "Section 1 : Résultats descriptifs",
          "Section 2 : Résultats analytiques / thématiques",
          "CHAPITRE IV : Discussion et recommandations",
          "Section 1 : Interprétation et confrontation à la littérature",
          "Section 2 : Implications et recommandations",
          "CONCLUSION GÉNÉRALE",
          "BIBLIOGRAPHIE (brouillon)",
          "ANNEXES (brouillon)",
        ];
  }

  return units.slice(0, 24);
}

export async function reviseLicenceMemoireFromDraft({
  lang = "fr",
  title = "Mémoire (version corrigée)",
  ctx = {},
  draftText = "",
}) {
  const temperature = Number(process.env.ACAD_TEMPERATURE || 0.35);
  const maxTokensPerSection = Number(process.env.ACAD_MAX_TOKENS_PER_SECTION || 5200);
  const hardMax = Number(process.env.ACAD_HARD_MAX_TOKENS || 6500);

  const clean = String(draftText || "").replace(/\r/g, "").trim();
  if (!clean) {
    throw new Error("Draft text is empty (no extractable content).");
  }

  // Découpe en blocs raisonnables (évite dépassement tokens)
  const maxChunkChars = 8000;
  const chunks = [];
  let cur = "";
  for (const line of clean.split(/\n/)) {
    if ((cur + "\n" + line).length > maxChunkChars) {
      chunks.push(cur.trim());
      cur = line;
    } else {
      cur += (cur ? "\n" : "") + line;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());

  const planPrompt = buildMemoirePlanPrompt({ lang, ctx, topic: ctx?.topic || title });
  const plan = await deepseekChat({
    messages: [
      { role: "system", content: academicSystemPrompt(lang, ctx) },
      { role: "user", content: planPrompt },
    ],
    temperature,
    max_tokens: Number(process.env.ACAD_PLAN_MAX_TOKENS || 1600),
  });

  const sections = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sectionTitle =
      chunks.length <= 1
        ? "Texte intégral (corrigé et enrichi)"
        : `Bloc ${i + 1} (corrigé et enrichi)`;

    const prompt = buildMemoireRevisionPrompt({
      lang,
      ctx,
      title,
      sectionTitle,
      draftChunk: chunk,
    });

    const content = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang, ctx) },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: Math.min(maxTokensPerSection, hardMax),
    });

    sections.push({
      title: `**${sectionTitle}**`,
      content: ensureNiceEnding(trimToLastPunct(String(content || "").trim())),
    });
  }

  return {
    title,
    ctx,
    plan: String(plan || "").trim(),
    sections,
  };
}

export async function generateLicenceMemoire({ lang, ctx }) {
  const temperature = Number(process.env.ACAD_TEMPERATURE || 0.35);
  const safeCtx = { ...(ctx || {}) };

  // ✅ Pages target (fast): default 40 pages (concise, no filler); allow override via ctx/env
  const targetFromCtx = Number(safeCtx.lengthPagesTarget || 0);
  const targetFromEnv = Number(process.env.ACAD_PAGES_TARGET || 40);
  // clamp: 30..60 (fast + stable)
  const pagesTarget = Math.max(30, Math.min(60, targetFromCtx || targetFromEnv || 40));
  safeCtx.lengthPagesTarget = pagesTarget;

  const isCongoLawMode = ["droit_congolais", "qdrantLaw", "congo_law", "droitcongolais"].includes(
    String(safeCtx.mode || "").trim()
  );

  let plan = String(safeCtx.plan || "").trim();
  if (!plan) {
    plan = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang, safeCtx) },
        { role: "user", content: buildMemoirePlanPrompt({ lang, ctx: safeCtx }) },
      ],
      temperature,
      max_tokens: Number(process.env.ACAD_PLAN_MAX_TOKENS || 1400),
    });
  }

  const sectionTitles = extractWritingUnits(plan, lang);

  // Used by prompts to keep sections realistically sized while reaching target pages.
  // Fast profile: ~260–290 words/page in typical university formatting.
  const wordsTargetTotal = Math.max(9000, Math.round(pagesTarget * 270));
  safeCtx.__sectionWordsTarget = Math.max(450, Math.round(wordsTargetTotal / Math.max(sectionTitles.length, 1)));

  const tokensPerPage = Number(process.env.ACAD_TOKENS_PER_PAGE || 520); // faster default
  const totalBudget = pagesTarget * tokensPerPage;
  const perSectionBudget = Math.floor(totalBudget / Math.max(sectionTitles.length, 1));
  const hardMaxTokensPerSection = Number(process.env.ACAD_MAX_TOKENS_PER_SECTION || 4200);
  const maxTokensPerSection = Math.max(1200, Math.min(hardMaxTokensPerSection, perSectionBudget));

  const sections = [];
  const sourcesUsed = [];

  for (const title of sectionTitles) {
    let passagesText = "";
    if (isCongoLawMode) {
      const { sources, passages } = await searchCongoLawSources({
        query: `${safeCtx.topic || ""}\n${title}`,
        limit: 6,
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
  // Rough char heuristic: ~2000 chars per page (varies widely). Use dynamic minimum.
  const minTotalChars = Number(process.env.ACAD_MIN_TOTAL_CHARS || Math.round(pagesTarget * 1600));
  if (totalChars < minTotalChars) {
    // ✅ Annexes must match the discipline. Law-specific annexes only in Congo law mode.
    const extras = isCongoLawMode
      ? [
          "ANNEXE A : Tableau des textes légaux cités (brouillon)",
          "ANNEXE B : Jurisprudence et décisions pertinentes (brouillon)",
          "ANNEXE C : Commentaire doctrinal et notes de bas de page (brouillon)",
          "ANNEXE D : Synthèse et recommandations opérationnelles (brouillon)",
        ]
      : [
          "ANNEXE A : Outils de collecte (questionnaire / guide d'entretien) (brouillon)",
          "ANNEXE B : Grille d'analyse et variables / indicateurs (brouillon)",
          "ANNEXE C : Tableau de résultats (exemples) (brouillon)",
          "ANNEXE D : Glossaire, limites et recommandations (brouillon)",
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
