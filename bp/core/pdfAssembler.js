// business-plan-service/core/pdfAssembler.js
import PDFDocument from "pdfkit";

/**
 * PREMIUM PDF renderer:
 * - Cover page
 * - Real Table of Contents (with page numbers)
 * - Clean section layout + dividers
 * - Header/footer + page numbers
 * - Canvas + SWOT rendered as tables
 * - Financials rendered as modern tables (JSON) + auto-calculations:
 *   Gross Profit, EBITDA, Gross margin %, EBITDA margin %
 */
export function writeBusinessPlanPdfPremium({ res, title, ctx, sections }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sanitizeFilename(title)}.pdf"`
  );

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, left: 56, right: 56, bottom: 56 },
    bufferPages: true,
  });

  doc.pipe(res);

  // -----------------------------
  // Page tracking (ROBUST): mark page as "non-blank" ONLY when real text is written
  // -----------------------------
  let __pageIndex = 0;
  const __pageHasBody = new Set();
  const __touch = () => __pageHasBody.add(__pageIndex);

  // When true, doc.text() will NOT mark page as having body content (used for header/footer)
  let __suppressTouch = false;

  doc.on("pageAdded", () => {
    __pageIndex += 1;
  });

  // Wrap doc.text so we "touch" only when something is actually printed
  const __origText = doc.text.bind(doc);
  doc.text = function (...args) {
    const s = args?.[0];
    if (!__suppressTouch && s !== undefined && s !== null && String(s).trim().length > 0) {
      __touch();
    }
    return __origText(...args);
  };

  // expose for helpers (optional)
  doc.__touch = __touch;
  doc.__setSuppressTouch = (v) => { __suppressTouch = !!v; };
  const styles = {
    title: { font: "Helvetica-Bold", size: 22 },
    subtitle: { font: "Helvetica", size: 11 },
    h1: { font: "Helvetica-Bold", size: 16 },
    h2: { font: "Helvetica-Bold", size: 12 },
    body: { font: "Helvetica", size: 10.5, lineGap: 3.2 },
    small: { font: "Helvetica", size: 9, lineGap: 2.6 },
    mono: { font: "Courier", size: 9 },
  };

  const safeSections = Array.isArray(sections) ? sections : [];
  const company =
    String(ctx?.companyName || "Business Plan").trim() || "Business Plan";
  const footerText = `${company}`;

  // Helper: render headers/footers on all buffered pages (safe: no page breaks)
  function renderAllHeadersFooters() {
    const rangeHF = doc.bufferedPageRange();
    const pageCountHF = rangeHF.count;

    for (let i = rangeHF.start; i < rangeHF.start + rangeHF.count; i++) {
      doc.switchToPage(i);
      renderHeaderFooter(doc, {
        headerLeft: company,
        headerRight: "CONFIDENTIEL",
        footerLeft: footerText,
        pageNumber: i + 1,
        pageCount: pageCountHF,
        styles,
      });
    }
  }

  // 1) Cover
  renderCover(doc, title, ctx, styles);

  // 2) Reserve TOC page
  const tocPageIndex = doc.bufferedPageRange().count;
  doc.addPage();
  renderTOCPlaceholder(doc, styles);

  // 3) Render sections and collect TOC entries
  const toc = [];
  for (const s of safeSections) {
    const secTitle = (s?.title || "").trim() || s?.key || "Section";
    doc.addPage();
    // don't mark page as "has body" until we actually write something

    const startPageNumber = getCurrentPageNumber(doc);
    toc.push({ title: secTitle, page: startPageNumber });

    renderSection(doc, secTitle, s, styles);
  }

  // 4) Fill TOC page
  fillTOC(doc, tocPageIndex, toc, styles);

  // 5) Headers/footers (first pass)
  renderAllHeadersFooters();

  // 6) Remove trailing blank pages (even if they contain header/footer)
  // Header/footer drawing is suppressed from touching body content, so truly empty pages remain removable.
  removeTrailingBlankPages(doc, __pageHasBody);

  // 7) Enforce max pages (hard cap)
  enforceMaxPages(doc, 36);

  // 8) Headers/footers again to refresh correct pageCount after removals/cap
  renderAllHeadersFooters();

  doc.end();
}
/* =========================
   COVER
========================= */
function renderCover(doc, title, ctx, styles) {
  // Decorative border should NOT count as body content
  doc.save();
  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(true);
  doc
    .rect(36, 36, doc.page.width - 72, doc.page.height - 72)
    .lineWidth(1)
    .strokeOpacity(0.25)
    .stroke();
  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(false);
  doc.restore();

  doc.moveDown(2.2);
  applyFont(doc, styles.title).text(String(title || "Business Plan"), {
    align: "center",
  });

  doc.moveDown(0.7);
  const metaLine = [
    ctx?.sector ? `Secteur : ${ctx.sector}` : null,
    ctx?.country ? `Pays : ${ctx.country}` : null,
    ctx?.city ? `Villes : ${ctx.city}` : null,
    ctx?.audience ? `Audience : ${String(ctx.audience).toUpperCase()}` : null,
    ctx?.docType ? `Type : ${String(ctx.docType).toUpperCase()}` : null,
    ctx?.stage ? `Stade : ${ctx.stage}` : null,
  ]
    .filter(Boolean)
    .join("  •  ");

  applyFont(doc, styles.subtitle).text(metaLine, { align: "center" });

  doc.moveDown(2.2);
  doc.moveDown(0.3);
  applyFont(doc, styles.small).text(
    `Date : ${new Date().toLocaleDateString()}`,
    { align: "center" }
  );

  doc.moveDown(2.6);
  const disclaimer =
    "Note : Ce document est généré automatiquement à partir des informations fournies. " +
    "Toute décision d’investissement doit être fondée sur une analyse et une due diligence complètes.";
  applyFont(doc, styles.small).text(disclaimer, {
    align: "center",
    width: doc.page.width - 120,
  });
}

/* =========================
   TOC
========================= */
function renderTOCPlaceholder(doc, styles) {
  applyFont(doc, styles.h1).text("Table des matières", { align: "left" });
  doc.moveDown(1);
  applyFont(doc, styles.body).text("Génération en cours…", { align: "left" });
}

