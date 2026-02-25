// bp/core/ngoPrompts.js

export function ngoSystemPrompt(lang = "fr") {
  if (lang === "en") {
    return `
You are a senior international development proposal writer (World Bank / UN / USAID / EU).
Write donor-grade, structured, professional content.
No fluff, no repetition, no fake precise statistics.
If numbers are needed: use ranges and clear assumptions.
When asked for JSON: return STRICT JSON ONLY (no markdown, no backticks).
`.trim();
  }

  return `
Tu es un rédacteur senior de propositions de projets (Banque Mondiale / ONU / USAID / UE).
Style: bailleurs, structuré, professionnel, concret.
Interdits: blabla, répétitions, statistiques précises inventées.
Si chiffres nécessaires: fourchettes + hypothèses claires.
Quand on te demande du JSON: retourne UNIQUEMENT du JSON strict (sans markdown, sans backticks).
`.trim();
}

export const NGO_SECTION_ORDER = [
  "cover_pack", // short (key facts)
  "executive_summary",
  "context_justification",
  "problem_analysis",
  "stakeholder_analysis_json",
  "org_chart_json",
  "theory_of_change",
  "objectives_results",
  "logframe_json",
  "implementation_plan",
  "me_plan_json",
  "sdg_alignment_json",
  "risk_matrix_json",
  "budget_json",
  "workplan_json",
  "sustainability_exit",
  "governance_capacity",
  "annexes_list",
];

// Lite mode (fast) – essential donor deliverables
export const NGO_LITE_ORDER = [
  "executive_summary",
  "logframe_json",
  "budget_json",
  "me_plan_json",
  "risk_matrix_json",
  "sdg_alignment_json",
  "workplan_json",
  "org_chart_json",
];

function baseContextFR(ctx) {
  return `
[CONTEXTE PROJET ONG]
Titre du projet: ${ctx.projectTitle}
Organisation: ${ctx.organization}
Pays: ${ctx.country}
Zone (province/ville): ${ctx.provinceCity}
Secteur: ${ctx.sector}
Style bailleur (optionnel): ${ctx.donorStyle}

Problème / justification (si fourni):
${ctx.problem}

Groupes cibles / bénéficiaires:
${ctx.targetGroups}

Objectif global:
${ctx.overallGoal}

Objectifs spécifiques:
${ctx.specificObjectives}

Durée (mois): ${ctx.durationMonths || ""}
Date de démarrage (optionnel): ${ctx.startDate || ""}
Budget total (optionnel): ${ctx.budgetTotal || ""}

Partenaires (optionnel):
${ctx.partners}

Approche de mise en œuvre (optionnel):
${ctx.implementationApproach}

Durabilité / sortie (optionnel):
${ctx.sustainability}

Safeguarding / protection (optionnel):
${ctx.safeguarding}

Hypothèses (optionnel):
${ctx.assumptions}

Risques (optionnel):
${ctx.risks}

EXIGENCES:
- Standard bailleurs internationaux, contenu dense.
- Pas de répétitions inutiles.
- Pas de statistiques précises inventées.
- Si JSON demandé: JSON STRICT uniquement.
`.trim();
}

function baseContextEN(ctx) {
  return `
[NGO PROJECT CONTEXT]
Project title: ${ctx.projectTitle}
Organization: ${ctx.organization}
Country: ${ctx.country}
Target area (province/city): ${ctx.provinceCity}
Sector: ${ctx.sector}
Donor style (optional): ${ctx.donorStyle}

Problem / rationale (if provided):
${ctx.problem}

Target groups / beneficiaries:
${ctx.targetGroups}

Overall goal:
${ctx.overallGoal}

Specific objectives:
${ctx.specificObjectives}

Duration (months): ${ctx.durationMonths || ""}
Start date (optional): ${ctx.startDate || ""}
Total budget (optional): ${ctx.budgetTotal || ""}

Partners (optional):
${ctx.partners}

Implementation approach (optional):
${ctx.implementationApproach}

Sustainability / exit (optional):
${ctx.sustainability}

Safeguarding (optional):
${ctx.safeguarding}

Assumptions (optional):
${ctx.assumptions}

Risks (optional):
${ctx.risks}

REQUIREMENTS:
- Donor-grade, dense, structured.
- No useless repetition.
- No fake precise statistics.
- If JSON requested: STRICT JSON ONLY.
`.trim();
}

