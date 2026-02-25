// bp/core/ngoPdfAssembler.js
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

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

export function writeNgoProjectPdfPremium({ res, title, ctx, sections }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(title)}.pdf"`);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, left: 56, right: 56, bottom: 56 },
    bufferPages: true,
  });

  let __ended = false;

  const safeDocEnd = () => {
    if (__ended) return;
    __ended = true;
    try {
      doc.end();
    } catch (_) {}
  };

  const __safeClose = (tag, err) => {
    try {
      console.error(`[NGO][PDF] safeClose: ${tag}`, err || "");
    } catch (_) {}

    try {
      doc.unpipe(res);
    } catch (_) {}

    safeDocEnd();

    try {
      if (!res.headersSent) res.statusCode = 500;
    } catch (_) {}

    try {
      if (err) res.destroy(err);
      else if (!res.writableEnded) res.end();
    } catch (_) {}
  };

  res.on("error", (err) => {
    console.error("[NGO][PDF] response error", err);
    __safeClose("response_error", err);
  });

  doc.on("error", (err) => {
    console.error("[NGO][PDF] PDFKit error", err);
    __safeClose("pdfkit_error", err);
  });

  res.on("close", () => {
    if (res.writableEnded) return;
    __safeClose("client_close");
  });

  doc.pipe(res);

  try {
    renderNgoProjectPdf(doc, { title, ctx, sections });
    safeDocEnd();
  } catch (err) {
    console.error("[NGO] PDF generation failed", err);
    __safeClose("render_error", err);
  }
}

/* =========================
   Cover + TOC
========================= */
function renderCover(doc, title, ctx, styles) {
  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(true);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font("Helvetica-Bold").fontSize(styles.title.size).text(String(title || ""), x, 120, {
    width: w,
    align: "left",
  });

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(11).text(
    [
      `Organisation: ${ctx.organization || ""}`,
      `Pays: ${ctx.country || ""}`,
      `Zone: ${ctx.provinceCity || ""}`,
      `Secteur: ${ctx.sector || ""}`,
      ctx.donorStyle ? `Style bailleur: ${ctx.donorStyle}` : "",
      ctx.durationMonths ? `Durée: ${ctx.durationMonths} mois` : "",
      ctx.startDate ? `Démarrage: ${ctx.startDate}` : "",
      ctx.budgetTotal ? `Budget total: ${ctx.budgetTotal}` : "",
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

  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(false);
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

/* =========================
   Sections renderer
========================= */
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
  renderTextWithBoldAndLists(doc, content || "—", styles);
}

/* =========================
   JSON renderers (tables)
========================= */
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
    colFracs: [0.18, 0.10, 0.08, 0.08, 0.22, 0.34],
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
      rows.push(["Output", out?.statement || "", joinIndicators(out?.indicators), ""]);
    }
  }

  renderTable(doc, {
    title: "Cadre logique (LogFrame) — synthèse",
    headers: ["Niveau", "Énoncé", "Indicateurs (baseline/target/MoV)", "Hypothèses"],
    colFracs: [0.12, 0.38, 0.34, 0.16],
    rows,
    styles,
  });
}

function renderME(doc, obj, styles) {
  const rows = Array.isArray(obj?.me_framework) ? obj.me_framework : [];
  const tableRows = rows.map((r) => [
    r?.indicator || "",
    r?.baseline || "",
    r?.target || "",
    r?.frequency || "",
    r?.data_source || "",
    r?.collection_method || "",
    r?.responsible || "",
  ]);

  renderTable(doc, {
    title: "Plan Suivi-Évaluation (M&E) — cadre",
    headers: ["Indicateur", "Baseline", "Cible", "Fréquence", "Source", "Méthode", "Responsable"],
    colFracs: [0.20, 0.10, 0.10, 0.10, 0.16, 0.18, 0.16],
    rows: tableRows,
    styles,
  });
}