function fillTOC(doc, tocPageIndex, toc, styles) {
  doc.switchToPage(tocPageIndex);
  doc.x = 56;
  doc.y = 56;

  applyFont(doc, styles.h1).text("Table des matières", { align: "left" });
  doc.moveDown(1);

  const maxWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  applyFont(doc, styles.body);

  for (const item of toc) {
    const left = String(item.title || "").trim();
    const right = String(item.page || "");

    const leftWidth = doc.widthOfString(left, {
      font: "Helvetica",
      size: styles.body.size,
    });
    const rightWidth = doc.widthOfString(right, {
      font: "Helvetica",
      size: styles.body.size,
    });

    const xLeft = doc.page.margins.left;
    const xRight = doc.page.width - doc.page.margins.right - rightWidth;

    doc.text(left, xLeft, doc.y, { width: maxWidth });

    const dotsStart = xLeft + Math.min(leftWidth + 10, maxWidth * 0.75);
    const dotsEnd = xRight - 10;

    if (dotsEnd > dotsStart) {
      doc.save();
      doc.strokeOpacity(0.25);
      doc
        .moveTo(dotsStart, doc.y - 3)
        .lineTo(dotsEnd, doc.y - 3)
        .dash(1, { space: 2 })
        .stroke();
      doc.undash();
      doc.restore();
    }

    doc.text(right, xRight, doc.y - 12);
    doc.moveDown(0.35);

    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
    }
  }
}

/* =========================
   SECTION RENDERER
========================= */
function renderSection(doc, title, sectionObj, styles) {
  applyFont(doc, styles.h1).text(String(title || "Section"), {
    align: "left",
  });
  drawTitleDivider(doc);
  doc.moveDown(0.6);

  const key = String(sectionObj?.key || "").toLowerCase();
  const t = String(title || "").toLowerCase();

  // --- Financial tables ---
  if (key === "financials_json") {
    const fin = normalizeFinancialsSchema(sectionObj?.meta?.financials);
    if (fin) {
      renderFinancialTables(doc, fin, styles);
      doc.moveDown(0.6);
      renderFinancialCharts(doc, fin, styles);
    } else {
      applyFont(doc, styles.body).text(
        "⚠️ Financial JSON missing or invalid. Re-run generation.",
        { align: "left" }
      );
    }
    return;
  }

  // --- KPI Calendar / KPIs (JSON) ---
  if (key === "kpi_calendar_json") {
    renderKpiCalendarTables(doc, sectionObj?.meta?.kpiCalendar, styles);
    return;
  }

  // --- Canvas (prefer JSON meta.canvas; fallback to text extraction) ---
  if (key === "canvas_json" || t.includes("canvas")) {
    if (sectionObj?.meta?.canvas) {
      renderCanvasFromJson(doc, sectionObj.meta.canvas, styles);
    } else {
      const blocks = extractCanvasBlocks(sectionObj?.content || "");
      renderCanvasGrid(doc, blocks, styles);
    }
    return;
  }

  // --- SWOT (prefer JSON meta.swot; fallback to text extraction) ---
  if (key === "swot_json" || t.includes("swot")) {
    if (sectionObj?.meta?.swot) {
      renderSWOTFromJson(doc, sectionObj.meta.swot, styles);
    } else {
      const sw = extractSwotBlocks(sectionObj?.content || "");
      renderSWOTGrid(doc, sw, styles);
    }
    return;
  }

  // --- Default text section: clean markdown + render titles in bold ---
  renderRichText(doc, sectionObj?.content || "", styles);
}


function drawTitleDivider(doc) {
  const x1 = doc.page.margins.left;
  const x2 = doc.page.width - doc.page.margins.right;
  const y = doc.y + 6;

  doc.save();
  doc.strokeOpacity(0.18).lineWidth(1).moveTo(x1, y).lineTo(x2, y).stroke();

  doc.restore();
}

/* =========================
   HEADER / FOOTER
========================= */
function renderHeaderFooter(
  doc,
  { headerLeft, headerRight, footerLeft, pageNumber, pageCount, styles }
) {
  const topY = 22;
  const bottomY = doc.page.height - 28;

  // Preserve cursor so header/footer can't affect layout or trigger page breaks
  const prevX = doc.x;
  const prevY = doc.y;

  doc.save();

  // Header/footer should NOT mark a page as having body content
  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(true);

  // Header top rule
  doc
    .strokeOpacity(0.15)
    .moveTo(56, 40)
    .lineTo(doc.page.width - 56, 40)
    .stroke();

  applyFont(doc, styles.small);

  // Use fixed boxes + ellipsis to avoid wrapping and avoid any implicit page-add
  const headerW = doc.page.width - 112;
  doc.fillOpacity(0.85).text(String(headerLeft || ""), 56, topY, {
    width: headerW * 0.65,
    height: 12,
    ellipsis: true,
    lineBreak: false,
    align: "left",
  });
  doc.text(String(headerRight || ""), 56 + headerW * 0.65, topY, {
    width: headerW * 0.35,
    height: 12,
    ellipsis: true,
    lineBreak: false,
    align: "right",
  });

  // Footer bottom rule
  doc
    .strokeOpacity(0.15)
    .moveTo(56, doc.page.height - 42)
    .lineTo(doc.page.width - 56, doc.page.height - 42)
    .stroke();

  applyFont(doc, styles.small);

  doc.fillOpacity(0.85).text(String(footerLeft || ""), 56, bottomY, {
    width: headerW * 0.65,
    height: 12,
    ellipsis: true,
    lineBreak: false,
    align: "left",
  });
  doc.text(`Page ${pageNumber} / ${pageCount}`, 56 + headerW * 0.65, bottomY, {
    width: headerW * 0.35,
    height: 12,
    ellipsis: true,
    lineBreak: false,
    align: "right",
  });

  // Restore suppressTouch
  if (typeof doc.__setSuppressTouch === "function") doc.__setSuppressTouch(false);

  doc.restore();

  // Restore cursor
  doc.x = prevX;
  doc.y = prevY;
}

