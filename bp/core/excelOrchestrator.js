// bp/core/excelOrchestrator.js
// Ultra professional Excel app generator:
// 1) Build an Excel "blueprint" (deterministic template OR model JSON)
// 2) Compile into .xlsx with ExcelJS (no macros)

import { deepseekChat } from "../core/deepseekClient.js";
import {
  excelSystemPrompt,
  excelBlueprintPrompt,
} from "./excelPrompts.js";
import { buildExcelFromBlueprint } from "./excelAssembler.js";
import { getExcelTemplateBlueprint } from "./excelTemplates.js";

function safeJsonParse(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Try direct parse
  try {
    return JSON.parse(s);
  } catch {}

  // Try to extract first JSON object block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function normalizeBlueprint(bp, { lang, ctx }) {
  if (!bp || typeof bp !== "object") return null;
  if (!bp.app) bp.app = {};
  bp.app.lang = bp.app.lang || (lang || "fr");
  bp.app.name = bp.app.name || ctx?.appName || "Progiciel Excel";
  bp.version = bp.version || "1.0";
  if (!Array.isArray(bp.sheets)) bp.sheets = [];
  if (!bp.lists || typeof bp.lists !== "object") bp.lists = {};

  // Ensure mandatory sheets
  const ensure = (name, kind, description) => {
    if (!bp.sheets.some((s) => s?.name === name)) {
      bp.sheets.push({ name, kind, description });
    }
  };
  ensure("00_HOME", "home", "Menu");
  ensure("03_LISTES", "lists", "Listes");
  ensure("04_DASHBOARD", "dashboard", "KPIs");

  // If there is a form, ensure a data table exists with matching name
  const forms = bp.sheets.filter((s) => s.kind === "form" && s.form?.bindTable);
  for (const f of forms) {
    const tableSheetName = f.form.bindTable;
    if (!bp.sheets.some((s) => s.kind === "data" && s.table?.name === tableSheetName)) {
      // Create a minimal data sheet
      const cols = (f.form.fields || []).map((x) => ({ key: x.key, label: x.label || x.key, type: x.type || "text" }));
      bp.sheets.push({
        name: tableSheetName.replace(/^DATA_/, "02_DATA_"),
        kind: "data",
        description: "Table de données",
        table: { name: tableSheetName, columns: [{ key: "id", label: "ID", type: "text" }, ...cols] },
      });
    }
  }

  return bp;
}

export async function generateExcelApp({ lang = "fr", ctx = {} }) {
  const temperature = Number(process.env.EXCEL_TEMPERATURE || 0.2);
  const max_tokens = Number(process.env.EXCEL_MAX_TOKENS || 2200);

  // ✅ Ultra-pro v2: deterministic templates for the main business apps.
  // For unsupported types, fallback to AI blueprint (still no macros).
  const tpl = getExcelTemplateBlueprint({ lang, ctx });
  let blueprint = tpl;

  if (!blueprint) {
    const system = excelSystemPrompt({ lang });
    const user = excelBlueprintPrompt({ lang, ctx });
    const out = await deepseekChat({
      temperature,
      max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    blueprint = safeJsonParse(out);
    if (!blueprint) {
      // Fallback to deterministic template if parsing fails
      blueprint = getExcelTemplateBlueprint({ lang, ctx: { ...ctx, type: "cash_management" } });
    }
  }

  blueprint = normalizeBlueprint(blueprint, { lang, ctx });
  if (!blueprint) throw new Error("EXCEL_BLUEPRINT_INVALID");

  const xlsxBuffer = await buildExcelFromBlueprint(blueprint);

  return {
    blueprint,
    xlsxBuffer,
    fileNameBase: String(ctx?.fileName || blueprint?.app?.name || "excel-app")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 80),
  };
}