function renderSDGs(doc, obj, styles) {
  const sdgs = Array.isArray(obj?.sdgs) ? obj.sdgs : [];
  const rows = [];

  for (const s of sdgs) {
    const targets = Array.isArray(s?.targets) ? s.targets : [];
    for (const t of targets) {
      rows.push([
        s?.sdg || "",
        t?.target || "",
        t?.contribution || "",
        Array.isArray(t?.project_indicators) ? t.project_indicators.join("; ") : "",
      ]);
    }
  }

  renderTable(doc, {
    title: "Alignement ODD (SDGs)",
    headers: ["SDG", "Target", "Contribution", "Indicateurs projet"],
    colFracs: [0.12, 0.20, 0.38, 0.30],
    rows,
    styles,
  });
}

function renderRisks(doc, obj, styles) {
  const rows = Array.isArray(obj?.risks) ? obj.risks : [];
  const tableRows = rows.map((r) => [
    r?.risk || "",
    r?.category || "",
    r?.probability || "",
    r?.impact || "",
    r?.mitigation || "",
    r?.owner || "",
  ]);

  renderTable(doc, {
    title: "Matrice des risques",
    headers: ["Risque", "Catégorie", "Probabilité", "Impact", "Mitigation", "Owner"],
    colFracs: [0.26, 0.12, 0.10, 0.10, 0.30, 0.12],
    rows: tableRows,
    styles,
  });
}

function renderBudget(doc, obj, styles) {
  const currency = String(obj?.currency || "USD");
  const direct = Array.isArray(obj?.direct_costs) ? obj.direct_costs : [];

  for (const cat of direct) {
    const catName = String(cat?.category || "Catégorie");
    const items = Array.isArray(cat?.items) ? cat.items : [];
    const rows = items.map((it) => [
      it?.line_item || "",
      it?.unit || "",
      it?.qty || "",
      it?.unit_cost || "",
      it?.total_cost || "",
      it?.notes || "",
    ]);

    renderTable(doc, {
      title: `Budget — ${catName} (${currency})`,
      headers: ["Ligne", "Unité", "Qté", "Coût unitaire", "Total", "Notes"],
      colFracs: [0.30, 0.10, 0.08, 0.14, 0.12, 0.26],
      rows,
      styles,
    });
  }

  const totals = obj?.totals || {};
  const indirect = obj?.indirect_costs || {};
  const summaryRows = [
    { label: "Total direct", value: totals?.direct_total || "" },
    { label: "Coûts indirects (taux)", value: indirect?.rate || "" },
    { label: "Coûts indirects (montant)", value: indirect?.amount || "" },
    { label: "Total général", value: totals?.grand_total || "" },
  ];

  renderKeyValue(doc, "Résumé budget", summaryRows, styles);
}

function renderWorkplan(doc, obj, styles) {
  const duration = Number(obj?.duration_months || 12);
  const activities = Array.isArray(obj?.activities) ? obj.activities : [];

  const rows = activities.map((a) => [
    a?.activity || "",
    a?.component || "",
    String(a?.start_month ?? ""),
    String(a?.end_month ?? ""),
    Array.isArray(a?.milestones) ? a.milestones.join("; ") : "",
  ]);

  renderTable(doc, {
    title: `Chronogramme (Workplan) — ${duration} mois`,
    headers: ["Activité", "Composante", "Début", "Fin", "Jalons"],
    colFracs: [0.32, 0.16, 0.08, 0.08, 0.36],
    rows,
    styles,
  });
}

/* =========================
   Table utilities
========================= */
function renderKeyValue(doc, title, rows, styles) {
  doc.moveDown(0.7);
  applyFont(doc, styles.h2);
  doc.text(title);
  doc.moveDown(0.25);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const yH = doc.y;
  doc.save();
  doc.rect(x, yH, w, 18).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.2 });
  doc.text("Clé", x + 8, yH + 4, { width: w * 0.45 - 10 });
  doc.text("Valeur", x + 8 + w * 0.45, yH + 4, { width: w * 0.55 - 10 });

  doc.moveDown(1.1);
  applyFont(doc, styles.small);

  for (const r of rows || []) {
    ensureSpace(doc, 28);
    const y0 = doc.y;

    doc.save();
    doc.rect(x, y0 - 2, w, 16).strokeOpacity(0.12).stroke();
    doc.restore();

    doc.text(String(r?.label || ""), x + 8, y0 + 2, { width: w * 0.45 - 10 });
    doc.text(String(r?.value || ""), x + 8 + w * 0.45, y0 + 2, { width: w * 0.55 - 10 });

    doc.moveDown(1.05);
  }
}

