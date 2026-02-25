// bp/core/excelPrompts.js

// Ultra-pro Excel app generation: model outputs a STRICT JSON blueprint.
// The blueprint is then compiled into an .xlsx using ExcelJS.

export const EXCEL_BLUEPRINT_SCHEMA = {
  name: "ExcelBlueprint",
  required: ["app", "version", "sheets"],
};

export function excelSystemPrompt({ lang }) {
  const L = (lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  if (L === "en") {
    return `You are an expert Excel solution architect. Produce ONLY valid JSON (no markdown, no comments).
You design professional spreadsheet-based business apps with:
- Data tables (one row per record)
- Form sheets with validations (dropdowns)
- Dashboards (KPIs)
- Robust formulas (SUMIFS, COUNTIFS, XLOOKUP/INDEX-MATCH)

Hard rules:
- Output MUST be a single JSON object following the provided blueprint shape.
- NEVER output VBA. No macros.
- Keep formulas compatible with modern Excel.
- Use "INCOMPLETE" for unknown values; never invent data.
- Keep sheet names short (<= 31 chars).
`; 
  }

  return `Tu es un architecte Excel senior. Tu dois produire UNIQUEMENT du JSON valide (pas de markdown, pas de commentaires).
Tu conçois des progiciels Excel professionnels avec :
- Tables de données (1 ligne = 1 enregistrement)
- Feuilles "Formulaire" avec validations (listes déroulantes)
- Tableau de bord (KPIs)
- Formules robustes (SOMME.SI.ENS/SUMIFS, NB.SI.ENS/COUNTIFS, XLOOKUP/INDEX-EQUIV)

Règles strictes :
- La sortie DOIT être un seul objet JSON conforme à la forme demandée.
- Interdit de sortir du VBA / macros.
- Formules compatibles Excel moderne.
- Mets "INCOMPLET" si une info est inconnue; n'invente jamais.
- Noms d'onglets <= 31 caractères.
`;
}

export function excelBlueprintPrompt({ lang, ctx }) {
  const L = (lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  const appType = String(ctx?.type || "management_tool");
  const appName = String(ctx?.appName || "Progiciel Excel");
  const modules = Array.isArray(ctx?.modules) ? ctx.modules : [];
  const notes = String(ctx?.notes || "");

  const base = {
    app: {
      name: appName,
      type: appType,
      lang: L,
      modules,
    },
    version: "1.0",
    sheets: [
      {
        name: "00_HOME",
        kind: "home",
        description: "Menu + instructions + liens internes",
      },
      {
        name: "03_LISTES",
        kind: "lists",
        description: "Listes pour validations (dropdowns)",
      },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: "KPIs + tableaux",
      },
    ],
  };

  if (L === "en") {
    return `Create a professional Excel app blueprint as JSON.
Context:
- appName: ${appName}
- type: ${appType}
- modules: ${modules.join(", ") || "(none)"}
- notes: ${notes || "(none)"}

Return STRICT JSON following this shape:
{
  "app": {"name": string, "type": string, "lang": "en"|"fr", "modules": string[]},
  "version": "1.0",
  "sheets": [
     {
       "name": "00_HOME"|...,
       "kind": "home"|"form"|"data"|"lists"|"dashboard",
       "description": string,
       "table"?: {
          "name": string,
          "columns": [{"key": string, "label": string, "type": "text"|"number"|"date"|"enum", "required"?: boolean}],
          "idPrefix"?: string
       },
       "form"?: {
          "bindTable": string,
          "fields": [{"key": string, "label": string, "type": "text"|"number"|"date"|"enum", "listRef"?: string, "required"?: boolean}],
          "actions": ["save","clear","find","update","delete"]
       },
       "validations"?: [{"cell": string, "listRef": string}],
       "kpis"?: [{"label": string, "formula": string}]
     }
  ],
  "lists": {"LIST_NAME": ["A","B",...]} 
}

IMPORTANT: keep it realistic; prefer robust, minimal design. No VBA.`;
  }

  return `Crée un blueprint d'un progiciel Excel professionnel sous forme de JSON.
Contexte:
- appName: ${appName}
- type: ${appType}
- modules: ${modules.join(", ") || "(aucun)"}
- notes: ${notes || "(aucun)"}

Retourne UNIQUEMENT du JSON strict avec cette forme:
{
  "app": {"name": string, "type": string, "lang": "en"|"fr", "modules": string[]},
  "version": "1.0",
  "sheets": [
     {
       "name": "00_HOME"|...,
       "kind": "home"|"form"|"data"|"lists"|"dashboard",
       "description": string,
       "table"?: {
          "name": string,
          "columns": [{"key": string, "label": string, "type": "text"|"number"|"date"|"enum", "required"?: boolean}],
          "idPrefix"?: string
       },
       "form"?: {
          "bindTable": string,
          "fields": [{"key": string, "label": string, "type": "text"|"number"|"date"|"enum", "listRef"?: string, "required"?: boolean}],
          "actions": ["save","clear","find","update","delete"]
       },
       "validations"?: [{"cell": string, "listRef": string}],
       "kpis"?: [{"label": string, "formula": string}]
     }
  ],
  "lists": {"NOM_LISTE": ["A","B",...]} 
}

IMPORTANT: reste réaliste; design minimal et robuste. Interdit VBA.`;
}

export function excelDefaultBlueprint({ lang, ctx }) {
  // Deterministic ultra-pro template for "cash_management".
  const L = (lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  const appName = String(ctx?.appName || (L === "en" ? "Cash & Expenses Manager" : "Gestion Caisse & Dépenses"));
  const idPrefix = "TX";
  const lists = {
    CATEGORIES: L === "en"
      ? ["Sales", "Services", "Supplies", "Transport", "Rent", "Utilities", "Salary", "Other"]
      : ["Ventes", "Services", "Fournitures", "Transport", "Loyer", "Charges", "Salaire", "Autres"],
    TYPES: L === "en" ? ["Income", "Expense"] : ["Entrée", "Sortie"],
    PAYMENT_METHOD: L === "en" ? ["Cash", "Mobile Money", "Bank Transfer", "Card"] : ["Cash", "Mobile Money", "Virement", "Carte"],
    MONTHS: ["01","02","03","04","05","06","07","08","09","10","11","12"],
  };

  return {
    app: { name: appName, type: String(ctx?.type || "cash_management"), lang: L, modules: ["transactions", "dashboard"] },
    version: "1.0",
    lists,
    sheets: [
      { name: "00_HOME", kind: "home", description: L === "en" ? "Menu and quick instructions" : "Menu et instructions" },
      {
        name: "01_FORM_TX",
        kind: "form",
        description: L === "en" ? "Transaction form" : "Formulaire transaction",
        form: {
          bindTable: "DATA_TX",
          fields: [
            { key: "date", label: L === "en" ? "Date" : "Date", type: "date", required: true },
            { key: "type", label: L === "en" ? "Type" : "Type", type: "enum", listRef: "TYPES", required: true },
            { key: "category", label: L === "en" ? "Category" : "Catégorie", type: "enum", listRef: "CATEGORIES", required: true },
            { key: "description", label: L === "en" ? "Description" : "Description", type: "text", required: true },
            { key: "amount", label: L === "en" ? "Amount" : "Montant", type: "number", required: true },
            { key: "method", label: L === "en" ? "Payment method" : "Mode de paiement", type: "enum", listRef: "PAYMENT_METHOD" },
            { key: "reference", label: L === "en" ? "Reference" : "Référence", type: "text" },
          ],
          actions: ["save", "clear"],
        },
        validations: [
          { cell: "B6", listRef: "TYPES" },
          { cell: "B7", listRef: "CATEGORIES" },
          { cell: "B10", listRef: "PAYMENT_METHOD" },
        ],
      },
      {
        name: "02_DATA_TX",
        kind: "data",
        description: L === "en" ? "Transactions table" : "Table des transactions",
        table: {
          name: "DATA_TX",
          idPrefix,
          columns: [
            { key: "id", label: "ID", type: "text", required: true },
            { key: "date", label: L === "en" ? "Date" : "Date", type: "date", required: true },
            { key: "type", label: L === "en" ? "Type" : "Type", type: "enum", required: true },
            { key: "category", label: L === "en" ? "Category" : "Catégorie", type: "enum", required: true },
            { key: "description", label: L === "en" ? "Description" : "Description", type: "text", required: true },
            { key: "amount", label: L === "en" ? "Amount" : "Montant", type: "number", required: true },
            { key: "method", label: L === "en" ? "Method" : "Mode", type: "enum" },
            { key: "reference", label: L === "en" ? "Reference" : "Référence", type: "text" },
            { key: "month", label: L === "en" ? "Month" : "Mois", type: "text" },
          ],
        },
      },
      { name: "03_LISTES", kind: "lists", description: L === "en" ? "Lists for dropdowns" : "Listes pour validations" },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: L === "en" ? "KPIs and monthly summary" : "KPIs et synthèse mensuelle",
        kpis: [
          { label: L === "en" ? "Total income" : "Total entrées", formula: "=SUMIFS(DATA_TX[Montant],DATA_TX[Type],\"Entrée\")" },
          { label: L === "en" ? "Total expenses" : "Total sorties", formula: "=SUMIFS(DATA_TX[Montant],DATA_TX[Type],\"Sortie\")" },
          { label: L === "en" ? "Net" : "Solde", formula: "=B3-B4" },
        ],
      },
    ],
  };
}
