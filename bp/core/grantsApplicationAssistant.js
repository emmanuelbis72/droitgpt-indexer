// bp/core/grantsApplicationAssistant.js
import { deepseekChat } from "./deepseekClient.js";

export async function generateGrantApplicationAnswers({ lang = "fr", companyProfile, opportunity, questions }) {
  const safeQuestions = normalizeQuestions(questions);
  if (!safeQuestions.length) throw new Error("NO_APPLICATION_QUESTIONS");

  const prompt = buildPrompt({ lang, companyProfile, opportunity, questions: safeQuestions });
  const raw = await deepseekChat({
    messages: [
      { role: "system", content: systemPrompt(lang) },
      { role: "user", content: prompt },
    ],
    temperature: Number(process.env.GRANTS_APPLICATION_TEMPERATURE || 0.22),
    max_tokens: Number(process.env.GRANTS_APPLICATION_MAX_TOKENS || 5200),
  });

  const parsed = safeJsonParse(extractJsonBlock(raw));
  if (!parsed) throw new Error("APPLICATION_ANSWERS_JSON_PARSE_FAILED");
  return {
    answers: Array.isArray(parsed.answers) ? parsed.answers : [],
    missingProfileFields: Array.isArray(parsed.missingProfileFields) ? parsed.missingProfileFields : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    language: parsed.language || lang,
  };
}

export function normalizeQuestions(questions) {
  if (Array.isArray(questions)) {
    return questions
      .map((q, idx) => {
        if (typeof q === "string") return { id: `q${idx + 1}`, question: q, maxWords: null };
        return {
          id: String(q?.id || `q${idx + 1}`),
          question: String(q?.question || q?.label || ""),
          maxWords: q?.maxWords || q?.limit || null,
          guidance: String(q?.guidance || q?.helpText || ""),
        };
      })
      .filter((q) => q.question.trim());
  }

  return String(questions || "")
    .split(/\n+/)
    .map((line, idx) => ({ id: `q${idx + 1}`, question: line.replace(/^[-*\d.)\s]+/, "").trim(), maxWords: null }))
    .filter((q) => q.question);
}

function systemPrompt(lang) {
  if (lang === "en") {
    return `
You are a senior grant application writer.
Fill application questions using only the company profile and opportunity context.
Do not invent registrations, numbers, partners, awards, or past results.
If evidence is missing, write a careful draft and flag the missing information.
Return STRICT JSON only.
`.trim();
  }
  return `
Tu es un redacteur senior de candidatures a subventions.
Remplis les questions avec le profil entreprise/organisation et le contexte de l'appel.
N'invente pas de numero legal, partenaires, resultats, prix ou references.
Si une preuve manque, propose une reponse prudente et signale l'information manquante.
Retourne uniquement du JSON strict.
`.trim();
}

function buildPrompt({ lang, companyProfile, opportunity, questions }) {
  const schema = `
{
  "language": "${lang}",
  "answers": [
    {
      "id": "",
      "question": "",
      "answer": "",
      "confidence": "low|medium|high",
      "profileEvidenceUsed": [""],
      "needsUserReview": true
    }
  ],
  "missingProfileFields": [""],
  "warnings": [""]
}
`.trim();

  return `
LANGUE DE REPONSE: ${lang}

[PROFIL ENTREPRISE / ORGANISATION]
${JSON.stringify(companyProfile || {}, null, 2)}

[APPEL / OPPORTUNITE]
${JSON.stringify({
  title: opportunity?.title,
  donor: opportunity?.donor,
  source: opportunity?.source,
  deadline: opportunity?.closeDate || opportunity?.enrichment?.deadline,
  eligibility: opportunity?.eligibility || opportunity?.enrichment?.eligibility,
  description: opportunity?.description || opportunity?.enrichment?.summaryText,
  budget: opportunity?.enrichment?.budget,
  url: opportunity?.url,
}, null, 2)}

[QUESTIONS A REMPLIR]
${JSON.stringify(questions, null, 2)}

REGLES:
- Reponds question par question.
- Ton: professionnel, concret, compatible bailleurs.
- Utilise le profil fourni; ne fabrique pas de faits.
- Si une question demande une donnee absente, redige une phrase avec placeholder clair entre crochets, puis ajoute le champ manquant dans missingProfileFields.
- Respecte maxWords si fourni.
- Retourne uniquement ce JSON:
${schema}
`.trim();
}

function extractJsonBlock(raw) {
  const s = String(raw || "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || "").trim());
  } catch {
    return null;
  }
}
