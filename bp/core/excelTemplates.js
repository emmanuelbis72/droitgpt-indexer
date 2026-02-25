// bp/core/excelTemplates.js
// Deterministic ultra-pro templates (stable, no AI needed).

export function getExcelTemplateBlueprint({ lang = "fr", ctx = {} }) {
  const L = String(lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  const type = String(ctx?.type || "cash_management").toLowerCase();

  switch (type) {
    case "cash_management":
    case "caisse":
    case "gestion_caisse":
      return cashManagementTemplate({ L, ctx });

    case "school_management":
    case "gestion_ecole":
    case "school":
      return schoolManagementTemplate({ L, ctx });

    case "inventory_sales":
    case "stock_ventes":
    case "inventory":
      return inventorySalesTemplate({ L, ctx });

    case "hr_payroll":
    case "salaires":
    case "rh":
      return hrPayrollTemplate({ L, ctx });

    case "ngo_budget_me":
    case "ngo_project":
    case "ong":
      return ngoBudgetMETemplate({ L, ctx });

    default:
      return null;
  }
}

function cashManagementTemplate({ L, ctx }) {
  const isFR = L !== "en";
  const appName = String(ctx?.appName || (isFR ? "Gestion Caisse & Dépenses" : "Cash & Expenses Manager"));
  const lists = {
    CATEGORIES: isFR
      ? ["Ventes", "Services", "Fournitures", "Transport", "Loyer", "Charges", "Salaire", "Autres"]
      : ["Sales", "Services", "Supplies", "Transport", "Rent", "Utilities", "Salary", "Other"],
    TYPES: isFR ? ["Entrée", "Sortie"] : ["Income", "Expense"],
    PAYMENT_METHOD: isFR ? ["Cash", "Mobile Money", "Virement", "Carte"] : ["Cash", "Mobile Money", "Bank Transfer", "Card"],
  };

  const amountCol = isFR ? "Montant" : "Amount";
  const typeCol = "Type";

  return {
    app: { name: appName, type: "cash_management", lang: L, modules: ["transactions", "dashboard"] },
    version: "2.0",
    lists,
    sheets: [
      { name: "00_HOME", kind: "home", description: "Menu" },
      {
        name: "01_FORM_TX",
        kind: "form",
        description: isFR ? "Formulaire transaction" : "Transaction form",
        form: {
          bindTable: "DATA_TX",
          fields: [
            { key: "date", label: "Date", type: "date", required: true },
            { key: "type", label: "Type", type: "enum", listRef: "TYPES", required: true },
            { key: "category", label: isFR ? "Catégorie" : "Category", type: "enum", listRef: "CATEGORIES", required: true },
            { key: "description", label: "Description", type: "text", required: true },
            { key: "amount", label: amountCol, type: "number", required: true },
            { key: "method", label: isFR ? "Mode de paiement" : "Payment method", type: "enum", listRef: "PAYMENT_METHOD" },
            { key: "reference", label: isFR ? "Référence" : "Reference", type: "text" },
          ],
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
        description: isFR ? "Transactions" : "Transactions",
        table: {
          name: "DATA_TX",
          idPrefix: "TX",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "date", label: "Date", type: "date" },
            { key: "type", label: typeCol, type: "text" },
            { key: "category", label: isFR ? "Catégorie" : "Category", type: "text" },
            { key: "description", label: "Description", type: "text" },
            { key: "amount", label: amountCol, type: "number" },
            { key: "method", label: isFR ? "Mode" : "Method", type: "text" },
            { key: "reference", label: isFR ? "Référence" : "Reference", type: "text" },
          ],
        },
      },
      { name: "03_LISTES", kind: "lists", description: "Listes" },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: "KPIs",
        kpis: [
          {
            label: isFR ? "Total entrées" : "Total income",
            formula: isFR
              ? `=SUMIFS(DATA_TX[${amountCol}],DATA_TX[${typeCol}],"Entrée")`
              : `=SUMIFS(DATA_TX[${amountCol}],DATA_TX[${typeCol}],"Income")`,
          },
          {
            label: isFR ? "Total sorties" : "Total expenses",
            formula: isFR
              ? `=SUMIFS(DATA_TX[${amountCol}],DATA_TX[${typeCol}],"Sortie")`
              : `=SUMIFS(DATA_TX[${amountCol}],DATA_TX[${typeCol}],"Expense")`,
          },
          { label: isFR ? "Solde" : "Net", formula: "=B5-B6" },
        ],
      },
    ],
  };
}

