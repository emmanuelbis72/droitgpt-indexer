// bp/core/ngoPdfAssembler.js
// ✅ Minimal production hardening:
// - Keep existing public API: writeNgoProjectPdfPremium({res,title,ctx,sections})
// - Add buildNgoProjectPdfBufferPremium(...) to allow async jobs to pre-build PDF

import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

/**
 * Build PDF as Buffer (used by async job mode).
 * This prevents /result from doing heavy work (reduces 500 + avoids JOB_NOT_FOUND after crash).
 */
export async function buildNgoProjectPdfBufferPremium({ title, ctx, sections }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, left: 56, right: 56, bottom: 56 },
      bufferPages: true,
    });

    const stream = new PassThrough();
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.on("error", reject);

    doc.pipe(stream);

    try {
      renderNgoProjectPdf(doc, { title, ctx, sections });
      doc.end();
    } catch (e) {
      reject(e);
      try {
        doc.end();
      } catch (_) {}
    }
  });
}

/**
 * Stream PDF directly to HTTP response (sync mode or fallback).
 */
export function writeNgoProjectPdfPremium({ res, title, ctx, sections }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(title)}.pdf"`);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, left: 56, right: 56, bottom: 56 },
    bufferPages: true,
  });

  doc.pipe(res);

  doc.on("error", (err) => {
    console.error("[NGO][PDF] PDFKit error", err);
    try {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    } catch (_) {}
  });

  // If client disconnects, stop.
  res.on("close", () => {
    try {
      doc.end();
    } catch (_) {}
  });

  renderNgoProjectPdf(doc, { title, ctx, sections });
  doc.end();
}

/* =========================================================
   Shared renderer
========================================================= */
function renderNgoProjectPdf(doc, { title, ctx, sections }) {
  // ---- Blank-page protection
  let __pageIndex = 0;
  const __pageHasBody = new Set();
  const __touch = () => __pageHasBody.add(__pageIndex);
  let __suppressTouch = false;

  doc.on("pageAdded", () => {
    __pageIndex += 1;
  });

  const __origText = doc.text.bind(doc);
  doc.text = function (...args) {
    const s = args?.[0];
    if (!__suppressTouch && s !== undefined && s !== null && String(s).trim().length > 0) {
      __touch();
    }
    return __origText(...args);
  };

  doc.__setSuppressTouch = (v) => {
    __suppressTouch = !!v;
  };

  const styles = {
    title: { font: "Helvetica-Bold", size: 22 },
    h1: { font: "Helvetica-Bold", size: 16 },
    h2: { font: "Helvetica-Bold", size: 12 },
    body: { font: "Helvetica", size: 10.5, lineGap: 3.2 },
    small: { font: "Helvetica", size: 9, lineGap: 2.6 },
  };

  const safeSections = Array.isArray(sections) ? sections : [];
  const headerLeft = String(ctx?.organization || "ONG").trim() || "ONG";
  const footerLeft = String(ctx?.projectTitle || title || "Projet").trim();

  // 1) Cover
  renderCover(doc, title, ctx, styles);

  // 2) TOC placeholder
  const tocPageIndex = doc.bufferedPageRange().count;
  doc.addPage();
  renderTOCPlaceholder(doc, styles);

  // 3) Sections + TOC entries
  const toc = [];
  for (const s of safeSections) {
    const secTitle = (s?.title || "").trim() || s?.key || "Section";
    doc.addPage();

    const startPageNumber = getCurrentPageNumber(doc);
    toc.push({ title: secTitle, page: startPageNumber });

    renderSection(doc, secTitle, s, styles);
  }

  // 4) Fill TOC
  fillTOC(doc, tocPageIndex, toc, styles);

  // 5) headers/footers
  renderAllHeadersFooters(doc, { headerLeft, footerLeft, styles });

  // 6) Remove trailing blank pages
  removeTrailingBlankPages(doc, __pageHasBody);
}