/* =========================
   MARKDOWN CLEANER + RICH TEXT
========================= */
function cleanMd(s) {
  return String(s || "")
    .replace(/\*\*\*\*/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/#+\s*/g, "")
    .replace(/`/g, "")
    .trim();
}

function renderRichText(doc, text, styles) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let blankStreak = 0;
  for (const raw of lines) {
    const line = cleanMd(raw).trim();
    if (!line) {
      blankStreak++;
      if (blankStreak <= 2) doc.moveDown(0.4);
      continue;
    }
    blankStreak = 0;
    const isTitle =
      line.endsWith(":") ||
      /^[0-9]+\.\s+/.test(line) ||
      /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ\s]{6,}$/.test(line);

    if (isTitle) {
      applyFont(doc, styles.h2).text(line.replace(/:$/, ""), { align: "left" });
      doc.moveDown(0.2);
    } else {
      applyFont(doc, styles.body).text(line, { align: "justify" });
    }
  }
}

function arrToBullets(v) {
  const a = Array.isArray(v) ? v : [];
  return a
    .map((x) => cleanMd(String(x || "")))
    .filter(Boolean)
    .map((x) => `• ${x}`)
    .join("\n");
}

/* =========================
   CANVAS / SWOT (FROM JSON)
========================= */
function renderCanvasFromJson(doc, canvas, styles) {
  const c = canvas || {};
  const blocks = {
    partners: arrToBullets(c.partenaires_cles || c.key_partners),
    activities: arrToBullets(c.activites_cles || c.key_activities),
    resources: arrToBullets(c.ressources_cles || c.key_resources),
    value: arrToBullets(c.propositions_de_valeur || c.value_propositions),
    relationships: arrToBullets(c.relations_clients || c.customer_relationships),
    channels: arrToBullets(c.canaux || c.channels),
    segments: arrToBullets(c.segments_clients || c.customer_segments),
    costs: arrToBullets(c.structure_de_couts || c.cost_structure),
    revenues: arrToBullets(c.sources_de_revenus || c.revenue_streams),
  };
  renderCanvasGrid(doc, blocks, styles);
}

function renderSWOTFromJson(doc, swot, styles) {
  const s = swot || {};
  const sw = {
    strengths: arrToBullets(s.forces || s.strengths),
    weaknesses: arrToBullets(s.faiblesses || s.weaknesses),
    opportunities: arrToBullets(s.opportunites || s.opportunities),
    threats: arrToBullets(s.menaces || s.threats),
    interpretation: cleanMd(String(s.interpretation || "")),
  };
  renderSWOTGrid(doc, sw, styles);
}

/* =========================
   KPI CALENDAR + KPIs (TABLES)
========================= */
function renderKpiCalendarTables(doc, data, styles) {
  const d = data || {};
  const cal = Array.isArray(d.calendrier || d.calendar) ? (d.calendrier || d.calendar) : [];
  const kpis = Array.isArray(d.kpis) ? d.kpis : [];

  applyFont(doc, styles.h2).text("Calendrier d’exécution", { align: "left" });
  doc.moveDown(0.3);

  renderSimpleTable(
    doc,
    {
      headers: ["Période", "Jalons", "Livrables", "Responsable"],
      colPercents: [0.16, 0.34, 0.34, 0.16],
      rows: cal.map((r) => [
        cleanMd(r.periode || r.period || ""),
        arrToBullets(r.jalons || r.milestones).replace(/^•\s?/gm, "• "),
        arrToBullets(r.livrables || r.deliverables).replace(/^•\s?/gm, "• "),
        cleanMd(r.responsable || r.owner || ""),
      ]),
    },
    styles
  );

  doc.moveDown(0.6);
  applyFont(doc, styles.h2).text("Indicateurs Clés de Performance (KPIs)", { align: "left" });
  doc.moveDown(0.3);

  renderSimpleTable(
    doc,
    {
      headers: ["KPI", "Définition", "Cible 12m", "Fréquence", "Responsable"],
      colPercents: [0.18, 0.34, 0.14, 0.14, 0.20],
      rows: kpis.map((r) => [
        cleanMd(r.kpi || ""),
        cleanMd(r.definition || ""),
        cleanMd(r.cible_12m || r.target_12m || ""),
        cleanMd(r.frequence || r.frequency || ""),
        cleanMd(r.responsable || r.owner || ""),
      ]),
    },
    styles
  );
}

function renderSimpleTable(doc, { headers, rows, colPercents }, styles) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Compute column widths and x positions (fix: colX/colWidths undefined)
  const perc = Array.isArray(colPercents) && colPercents.length
    ? colPercents
    : new Array((headers || []).length || 1).fill(1 / Math.max(1, (headers || []).length || 1));
  const colWidths = perc.map((p) => Math.max(40, Math.floor(w * Number(p || 0))));
  // Normalize last column to fill remaining width (avoid drift)
  const sumW = colWidths.reduce((a, b) => a + b, 0);
  if (sumW !== w && colWidths.length) colWidths[colWidths.length - 1] += (w - sumW);
  const colX = (i) => x + colWidths.slice(0, i).reduce((a, b) => a + b, 0);

  const paddingX = 6;
  const paddingY = 4;
  const headerH = 18;

  ensureSpace(doc, headerH + 10);
  const yH = doc.y;

  doc.save();
  doc.rect(x, yH, w, headerH).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.2 });
  (headers || []).forEach((h, i) => {
    doc.text(String(h || ""), colX(i) + paddingX, yH + 4, { width: colWidths[i] - 2 * paddingX });
  });

  doc.y = yH + headerH + 6;
  applyFont(doc, styles.small);

  for (const r of rows || []) {
    // calc row height based on tallest cell
    const cellHeights = (r || []).map((cell, i) => {
      const s = String(cell || "");
      return doc.heightOfString(s, { width: colWidths[i] - 2 * paddingX });
    });
    const rowH = Math.max(16, maxNum(cellHeights) + 2 * paddingY);

    ensureSpace(doc, rowH + 6);
    const y0 = doc.y;

    doc.save();
    doc.rect(x, y0 - 2, w, rowH).strokeOpacity(0.12).stroke();
    doc.restore();

    // IMPORTANT: PDFKit updates doc.y during text rendering.
    // If we draw multiple cells on the same row without resetting doc.y,
    // long wrapped text can drift the cursor and cause overlaps on next rows.
    for (let i = 0; i < (r || []).length; i++) {
      const s = String(r[i] || "");
      const cellX = colX(i) + paddingX;
      const cellY = y0 + paddingY;
      const cellW = colWidths[i] - 2 * paddingX;
      const cellH = rowH - 2 * paddingY;
      doc.text(s, cellX, cellY, {
        width: cellW,
        height: cellH,
        ellipsis: true,
      });
      // reset cursor for next cell in the same row
      doc.y = y0;
    }

    doc.y = y0 + rowH + 4;
  }
}

function maxNum(arr) {
  let m = 0;
  for (const v of arr || []) {
    const n = Number(v);
    if (Number.isFinite(n) && n > m) m = n;
  }
  return m;
}

/* =========================
   CANVAS (3x3)
========================= */
function renderCanvasGrid(doc, blocks, styles) {
  applyFont(doc, styles.h2).text("Business Model Canvas", { align: "left" });
  doc.moveDown(0.5);

  const x = doc.page.margins.left;
  const y = doc.y;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const gap = 8;
  const colW = (w - 2 * gap) / 3;

  const usableHeight = doc.page.height - doc.page.margins.bottom - y - 40;
  const rowH = Math.max(
    130,
    Math.min(160, Math.floor((usableHeight - 2 * gap) / 3))
  );

  drawCell(doc, x, y, colW, rowH, "Partenaires clés", blocks.partners, styles);
  drawCell(
    doc,
    x + colW + gap,
    y,
    colW,
    rowH,
    "Activités clés",
    blocks.activities,
    styles
  );
  drawCell(
    doc,
    x + 2 * (colW + gap),
    y,
    colW,
    rowH,
    "Segments clients",
    blocks.segments,
    styles
  );

  const y2 = y + rowH + gap;
  drawCell(doc, x, y2, colW, rowH, "Ressources clés", blocks.resources, styles);
  drawCell(
    doc,
    x + colW + gap,
    y2,
    colW,
    rowH,
    "Propositions de valeur",
    blocks.value,
    styles
  );
  drawCell(
    doc,
    x + 2 * (colW + gap),
    y2,
    colW,
    rowH,
    "Canaux",
    blocks.channels,
    styles
  );

  const y3 = y2 + rowH + gap;
  drawCell(
    doc,
    x,
    y3,
    colW,
    rowH,
    "Relations clients",
    blocks.relationships,
    styles
  );
  drawCell(
    doc,
    x + colW + gap,
    y3,
    colW,
    rowH,
    "Structure de coûts",
    blocks.costs,
    styles
  );
  drawCell(
    doc,
    x + 2 * (colW + gap),
    y3,
    colW,
    rowH,
    "Sources de revenus",
    blocks.revenues,
    styles
  );

  doc.y = y3 + rowH + 14;
}

/* =========================
   SWOT (2x2)
========================= */
function renderSWOTGrid(doc, sw, styles) {
  applyFont(doc, styles.h2).text("Analyse SWOT", { align: "left" });
  doc.moveDown(0.5);

  const x = doc.page.margins.left;
  const y = doc.y;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const gap = 10;
  const colW = (w - gap) / 2;
  const usableHeight = doc.page.height - doc.page.margins.bottom - y - 70;
  const rowH = Math.max(
    190,
    Math.min(240, Math.floor((usableHeight - gap) / 2))
  );

  drawCell(doc, x, y, colW, rowH, "Forces", sw.strengths, styles);
  drawCell(
    doc,
    x + colW + gap,
    y,
    colW,
    rowH,
    "Faiblesses",
    sw.weaknesses,
    styles
  );

  const y2 = y + rowH + gap;
  drawCell(doc, x, y2, colW, rowH, "Opportunités", sw.opportunities, styles);
  drawCell(
    doc,
    x + colW + gap,
    y2,
    colW,
    rowH,
    "Menaces",
    sw.threats,
    styles
  );

  doc.y = y2 + rowH + 14;

  if (sw.interpretation?.trim()) {
    applyFont(doc, styles.h2).text("Interprétation stratégique", {
      align: "left",
    });
    doc.moveDown(0.3);
    applyFont(doc, styles.body).text(normalizeText(sw.interpretation), {
      align: "justify",
    });
  }
}

/* =========================
   FINANCIAL TABLES (JSON) + AUTO CALCS
========================= */

function normalizeFinancialsSchema(fin) {
  if (!fin || typeof fin !== "object") return null;

  const years = ["Y1", "Y2", "Y3", "Y4", "Y5"];
  const currency = String(fin.currency || "USD").trim() || "USD";

  const normRow = (row, defaultFormat) => {
    const r = row && typeof row === "object" ? row : {};
    const out = { label: String(r.label || "").trim(), __format: String(r.__format || defaultFormat) };

    // Map any key that looks like a year to Y1..Y5
    for (const [k, v] of Object.entries(r)) {
      const y = normalizeYearKey(k);
      if (y) out[y] = parseNumber(v);
    }
    // If years provided are weird (e.g., "Year 1"), we still enforce Y1..Y5
    for (const y of years) {
      if (out[y] === undefined) out[y] = 0;
    }
    return out;
  };

  const normalizeTable = (arr, fmt) =>
    (Array.isArray(arr) ? arr : [])
      .map((r) => normRow(r, fmt))
      .filter((r) => r.label);

  const out = {
    currency,
    years,
    assumptions: Array.isArray(fin.assumptions) ? fin.assumptions : [],
    revenue_drivers: normalizeTable(fin.revenue_drivers, "number"),
    pnl: normalizeTable(fin.pnl, "money"),
    cashflow: normalizeTable(fin.cashflow, "money"),
    balance_sheet: normalizeTable(fin.balance_sheet, "money"),
    break_even: fin.break_even || { metric: "months", estimate: 0, explanation: "" },
    use_of_funds: Array.isArray(fin.use_of_funds) ? fin.use_of_funds : [],
    scenarios: Array.isArray(fin.scenarios) ? fin.scenarios : [],
  };

  // Ensure minimal rows exist
  ensureMinRow(out.pnl, "Revenue", years);
  ensureMinRow(out.pnl, "COGS", years);
  ensureMinRow(out.pnl, "OPEX", years);

  // If revenue is all zeros -> treat as invalid to force re-generation
  const rev = findRowByLabel(out.pnl, ["revenue", "ventes", "chiffre"]);
  const hasNonZero = rev ? years.some((y) => Number(rev[y] || 0) > 0) : false;
  if (!hasNonZero) return out; // keep but will show 0s; orchestrator should provide fallback
  return out;
}

function normalizeYearKey(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return null;
  let m = k.match(/^y\s*([1-9])$/);
  if (m) return `Y${m[1]}`;
  m = k.match(/^year\s*([1-9])$/);
  if (m) return `Y${m[1]}`;
  m = k.match(/^([1-9])$/);
  if (m) return `Y${m[1]}`;
  m = k.match(/^y\s*([1-9])\b/);
  if (m) return `Y${m[1]}`;
  m = k.match(/^year\s*([1-9])\b/);
  if (m) return `Y${m[1]}`;
  return null;
}

function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;

  const cleaned = s.replace(/[^\d,.\-]/g, "").replace(/\s+/g, "");
  let num = 0;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    num = Number(cleaned.replace(/,/g, ""));
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    const parts = cleaned.split(",");
    num = parts.length > 2 ? Number(parts.join("")) : Number(parts.join("."));
  } else {
    num = Number(cleaned);
  }
  return Number.isFinite(num) ? num : 0;
}

function ensureMinRow(rows, label, years) {
  const rr = Array.isArray(rows) ? rows : [];
  const exists = rr.some((r) => String(r?.label || "").toLowerCase() === String(label).toLowerCase());
  if (exists) return;
  const row = { label, __format: "money" };
  years.forEach((y) => (row[y] = 0));
  rr.push(row);
}

function findRowByLabel(rows, needles) {
  const rr = Array.isArray(rows) ? rows : [];
  const ns = (needles || []).map((n) => String(n).toLowerCase());
  for (const r of rr) {
    const label = String(r?.label || "").toLowerCase();
    if (ns.some((n) => label.includes(n))) return r;
  }
  return null;
}

function renderFinancialCharts(doc, fin, styles) {
  // Minimal integrated charts (revenues + EBITDA proxy + cashflow)
  const years = Array.isArray(fin?.years) ? fin.years : ["Y1", "Y2", "Y3", "Y4", "Y5"];
  const currency = String(fin?.currency || "USD");

  const rev = findRowByLabel(fin?.pnl, ["revenue", "ventes", "chiffre"]);
  const cogs = findRowByLabel(fin?.pnl, ["cogs", "cost", "coût", "cout"]);
  const opex = findRowByLabel(fin?.pnl, ["opex", "expenses", "charges"]);
  const op = findRowByLabel(fin?.cashflow, ["operating"]);

  const revenues = years.map((y) => Number(rev?.[y] || 0));
  const ebitda = years.map((y, i) => revenues[i] - Number(cogs?.[y] || 0) - Number(opex?.[y] || 0));
  const opcf = years.map((y) => Number(op?.[y] || 0));

  doc.moveDown(0.2);
  applyFont(doc, styles.h2).text("Graphiques financiers", { align: "left" });
  doc.moveDown(0.25);

  renderBarChart(doc, { title: `Revenus (${currency})`, labels: years, values: revenues }, styles);
  doc.moveDown(0.35);
  renderBarChart(doc, { title: `EBITDA (proxy) (${currency})`, labels: years, values: ebitda }, styles);
  doc.moveDown(0.35);
  renderBarChart(doc, { title: `Cashflow opérationnel (${currency})`, labels: years, values: opcf }, styles);
}

function renderBarChart(doc, { title, labels, values }, styles) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 140;

  ensureSpace(doc, h + 40);
  const y = doc.y;

  applyFont(doc, { font: "Helvetica-Bold", size: 10.5 });
  doc.text(String(title || ""), x, y, { width: w });

  const chartY = y + 18;
  const chartH = h;
  const chartX = x;
  const chartW = w;

  const vals = Array.isArray(values) ? values.map((v) => Number(v || 0)) : [];
  const maxV = Math.max(1, ...vals.map((v) => Math.abs(v)));

  // Axis
  doc.save();
  doc.strokeOpacity(0.25);
  doc.moveTo(chartX, chartY + chartH).lineTo(chartX + chartW, chartY + chartH).stroke();
  doc.restore();

  const n = Math.max(1, labels.length);
  const gap = 8;
  const barW = Math.max(10, (chartW - gap * (n - 1)) / n);

  applyFont(doc, { font: "Helvetica", size: 8.2 });

  for (let i = 0; i < n; i++) {
    const v = vals[i] || 0;
    const bh = Math.round((Math.abs(v) / maxV) * (chartH - 22));
    const bx = chartX + i * (barW + gap);
    const by = chartY + chartH - bh;

    doc.save();
    doc.fillOpacity(0.12);
    doc.rect(bx, by, barW, bh).fill("#000000");
    doc.restore();

    const lab = String(labels[i] || "");
    doc.text(lab, bx, chartY + chartH + 4, { width: barW, align: "center" });
  }

  doc.y = chartY + chartH + 18;
}

function renderFinancialTables(doc, fin, styles) {
  const currency = String(fin?.currency || "USD");
  const years = Array.isArray(fin?.years)
    ? fin.years
    : ["Y1", "Y2", "Y3", "Y4", "Y5"];

  // Clone arrays to avoid mutating original object
  const pnl = Array.isArray(fin?.pnl) ? fin.pnl.map((r) => ({ ...r })) : [];
  const cashflow = Array.isArray(fin?.cashflow)
    ? fin.cashflow.map((r) => ({ ...r }))
    : [];
  const balance = Array.isArray(fin?.balance_sheet)
    ? fin.balance_sheet.map((r) => ({ ...r }))
    : [];
  const drivers = Array.isArray(fin?.revenue_drivers)
    ? fin.revenue_drivers.map((r) => ({ ...r }))
    : [];

  // ✅ Add derived P&L rows if missing (Gross Profit, EBITDA, margins)
  const pnlEnriched = enrichPnlWithDerived({ years, pnl });

  applyFont(doc, styles.h2).text(`Finances (${currency})`, { align: "left" });
  doc.moveDown(0.25);

  renderKeyValueTable(
    doc,
    "Hypothèses clés",
    Array.isArray(fin?.assumptions) ? fin.assumptions : [],
    styles
  );

  renderYearTable(doc, "Drivers de revenus", years, drivers, styles, {
    defaultFormat: "number",
  });
  renderYearTable(doc, "Compte de résultat (P&L)", years, pnlEnriched, styles, {
    defaultFormat: "money",
  });
  renderYearTable(doc, "Cashflow", years, cashflow, styles, {
    defaultFormat: "money",
  });
  renderYearTable(doc, "Bilan simplifié", years, balance, styles, {
    defaultFormat: "money",
  });

  doc.moveDown(0.7);
  applyFont(doc, styles.h2).text("Point mort / Break-even");
  doc.moveDown(0.2);
  const beMetric = String(fin?.break_even?.metric || "mois");
  const beEst = Number.isFinite(Number(fin?.break_even?.estimate))
    ? Number(fin?.break_even?.estimate)
    : "—";
  const beExp = String(fin?.break_even?.explanation || "").trim();
  applyFont(doc, styles.body).text(`Estimation : ${beEst} ${beMetric}\n${beExp}`, {
    align: "justify",
  });

  renderUseOfFundsTable(
    doc,
    "Utilisation des fonds",
    Array.isArray(fin?.use_of_funds) ? fin.use_of_funds : [],
    styles,
    currency
  );

  doc.moveDown(0.7);
  applyFont(doc, styles.h2).text("Scénarios");
  doc.moveDown(0.25);
  const scenarios = Array.isArray(fin?.scenarios) ? fin.scenarios : [];
  applyFont(doc, styles.body).text(
    scenarios.length
      ? scenarios
          .map(
            (s) =>
              `• ${String(s.name || "").trim()}: ${String(s.note || "").trim()}`
          )
          .join("\n")
      : "• Base: —\n• Optimiste: —\n• Prudent: —",
    { align: "left" }
  );
}

function enrichPnlWithDerived({ years, pnl }) {
  const rows = Array.isArray(pnl) ? pnl : [];

  const idxRevenue = findRowIndex(rows, [
    "revenue",
    "chiffre d’affaires",
    "chiffre d'affaires",
    "ca",
    "ventes",
  ]);
  const idxCogs = findRowIndex(rows, [
    "cogs",
    "coût des ventes",
    "cout des ventes",
    "coûts des ventes",
    "couts des ventes",
    "cost of goods",
    "costs of goods",
  ]);
  const idxOpex = findRowIndex(rows, [
    "opex",
    "charges opérationnelles",
    "charges operationnelles",
    "frais opérationnels",
    "frais operationnels",
    "sales+admin+ops",
    "vente+admin+ops",
  ]);

  const revenue = idxRevenue >= 0 ? rows[idxRevenue] : null;
  const cogs = idxCogs >= 0 ? rows[idxCogs] : null;
  const opex = idxOpex >= 0 ? rows[idxOpex] : null;

  // 1) Gross Profit (Marge brute)
  let idxGP = findRowIndex(rows, ["gross profit", "marge brute"]);
  let grossProfitRow = idxGP >= 0 ? rows[idxGP] : null;

  if (!grossProfitRow && revenue && cogs) {
    grossProfitRow = { label: "Marge brute", __format: "money" };
    for (const y of years) {
      grossProfitRow[y] = toNum(revenue[y]) - toNum(cogs[y]);
    }
    const insertAt = idxCogs >= 0 ? idxCogs + 1 : idxRevenue + 1;
    rows.splice(Math.max(0, insertAt), 0, grossProfitRow);
  }

  // If exists but empty/zeros => fill best effort
  idxGP = findRowIndex(rows, ["gross profit", "marge brute"]);
  grossProfitRow = idxGP >= 0 ? rows[idxGP] : grossProfitRow;

  if (grossProfitRow && revenue && cogs) {
    grossProfitRow.__format = "money";
    for (const y of years) {
      const v = grossProfitRow[y];
      if (v === 0 || v === null || v === undefined || v === "") {
        grossProfitRow[y] = toNum(revenue[y]) - toNum(cogs[y]);
      }
    }
  }

  // 2) EBITDA
  let idxEBITDA = findRowIndex(rows, ["ebitda"]);
  let ebitdaRow = idxEBITDA >= 0 ? rows[idxEBITDA] : null;

  if (!ebitdaRow && grossProfitRow && opex) {
    ebitdaRow = { label: "EBITDA", __format: "money" };
    for (const y of years) {
      ebitdaRow[y] = toNum(grossProfitRow[y]) - toNum(opex[y]);
    }
    const idxOpexNow = findRowIndex(rows, [
      "opex",
      "charges",
      "frais",
      "sales+admin+ops",
      "vente+admin+ops",
    ]);
    const insertAt = idxOpexNow >= 0 ? idxOpexNow + 1 : rows.length;
    rows.splice(Math.max(0, insertAt), 0, ebitdaRow);
  }

  idxEBITDA = findRowIndex(rows, ["ebitda"]);
  ebitdaRow = idxEBITDA >= 0 ? rows[idxEBITDA] : ebitdaRow;

  if (ebitdaRow && grossProfitRow && opex) {
    ebitdaRow.__format = "money";
    for (const y of years) {
      const v = ebitdaRow[y];
      if (v === 0 || v === null || v === undefined || v === "") {
        ebitdaRow[y] = toNum(grossProfitRow[y]) - toNum(opex[y]);
      }
    }
  }

  // 3) Gross margin %
  if (
    revenue &&
    grossProfitRow &&
    findRowIndex(rows, ["gross margin", "marge brute %", "marge brute%"]) < 0
  ) {
    const gm = { label: "Marge brute %", __format: "percent" };
    for (const y of years) {
      const rev = toNum(revenue[y]);
      const gp = toNum(grossProfitRow[y]);
      gm[y] = rev > 0 ? (gp / rev) * 100 : 0;
    }
    const idxGPNow = findRowIndex(rows, ["gross profit", "marge brute"]);
    rows.splice(Math.max(0, idxGPNow + 1), 0, gm);
  }

  // 4) EBITDA margin %
  if (
    revenue &&
    ebitdaRow &&
    findRowIndex(rows, ["ebitda margin", "ebitda %", "ebitda%"]) < 0
  ) {
    const em = { label: "EBITDA margin %", __format: "percent" };
    for (const y of years) {
      const rev = toNum(revenue[y]);
      const eb = toNum(ebitdaRow[y]);
      em[y] = rev > 0 ? (eb / rev) * 100 : 0;
    }
    const idxENow = findRowIndex(rows, ["ebitda"]);
    rows.splice(Math.max(0, idxENow + 1), 0, em);
  }

  // Default formats
  for (const r of rows) {
    if (!r.__format) r.__format = "money";
  }

  return rows;
}

function findRowIndex(rows, patterns) {
  const pats = (patterns || []).map((p) => String(p).toLowerCase());
  for (let i = 0; i < rows.length; i++) {
    const label = String(rows[i]?.label || "").toLowerCase();
    if (!label) continue;
    if (pats.some((p) => label.includes(p))) return i;
  }
  return -1;
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/* =========================
   TABLE HELPERS (MODERN)
========================= */
function drawCell(doc, x, y, w, h, title, text, styles) {
  doc.save();

  doc.rect(x, y, w, h).lineWidth(1).strokeOpacity(0.2).stroke();

  doc.save();
  doc.rect(x, y, w, 20).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.5 });
  doc.fillOpacity(1).text(String(title || ""), x + 8, y + 5, {
    width: w - 16,
    align: "left",
  });

  applyFont(doc, styles.small);
  const bodyText = normalizeBullets(text || "");
  doc.text(bodyText, x + 8, y + 28, {
    width: w - 16,
    height: h - 34,
    align: "left",
  });

  doc.restore();
}

function renderKeyValueTable(doc, title, rows, styles) {
  doc.moveDown(0.7);
  applyFont(doc, styles.h2).text(title);
  doc.moveDown(0.25);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const yH = doc.y;
  doc.save();
  doc.rect(x, yH, w, 18).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.2 });
  doc.text("Indicateur", x + 8, yH + 4, { width: w * 0.55 - 10 });
  doc.text("Valeur", x + 8 + w * 0.55, yH + 4, { width: w * 0.45 - 10 });

  doc.moveDown(1.1);
  applyFont(doc, styles.small);

  for (const r of rows || []) {
    ensureSpace(doc, 28);
    const label = String(r?.label || "").trim();
    const value = String(r?.value || "").trim();

    const y0 = doc.y;
    doc.save();
    doc.rect(x, y0 - 2, w, 16).strokeOpacity(0.12).stroke();
    doc.restore();

    doc.text(label, x + 8, y0 + 2, { width: w * 0.55 - 10 });
    doc.text(value, x + 8 + w * 0.55, y0 + 2, { width: w * 0.45 - 10 });

    doc.moveDown(1.05);
  }
}

function renderYearTable(doc, title, years, rows, styles, opts = {}) {
  const defaultFormat = opts.defaultFormat || "money"; // money|number|percent

  doc.moveDown(0.8);
  applyFont(doc, styles.h2).text(title);
  doc.moveDown(0.25);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const col0 = w * 0.40;
  const colW = (w - col0) / Math.max(1, years.length);

  const yH = doc.y;
  doc.save();
  doc.rect(x, yH, w, 18).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.2 });
  doc.text("Ligne", x + 8, yH + 4, { width: col0 - 10 });

  years.forEach((yy, i) => {
    doc.text(String(yy), x + col0 + i * colW, yH + 4, {
      width: colW,
      align: "right",
    });
  });

  doc.moveDown(1.1);
  applyFont(doc, styles.small);

  for (const r of rows || []) {
    ensureSpace(doc, 28);
    const y0 = doc.y;

    doc.save();
    doc.rect(x, y0 - 2, w, 16).strokeOpacity(0.12).stroke();
    doc.restore();

    const label = String(r?.label || "");
    doc.text(label, x + 8, y0 + 2, { width: col0 - 10 });

    const fmt = String(r?.__format || defaultFormat);
    years.forEach((yy, i) => {
      const v = r?.[yy];
      const rendered =
        fmt === "percent"
          ? formatPercent(v)
          : fmt === "number"
          ? formatNumber(v)
          : formatMoney(v);

      doc.text(rendered, x + col0 + i * colW, y0 + 2, {
        width: colW,
        align: "right",
      });
    });

    doc.moveDown(1.05);
  }
}

function renderUseOfFundsTable(doc, title, rows, styles, currency = "USD") {
  doc.moveDown(0.8);
  applyFont(doc, styles.h2).text(`${title} (${currency})`);
  doc.moveDown(0.25);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const colA = w * 0.45;
  const colB = w * 0.20;
  const colC = w * 0.35;

  const yH = doc.y;
  doc.save();
  doc.rect(x, yH, w, 18).fillOpacity(0.06).fill("#000000");
  doc.restore();

  applyFont(doc, { font: "Helvetica-Bold", size: 9.2 });
  doc.text("Poste", x + 8, yH + 4, { width: colA - 10 });
  doc.text("Montant", x + colA, yH + 4, { width: colB - 10, align: "right" });
  doc.text("Notes", x + colA + colB + 8, yH + 4, { width: colC - 16 });

  doc.moveDown(1.1);
  applyFont(doc, styles.small);

  let total = 0;

  for (const r of rows || []) {
    ensureSpace(doc, 40);

    const label = String(r?.label || "").trim();
    const amt = Number(r?.amount || 0);
    const notes = String(r?.notes || "").trim();

    if (Number.isFinite(amt)) total += amt;

    const y0 = doc.y;
    doc.save();
    doc.rect(x, y0 - 2, w, 16).strokeOpacity(0.12).stroke();
    doc.restore();

    doc.text(label, x + 8, y0 + 2, { width: colA - 10 });
    doc.text(formatMoney(amt), x + colA, y0 + 2, {
      width: colB - 10,
      align: "right",
    });
    doc.text(notes, x + colA + colB + 8, y0 + 2, { width: colC - 16 });

    doc.moveDown(1.05);
  }

  doc.moveDown(0.2);
  applyFont(doc, { font: "Helvetica-Bold", size: 10 });
  doc.text(`Total: ${formatMoney(total)}`, x, doc.y, { width: w, align: "right" });
}

/* =========================
   EXTRACTORS
========================= */
function extractCanvasBlocks(content) {
  const txt = String(content || "").replace(/\r/g, "");

  function pick(labelFr, labelEn) {
    const re = new RegExp(
      `(${escapeReg(labelFr)}|${escapeReg(labelEn)})\\s*[:\\n]([\\s\\S]*?)(?=\\n\\s*(Forces|Strengths|Faiblesses|Weaknesses|Opportunités|Opportunities|Menaces|Threats|Interprétation|Interpretation|\\d+\\.?\\s*[A-Za-zÀ-ÿ].{0,40}[:\\n])|$)`,
      "i"
    );
    const m = txt.match(re);
    return m ? String(m[2] || "").trim() : "";
  }

  return {
    partners: pick("Partenaires clés", "Key Partners") || txt,
    activities: pick("Activités clés", "Key Activities"),
    resources: pick("Ressources clés", "Key Resources"),
    value: pick("Propositions de valeur", "Value Propositions"),
    relationships: pick("Relations clients", "Customer Relationships"),
    channels: pick("Canaux", "Channels"),
    segments: pick("Segments de clients", "Customer Segments"),
    costs: pick("Structure de coûts", "Cost Structure"),
    revenues: pick("Sources de revenus", "Revenue Streams"),
  };
}

function extractSwotBlocks(content) {
  const txt = String(content || "").replace(/\r/g, "");

  const strengths = pickSwot(txt, ["Forces", "Strengths"]);
  const weaknesses = pickSwot(txt, ["Faiblesses", "Weaknesses"]);
  const opportunities = pickSwot(txt, ["Opportunités", "Opportunities"]);
  const threats = pickSwot(txt, ["Menaces", "Threats"]);
  const interpretation = pickGeneric(txt, [
    "Interprétation",
    "Strategic interpretation",
    "Interpretation",
  ]);

  return { strengths, weaknesses, opportunities, threats, interpretation };
}

function pickSwot(txt, labels) {
  for (const lb of labels) {
    const re = new RegExp(
      `${escapeReg(lb)}\\s*[:\\n]([\\s\\S]*?)(?=\\n\\s*(Forces|Strengths|Faiblesses|Weaknesses|Opportunités|Opportunities|Menaces|Threats|Interprétation|Interpretation)\\s*[:\\n]|$)`,
      "i"
    );
    const m = txt.match(re);
    if (m && m[1]) return String(m[1]).trim();
  }
  return "";
}

function pickGeneric(txt, labels) {
  for (const lb of labels) {
    const re = new RegExp(`${escapeReg(lb)}\\s*[:\\n]([\\s\\S]*?)$`, "i");
    const m = txt.match(re);
    if (m && m[1]) return String(m[1]).trim();
  }
  return "";
}

/* =========================
   UTILS
========================= */
function applyFont(doc, st) {
  // IMPORTANT: do NOT "touch" page here.
  // Page will be marked as non-blank only when doc.text() prints real content.
  doc.font(st.font).fontSize(st.size);
  if (typeof st.lineGap === "number") doc.lineGap(st.lineGap);
  return doc;
}
function normalizeText(s) {
  return String(s || "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeBullets(s) {
  const t = cleanMd(normalizeText(s));
  if (!t) return "";
  return t
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line.startsWith("•") || line.startsWith("-")
        ? line.replace(/^-+\s*/, "• ")
        : `• ${line}`
    )
    .join("\n");
}

function formatMoney(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function formatNumber(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function formatPercent(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "—";
  const val = Math.round(n * 10) / 10; // 1 decimal in PDF for readability
  return `${val.toLocaleString("en-US")}%`;
}

function ensureSpace(doc, neededPx = 28) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededPx > bottomLimit) {
    doc.addPage();
    // keep cursor consistent after page break
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
  }
}

function getCurrentPageNumber(doc) {
  const range = doc.bufferedPageRange();
  return range.start + range.count; // 1-based
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function removeTrailingBlankPages(doc, pageHasBody) {
  try {
    const range = doc.bufferedPageRange();
    const last = range.start + range.count - 1;
    if (!pageHasBody || pageHasBody.size === 0) return;

    const lastBody = Math.max(...Array.from(pageHasBody.values()));
    if (!Number.isFinite(lastBody)) return;
    if (lastBody >= last) return;

    // Remove pages from the end down to lastBody+1
    for (let i = last; i > lastBody; i--) {
      try {
        doc.removePage(i);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore
  }
}

function enforceMaxPages(doc, maxPages = 36) {
  try {
    const range = doc.bufferedPageRange();
    const start = range.start;
    let count = range.count;

    if (!Number.isFinite(maxPages) || maxPages <= 0) return;
    if (count <= maxPages) return;

    // Remove pages from the end to respect the cap
    for (let i = start + count - 1; i >= start + maxPages; i--) {
      try {
        doc.removePage(i);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore
  }
}

function sanitizeFilename(name) {
  return String(name || "business_plan")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 60);
}

// ===== Improved Financial Charts (Line Charts) =====
function renderLineChart(doc, { title, labels, values }, styles) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 160;

  doc.text(title, x, doc.y);
  const chartY = doc.y + 15;

  const max = Math.max(...values, 1);
  const stepX = w / (labels.length - 1);

  doc.moveTo(x, chartY + h).lineTo(x + w, chartY + h).stroke();

  values.forEach((v, i) => {
    const px = x + i * stepX;
    const py = chartY + h - (v / max) * h;
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
    doc.circle(px, py, 2).fill();
  });

  doc.stroke();
  doc.moveDown(2);
}


// =========================
// ASYNC JOB SUPPORT: build PDF as Buffer (no HTTP response needed)
// =========================
// This helper lets the backend generate the PDF fully in-memory for /jobs/:id/download
// without keeping the original HTTP request open.
export async function buildBusinessPlanPdfPremiumBuffer({ title, ctx, sections }) {
  return new Promise((resolve, reject) => {
    try {
      const pass = new PassThrough();
      // writeBusinessPlanPdfPremium expects an Express-like response with setHeader()
      pass.setHeader = () => {};

      const chunks = [];
      pass.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      pass.on("error", reject);
      pass.on("end", () => resolve(Buffer.concat(chunks)));

      writeBusinessPlanPdfPremium({ res: pass, title, ctx, sections });
    } catch (e) {
      reject(e);
    }
  });
}
