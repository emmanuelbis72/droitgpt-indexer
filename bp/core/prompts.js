// business-plan-service/core/prompts.js

export function systemPrompt(lang = "fr") {
  if (lang === "en") {
    return `
You are a senior investment analyst and business plan writer.
Write investor-grade, professional content.
No fluff. No fake statistics. If you need numbers, use ranges or explain assumptions.
Use clear headings and structured paragraphs.
When asked for JSON, return STRICT JSON ONLY (no markdown, no backticks).
`;
  }
  return `
Tu es un analyste investissement senior et rédacteur expert de plans d’affaires.
Style: professionnel, investisseur, structuré, sans marketing excessif.
Interdits: inventer des statistiques "précises". Si nécessaire: fourchettes + hypothèses.
Format: titres clairs, paragraphes structurés.
Quand on te demande du JSON, retourne UNIQUEMENT du JSON strict (sans markdown, sans backticks).
`;
}

/**
 * Ordre Premium (avec Canvas/SWOT/KPI tables en JSON).
 */
export const SECTION_ORDER = [
  "executive_summary",
  "market_analysis",
  "business_model",
  "canvas_json",
  "swot_json",
  "go_to_market",
  "kpi_calendar_json",
  "operations",
  "risks",
  "financials_json",
  "funding_ask",
];