export function ngoSectionPrompt({ lang, sectionKey, ctx }) {
  const ctxBlock = lang === "en" ? baseContextEN(ctx) : baseContextFR(ctx);

  const pFR = {
    cover_pack: `${ctxBlock}
Rédige une “fiche projet” ultra concise (max 250 mots) :
- Contexte (1–2 phrases)
- Objectif global
- 3 objectifs spécifiques
- Zone & bénéficiaires
- Durée & budget (si fournis)
- Résultats majeurs attendus (4–6 bullets)`,
    executive_summary: `${ctxBlock}
Rédige le Résumé exécutif (900–1200 mots) :
- Problème + causes
- Approche / solution
- Résultats (outcomes) + outputs
- Valeur ajoutée / complémentarité
- Logique de mise en œuvre
- Budget & durée (si fournis)
- Risques clés + mitigation (haut niveau)
Ton: bailleurs, clair, sans blabla.`,
    context_justification: `${ctxBlock}
Rédige Contexte & justification (1000–1400 mots) :
- Situation de base (sans stats inventées, utiliser fourchettes/hypothèses)
- Causes racines
- Cadre politique/stratégique (national/sectoriel)
- Pourquoi maintenant
- Définir clairement le gap que le projet comble.`,
    problem_analysis: `${ctxBlock}
Rédige Analyse du problème (900–1300 mots) :
- arbre des problèmes (narratif)
- groupes affectés + vulnérabilités
- contraintes opérationnelles (sécurité/logistique/institutions)
- hypothèses critiques.`,
    stakeholder_analysis_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Analyse des parties prenantes (matrice + cartographie) :

{
  "stakeholders": [
    {
      "name": "",
      "type": "beneficiary|community|authority|partner|private|donor|other",
      "interest": "low|medium|high",
      "influence": "low|medium|high",
      "role": "",
      "engagement_strategy": ""
    }
  ],
  "stakeholder_map": {
    "method": "power_interest_grid",
    "quadrants": {
      "manage_closely": [""],
      "keep_satisfied": [""],
      "keep_informed": [""],
      "monitor": [""]
    }
  }
}

Contraintes:
- 10 à 18 parties prenantes pertinentes, adaptées à la RDC si le pays=RDC.
- Textes courts mais concrets.`,

    org_chart_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Organigramme fonctionnel de l'équipe du projet (rôles, responsabilités, lignes de reporting) :

{
  "org_structure": {
    "governance": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "management": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "technical": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "field": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "support": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ]
  }
}

Règles:
- 10 à 18 rôles max, réalistes pour un projet de 12 mois.
- Chaque rôle: responsabilités concrètes (3–6 bullets) + reporting clair.
- Adapter à la zone/pays (RDC si pays=RDC).`,
    theory_of_change: `${ctxBlock}
Rédige Théorie du changement (900–1300 mots) :
- Chaîne logique: inputs → activités → outputs → outcomes → impact
- Hypothèses et facteurs externes
- Comment le changement sera mesuré (référence aux indicateurs, sans inventer des stats précises).`,
    objectives_results: `${ctxBlock}
Rédige Objectifs & résultats attendus (900–1200 mots) :
- Objectif global
- 3–5 objectifs spécifiques
- Outcomes (3–6) + description
- Outputs (6–12) regroupés par outcome
- Stratégie de ciblage des bénéficiaires.`,
    logframe_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Cadre logique (LogFrame) :

{
  "impact": {
    "statement": "",
    "indicators": [{"name":"","baseline":"","target":"","means_of_verification":""}],
    "assumptions": [""]
  },
  "outcomes": [
    {
      "statement": "",
      "indicators": [{"name":"","baseline":"","target":"","means_of_verification":""}],
      "assumptions": [""],
      "outputs": [
        {
          "statement": "",
          "indicators": [{"name":"","baseline":"","target":"","means_of_verification":""}]
        }
      ]
    }
  ]
}

Règles:
- Indicateurs SMART (sans chiffres “inventés” : utiliser baseline/target en termes qualitatifs ou fourchettes si nécessaire).
- 3–6 outcomes, chacun 2–4 outputs.`,
    implementation_plan: `${ctxBlock}
Rédige Plan de mise en œuvre (1000–1500 mots) :
- approche technique / méthodologie
- composantes (par outcome)
- modalités terrain, partenariats, coordination
- gestion qualité & safeguarding
- plan de communication / redevabilité (AAP) si pertinent.`,
    me_plan_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Plan Suivi-Évaluation (M&E) :

{
  "me_framework": [
    {
      "indicator": "",
      "baseline": "",
      "target": "",
      "frequency": "monthly|quarterly|semiannual|annual|endline",
      "data_source": "",
      "collection_method": "",
      "responsible": "",
      "disaggregation": ""
    }
  ],
  "evaluations": [
    {"type":"baseline","timing":"", "purpose":""},
    {"type":"midterm","timing":"", "purpose":""},
    {"type":"endline","timing":"", "purpose":""}
  ],
  "reporting": [
    {"deliverable":"", "frequency":"", "audience":""}
  ]
}

Règles:
- 12–22 indicateurs (mix output/outcome).
- Très concret et exploitable.`,
    sdg_alignment_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Alignement ODD (SDGs) :

{
  "sdgs": [
    {
      "sdg": "SDG 1|SDG 2|...|SDG 17",
      "targets": [
        {
          "target": "",
          "contribution": "",
          "project_indicators": [""]
        }
      ]
    }
  ]
}

Règles:
- 2 à 5 SDGs maximum, bien justifiés.`,
    risk_matrix_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Matrice des risques :

{
  "risks": [
    {
      "risk": "",
      "category": "security|fiduciary|operational|political|climate|social|other",
      "probability": "low|medium|high",
      "impact": "low|medium|high",
      "mitigation": "",
      "owner": ""
    }
  ]
}

Règles:
- 10 à 16 risques, adaptés RDC si pays=RDC.`,
    budget_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Budget détaillé (ventilation par catégorie ET par activité) :

{
  "currency": "USD",
  "by_category": [
    {
      "category": "Personnel|Travel|Equipment|Supplies|Services|Training|Grants|Other",
      "category_total": "",
      "items": [
        {"line_item":"","unit":"","qty":"","unit_cost":"","total_cost":"","notes":""}
      ]
    }
  ],
  "by_activity": [
    {
      "activity": "",
      "costs": [
        {"category":"","line_item":"","unit":"","qty":"","unit_cost":"","total_cost":"","notes":""}
      ],
      "activity_total": ""
    }
  ],
  "indirect_costs": {
    "rate": "",
    "amount": "",
    "notes": ""
  },
  "totals": {
    "direct_total": "",
    "indirect_total": "",
    "grand_total": ""
  }
}

Règles:
- Garder les coûts sous forme de montants indicatifs (pas besoin de chiffres ultra-précis).
- Les activités doivent correspondre au chronogramme (mêmes intitulés ou très proches).`,
    workplan_json: `${ctxBlock}
Retourne du JSON STRICT uniquement.
Chronogramme détaillé des activités (Workplan + logique Gantt) :

{
  "duration_months": ${ctx.durationMonths || 12},
  "activities": [
    {
      "activity": "",
      "component": "",
      "start_month": 1,
      "end_month": 3,
      "milestones": [""],
      "deliverables": [""]
    }
  ]
}

Règles:
- 12 à 20 activités, couvrant toute la durée.
- Chaque activité doit inclure 1–3 jalons et 1–3 livrables.`,
    sustainability_exit: `${ctxBlock}
Rédige Durabilité & stratégie de sortie (900–1200 mots) :
- appropriation locale, institutionnalisation
- durabilité financière/technique
- renforcement capacités
- stratégie de retrait / handover.`,
    governance_capacity: `${ctxBlock}
Rédige Gouvernance, capacités & gestion fiduciaire (900–1200 mots) :
- structure équipe, rôles
- mécanismes de contrôle interne
- gestion des achats, gestion financière
- conformité, safeguarding, plainte (GRM).`,
    annexes_list: `${ctxBlock}
Rédige la section Annexes (max 350 mots) :
- liste des annexes proposées (chronogramme détaillé + diagramme de Gantt, organigramme fonctionnel, cartographie parties prenantes, budget détaillé par activité, outils de collecte M&E, CV, lettres de soutien, etc.)`,
  };

  const pEN = {
    cover_pack: `${ctxBlock}
Write an ultra concise “project factsheet” (max 250 words):
- context (1–2 sentences)
- overall goal
- 3 specific objectives
- area & beneficiaries
- duration & budget (if provided)
- key expected results (4–6 bullets)`,
    executive_summary: `${ctxBlock}
Write the Executive Summary (900–1200 words):
- problem + root causes
- approach / solution
- outcomes + outputs
- value added / complementarity
- implementation logic
- budget & duration (if provided)
- key risks + mitigation (high level)
Tone: donor-grade, clear, no fluff.`,
    context_justification: `${ctxBlock}
Write Context & Rationale (1000–1400 words):
- baseline situation (no fake stats; use ranges/assumptions)
- root causes
- policy/strategy alignment
- why now
- clear gap analysis.`,
    problem_analysis: `${ctxBlock}
Write Problem Analysis (900–1300 words):
- problem tree narrative
- affected groups + vulnerabilities
- operational constraints
- critical assumptions.`,
    stakeholder_analysis_json: `${ctxBlock}
Return STRICT JSON ONLY.
Stakeholder analysis matrix + stakeholder mapping:

{
  "stakeholders": [
    {
      "name": "",
      "type": "beneficiary|community|authority|partner|private|donor|other",
      "interest": "low|medium|high",
      "influence": "low|medium|high",
      "role": "",
      "engagement_strategy": ""
    }
  ],
  "stakeholder_map": {
    "method": "power_interest_grid",
    "quadrants": {
      "manage_closely": [""],
      "keep_satisfied": [""],
      "keep_informed": [""],
      "monitor": [""]
    }
  }
}`,

    org_chart_json: `${ctxBlock}
Return STRICT JSON ONLY.
Functional project team org chart (roles, responsibilities, reporting lines):

{
  "org_structure": {
    "governance": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "management": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "technical": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "field": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ],
    "support": [
      {"role":"","reports_to":"","key_responsibilities":[""],"profile":""}
    ]
  }
}

Rules:
- 10 to 18 roles max, realistic for a 12-month project.
- Each role: concrete responsibilities (3–6 bullets) + clear reporting line.
- Adapt to country/area (DRC if country=DRC).`,
    theory_of_change: `${ctxBlock}
Write Theory of Change (900–1300 words):
- logical chain: inputs → activities → outputs → outcomes → impact
- assumptions and external factors
- how change will be measured (link to indicators).`,
    objectives_results: `${ctxBlock}
Write Objectives & Expected Results (900–1200 words):
- overall goal
- 3–5 specific objectives
- outcomes (3–6)
- outputs (6–12) grouped by outcome
- beneficiary targeting strategy.`,
    logframe_json: `${ctxBlock}
Return STRICT JSON ONLY.
LogFrame:

{
  "impact": {
    "statement": "",
    "indicators": [{"name":"","baseline":"","target":"","means_of_verification":""}],
    "assumptions": [""]
  },
  "outcomes": [
    {
      "statement": "",
      "indicators": [{"name":"","baseline":"","target":"","means_of_verification":""}],
      "assumptions": [""],
      "outputs": [
        {
          "statement": "",
          "indicators": [{"name":"","baseline":"","target":"","means_of_verification":""}]
        }
      ]
    }
  ]
}`,
    implementation_plan: `${ctxBlock}
Write Implementation Plan (1000–1500 words):
- technical approach/methodology
- components (by outcome)
- field modalities, coordination, partnerships
- quality management & safeguarding
- accountability to affected populations if relevant.`,
    me_plan_json: `${ctxBlock}
Return STRICT JSON ONLY.
M&E plan:

{
  "me_framework": [
    {
      "indicator": "",
      "baseline": "",
      "target": "",
      "frequency": "monthly|quarterly|semiannual|annual|endline",
      "data_source": "",
      "collection_method": "",
      "responsible": "",
      "disaggregation": ""
    }
  ],
  "evaluations": [
    {"type":"baseline","timing":"", "purpose":""},
    {"type":"midterm","timing":"", "purpose":""},
    {"type":"endline","timing":"", "purpose":""}
  ],
  "reporting": [
    {"deliverable":"", "frequency":"", "audience":""}
  ]
}`,
    sdg_alignment_json: `${ctxBlock}
Return STRICT JSON ONLY.
SDG alignment:

{
  "sdgs": [
    {
      "sdg": "SDG 1|SDG 2|...|SDG 17",
      "targets": [
        {
          "target": "",
          "contribution": "",
          "project_indicators": [""]
        }
      ]
    }
  ]
}`,
    risk_matrix_json: `${ctxBlock}
Return STRICT JSON ONLY.
Risk matrix:

{
  "risks": [
    {
      "risk": "",
      "category": "security|fiduciary|operational|political|climate|social|other",
      "probability": "low|medium|high",
      "impact": "low|medium|high",
      "mitigation": "",
      "owner": ""
    }
  ]
}`,
    budget_json: `${ctxBlock}
Return STRICT JSON ONLY.
Detailed budget (breakdown by category AND by activity):

{
  "currency": "USD",
  "by_category": [
    {
      "category": "Personnel|Travel|Equipment|Supplies|Services|Training|Grants|Other",
      "category_total": "",
      "items": [
        {"line_item":"","unit":"","qty":"","unit_cost":"","total_cost":"","notes":""}
      ]
    }
  ],
  "by_activity": [
    {
      "activity": "",
      "costs": [
        {"category":"","line_item":"","unit":"","qty":"","unit_cost":"","total_cost":"","notes":""}
      ],
      "activity_total": ""
    }
  ],
  "indirect_costs": {
    "rate": "",
    "amount": "",
    "notes": ""
  },
  "totals": {
    "direct_total": "",
    "indirect_total": "",
    "grand_total": ""
  }
}`,
    workplan_json: `${ctxBlock}
Return STRICT JSON ONLY.
Detailed workplan schedule (incl. Gantt logic):

{
  "duration_months": ${ctx.durationMonths || 12},
  "activities": [
    {
      "activity": "",
      "component": "",
      "start_month": 1,
      "end_month": 3,
      "milestones": [""],
      "deliverables": [""]
    }
  ]
}`,
    sustainability_exit: `${ctxBlock}
Write Sustainability & Exit Strategy (900–1200 words).`,
    governance_capacity: `${ctxBlock}
Write Governance, Capacity & Fiduciary Management (900–1200 words).`,
    annexes_list: `${ctxBlock}
Write Annexes section (max 350 words): list proposed annexes (detailed schedule + Gantt, functional org chart, stakeholder mapping, activity-based budget, M&E data collection tools, etc.).`,
  };

  const map = lang === "en" ? pEN : pFR;
  return map[sectionKey] || `${ctxBlock}\nRédige une section complète, structurée, standard bailleurs.`;
}