function schoolManagementTemplate({ L, ctx }) {
  const isFR = L !== "en";
  const schoolName = String(ctx?.schoolName || (isFR ? "École" : "School"));
  const year = String(ctx?.year || "2025-2026");
  const appName = String(ctx?.appName || (isFR ? `Gestion École – ${schoolName}` : `School Management – ${schoolName}`));

  const lists = {
    CLASSES: Array.isArray(ctx?.classes)
      ? ctx.classes
      : (isFR ? ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"] : ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"]),
    SEXE: ["M", "F"],
    STATUS_PAY: isFR ? ["Payé", "Partiel", "Impayé"] : ["Paid", "Partial", "Unpaid"],
    MOIS: ["01","02","03","04","05","06","07","08","09","10","11","12"],
    PERIODS: isFR ? ["T1", "T2", "T3"] : ["Q1", "Q2", "Q3"],
  };

  return {
    app: { name: appName, type: "school_management", lang: L, modules: ["students", "fees", "grades", "dashboard"] },
    version: "2.0",
    lists,
    sheets: [
      { name: "00_HOME", kind: "home", description: "Menu" },

      {
        name: "01_FORM_ELE",
        kind: "form",
        description: isFR ? "Inscription élève" : "Student registration",
        form: {
          bindTable: "DATA_ELE",
          fields: [
            { key: "date", label: isFR ? "Date inscription" : "Registration date", type: "date", required: true },
            { key: "matricule", label: isFR ? "Matricule" : "Student ID", type: "text", required: true },
            { key: "nom", label: isFR ? "Nom complet" : "Full name", type: "text", required: true },
            { key: "sexe", label: isFR ? "Sexe" : "Sex", type: "enum", listRef: "SEXE", required: true },
            { key: "classe", label: isFR ? "Classe" : "Class", type: "enum", listRef: "CLASSES", required: true },
            { key: "telephone", label: isFR ? "Téléphone parent" : "Parent phone", type: "text" },
            { key: "adresse", label: isFR ? "Adresse" : "Address", type: "text" },
          ],
        },
        validations: [
          { cell: "B8", listRef: "SEXE" },
          { cell: "B9", listRef: "CLASSES" },
        ],
      },
      {
        name: "02_DATA_ELE",
        kind: "data",
        description: isFR ? "Élèves" : "Students",
        table: {
          name: "DATA_ELE",
          idPrefix: "EL",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "date", label: isFR ? "Date inscription" : "Registration date", type: "date" },
            { key: "matricule", label: isFR ? "Matricule" : "Student ID", type: "text" },
            { key: "nom", label: isFR ? "Nom" : "Name", type: "text" },
            { key: "sexe", label: isFR ? "Sexe" : "Sex", type: "text" },
            { key: "classe", label: isFR ? "Classe" : "Class", type: "text" },
            { key: "telephone", label: isFR ? "Téléphone" : "Phone", type: "text" },
            { key: "adresse", label: isFR ? "Adresse" : "Address", type: "text" },
          ],
        },
      },

      {
        name: "05_FORM_FRAIS",
        kind: "form",
        description: isFR ? "Paiement frais" : "Fees payment",
        form: {
          bindTable: "DATA_FRAIS",
          fields: [
            { key: "date", label: "Date", type: "date", required: true },
            { key: "matricule", label: isFR ? "Matricule" : "Student ID", type: "text", required: true },
            { key: "classe", label: isFR ? "Classe" : "Class", type: "enum", listRef: "CLASSES", required: true },
            { key: "mois", label: isFR ? "Mois" : "Month", type: "enum", listRef: "MOIS", required: true },
            { key: "montant", label: isFR ? "Montant" : "Amount", type: "number", required: true },
            { key: "statut", label: isFR ? "Statut" : "Status", type: "enum", listRef: "STATUS_PAY", required: true },
            { key: "reference", label: isFR ? "Référence" : "Reference", type: "text" },
          ],
        },
        validations: [
          { cell: "B7", listRef: "CLASSES" },
          { cell: "B8", listRef: "MOIS" },
          { cell: "B10", listRef: "STATUS_PAY" },
        ],
      },
      {
        name: "06_DATA_FRAIS",
        kind: "data",
        description: isFR ? "Frais" : "Fees",
        table: {
          name: "DATA_FRAIS",
          idPrefix: "FR",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "date", label: "Date", type: "date" },
            { key: "matricule", label: isFR ? "Matricule" : "Student ID", type: "text" },
            { key: "classe", label: isFR ? "Classe" : "Class", type: "text" },
            { key: "mois", label: isFR ? "Mois" : "Month", type: "text" },
            { key: "montant", label: isFR ? "Montant" : "Amount", type: "number" },
            { key: "statut", label: isFR ? "Statut" : "Status", type: "text" },
            { key: "reference", label: isFR ? "Référence" : "Reference", type: "text" },
          ],
        },
      },

      {
        name: "07_FORM_NOTES",
        kind: "form",
        description: isFR ? "Saisie notes" : "Grades entry",
        form: {
          bindTable: "DATA_NOTES",
          fields: [
            { key: "periode", label: isFR ? "Période" : "Period", type: "enum", listRef: "PERIODS", required: true },
            { key: "matricule", label: isFR ? "Matricule" : "Student ID", type: "text", required: true },
            { key: "classe", label: isFR ? "Classe" : "Class", type: "enum", listRef: "CLASSES", required: true },
            { key: "cours", label: isFR ? "Cours" : "Subject", type: "text", required: true },
            { key: "note", label: isFR ? "Note" : "Score", type: "number", required: true },
          ],
        },
        validations: [
          { cell: "B6", listRef: "PERIODS" },
          { cell: "B8", listRef: "CLASSES" },
        ],
      },
      {
        name: "08_DATA_NOTES",
        kind: "data",
        description: isFR ? "Notes" : "Grades",
        table: {
          name: "DATA_NOTES",
          idPrefix: "NT",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "periode", label: isFR ? "Période" : "Period", type: "text" },
            { key: "matricule", label: isFR ? "Matricule" : "Student ID", type: "text" },
            { key: "classe", label: isFR ? "Classe" : "Class", type: "text" },
            { key: "cours", label: isFR ? "Cours" : "Subject", type: "text" },
            { key: "note", label: isFR ? "Note" : "Score", type: "number" },
          ],
        },
      },

      { name: "03_LISTES", kind: "lists", description: "Listes" },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: isFR ? "Tableau de bord" : "Dashboard",
        kpis: [
          { label: isFR ? "Année scolaire" : "School year", formula: `="${year}"` },
          { label: isFR ? "Total élèves" : "Total students", formula: "=COUNTA(DATA_ELE[Matricule])" },
          { label: isFR ? "Total paiements" : "Total payments", formula: "=SUM(DATA_FRAIS[Montant])" },
          { label: isFR ? "Moyenne générale" : "Overall average", formula: "=IFERROR(AVERAGE(DATA_NOTES[Note]),0)" },
        ],
      },
    ],
  };
}

