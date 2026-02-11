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
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "section";
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
  const attempts = Number(process.env.ACAD_SECTION_RETRIES || 2);
  const minChars = Number(process.env.ACAD_MIN_SECTION_CHARS || 2400);
  const hardMax = Number(process.env.ACAD_HARD_MAX_TOKENS || 6500);

  // FAST guardrails (avoid too many extra calls)
  const longEnoughChars = Number(process.env.ACAD_LONG_ENOUGH_CHARS || 3200);

  const sectionId = slugifyTitle(title);
  const marker = `[[END_SECTION:${sectionId}]]`;

  let last = "";
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
        { role: "system", content: academicSystemPrompt(lang) },
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: mt,
    });

    last = String(content || "").trim();
    if (!last) continue;

    acc = (acc ? acc + "

" : "") + last;

    const cleaned = stripEndMarker(acc, marker);

    const hasMarker = acc.includes(marker);
    const truncated = isLikelyTruncated(cleaned);

    // ✅ if it's already long enough, don't pay an extra model call—finish locally
    if ((cleaned.length >= longEnoughChars) && (!hasMarker || truncated)) {
      return ensureNiceEnding(trimToLastPunct(cleaned));
    }

    // ✅ OK: complete enough + has marker + meets minimum size
    if (hasMarker && !truncated && cleaned.length >= minChars) {
      return ensureNiceEnding(cleaned);
    }

    // If too short, we let the loop retry with slightly larger tokens (above).
    // If likely truncated and not long enough yet, we do a continuation call inside the next attempt
    // by switching the context (tail-based).
    const tail = cleaned.slice(-900);
    const continuePrompt = buildContinuePrompt({ lang, title, marker, tail });

    const cont = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang) },
        { role: "user", content: continuePrompt },
      ],
      temperature,
      max_tokens: Math.min(Math.floor(mt * 0.6), hardMax),
    });

    const contTxt = String(cont || "").trim();
    if (contTxt) {
      acc = acc + "

" + contTxt;
    }

    const cleaned2 = stripEndMarker(acc, marker);
    const hasMarker2 = acc.includes(marker);
    const truncated2 = isLikelyTruncated(cleaned2);

    if ((cleaned2.length >= longEnoughChars) && (!hasMarker2 || truncated2)) {
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

  const finalText = stripEndMarker(acc || last, marker);
  return (
    ensureNiceEnding(trimToLastPunct(finalText)) ||
    `**${title}**

(Contenu non généré : réponse vide du modèle. Veuillez relancer la génération.)
`
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


export async function reviseLicenceMemoireFromDraft({ lang = "fr", title = "Mémoire (version corrigée)", ctx = {}, draftText = "" }) {
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

  // Plan: on garde un plan simple, puis sections = blocs corrigés/enrichis
  const planPrompt = buildMemoirePlanPrompt({ lang, ctx, topic: ctx?.topic || title });
  const plan = await deepseekChat({
    messages: [
      { role: "system", content: academicSystemPrompt(lang) },
      { role: "user", content: planPrompt },
    ],
    temperature,
    max_tokens: Number(process.env.ACAD_PLAN_MAX_TOKENS || 1600),
  });

  const sections = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sectionTitle = chunks.length <= 1 ? "Texte intégral (corrigé et enrichi)" : `Bloc ${i + 1} (corrigé et enrichi)`;

    const prompt = buildMemoireRevisionPrompt({
      lang,
      ctx,
      title,
      sectionTitle,
      draftChunk: chunk,
    });

    const content = await deepseekChat({
      messages: [
        { role: "system", content: academicSystemPrompt(lang) },
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

  // S'assure qu'on a au moins quelques sections (au cas où)
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

  const tokensPerPage = Number(process.env.ACAD_TOKENS_PER_PAGE || 650);
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
