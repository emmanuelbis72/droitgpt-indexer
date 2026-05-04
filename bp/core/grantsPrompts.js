// bp/core/grantsPrompts.js

export function grantsSystemPrompt(lang = "fr") {
  if (lang === "en") {
    return `
You are a senior grants management advisor for NGOs, social enterprises, universities, and public programs.
Your job is to make grants easier to manage: eligibility, donor fit, compliance, budget logic, proposal planning, and next actions.
Be practical, structured, and easy to understand.
Do not invent donor rules. If information is missing, mark it as an assumption or a question.
Return STRICT JSON only when requested.
`.trim();
  }

  return `
Tu es un conseiller senior en gestion de subventions pour ONG, entreprises sociales, universites et programmes publics.
Ta mission: rendre la gestion des grants simple a piloter: eligibilite, adequation bailleur, conformite, budget, calendrier de proposition et prochaines actions.
Sois pratique, structure et facile a comprendre.
N'invente pas de regles bailleurs. Si une information manque, indique une hypothese ou une question.
Quand on demande du JSON, retourne uniquement du JSON strict.
`.trim();
}

function baseContextFR(ctx) {
  return `
[CONTEXTE GRANTS]
Nom du projet / organisation: ${ctx.projectName}
Type d'organisation: ${ctx.organizationType}
Pays / zone: ${ctx.country}
Secteur: ${ctx.sector}
Objectif du projet:
${ctx.goal}

Bailleur / opportunite visee:
${ctx.donor}

Montant demande / budget indicatif: ${ctx.requestedAmount}
Date limite: ${ctx.deadline}
Duree du projet: ${ctx.duration}

Texte de l'appel, notes ou criteres connus:
${ctx.callText}

Capacites, experience, partenaires:
${ctx.capacity}

Contraintes ou risques:
${ctx.constraints}

Besoin utilisateur:
${ctx.userNeed}
`.trim();
}

function baseContextEN(ctx) {
  return `
[GRANTS CONTEXT]
Project / organization name: ${ctx.projectName}
Organization type: ${ctx.organizationType}
Country / area: ${ctx.country}
Sector: ${ctx.sector}
Project goal:
${ctx.goal}

Target donor / opportunity:
${ctx.donor}

Requested amount / indicative budget: ${ctx.requestedAmount}
Deadline: ${ctx.deadline}
Project duration: ${ctx.duration}

Call text, notes, or known criteria:
${ctx.callText}

Capacity, experience, partners:
${ctx.capacity}

Constraints or risks:
${ctx.constraints}

User need:
${ctx.userNeed}
`.trim();
}

export function grantsWorkspacePrompt({ lang, ctx }) {
  const isEN = lang === "en";
  const c = isEN ? baseContextEN(ctx) : baseContextFR(ctx);

  const schema = `
{
  "summary": {
    "project": "",
    "donor": "",
    "recommendation": "go|go_with_conditions|needs_more_info|no_go",
    "readiness_score": 0,
    "fit_score": 0,
    "confidence": "low|medium|high",
    "plain_language_reason": ""
  },
  "intake": {
    "known_information": [{"label":"","value":""}],
    "missing_information": [{"question":"","why_it_matters":"","priority":"high|medium|low"}],
    "assumptions": [""]
  },
  "eligibility": {
    "verdict": "eligible|likely_eligible|unclear|likely_not_eligible|not_eligible",
    "checks": [{"criterion":"","status":"pass|risk|fail|unknown","evidence":"","action":""}]
  },
  "donor_fit": {
    "strengths": [""],
    "weaknesses": [""],
    "positioning_angles": [""]
  },
  "compliance": {
    "required_documents": [{"document":"","status":"ready|to_prepare|unknown","owner":"","notes":""}],
    "submission_rules": [{"rule":"","risk_level":"high|medium|low","action":""}]
  },
  "budget_review": {
    "budget_logic": "",
    "eligible_cost_risks": [{"cost_area":"","risk":"","fix":""}],
    "simple_budget_lines": [{"category":"","description":"","amount_or_basis":"","notes":""}]
  },
  "proposal_plan": {
    "outline": [{"section":"","purpose":"","inputs_needed":[""]}],
    "review_checklist": [{"item":"","why":"","status":"todo|in_progress|done"}]
  },
  "timeline": {
    "deadline": "",
    "workplan": [{"day_or_week":"","task":"","owner":"","output":""}]
  },
  "ai_next_actions": [
    {"action":"","user_input_needed":"","output":""}
  ],
  "quick_start": {
    "first_3_steps": [""],
    "one_screen_brief": ""
  }
}
`.trim();

  if (isEN) {
    return `
${c}

Build an AI-assisted grants management workspace. It must feel simple for a non-expert user:
- Start with a clear go/no-go recommendation.
- Convert grant complexity into a short intake, eligibility checks, compliance checklist, budget review, proposal plan, timeline, and next actions.
- Use only information provided. If donor rules are not present, mark checks as unknown.
- Keep wording concise and operational.

Return STRICT JSON only, following this exact shape:
${schema}
`.trim();
  }

  return `
${c}

Construis un espace de gestion de subvention assiste par IA. Il doit rester simple pour un utilisateur non expert:
- Commencer par une recommandation claire go/no-go.
- Transformer la complexite du grant en intake court, controles d'eligibilite, checklist de conformite, revue budget, plan de proposition, calendrier et actions suivantes.
- Utiliser uniquement les informations fournies. Si les regles bailleurs ne sont pas presentes, marquer les controles comme unknown.
- Style concis, operationnel, facile a suivre.

Retourne uniquement du JSON strict selon cette forme exacte:
${schema}
`.trim();
}
