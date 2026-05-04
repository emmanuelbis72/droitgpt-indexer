// bp/core/grantsOrchestrator.js
import { deepseekChat } from "./deepseekClient.js";
import { grantsSystemPrompt, grantsWorkspacePrompt } from "./grantsPrompts.js";

export async function generateGrantsManagementWorkspace({ lang, ctx }) {
  const temperature = Number(process.env.GRANTS_TEMPERATURE || 0.2);
  const max_tokens = Number(process.env.GRANTS_MAX_TOKENS || 5200);
  const retries = Number(process.env.GRANTS_JSON_RETRIES || 2);

  let last = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt =
      attempt === 0
        ? grantsWorkspacePrompt({ lang, ctx })
        : `${grantsWorkspacePrompt({ lang, ctx })}

IMPORTANT: Return STRICT JSON only. No markdown, no backticks, no comments.`;

    last = await deepseekChat({
      messages: [
        { role: "system", content: grantsSystemPrompt(lang) },
        { role: "user", content: prompt },
      ],
      temperature: attempt === 0 ? temperature : Math.min(temperature, 0.1),
      max_tokens,
    });

    const parsed = safeJsonParse(extractJsonBlock(last));
    if (parsed) return normalizeWorkspace(parsed);
  }

  const parsed = safeJsonParse(extractJsonBlock(last));
  if (parsed) return normalizeWorkspace(parsed);
  throw new Error("GRANTS_JSON_PARSE_FAILED");
}

export function buildDemoGrantsWorkspace(ctx = {}) {
  const project = ctx.projectName || "Projet de subvention";
  const donor = ctx.donor || "Bailleur a confirmer";
  return {
    summary: {
      project,
      donor,
      recommendation: "needs_more_info",
      readiness_score: 58,
      fit_score: 64,
      confidence: "medium",
      plain_language_reason:
        "Le projet semble finançable, mais il faut confirmer les criteres d'eligibilite, les pieces requises et la logique budgetaire avant soumission.",
    },
    intake: {
      known_information: [
        { label: "Pays / zone", value: ctx.country || "RDC" },
        { label: "Secteur", value: ctx.sector || "Developpement communautaire" },
      ],
      missing_information: [
        {
          question: "Quel est le texte complet de l'appel a propositions ?",
          why_it_matters: "Il determine les criteres d'eligibilite et les pieces obligatoires.",
          priority: "high",
        },
        {
          question: "Quel est le budget detaille par activite ?",
          why_it_matters: "Il permet de verifier les couts eligibles et la coherence du montant demande.",
          priority: "high",
        },
      ],
      assumptions: ["Les criteres bailleur ne sont pas tous fournis."],
    },
    eligibility: {
      verdict: "unclear",
      checks: [
        {
          criterion: "Type d'organisation eligible",
          status: "unknown",
          evidence: "Non precise dans les informations disponibles.",
          action: "Ajouter les criteres d'eligibilite de l'appel.",
        },
        {
          criterion: "Alignement thematique",
          status: "risk",
          evidence: ctx.sector || "Secteur a confirmer.",
          action: "Relier explicitement le projet aux priorites du bailleur.",
        },
      ],
    },
    donor_fit: {
      strengths: ["Objectif projet identifiable", "Zone et secteur parametrables"],
      weaknesses: ["Criteres bailleur incomplets", "Pieces de conformite non confirmees"],
      positioning_angles: ["Mettre en avant l'impact mesurable", "Clarifier les beneficiaires et le changement attendu"],
    },
    compliance: {
      required_documents: [
        { document: "Formulaire de candidature", status: "to_prepare", owner: "Equipe programme", notes: "" },
        { document: "Budget detaille", status: "to_prepare", owner: "Finance", notes: "" },
        { document: "Documents legaux de l'organisation", status: "unknown", owner: "Administration", notes: "" },
      ],
      submission_rules: [
        { rule: "Respecter la date limite", risk_level: "high", action: "Creer un retroplanning." },
        { rule: "Verifier format, langue et annexes", risk_level: "medium", action: "Faire une revue conformite avant depot." },
      ],
    },
    budget_review: {
      budget_logic: "Le budget doit etre relie aux activites et livrables, avec hypotheses simples.",
      eligible_cost_risks: [
        { cost_area: "Frais indirects", risk: "Taux non confirme", fix: "Verifier le plafond autorise par le bailleur." },
      ],
      simple_budget_lines: [
        { category: "Personnel", description: "Coordination et mise en oeuvre", amount_or_basis: "A definir", notes: "" },
        { category: "Activites", description: "Ateliers, terrain, services", amount_or_basis: "A definir", notes: "" },
      ],
    },
    proposal_plan: {
      outline: [
        { section: "Resume", purpose: "Donner la decision rapide au lecteur", inputs_needed: ["Objectif", "budget", "zone"] },
        { section: "Cadre logique", purpose: "Montrer resultats et indicateurs", inputs_needed: ["Outcomes", "outputs", "indicateurs"] },
      ],
      review_checklist: [
        { item: "Verifier eligibilite", why: "Eviter une rejection administrative", status: "todo" },
        { item: "Relire budget vs activites", why: "Eviter incoherence technique-finance", status: "todo" },
      ],
    },
    timeline: {
      deadline: ctx.deadline || "A confirmer",
      workplan: [
        { day_or_week: "J-10", task: "Completer intake et eligibilite", owner: "Lead grants", output: "Decision go/no-go" },
        { day_or_week: "J-7", task: "Rediger version 1", owner: "Programme", output: "Draft complet" },
        { day_or_week: "J-2", task: "Revue conformite", owner: "Operations/finance", output: "Dossier pret" },
      ],
    },
    ai_next_actions: [
      { action: "Analyser l'appel complet", user_input_needed: "Coller le texte de l'appel", output: "Matrice d'eligibilite" },
      { action: "Construire le budget", user_input_needed: "Montant, activites, duree", output: "Budget simple par ligne" },
    ],
    quick_start: {
      first_3_steps: [
        "Coller l'appel a propositions.",
        "Completer les informations organisation/projet.",
        "Lancer la checklist eligibilite puis le retroplanning.",
      ],
      one_screen_brief: "Un tableau de bord simple pour decider, preparer et soumettre une demande de subvention sans perdre les pieces critiques.",
    },
  };
}

function normalizeWorkspace(obj) {
  return obj && typeof obj === "object" ? obj : {};
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
    const txt = String(s || "").trim();
    if (!txt) return null;
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}