function inventorySalesTemplate({ L, ctx }) {
  const isFR = L !== "en";
  const appName = String(ctx?.appName || (isFR ? "Stock & Ventes" : "Inventory & Sales"));
  const lists = {
    UNITS: isFR ? ["pcs", "kg", "L", "boîte"] : ["pcs", "kg", "L", "box"],
    CATEGORIES: isFR ? ["Aliments", "Cosmétiques", "Boissons", "Autres"] : ["Food", "Cosmetics", "Drinks", "Other"],
    MOVEMENT: isFR ? ["Entrée", "Sortie"] : ["In", "Out"],
  };

  return {
    app: { name: appName, type: "inventory_sales", lang: L, modules: ["products", "movements", "dashboard"] },
    version: "2.0",
    lists,
    sheets: [
      { name: "00_HOME", kind: "home", description: "Menu" },
      {
        name: "01_FORM_PROD",
        kind: "form",
        description: isFR ? "Produit" : "Product",
        form: {
          bindTable: "DATA_PROD",
          fields: [
            { key: "sku", label: "SKU", type: "text", required: true },
            { key: "nom", label: isFR ? "Nom" : "Name", type: "text", required: true },
            { key: "categorie", label: isFR ? "Catégorie" : "Category", type: "enum", listRef: "CATEGORIES", required: true },
            { key: "unite", label: isFR ? "Unité" : "Unit", type: "enum", listRef: "UNITS", required: true },
            { key: "prix_vente", label: isFR ? "Prix vente" : "Sale price", type: "number" },
          ],
        },
        validations: [
          { cell: "B7", listRef: "CATEGORIES" },
          { cell: "B8", listRef: "UNITS" },
        ],
      },
      {
        name: "02_DATA_PROD",
        kind: "data",
        description: isFR ? "Produits" : "Products",
        table: {
          name: "DATA_PROD",
          idPrefix: "PR",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "sku", label: "SKU", type: "text" },
            { key: "nom", label: isFR ? "Nom" : "Name", type: "text" },
            { key: "categorie", label: isFR ? "Catégorie" : "Category", type: "text" },
            { key: "unite", label: isFR ? "Unité" : "Unit", type: "text" },
            { key: "prix_vente", label: isFR ? "Prix vente" : "Sale price", type: "number" },
          ],
        },
      },
      {
        name: "03_FORM_MOV",
        kind: "form",
        description: isFR ? "Mouvement" : "Movement",
        form: {
          bindTable: "DATA_MOV",
          fields: [
            { key: "date", label: "Date", type: "date", required: true },
            { key: "sku", label: "SKU", type: "text", required: true },
            { key: "type", label: "Type", type: "enum", listRef: "MOVEMENT", required: true },
            { key: "quantite", label: isFR ? "Quantité" : "Quantity", type: "number", required: true },
            { key: "prix_unitaire", label: isFR ? "Prix unitaire" : "Unit price", type: "number" },
            { key: "note", label: "Note", type: "text" },
          ],
        },
        validations: [
          { cell: "B7", listRef: "MOVEMENT" },
        ],
      },
      {
        name: "10_DATA_MOV",
        kind: "data",
        description: isFR ? "Mouvements" : "Movements",
        table: {
          name: "DATA_MOV",
          idPrefix: "MV",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "date", label: "Date", type: "date" },
            { key: "sku", label: "SKU", type: "text" },
            { key: "type", label: "Type", type: "text" },
            { key: "quantite", label: isFR ? "Quantité" : "Quantity", type: "number" },
            { key: "prix_unitaire", label: isFR ? "Prix unitaire" : "Unit price", type: "number" },
            { key: "note", label: "Note", type: "text" },
          ],
        },
      },
      { name: "03_LISTES", kind: "lists", description: "Listes" },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: "KPIs",
        kpis: [
          { label: isFR ? "Total entrées (qty)" : "Total in (qty)", formula: isFR ? "=SUMIFS(DATA_MOV[Quantité],DATA_MOV[Type],\"Entrée\")" : "=SUMIFS(DATA_MOV[Quantity],DATA_MOV[Type],\"In\")" },
          { label: isFR ? "Total sorties (qty)" : "Total out (qty)", formula: isFR ? "=SUMIFS(DATA_MOV[Quantité],DATA_MOV[Type],\"Sortie\")" : "=SUMIFS(DATA_MOV[Quantity],DATA_MOV[Type],\"Out\")" },
          { label: isFR ? "Valeur ventes" : "Sales value", formula: isFR ? "=SUMPRODUCT(DATA_MOV[Quantité],DATA_MOV[Prix unitaire])" : "=SUMPRODUCT(DATA_MOV[Quantity],DATA_MOV[Unit price])" },
        ],
      },
    ],
  };
}

