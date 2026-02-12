// business-plan-service/core/prompts.js

export function systemPrompt(lang = "fr") {
  if (lang === "en") {
    return `
You are a senior investment analyst and business plan writer.
Write investor-grade, professional content.
No fluff. No fake statistics. If you need numbers, use ranges or explain assumptions.
Use clear headings and structured paragraphs.
When asked for JSON, return STRICT JSON ONLY (no markdown, no backticks).
`.trim();
  }
  return `
Tu es un analyste investissement senior et rédacteur expert de plans d’affaires.
Style: professionnel, investisseur, structuré, sans marketing excessif.
Interdits: inventer des statistiques "précises". Si nécessaire: fourchettes + hypothèses.
Format: titres clairs, paragraphes structurés.
Quand on te demande du JSON, retourne UNIQUEMENT du JSON strict (sans markdown, sans backticks).
`.trim();
}

/**
 * ✅ STANDARD INTERNATIONAL (VC / Banque)
 */
export const SECTION_ORDER = [
  "executive_summary",
  "market_analysis",
  "competition_analysis",
  "business_model",
  "canvas_json",
  "swot_json",
  "go_to_market",
  "strategic_partnerships",
  "kpi_calendar_json",
  "operations",
  "risks",
  "financials_json",
  "funding_ask",
];

function draftBlock(lang, ctx) {
  const raw = String(ctx?.draftText || "").trim();
  if (!raw) return "";
  const notes = String(ctx?.rewriteNotes || "").trim();
  const clipped = raw.length > 14000 ? raw.slice(0, 14000) + "\n\n[...TRUNCATED...]" : raw;

  if (lang === "en") {
    return `
[DRAFT BUSINESS PLAN (to revise)]
You must use this draft as the primary source of truth.
Your job: rewrite, correct, restructure and upgrade it to investor/bank grade.
- Keep the core facts, fix inconsistencies, remove fluff, improve clarity.
- Do NOT invent precise statistics. Use ranges + assumptions.
${notes ? `\n[REVISION NOTES]\n${notes}\n` : ""}

DRAFT TEXT:
"""${clipped}"""
`.trim();
  }

  return `
[BROUILLON DE PLAN D’AFFAIRES (à corriger)]
Tu dois utiliser ce brouillon comme source principale.
Ta mission : corriger, restructurer et élever le contenu au niveau banque/investisseur.
- Conserver les faits clés, corriger les incohérences, supprimer le superflu, améliorer la clarté.
- Ne pas inventer de statistiques précises. Utilise des fourchettes + hypothèses.
${notes ? `\n[CONSIGNES DE CORRECTION]\n${notes}\n` : ""}

TEXTE DU BROUILLON :
"""${clipped}"""
`.trim();
}

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
- Standard international (banque / investisseur).
- Pas de stats inventées: fourchettes + hypothèses.
- Si JSON demandé: JSON STRICT uniquement.
${draftBlock(lang, ctx)}
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
- International standard (bank / investor).
- No fake stats: ranges + assumptions.
- If JSON requested: STRICT JSON ONLY.
${draftBlock(lang, ctx)}
`.trim();

  const ctxBlock = lang === "en" ? baseCtxEN : baseCtx;

  const prompts = {
    executive_summary:
      lang === "en"
        ? `${ctxBlock}
Write an Executive Summary (450–650 words) using EXACT headings below.
Do NOT add other headings.

### 1) Business snapshot
### 2) Problem
### 3) Solution / Product
### 4) Market opportunity
(segmentation + sizing logic with ranges + assumptions)
### 5) Business model
### 6) Traction & validation
### 7) Go-to-market
### 8) Competition & moat
### 9) Team / capabilities
### 10) Financial highlights & funding ask

End with a short 2–3 line conclusion.`
        : `${ctxBlock}
Rédige un Résumé exécutif (450–650 mots) avec EXACTEMENT les titres ci-dessous.
N’ajoute aucun autre titre.

