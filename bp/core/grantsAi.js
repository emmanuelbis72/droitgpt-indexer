// bp/core/grantsAi.js
import { deepseekChat } from "./deepseekClient.js";
import { clean, cleanUrl, normalizeArray } from "./grantsVerifier.js";
import { normalizeGrantType } from "./grantsSources.js";

export async function classifyOpportunityWithAI({ rawText, sourceUrl, sourceName }) {
  const safeSourceUrl = cleanUrl(sourceUrl);
  const prompt = `
Tu es un analyste senior de subventions.
Analyse uniquement le contenu fourni. N'invente jamais une deadline, un montant, un organisme ou une eligibilite.
Si une information manque, mets null ou [].
sourceUrl doit etre conserve tel quel.

Retourne uniquement un JSON strict:
{
  "title": null,
  "organization": null,
  "type": "grant|scholarship|call_for_projects|competition|accelerator|fellowship|ngo_funding|other",
  "summary": null,
  "description": null,
  "eligibility": null,
  "countries": [],
  "region": null,
  "sectors": [],
  "amount": null,
  "currency": null,
  "deadline": null,
  "deadlineText": null,
  "applicationUrl": null,
  "sourceUrl": "${safeSourceUrl}",
  "sourceName": ${JSON.stringify(clean(sourceName, 180))},
  "language": "fr|en|unknown",
  "reliabilityScore": 0,
  "verificationNotes": ""
}

CONTENU SOURCE:
${clean(rawText, 12000)}
`.trim();

  try {
    const content = await deepseekChat({
      messages: [
        {
          role: "system",
          content:
            "Return strict JSON only. Never invent facts. Unverified opportunity data must remain incomplete, not confirmed.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.05,
      max_tokens: 1800,
    });
    return normalizeAiOpportunity(JSON.parse(extractJson(content)), { sourceUrl: safeSourceUrl, sourceName });
  } catch (e) {
    return {
      sourceUrl: safeSourceUrl,
      sourceName: clean(sourceName, 180),
      type: "other",
      reliabilityScore: 35,
      verificationNotes: `Classification IA indisponible: ${String(e?.message || e)}`,
    };
  }
}

export function summarizeOpportunityForUser(opportunity = {}) {
  return {
    title: opportunity.title,
    organization: opportunity.organization,
    status: opportunity.status,
    reliabilityScore: opportunity.reliabilityScore,
    deadline: opportunity.deadline,
    summary: opportunity.summary || clean(opportunity.description, 500),
    sourceUrl: opportunity.sourceUrl,
  };
}

export async function matchOpportunityToUserProfile({ opportunity, userProfile }) {
  const sectors = normalizeArray(userProfile?.sectors || userProfile?.sector);
  const country = clean(userProfile?.country || userProfile?.region, 120).toLowerCase();
  let score = 35;
  const reasons = [];

  if (country && opportunity.countries?.some((c) => c.toLowerCase().includes(country) || country.includes(c.toLowerCase()))) {
    score += 25;
    reasons.push("Pays compatible.");
  }
  if (sectors.length && opportunity.sectors?.some((s) => sectors.some((x) => s.toLowerCase().includes(x.toLowerCase())))) {
    score += 25;
    reasons.push("Secteur compatible.");
  }
  if (opportunity.status === "open") score += 15;
  return { score: Math.min(100, score), reasons };
}

export async function generateApplicationAdvice({ opportunity, userContext }) {
  const prompt = `
Tu aides a preparer une candidature. Utilise uniquement ces informations.
Si le profil utilisateur manque, indique les informations a collecter.
Retourne JSON strict:
{
  "fitSummary":"",
  "firstActions":[],
  "documentsToPrepare":[],
  "risks":[],
  "draftPositioning":""
}

OPPORTUNITE:
${JSON.stringify(summarizeOpportunityForUser(opportunity), null, 2)}

CONTEXTE UTILISATEUR:
${JSON.stringify(userContext || {}, null, 2)}
`.trim();

  try {
    const content = await deepseekChat({
      messages: [
        { role: "system", content: "Return strict JSON only. Do not invent donor rules." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1300,
    });
    return JSON.parse(extractJson(content));
  } catch (e) {
    return {
      fitSummary: "Conseil IA indisponible pour le moment.",
      firstActions: ["Verifier la source officielle.", "Comparer l'eligibilite avec le profil.", "Preparer les pieces administratives."],
      documentsToPrepare: [],
      risks: [String(e?.message || e)],
      draftPositioning: "",
    };
  }
}

function normalizeAiOpportunity(obj = {}, fallback = {}) {
  return {
    title: clean(obj.title, 300),
    organization: clean(obj.organization, 220),
    type: normalizeGrantType(obj.type),
    summary: clean(obj.summary, 900),
    description: clean(obj.description, 6000),
    eligibility: clean(obj.eligibility, 2500),
    countries: normalizeArray(obj.countries),
    region: clean(obj.region, 120),
    sectors: normalizeArray(obj.sectors),
    amount: clean(obj.amount, 160),
    currency: clean(obj.currency, 24),
    deadline: clean(obj.deadline, 120),
    deadlineText: clean(obj.deadlineText, 220),
    applicationUrl: cleanUrl(obj.applicationUrl),
    sourceUrl: cleanUrl(obj.sourceUrl) || fallback.sourceUrl,
    sourceName: clean(obj.sourceName || fallback.sourceName, 180),
    language: clean(obj.language || "unknown", 20),
    aiReliabilityScore: clamp(obj.reliabilityScore),
    verificationNotes: clean(obj.verificationNotes, 1200),
  };
}

function extractJson(value) {
  const s = String(value || "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s;
}

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