function hrPayrollTemplate({ L, ctx }) {
  const isFR = L !== "en";
  const appName = String(ctx?.appName || (isFR ? "RH & Salaires" : "HR & Payroll"));
  const lists = {
    DEPARTEMENTS: isFR ? ["Administration", "Ventes", "Production", "Logistique", "Autres"] : ["Admin", "Sales", "Production", "Logistics", "Other"],
    MOIS: ["01","02","03","04","05","06","07","08","09","10","11","12"],
  };

  return {
    app: { name: appName, type: "hr_payroll", lang: L, modules: ["employees", "payroll", "dashboard"] },
    version: "2.0",
    lists,
    sheets: [
      { name: "00_HOME", kind: "home", description: "Menu" },
      {
        name: "01_FORM_EMP",
        kind: "form",
        description: isFR ? "Employé" : "Employee",
        form: {
          bindTable: "DATA_EMP",
          fields: [
            { key: "matricule", label: isFR ? "Matricule" : "Employee ID", type: "text", required: true },
            { key: "nom", label: isFR ? "Nom" : "Name", type: "text", required: true },
            { key: "departement", label: isFR ? "Département" : "Department", type: "enum", listRef: "DEPARTEMENTS" },
            { key: "salaire_base", label: isFR ? "Salaire de base" : "Base salary", type: "number", required: true },
          ],
        },
        validations: [
          { cell: "B7", listRef: "DEPARTEMENTS" },
        ],
      },
      {
        name: "02_DATA_EMP",
        kind: "data",
        description: isFR ? "Employés" : "Employees",
        table: {
          name: "DATA_EMP",
          idPrefix: "EM",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "matricule", label: isFR ? "Matricule" : "Employee ID", type: "text" },
            { key: "nom", label: isFR ? "Nom" : "Name", type: "text" },
            { key: "departement", label: isFR ? "Département" : "Department", type: "text" },
            { key: "salaire_base", label: isFR ? "Salaire de base" : "Base salary", type: "number" },
          ],
        },
      },
      {
        name: "03_FORM_PAY",
        kind: "form",
        description: isFR ? "Paie" : "Payroll",
        form: {
          bindTable: "DATA_PAY",
          fields: [
            { key: "mois", label: isFR ? "Mois" : "Month", type: "enum", listRef: "MOIS", required: true },
            { key: "matricule", label: isFR ? "Matricule" : "Employee ID", type: "text", required: true },
            { key: "prime", label: isFR ? "Prime" : "Bonus", type: "number" },
            { key: "retenues", label: isFR ? "Retenues" : "Deductions", type: "number" },
            { key: "net", label: "Net", type: "number" },
          ],
        },
        validations: [
          { cell: "B6", listRef: "MOIS" },
        ],
      },
      {
        name: "10_DATA_PAY",
        kind: "data",
        description: isFR ? "Paies" : "Payroll",
        table: {
          name: "DATA_PAY",
          idPrefix: "PY",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "mois", label: isFR ? "Mois" : "Month", type: "text" },
            { key: "matricule", label: isFR ? "Matricule" : "Employee ID", type: "text" },
            { key: "prime", label: isFR ? "Prime" : "Bonus", type: "number" },
            { key: "retenues", label: isFR ? "Retenues" : "Deductions", type: "number" },
            { key: "net", label: "Net", type: "number" },
          ],
        },
      },
      { name: "03_LISTES", kind: "lists", description: "Listes" },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: isFR ? "Synthèse" : "Summary",
        kpis: [
          { label: isFR ? "Nombre employés" : "Employees", formula: "=COUNTA(DATA_EMP[Matricule])" },
          { label: isFR ? "Total net payé" : "Total net paid", formula: "=SUM(DATA_PAY[Net])" },
        ],
      },
    ],
  };
}