function renderCover(doc, title, ctx, styles) {
  doc.__setSuppressTouch?.(true);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font("Helvetica-Bold").fontSize(styles.title.size).text(String(title || ""), x, 120, {
    width: w,
    align: "left",
  });

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(11).text(
    [
      `Organisation: ${ctx?.organization || ""}`,
      `Pays: ${ctx?.country || ""}`,
      `Zone: ${ctx?.provinceCity || ""}`,
      `Secteur: ${ctx?.sector || ""}`,
      ctx?.donorStyle ? `Style bailleur: ${ctx.donorStyle}` : "",
      ctx?.durationMonths ? `Durée: ${ctx.durationMonths} mois` : "",
      ctx?.startDate ? `Démarrage: ${ctx.startDate}` : "",
      ctx?.budgetTotal ? `Budget total: ${ctx.budgetTotal}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    { width: w, align: "left" }
  );

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(10).text(
    "Document généré automatiquement (Premium) — standard bailleurs internationaux.",
    x,
    doc.y,
    { width: w }
  );

  doc.__setSuppressTouch?.(false);
}

function renderTOCPlaceholder(doc, styles) {
  applyFont(doc, styles.h1);
  doc.text("Sommaire");
  doc.moveDown(0.4);
  applyFont(doc, styles.body);
  doc.text("Le sommaire sera généré automatiquement.");
}

function fillTOC(doc, tocPageIndex, toc, styles) {
  doc.switchToPage(tocPageIndex);
  doc.x = doc.page.margins.left;
  doc.y = doc.page.margins.top;

  applyFont(doc, styles.h1);
  doc.text("Sommaire");
  doc.moveDown(0.6);

  applyFont(doc, styles.body);
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const item of toc) {
    ensureSpace(doc, 18);
    const left = String(item.title || "").trim();
    const right = String(item.page || "");
    const dots = makeDots(left, right, 90);
    doc.text(`${left} ${dots} ${right}`, x, doc.y, { width: w });
    doc.moveDown(0.25);
  }
}

function renderSection(doc, title, sectionObj, styles) {
  applyFont(doc, styles.h1);
  doc.text(String(title || ""));
  drawDivider(doc);

  const key = String(sectionObj?.key || "").trim();
  const metaJson = sectionObj?.meta?.json;

  if (metaJson && typeof metaJson === "object") {
    renderJsonBlock(doc, key, metaJson, styles);
    return;
  }

  applyFont(doc, styles.body);
  const content = String(sectionObj?.content || "").trim();
  doc.text(content || "—");
}

function renderJsonBlock(doc, key, obj, styles) {
  if (key === "stakeholder_analysis_json") return renderStakeholders(doc, obj, styles);
  if (key === "logframe_json") return renderLogframe(doc, obj, styles);
  if (key === "me_plan_json") return renderME(doc, obj, styles);
  if (key === "sdg_alignment_json") return renderSDGs(doc, obj, styles);
  if (key === "risk_matrix_json") return renderRisks(doc, obj, styles);
  if (key === "budget_json") return renderBudget(doc, obj, styles);
  if (key === "workplan_json") return renderWorkplan(doc, obj, styles);

  applyFont(doc, styles.small);
  doc.text(JSON.stringify(obj, null, 2));
}

function renderStakeholders(doc, obj, styles) {
  const rows = Array.isArray(obj?.stakeholders) ? obj.stakeholders : [];
  const tableRows = rows.map((s) => [
    s?.name || "",
    s?.type || "",
    s?.interest || "",
    s?.influence || "",
    s?.role || "",
    s?.engagement_strategy || "",
  ]);

  renderTable(doc, {
    title: "Matrice des parties prenantes",
    headers: ["Partie prenante", "Type", "Intérêt", "Influence", "Rôle", "Stratégie d’engagement"],
    colFracs: [0.18, 0.1, 0.08, 0.08, 0.22, 0.34],
    rows: tableRows,
    styles,
  });
}

function renderLogframe(doc, obj, styles) {
  const rows = [];

  if (obj?.impact?.statement) {
    rows.push([
      "Impact",
      obj.impact.statement || "",
      joinIndicators(obj.impact.indicators),
      joinAssumptions(obj.impact.assumptions),
    ]);
  }

  const outcomes = Array.isArray(obj?.outcomes) ? obj.outcomes : [];
  for (const o of outcomes) {
    rows.push([
      "Outcome",
      o?.statement || "",
      joinIndicators(o?.indicators),
      joinAssumptions(o?.assumptions),
    ]);

    const outputs = Array.isArray(o?.outputs) ? o.outputs : [];
    for (const out of outputs) {
      rows.push([
        "Output",
        out?.statement || "",
        joinIndicators(out?.indicators),
        joinAssumptions(out?.assumptions),
      ]);
    }
  }

  renderTable(doc, {
    title: "Cadre logique (LogFrame) — synthèse",
    headers: ["Niveau", "Énoncé", "Indicateurs & Sources", "Hypothèses / Risques"],
    colFracs: [0.12, 0.38, 0.3, 0.2],
    rows,
    styles,
  });
}

function renderME(doc, obj, styles) {
  const items = Array.isArray(obj?.indicators) ? obj.indicators : [];
  const rows = items.map((i) => [
    i?.indicator || "",
    i?.definition || "",
    i?.data_source || "",
    i?.frequency || "",
    i?.responsible || "",
  ]);

  renderTable(doc, {
    title: "Plan de suivi-évaluation (M&E) — indicateurs",
    headers: ["Indicateur", "Définition", "Source", "Fréquence", "Responsable"],
    colFracs: [0.22, 0.28, 0.2, 0.15, 0.15],
    rows,
    styles,
  });
}

function renderSDGs(doc, obj, styles) {
  const rows = Array.isArray(obj?.sdgs) ? obj.sdgs : [];
  const tableRows = rows.map((s) => [s?.sdg || "", s?.targets || "", s?.contribution || "", s?.indicators || ""]);

  renderTable(doc, {
    title: "Alignement ODD (SDGs)",
    headers: ["ODD", "Cibles", "Contribution", "Indicateurs"],
    colFracs: [0.1, 0.22, 0.38, 0.3],
    rows: tableRows,
    styles,
  });
}

function renderRisks(doc, obj, styles) {
  const rows = Array.isArray(obj?.risks) ? obj.risks : [];
  const tableRows = rows.map((r) => [r?.risk || "", r?.probability || "", r?.impact || "", r?.mitigation || "", r?.owner || ""]);

  renderTable(doc, {
    title: "Matrice des risques",
    headers: ["Risque", "Prob.", "Impact", "Mesures de mitigation", "Responsable"],
    colFracs: [0.28, 0.08, 0.08, 0.4, 0.16],
    rows: tableRows,
    styles,
  });
}

function renderBudget(doc, obj, styles) {
  const rows = Array.isArray(obj?.lines) ? obj.lines : [];
  const tableRows = rows.map((l) => [
    l?.category || "",
    l?.item || "",
    String(l?.quantity ?? ""),
    String(l?.unit_cost ?? ""),
    String(l?.total ?? ""),
    l?.notes || "",
  ]);

  renderTable(doc, {
    title: "Budget détaillé",
    headers: ["Catégorie", "Ligne", "Qté", "Coût unitaire", "Total", "Notes"],
    colFracs: [0.16, 0.28, 0.08, 0.12, 0.12, 0.24],
    rows: tableRows,
    styles,
  });
}

function renderWorkplan(doc, obj, styles) {
  const rows = Array.isArray(obj?.activities) ? obj.activities : [];
  const tableRows = rows.map((a) => [
    a?.activity || "",
    a?.month_1 || "",
    a?.month_2 || "",
    a?.month_3 || "",
    a?.month_4 || "",
    a?.month_5 || "",
    a?.month_6 || "",
  ]);

  renderTable(doc, {
    title: "Chronogramme (extrait 6 mois)",
    headers: ["Activité", "M1", "M2", "M3", "M4", "M5", "M6"],
    colFracs: [0.4, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    rows: tableRows,
    styles,
  });
}

function applyFont(doc, style) {
  doc.font(style.font).fontSize(style.size);
  if (style.lineGap !== undefined) doc.lineGap(style.lineGap);
  return doc;
}

function drawDivider(doc) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.y + 8;
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(1).strokeColor("#E5E7EB").stroke();
  doc.moveDown(1.2);
}

function getCurrentPageNumber(doc) {
  const range = doc.bufferedPageRange();
  return range.start + range.count;
}

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function makeDots(left, right, maxDots) {
  const dotsCount = Math.max(5, Math.min(maxDots, maxDots - Math.floor((left.length + right.length) / 2)));
  return ".".repeat(dotsCount);
}

function renderAllHeadersFooters(doc, { headerLeft, footerLeft, styles }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNo = i + 1;

    doc.font("Helvetica").fontSize(8).fillColor("#6B7280");
    doc.text(headerLeft, doc.page.margins.left, 22, { align: "left" });

    doc.text(footerLeft, doc.page.margins.left, doc.page.height - 34, { align: "left" });
    doc.text(String(pageNo), doc.page.width - doc.page.margins.right - 20, doc.page.height - 34, {
      width: 20,
      align: "right",
    });

    doc.fillColor("#000000");
    applyFont(doc, styles.body);
  }
}

function removeTrailingBlankPages(doc, pageHasBodySet) {
  try {
    const range = doc.bufferedPageRange();
    const total = range.count;
    if (total <= 1) return;

    let lastIdx = total - 1;
    while (lastIdx > 0) {
      if (pageHasBodySet.has(lastIdx)) break;
      lastIdx -= 1;
    }

    const pagesToRemove = total - 1 - lastIdx;
    if (pagesToRemove <= 0) return;

    for (let k = 0; k < pagesToRemove; k++) {
      doc._pageBuffer.pop();
      doc._pageBufferStart = Math.min(doc._pageBufferStart, doc._pageBuffer.length);
    }
  } catch (e) {
    console.error("[NGO][PDF] removeTrailingBlankPages failed", e);
  }
}

function renderTable(doc, { title, headers, colFracs, rows, styles }) {
  doc.moveDown(0.8);
  applyFont(doc, styles.h2).text(String(title || ""));
  doc.moveDown(0.25);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const fracs = normalizeFracs(colFracs, headers.length);
  const colW = fracs.map((f) => f * w);

  const headerY = doc.y;
  ensureSpace(doc, 24);

  doc.save();
  doc.rect(x, headerY, w, 18).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.1 });

  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    const hw = colW[i];
    doc.text(String(headers[i] || ""), cx + 6, headerY + 4, { width: hw - 10, align: "left" });
    cx += hw;
  }

  doc.moveDown(1.2);
  applyFont(doc, styles.small);

  const cellText = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(" • ");
    if (typeof v === "object") {
      if (typeof v.text === "string" || typeof v.text === "number") return String(v.text);
      if (typeof v.label === "string" || typeof v.label === "number") return String(v.label);
      if (typeof v.value === "string" || typeof v.value === "number") return String(v.value);
      if (typeof v.name === "string" || typeof v.name === "number") return String(v.name);
      try {
        const s = JSON.stringify(v);
        return s && s !== "{}" ? s : "";
      } catch {
        return "";
      }
    }
    return "";
  };

  const rowHeight = 34;
  for (const r0 of rows || []) {
    ensureSpace(doc, rowHeight + 8);
    const y0 = doc.y;
    doc.save();
    doc.rect(x, y0 - 2, w, rowHeight).strokeOpacity(0.12).stroke();
    doc.restore();

    const r = Array.isArray(r0) ? r0 : r0 && typeof r0 === "object" ? Object.values(r0) : [r0];

    let x0 = x;
    for (let i = 0; i < headers.length; i++) {
      const cellW = colW[i];
      const txt = cellText(r?.[i]);
      doc.text(txt, x0 + 6, y0 + 2, { width: cellW - 10, height: rowHeight - 4 });
      x0 += cellW;
    }

    doc.moveDown(2.05);
  }
}

function normalizeFracs(colFracs, n) {
  const fr = Array.isArray(colFracs) ? colFracs.slice(0, n) : [];
  while (fr.length < n) fr.push(1 / n);
  const sum = fr.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return fr.map((x) => (Number(x) || 0) / sum);
}

function joinIndicators(indicators) {
  const arr = Array.isArray(indicators) ? indicators : [];
  return arr
    .map((i) => {
      const ind = i?.indicator || "";
      const src = i?.source || "";
      return [ind, src].filter(Boolean).join(" — ");
    })
    .filter(Boolean)
    .join("\n");
}

function joinAssumptions(assumptions) {
  const arr = Array.isArray(assumptions) ? assumptions : [];
  return arr.map((a) => String(a || "")).filter(Boolean).join("\n");
}

function sanitizeFilename(name) {
  return String(name || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 100);
}
