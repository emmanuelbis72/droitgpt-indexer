// bp/core/excelAssembler.js
// Builds a professional .xlsx from an Excel blueprint.

import ExcelJS from "exceljs";

function safeSheetName(name) {
  const s = String(name || "Sheet").replace(/[\\/?*\[\]:]/g, " ").trim();
  return s.slice(0, 31) || "Sheet";
}

function setHeaderRowStyle(row) {
  row.font = { bold: true };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

function setTableColumnWidth(ws, columns) {
  columns.forEach((c, idx) => {
    const base = Math.max(12, Math.min(40, String(c.label || c.key || "").length + 6));
    ws.getColumn(idx + 1).width = base;
  });
}

function addTitleBlock(ws, title, subtitle) {
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 18 };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

  ws.mergeCells("A2:H2");
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { size: 11 };
  ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

  ws.getRow(1).height = 28;
  ws.getRow(2).height = 18;
}

function writeListsSheet(ws, lists) {
  addTitleBlock(ws, "LISTES", "Listes utilisées pour les validations");
  let col = 1;
  Object.entries(lists || {}).forEach(([name, values]) => {
    const c = ws.getColumn(col);
    c.width = Math.max(16, Math.min(28, name.length + 4));
    ws.getCell(3, col).value = name;
    ws.getCell(3, col).font = { bold: true };
    (Array.isArray(values) ? values : []).forEach((v, i) => {
      ws.getCell(4 + i, col).value = String(v);
    });
    col += 1;
  });
}

function defineNamedRanges(workbook, listsSheet, lists) {
  // ExcelJS: workbook.definedNames.add(name, range)
  // Range must be like '03_LISTES'!$A$4:$A$20
  let col = 1;
  Object.entries(lists || {}).forEach(([name, values]) => {
    const count = (Array.isArray(values) ? values.length : 0) || 1;
    const colLetter = listsSheet.getColumn(col).letter;
    const range = `'${listsSheet.name}'!$${colLetter}$4:$${colLetter}$${3 + count}`;
    try {
      workbook.definedNames.add(name, range);
    } catch {
      // ignore duplicate
    }
    col += 1;
  });
}