function ngoBudgetMETemplate({ L, ctx }) {
  const isFR = L !== "en";
  const appName = String(ctx?.appName || (isFR ? "Projet ONG – Budget & S&E" : "NGO Project – Budget & M&E"));
  const lists = {
    COST_CAT: isFR ? ["Personnel", "Équipement", "Formation", "Fonctionnement"] : ["Staff", "Equipment", "Training", "Operations"],
    MONTHS: ["M1","M2","M3","M4","M5","M6","M7","M8","M9","M10","M11","M12"],
    STATUS: isFR ? ["Prévu", "En cours", "Terminé"] : ["Planned", "Ongoing", "Done"],
  };

  return {
    app: { name: appName, type: "ngo_budget_me", lang: L, modules: ["activities", "budget", "indicators", "dashboard"] },
    version: "2.0",
    lists,
    sheets: [
      { name: "00_HOME", kind: "home", description: "Menu" },
      {
        name: "01_ACTIVITES",
        kind: "data",
        description: isFR ? "Chronogramme" : "Schedule",
        table: {
          name: "DATA_ACT",
          idPrefix: "AC",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "activite", label: isFR ? "Activité" : "Activity", type: "text" },
            { key: "mois_debut", label: isFR ? "Début" : "Start", type: "text" },
            { key: "mois_fin", label: isFR ? "Fin" : "End", type: "text" },
            { key: "jalon", label: isFR ? "Jalon/Livrable" : "Milestone/Deliverable", type: "text" },
            { key: "statut", label: isFR ? "Statut" : "Status", type: "text" },
          ],
        },
      },
      {
        name: "02_BUDGET",
        kind: "data",
        description: isFR ? "Budget" : "Budget",
        table: {
          name: "DATA_BUD",
          idPrefix: "BD",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "activite", label: isFR ? "Activité" : "Activity", type: "text" },
            { key: "categorie", label: isFR ? "Catégorie" : "Category", type: "text" },
            { key: "description", label: "Description", type: "text" },
            { key: "cout", label: isFR ? "Coût" : "Cost", type: "number" },
          ],
        },
      },
      {
        name: "10_INDICATEURS",
        kind: "data",
        description: isFR ? "S&E" : "M&E",
        table: {
          name: "DATA_IND",
          idPrefix: "IN",
          columns: [
            { key: "id", label: "ID", type: "text" },
            { key: "niveau", label: isFR ? "Niveau" : "Level", type: "text" },
            { key: "indicateur", label: isFR ? "Indicateur" : "Indicator", type: "text" },
            { key: "cible", label: isFR ? "Cible" : "Target", type: "text" },
            { key: "frequence", label: isFR ? "Fréquence" : "Frequency", type: "text" },
            { key: "source", label: "Source", type: "text" },
          ],
        },
      },
      { name: "03_LISTES", kind: "lists", description: "Listes" },
      {
        name: "04_DASHBOARD",
        kind: "dashboard",
        description: "Synthèse",
        kpis: [
          { label: isFR ? "Total activités" : "Total activities", formula: isFR ? "=COUNTA(DATA_ACT[Activité])" : "=COUNTA(DATA_ACT[Activity])" },
          { label: isFR ? "Budget total" : "Total budget", formula: isFR ? "=SUM(DATA_BUD[Coût])" : "=SUM(DATA_BUD[Cost])" },
          { label: isFR ? "Total indicateurs" : "Total indicators", formula: isFR ? "=COUNTA(DATA_IND[Indicateur])" : "=COUNTA(DATA_IND[Indicator])" },
        ],
      },
    ],
  };
}