### 1) Fiche entreprise
### 2) Problème
### 3) Solution / Produit
### 4) Opportunité de marché
(segmentation + dimensionnement en fourchettes + hypothèses)
### 5) Modèle économique
### 6) Traction & validation
### 7) Go-to-market
### 8) Concurrence & avantage
### 9) Équipe / capacités
### 10) Highlights financiers & financement

Termine par une conclusion brève (2–3 lignes).`,

    market_analysis:
      lang === "en"
        ? `${ctxBlock}
Write Market Analysis (600–850 words) with headings:
### Segmentation
### Market sizing (logic)
### Trends & local realities
### Customer pain points & buying criteria
### Competitive landscape (high-level)`
        : `${ctxBlock}
Rédige l’Analyse du marché (600–850 mots) avec titres:
### Segmentation
### Dimensionnement (logique)
### Tendances & réalités locales
### Besoins clients & critères d’achat
### Paysage concurrentiel (haut niveau)`,

    competition_analysis:
      lang === "en"
        ? `${ctxBlock}
Write Competitive Analysis (450–650 words) with headings:
### Direct competitors
### Indirect substitutes
### Differentiation (moat)
### Pricing / positioning
### Competitive response plan`
        : `${ctxBlock}
Rédige l’Analyse concurrentielle (450–650 mots) avec titres:
### Concurrents directs
### Substituts / alternatives
### Différenciation (avantage)
### Prix / positionnement
### Plan de riposte`,

    business_model:
      lang === "en"
        ? `${ctxBlock}
Write Business Model (550–750 words) with headings:
### Revenue streams
### Pricing & packaging
### Unit economics (high-level)
### Distribution & fulfillment
### Key resources & capabilities`
        : `${ctxBlock}
Rédige le Modèle économique (550–750 mots) avec titres:
### Sources de revenus
### Politique de prix & offres
### Unit economics (haut niveau)
### Distribution & exécution
### Ressources & capacités clés`,

    canvas_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY.
Rules:
- 4 to 6 bullets per block max.

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
Retourne UNIQUEMENT du JSON STRICT.
Règles:
- 4 à 6 puces max par bloc.

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
Return STRICT JSON ONLY.
Interpretation max 5 lines.

{
  "strengths": [],
  "weaknesses": [],
  "opportunities": [],
  "threats": [],
  "interpretation": ""
}`
        : `${ctxBlock}
Retourne UNIQUEMENT du JSON STRICT.
Interprétation max 5 lignes.

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
Write Go-To-Market (Marketing & Sales) (600–850 words) with headings:
### Target segments & ICP
### Channels strategy
### Sales motion (B2B/B2C)
### Marketing plan (90 days)
### Partnerships & distribution
### KPIs (list)`
        : `${ctxBlock}
Rédige le Go-to-market (Marketing & Ventes) (600–850 mots) avec titres:
### Segments cibles & ICP
### Stratégie canaux
### Motion commerciale (B2B/B2C)
### Plan marketing (90 jours)
### Partenariats & distribution
### KPIs (liste)`,

    strategic_partnerships:
      lang === "en"
        ? `${ctxBlock}
Write Strategic Partnerships (350–550 words) with headings:
### Priority partners
### Partnership value exchange
### 12-month roadmap`
        : `${ctxBlock}
Rédige Partenariats stratégiques (350–550 mots) avec titres:
### Partenaires prioritaires
### Échange de valeur
### Feuille de route (12 mois)`,

    kpi_calendar_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY.