function renderTable(doc, { title, headers, colFracs, rows, styles }) {
  headers = Array.isArray(headers) ? headers : [];
  rows = Array.isArray(rows) ? rows : [];
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
    doc.text(String(headers[i] || ""), cx + 6, headerY + 4, {
      width: hw - 10,
      align: "left",
    });
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

function normalizeFracs(fracs, n) {
  const arr = Array.isArray(fracs) ? fracs.slice(0, n) : [];
  while (arr.length < n) arr.push(1 / n);
  const sum = arr.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return arr.map((v) => (Number(v) || 0) / sum);
}

function joinIndicators(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr
    .slice(0, 6)
    .map((it) => {
      const name = it?.name ? String(it.name) : "";
      const base = [
        name,
        it?.baseline ? `Baseline: ${it.baseline}` : "",
        it?.target ? `Cible: ${it.target}` : "",
        it?.means_of_verification ? `MoV: ${it.means_of_verification}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      return base;
    })
    .filter(Boolean)
    .join("\n");
}

function joinAssumptions(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.slice(0, 6).map((s) => `• ${String(s || "")}`).join("\n");
}

/* =========================
   Header/footer + cleanup
========================= */
function renderAllHeadersFooters(doc, { headerLeft, footerLeft, styles }) {
  const range = doc.bufferedPageRange();
  const pageCount = range.count;

  // IMPORTANT: we must ensure header/footer never wraps (wrap can force PDFKit to add pages)
  const safeHeaderLeft = oneLine(headerLeft, 70);
  const safeFooterLeft = oneLine(footerLeft, 90);

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    renderHeaderFooter(doc, {
      headerLeft: safeHeaderLeft,
      headerRight: "CONFIDENTIEL",
      footerLeft: safeFooterLeft,
      pageNumber: i + 1,
      pageCount,
      styles,
    });
  }
}

function renderHeaderFooter(doc, { headerLeft, headerRight, footerLeft, pageNumber, pageCount, styles }) {
  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(true);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ✅ Safe positions INSIDE printable area / margins (prevents implicit addPage)
  const headerY = Math.max(6, doc.page.margins.top - 28); // e.g. 56-28=28
  const headerLineY = doc.page.margins.top - 18;          // e.g. 38

  const footerLineY = doc.page.height - doc.page.margins.bottom + 12; // e.g. 842-56+12=798 (line in bottom margin)
  const footerTextY = doc.page.height - doc.page.margins.bottom - 14; // e.g. 842-56-14=772 (text in printable area)

  // Header divider
  doc.save();
  doc.moveTo(x, headerLineY).lineTo(x + w, headerLineY).strokeOpacity(0.12).stroke();
  doc.restore();

  applyFont(doc, { font: "Helvetica", size: 9 });

  // HARD RULE: prevent wrap => prevent implicit addPage()
  doc.text(oneLine(headerLeft, 70), x, headerY, { width: w * 0.6, align: "left", lineBreak: false });
  doc.text(oneLine(headerRight, 30), x + w * 0.6, headerY, { width: w * 0.4, align: "right", lineBreak: false });

  // Footer divider
  doc.save();
  doc.moveTo(x, footerLineY).lineTo(x + w, footerLineY).strokeOpacity(0.12).stroke();
  doc.restore();

  applyFont(doc, { font: "Helvetica", size: 9 });

  // Footer text (inside printable area)
  doc.text(oneLine(footerLeft, 90), x, footerTextY, { width: w * 0.7, align: "left", lineBreak: false });
  doc.text(`${pageNumber}/${pageCount}`, x + w * 0.7, footerTextY, { width: w * 0.3, align: "right", lineBreak: false });

  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(false);
}

function removeTrailingBlankPages(doc, pageHasBodySet) {
  void doc;
  void pageHasBodySet;
}

/* =========================
   Helpers
========================= */

function renderTextWithBoldAndLists(doc, text, styles) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");

  for (const raw of lines) {
    let line = String(raw ?? "").trimEnd();

    // blank line => paragraph spacing
    if (!line.trim()) {
      doc.moveDown(0.6);
      continue;
    }

    // separator lines like "******" or "-----" => render a light divider
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      drawDivider(doc);
      continue;
    }

    // bullets "- " or "* " => bullet point
    if (/^\s*[-*]\s+/.test(line)) {
      line = "• " + line.replace(/^\s*[-*]\s+/, "");
    }

    // neutralize markdown headings (just in case)
    const noMd = line.replace(/^#{1,6}\s+/, "");

    // full line bold **...**
    const mFull = noMd.match(/^\*\*(.+?)\*\*\s*$/);
    if (mFull) {
      doc.font("Helvetica-Bold").fontSize(styles?.h2?.size || 12).text(String(mFull[1] || "").trim(), { align: "left" });
      doc.font("Helvetica").fontSize(styles?.body?.size || 10.5);
      continue;
    }

    // mixed bold segments
    const parts = [];
    let rest = noMd;
    while (rest.length) {
      const m = rest.match(/\*\*(.+?)\*\*/);
      if (!m) {
        parts.push({ t: rest, b: false });
        break;
      }
      const idx = m.index || 0;
      if (idx > 0) parts.push({ t: rest.slice(0, idx), b: false });
      parts.push({ t: m[1], b: true });
      rest = rest.slice(idx + m[0].length);
    }

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const isLast = i === parts.length - 1;
      doc.font(p.b ? "Helvetica-Bold" : "Helvetica");
      doc.text(String(p.t || ""), { continued: !isLast });
    }
    doc.text("");
    doc.font("Helvetica");
  }
}

function sanitizeFilename(name) {
  return String(name || "document")
    .trim()
    .slice(0, 90)
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function applyFont(doc, style = {}) {
  const font = style.font || "Helvetica";
  const size = typeof style.size === "number" ? style.size : 10;
  doc.font(font).fontSize(size);
  if (style.lineGap !== undefined) doc.lineGap(style.lineGap);
  return doc;
}

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function drawDivider(doc) {
  doc.moveDown(0.35);
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save();
  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeOpacity(0.15).stroke();
  doc.restore();
  doc.moveDown(0.7);
}

function getCurrentPageNumber(doc) {
  const r = doc.bufferedPageRange();
  return r.start + r.count;
}

function makeDots(left, right, max = 90) {
  const L = String(left || "").length;
  const R = String(right || "").length;
  const dots = Math.max(2, Math.min(max, 90 - L - R));
  return ".".repeat(dots);
}

// CRITICAL: header/footer MUST be 1 line.
// We also normalize whitespace to avoid weird long sequences.
function oneLine(text, maxChars) {
  const s = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

function renderNgoProjectPdf(doc, { title, ctx, sections }) {
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

  doc.__touch = __touch;
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

  renderCover(doc, title, ctx, styles);

  const tocPageIndex = doc.bufferedPageRange().count;
  doc.addPage();
  renderTOCPlaceholder(doc, styles);

  const toc = [];
  for (const s of safeSections) {
    const secTitle = (s?.title || "").trim() || s?.key || "Section";
    doc.addPage();

    const startPageNumber = getCurrentPageNumber(doc);
    toc.push({ title: secTitle, page: startPageNumber });

    renderSection(doc, secTitle, s, styles);
  }

  fillTOC(doc, tocPageIndex, toc, styles);

  renderAllHeadersFooters(doc, { headerLeft, footerLeft, styles });

  removeTrailingBlankPages(doc, __pageHasBody);

  // Do NOT call doc.end() here.
}