export function sectionPrompt({ lang, sectionKey, ctx }) {
  const baseCtx = `
[CONTEXTE]
Pays/Marché: ${ctx.country}
Villes: ${ctx.city}
Secteur: ${ctx.sector}
Type de document: ${ctx.docType}
Audience cible: ${ctx.audience}
Stade: ${ctx.stage}
Nom: ${ctx.companyName}

Produit/Service:
${ctx.product}

Clients:
${ctx.customers}

Modèle économique:
${ctx.businessModel}

Traction:
${ctx.traction}

Concurrence:
${ctx.competition}

Risques:
${ctx.risks}

Hypothèses financières:
${ctx.finAssumptions}

Besoin de financement:
${ctx.fundingAsk}

Exigences:
- Document premium investisseur/banque/incubateur.
- Pas de stats inventées.
- Si JSON demandé: JSON STRICT uniquement.
`.trim();

  const baseCtxEN = `
[CONTEXT]
Country/Market: ${ctx.country}
Cities: ${ctx.city}
Sector: ${ctx.sector}
Document type: ${ctx.docType}
Target audience: ${ctx.audience}
Stage: ${ctx.stage}
Company name: ${ctx.companyName}

Product/Service:
${ctx.product}

Customers:
${ctx.customers}

Business model:
${ctx.businessModel}

Traction:
${ctx.traction}

Competition:
${ctx.competition}

Risks:
${ctx.risks}

Financial assumptions:
${ctx.finAssumptions}

Funding ask:
${ctx.fundingAsk}

Requirements:
- Premium investor/bank/incubator grade.
- No fake stats.
- If JSON requested: STRICT JSON ONLY.
`.trim();

  const ctxBlock = lang === "en" ? baseCtxEN : baseCtx;

  const prompts = {
    executive_summary:
      lang === "en"
        ? `${ctxBlock}
Write the Executive Summary (900–1200 words).
Include: problem, solution, market logic (no fake stats), business model, traction, edge, risks, funding ask, milestones.
Tone: investor-grade, concise.`
        : `${ctxBlock}
Rédige l’Executive Summary (900–1200 mots).
Inclure: problème, solution, logique de marché (sans stats inventées), modèle, traction, avantage, risques, financement, jalons.
Ton: investisseur, concis.`,

    market_analysis:
      lang === "en"
        ? `${ctxBlock}
Write Market Analysis:
- segmentation
- sizing logic (ranges + assumptions)
- trends & local realities
- competitive landscape
Length: 900–1400 words.`
        : `${ctxBlock}
Rédige l’Analyse du marché:
- segmentation
- dimensionnement (fourchettes + hypothèses)
- tendances & réalités locales
- concurrence
Longueur: 900–1400 mots.`,

    business_model:
      lang === "en"
        ? `${ctxBlock}
Write the Business Model section:
- revenue streams
- pricing logic
- unit economics assumptions
- distribution
- partnerships
Length: 800–1200 words.`
        : `${ctxBlock}
Rédige le Modèle économique:
- revenus
- logique de prix
- unit economics (haut niveau)
- distribution
- partenariats
Longueur: 800–1200 mots.`,

    canvas_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY (no markdown).
Business Model Canvas in 9 blocks. Each value is an array of bullet strings.
Write specific bullets based on context.

{
  "key_partners": [],
  "key_activities": [],
  "key_resources": [],
  "value_propositions": [],
  "customer_relationships": [],
  "channels": [],
  "customer_segments": [],
  "cost_structure": [],
  "revenue_streams": []
}`
        : `${ctxBlock}
Retourne UNIQUEMENT du JSON STRICT (sans markdown).
Business Model Canvas en 9 blocs. Chaque valeur est un tableau de puces (strings).
Rédige des puces spécifiques au contexte.

{
  "partenaires_cles": [],
  "activites_cles": [],
  "ressources_cles": [],
  "propositions_de_valeur": [],
  "relations_clients": [],
  "canaux": [],
  "segments_clients": [],
  "structure_de_couts": [],
  "sources_de_revenus": []
}`,

    swot_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY (no markdown).
SWOT with arrays of bullets + a strategic interpretation paragraph.

{
  "strengths": [],
  "weaknesses": [],
  "opportunities": [],
  "threats": [],
  "interpretation": ""
}`
        : `${ctxBlock}
Retourne UNIQUEMENT du JSON STRICT (sans markdown).
SWOT en listes de puces + interprétation stratégique (paragraphe).

{
  "forces": [],
  "faiblesses": [],
  "opportunites": [],
  "menaces": [],
  "interpretation": ""
}`,

    go_to_market:
      lang === "en"
        ? `${ctxBlock}
Write Go-To-Market Strategy:
- channels
- sales strategy
- acquisition plan
- partnerships
- timeline (next 12–18 months)
- KPIs (list)
Length: 900–1400 words.`
        : `${ctxBlock}
Rédige la Stratégie Go-To-Market:
- canaux
- stratégie commerciale
- acquisition
- partenariats
- calendrier (12–18 mois)
- KPIs (liste)
Longueur: 900–1400 mots.`,

    kpi_calendar_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY.
Build a modern execution calendar (quarters) + KPI table.

{
  "calendar": [
    {"period":"Q1","milestones":["..."],"deliverables":["..."],"owner":"..."},
    {"period":"Q2","milestones":["..."],"deliverables":["..."],"owner":"..."},
    {"period":"Q3","milestones":["..."],"deliverables":["..."],"owner":"..."},
    {"period":"Q4","milestones":["..."],"deliverables":["..."],"owner":"..."}
  ],
  "kpis":[
    {"kpi":"...","definition":"...","target_12m":"...","frequency":"...","owner":"..."}
  ]
}`
        : `${ctxBlock}
Retourne UNIQUEMENT du JSON STRICT.
Construis un calendrier d’exécution (par trimestres) + un tableau KPIs.

{
  "calendrier": [
    {"periode":"T1","jalons":["..."],"livrables":["..."],"responsable":"..."},
    {"periode":"T2","jalons":["..."],"livrables":["..."],"responsable":"..."},
    {"periode":"T3","jalons":["..."],"livrables":["..."],"responsable":"..."},
    {"periode":"T4","jalons":["..."],"livrables":["..."],"responsable":"..."}
  ],
  "kpis":[
    {"kpi":"...","definition":"...","cible_12m":"...","frequence":"...","responsable":"..."}
  ]
}`,

    operations:
      lang === "en"
        ? `${ctxBlock}
Write Operations Plan:
- supply chain
- processes
- quality
- logistics
- compliance
- scalability
Length: 900–1400 words.`
        : `${ctxBlock}
Rédige le Plan d’opérations:
- chaîne de valeur
- processus
- qualité
- logistique
- conformité
- passage à l’échelle
Longueur: 900–1400 mots.`,

    risks:
      lang === "en"
        ? `${ctxBlock}
Write Risks & Mitigation (800–1200 words). Provide practical actions.`
        : `${ctxBlock}
Rédige Risques & mitigations (800–1200 mots). Mitigations pratiques.`,

    financials_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY (no markdown).
Create 5-year financial model tables with conservative assumptions.
Years MUST be exactly ["Y1","Y2","Y3","Y4","Y5"]. Use keys Y1..Y5 in every row. Do NOT use "Year 1".
If you cannot estimate a value, use 0 and explain in assumptions.

Schema (STRICT):
{
  "currency":"USD",
  "years":["Y1","Y2","Y3","Y4","Y5"],
  "assumptions":[ {"label":"...","value":"..."} ],
  "revenue_drivers":[ {"label":"...","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0} ],
  "pnl":[
    {"label":"Revenue","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"COGS","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"OPEX","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "cashflow":[
    {"label":"Operating Cashflow","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Investing Cashflow (CAPEX)","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Financing Cashflow","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "balance_sheet":[
    {"label":"Cash","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Inventory","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Assets","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Liabilities","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Equity","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "break_even":{"metric":"months","estimate":0,"explanation":""},
  "use_of_funds":[ {"label":"...","amount":0,"notes":""} ],
  "scenarios":[ {"name":"Base","note":""},{"name":"Optimistic","note":""},{"name":"Conservative","note":""} ]
}

Important:
- Provide Revenue and COGS, OPEX at minimum.
- Keep assumptions realistic for the local context.
- Ensure all numeric fields are numbers (no strings).`
        : `${ctxBlock}
Retourne UNIQUEMENT du JSON STRICT (sans markdown).
Crée des tableaux financiers sur 5 ans avec hypothèses prudentes.
Si une valeur est incertaine, mets 0 et explique dans assumptions.

Schéma (STRICT):
{
  "currency":"USD",
  "years":["Y1","Y2","Y3","Y4","Y5"],
  "assumptions":[ {"label":"...","value":"..."} ],
  "revenue_drivers":[ {"label":"...","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0} ],
  "pnl":[
    {"label":"Chiffre d'affaires","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"COGS / Coût des ventes","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"OPEX / Charges opérationnelles","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "cashflow":[
    {"label":"Cashflow opérationnel","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Cashflow d'investissement (CAPEX)","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Cashflow de financement","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "balance_sheet":[
    {"label":"Trésorerie","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Stock","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Actif","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Passif","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Capitaux propres","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "break_even":{"metric":"mois","estimate":0,"explanation":""},
  "use_of_funds":[ {"label":"...","amount":0,"notes":""} ],
  "scenarios":[ {"name":"Base","note":""},{"name":"Optimiste","note":""},{"name":"Prudent","note":""} ]
}

Important:
- Fourni au minimum: Chiffre d'affaires + COGS + OPEX.
- Hypothèses réalistes et cohérentes avec le contexte local.
- Tous les champs numériques doivent être des nombres (pas des strings).`,

    funding_ask:
      lang === "en"
        ? `${ctxBlock}
Write Funding Ask & Use of Funds narrative (800–1200 words):
- amount and instrument options
- allocation by milestones
- timeline + KPIs
- what investor gets (high-level).`
        : `${ctxBlock}
Rédige Besoin de financement & utilisation (800–1200 mots):
- montant + options
- allocation par jalons
- calendrier + KPIs
- logique retour investisseur (haut niveau).`,
  };

  return prompts[sectionKey] || "";
}