Rules:
- Exactly 4 periods (Q1..Q4)
- 3–5 milestones max per period
- 8–12 KPIs max

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
Règles:
- 4 périodes (T1..T4)
- 3–5 jalons max
- 8–12 KPIs max

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
Write Operations Plan (550–800 words) with headings:
### Value chain & sourcing
### Production / delivery
### Quality & compliance
### Logistics
### Scalability milestones`
        : `${ctxBlock}
Rédige le Plan d’opérations (550–800 mots) avec titres:
### Chaîne de valeur & approvisionnement
### Processus de production / délivrance
### Qualité & conformité
### Logistique & exécution
### Passage à l’échelle`,

    risks:
      lang === "en"
        ? `${ctxBlock}
Write Risks & Mitigation (450–650 words) with headings:
### Top risks (5–8)
### Mitigation plan
### Monitoring (KPIs / triggers)`
        : `${ctxBlock}
Rédige Risques & mitigations (450–650 mots) avec titres:
### Risques principaux (5–8)
### Plan de mitigation
### Suivi (KPIs / signaux)`,

    financials_json:
      lang === "en"
        ? `${ctxBlock}
Return STRICT JSON ONLY.
Rules:
- Compact tables (max 8 rows per table)
- Years exactly ["Y1","Y2","Y3","Y4","Y5"]
- Numeric values only for Y1..Y5

Schema (STRICT): (same as existing backend expects)
{
  "currency":"USD",
  "years":["Y1","Y2","Y3","Y4","Y5"],
  "assumptions":[ {"label":"...","value":"..."} ],
  "revenue_drivers":[ {"label":"...","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0} ],
  "pnl":[
    {"label":"Revenue","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"COGS","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Gross Profit","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"OPEX","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"EBITDA","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Net Profit","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "cashflow":[
    {"label":"Operating Cashflow","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Investing Cashflow (CAPEX)","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Financing Cashflow","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "balance_sheet":[
    {"label":"Cash","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Assets","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Liabilities","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Equity","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "break_even":{"metric":"months","estimate":0,"explanation":""},
  "use_of_funds":[ {"label":"...","amount":0,"notes":""} ],
  "scenarios":[ {"name":"Base","note":""},{"name":"Optimistic","note":""},{"name":"Conservative","note":""} ]
}`
        : `${ctxBlock}
Retourne UNIQUEMENT du JSON STRICT.
Règles:
- Tableaux compacts (max 8 lignes)
- Années EXACTES ["Y1","Y2","Y3","Y4","Y5"]
- Valeurs numériques uniquement

Schéma (STRICT): (compatible backend)
{
  "currency":"USD",
  "years":["Y1","Y2","Y3","Y4","Y5"],
  "assumptions":[ {"label":"...","value":"..."} ],
  "revenue_drivers":[ {"label":"...","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0} ],
  "pnl":[
    {"label":"Chiffre d'affaires","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"COGS / Coût des ventes","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Marge brute","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"OPEX / Charges opérationnelles","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"EBITDA","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Résultat net","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "cashflow":[
    {"label":"Cashflow opérationnel","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Cashflow d'investissement (CAPEX)","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Cashflow de financement","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "balance_sheet":[
    {"label":"Trésorerie","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Actif","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Total Passif","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0},
    {"label":"Capitaux propres","__format":"money","Y1":0,"Y2":0,"Y3":0,"Y4":0,"Y5":0}
  ],
  "break_even":{"metric":"mois","estimate":0,"explanation":""},
  "use_of_funds":[ {"label":"...","amount":0,"notes":""} ],
  "scenarios":[ {"name":"Base","note":""},{"name":"Optimiste","note":""},{"name":"Prudent","note":""} ]
}`,

    funding_ask:
      lang === "en"
        ? `${ctxBlock}
Write Funding Ask & Use of Funds (450–650 words) with headings:
### Funding request
### Use of funds (milestones)
### 12–18 month plan
### Risk controls`
        : `${ctxBlock}
Rédige Besoin de financement & utilisation (450–650 mots) avec titres:
### Demande de financement
### Utilisation des fonds (jalons)
### Plan 12–18 mois
### Contrôles de risques`,
  };

  return prompts[sectionKey] || "";
}