function writeDataTable(ws, table, lang) {
  const L = (lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  const title = table?.name || "DATA";
  addTitleBlock(ws, title, L === "en" ? "Data table (do not delete headers)" : "Table de données (ne pas supprimer l'entête)");

  const columns = table?.columns || [];
  const headerRowIdx = 4;
  const headerRow = ws.getRow(headerRowIdx);
  headerRow.values = [null, ...columns.map((c) => c.label || c.key)];
  setHeaderRowStyle(headerRow);
  headerRow.height = 18;
  ws.views = [{ state: "frozen", ySplit: headerRowIdx }];

  setTableColumnWidth(ws, columns);

  // Apply formats + computed Month column if present
  columns.forEach((c, idx) => {
    const col = ws.getColumn(idx + 1);
    if (c.type === "date") col.numFmt = "yyyy-mm-dd";
    if (c.type === "number") col.numFmt = "#,##0.00";
  });

  // Create an Excel Table for structured references if possible
  const tableName = String(table?.name || "DATA").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 25);
  try {
    ws.addTable({
      name: tableName,
      ref: `A${headerRowIdx}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: columns.map((c) => ({ name: c.label || c.key })),
      rows: [],
    });
  } catch {
    // ExcelJS can throw if table name duplicate
  }
}

function writeFormSheet(ws, form, validations, workbook, listsSheetName, lang) {
  const L = (lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  addTitleBlock(ws, L === "en" ? "FORM" : "FORMULAIRE", L === "en" ? "Enter data here" : "Saisissez ici");
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 48;

  const fields = form?.fields || [];
  let row = 5;
  ws.getCell("A4").value = L === "en" ? "Field" : "Champ";
  ws.getCell("B4").value = L === "en" ? "Value" : "Valeur";
  ws.getRow(4).font = { bold: true };

  fields.forEach((f) => {
    ws.getCell(row, 1).value = f.label || f.key;
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 2).value = "";
    ws.getCell(row, 2).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
    if (f.type === "date") ws.getCell(row, 2).numFmt = "yyyy-mm-dd";
    if (f.type === "number") ws.getCell(row, 2).numFmt = "#,##0.00";
    row += 1;
  });

  // Buttons (no macros) – we just provide user instructions.
  const infoRow = row + 1;
  ws.mergeCells(`A${infoRow}:B${infoRow + 2}`);
  ws.getCell(`A${infoRow}`).value =
    L === "en"
      ? "Tip: Copy the row values and paste as a new row in the DATA sheet (below headers)."
      : "Astuce : copiez les valeurs ci-dessus et collez-les comme nouvelle ligne dans la feuille DATA (sous l'entête).";
  ws.getCell(`A${infoRow}`).alignment = { wrapText: true };
  ws.getCell(`A${infoRow}`).font = { size: 10 };

  // Apply dropdown validations using defined names (best) or explicit range in LISTES.
  (validations || []).forEach((v) => {
    if (!v?.cell || !v?.listRef) return;
    // Use defined name as formula for list.
    ws.getCell(v.cell).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [v.listRef],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: L === "en" ? "Invalid value" : "Valeur invalide",
      error: L === "en" ? "Select a value from the list." : "Sélectionnez une valeur dans la liste.",
    };
  });
}

function writeDashboard(ws, blueprint) {
  addTitleBlock(ws, "DASHBOARD", "Indicateurs & synthèse");
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 18;
  ws.getRow(4).height = 18;

  ws.getCell("A4").value = "Indicateur";
  ws.getCell("B4").value = "Valeur";
  ws.getRow(4).font = { bold: true };

  const kpis = blueprint?.sheets?.find((s) => s.kind === "dashboard")?.kpis || [];
  let r = 5;
  kpis.forEach((k) => {
    ws.getCell(r, 1).value = k.label;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = { formula: k.formula, result: 0 };
    ws.getCell(r, 2).numFmt = "#,##0.00";
    r += 1;
  });
}

export async function buildExcelFromBlueprint(blueprint) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DroitGPT";
  workbook.created = new Date();
  workbook.modified = new Date();

  const lang = blueprint?.app?.lang || "fr";
  const sheets = Array.isArray(blueprint?.sheets) ? blueprint.sheets : [];

  // Create worksheets
  const wsMap = new Map();
  for (const s of sheets) {
    const ws = workbook.addWorksheet(safeSheetName(s.name));
    wsMap.set(s.name, ws);
  }

  // Ensure LISTES exists
  let listsWs = wsMap.get("03_LISTES");
  if (!listsWs) {
    listsWs = workbook.addWorksheet("03_LISTES");
    wsMap.set("03_LISTES", listsWs);
  }

  // Write LISTES + defined names first
  writeListsSheet(listsWs, blueprint?.lists || {});
  defineNamedRanges(workbook, listsWs, blueprint?.lists || {});

  // Write other sheets
  for (const s of sheets) {
    const ws = wsMap.get(s.name);
    if (!ws) continue;

    if (s.kind === "home") {
      addTitleBlock(ws, blueprint?.app?.name || "DroitGPT", "Progiciel Excel – génération automatique");
      ws.getColumn(1).width = 86;
      ws.getCell("A4").value = "MENU";
      ws.getCell("A4").font = { bold: true, size: 12 };
      ws.getCell("A6").value = "1) Formulaire";
      ws.getCell("A7").value = "2) Données";
      ws.getCell("A8").value = "3) Dashboard";
      ws.getCell("A10").value = "Conseil : ne modifiez pas les en-têtes des tables. Utilisez les listes déroulantes.";
      ws.getCell("A10").font = { size: 10 };
    }

    if (s.kind === "data" && s.table) {
      writeDataTable(ws, s.table, lang);

      // Example computed Month column if exists
      const cols = s.table.columns || [];
      const monthIdx = cols.findIndex((c) => String(c.key).toLowerCase() === "month" || String(c.label).toLowerCase() === "mois");
      const dateIdx = cols.findIndex((c) => String(c.key).toLowerCase() === "date");
      if (monthIdx >= 0 && dateIdx >= 0) {
        // Put a formula in first data row (row 5) for Month column, then users can fill down.
        const headerRow = 4;
        const firstDataRow = headerRow + 1;
        const dateCell = ws.getCell(firstDataRow, dateIdx + 1).address;
        ws.getCell(firstDataRow, monthIdx + 1).value = { formula: `=TEXT(${dateCell},"mm")`, result: "" };
      }
    }

    if (s.kind === "form" && s.form) {
      writeFormSheet(ws, s.form, s.validations, workbook, listsWs.name, lang);
    }

    if (s.kind === "dashboard") {
      writeDashboard(ws, blueprint);
    }
  }

  // A bit of polish
  workbook.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0 }];

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
