// Shared helpers: detect numeric facts already present in generated content
// and render them as tables/charts without inventing assumptions.

function safeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function stripMarkdown(value) {
  return safeText(value)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/[`*_>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  const raw = safeText(value)
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSentence(sentence) {
  const clean = stripMarkdown(sentence);
  if (clean.length <= 150) return clean;
  return `${clean.slice(0, 147).trimEnd()}...`;
}

function isProbablyOnlyYear(sentence, matches) {
  const hasUnit = /%|usd|cdf|fc|eur|\$|dollar|franc|mois|jour|semaine|employ|client|revenu|cout|co[uû]t|budget|montant|taux|part|volume|kg|tonne|hectare|ha/i.test(
    sentence
  );
  if (hasUnit) return false;

  const numbers = matches.map((match) => parseNumber(match)).filter((n) => n !== null);
  return numbers.length > 0 && numbers.every((n) => n >= 1900 && n <= 2100);
}

function detectUnit(sentence) {
  if (/%/.test(sentence)) return "%";
  if (/\bUSD\b|\$|dollar/i.test(sentence)) return "USD";
  if (/\bCDF\b|\bFC\b|franc/i.test(sentence)) return "CDF";
  if (/\bEUR\b|euro/i.test(sentence)) return "EUR";
  if (/mois/i.test(sentence)) return "mois";
  if (/jour/i.test(sentence)) return "jours";
  if (/semaine/i.test(sentence)) return "semaines";
  if (/employ|emploi|agent|personne/i.test(sentence)) return "personnes";
  return "";
}

export function extractNumericFactsFromSections(sections, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 10), 20));
  const sourceSections = Array.isArray(sections) ? sections : [];
  const facts = [];
  const seen = new Set();

  for (const section of sourceSections) {
    const sectionTitle = stripMarkdown(section?.title || section?.key || "Section");
    const content = [section?.content, section?.text, section?.summary, section?.description, section?.meta]
      .map(safeText)
      .filter(Boolean)
      .join(" ");

    const sentences = stripMarkdown(content)
      .split(/(?<=[.!?;:])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12);

    for (const sentence of sentences) {
      const matches = sentence.match(/(?:\d[\d\s.,]*)(?:\s?%|\s?(?:USD|CDF|FC|EUR|\$))?/gi) || [];
      if (!matches.length || isProbablyOnlyYear(sentence, matches)) continue;

      const numericValue = parseNumber(matches[0]);
      if (numericValue === null) continue;

      const unit = detectUnit(sentence);
      const value = `${matches[0].trim()}${unit && !matches[0].toLowerCase().includes(unit.toLowerCase()) ? ` ${unit}` : ""}`;
      const label = normalizeSentence(sentence);
      const key = `${sectionTitle}|${label}|${value}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      facts.push({
        section: sectionTitle || "Section",
        label,
        value,
        numericValue: Math.abs(numericValue),
        unit,
      });

      if (facts.length >= limit) return facts;
    }
  }

  return facts;
}

export function renderNumericIllustrationsPdf(doc, facts, options = {}) {
  const rows = Array.isArray(facts) ? facts.filter(Boolean) : [];
  if (!rows.length) return;

  const font = options.font || "Helvetica";
  const boldFont = options.boldFont || "Helvetica-Bold";
  const accent = options.accent || "#0f766e";
  const title = options.title || "Synthese chiffree et illustrations";

  ensureSpace(doc, 135);
  doc.moveDown(0.4);
  doc.font(boldFont).fontSize(14).fillColor("#111827").text(title);
  doc.moveDown(0.25);
  doc
    .font(font)
    .fontSize(9)
    .fillColor("#475569")
    .text(
      "Tableau et graphique generes uniquement a partir des donnees chiffrees detectees dans le document. Les valeurs absentes ne sont pas inventees.",
      { lineGap: 2 }
    );
  doc.moveDown(0.6);

  renderFactsTable(doc, rows.slice(0, 8), { font, boldFont, accent });
  renderFactsBars(doc, rows.slice(0, 6), { font, boldFont, accent });
  doc.fillColor("#111827").font(font);
}

export function buildNumericIllustrationHtml(facts, options = {}) {
  const rows = Array.isArray(facts) ? facts.filter(Boolean) : [];
  if (!rows.length) return "";

  const title = escapeHtml(options.title || "Synthese chiffree et illustrations");
  const max = Math.max(...rows.map((fact) => Number(fact.numericValue || 0)), 1);
  const tableRows = rows
    .slice(0, 10)
    .map(
      (fact) => `<tr>
        <td>${escapeHtml(fact.section || "Section")}</td>
        <td>${escapeHtml(fact.label || "")}</td>
        <td><strong>${escapeHtml(fact.value || "")}</strong></td>
      </tr>`
    )
    .join("");

  const bars = rows
    .slice(0, 6)
    .map((fact) => {
      const width = Math.max(8, Math.round((Number(fact.numericValue || 0) / max) * 100));
      return `<div class="numeric-bar-row">
        <div class="numeric-bar-label">${escapeHtml(fact.section || "Section")}</div>
        <div class="numeric-bar-track"><div class="numeric-bar-fill" style="width:${width}%"></div></div>
        <div class="numeric-bar-value">${escapeHtml(fact.value || "")}</div>
      </div>`;
    })
    .join("");

  return `<section class="numeric-illustrations">
    <h2>${title}</h2>
    <p class="note">Ces illustrations reprennent uniquement les donnees chiffrees presentes dans le document. Aucune hypothese manquante n'est inventee.</p>
    <table>
      <tr><th>Section</th><th>Donnee chiffree detectee</th><th>Valeur</th></tr>
      ${tableRows}
    </table>
    <div class="numeric-chart">${bars}</div>
  </section>`;
}

function renderFactsTable(doc, rows, { font, boldFont, accent }) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = [0.25 * w, 0.55 * w, 0.2 * w];
  const headerH = 22;

  ensureSpace(doc, headerH + 30);
  const y = doc.y;
  doc.save();
  doc.rect(x, y, w, headerH).fillOpacity(0.1).fill(accent);
  doc.restore();

  doc.font(boldFont).fontSize(8.5).fillColor("#0f172a");
  ["Section", "Donnee chiffree", "Valeur"].forEach((header, index) => {
    const cx = x + widths.slice(0, index).reduce((sum, value) => sum + value, 0);
    doc.text(header, cx + 5, y + 6, { width: widths[index] - 10, lineBreak: false });
  });
  doc.y = y + headerH + 2;

  doc.font(font).fontSize(8.2).fillColor("#1f2937");
  for (const row of rows) {
    const values = [row.section, row.label, row.value].map((v) => safeText(v));
    const heights = values.map((value, index) => doc.heightOfString(value, { width: widths[index] - 10 }));
    const rowH = Math.max(30, Math.min(82, Math.max(...heights) + 12));
    ensureSpace(doc, rowH + 4);

    const ry = doc.y;
    doc.save();
    doc.rect(x, ry, w, rowH).strokeOpacity(0.18).stroke("#64748b");
    doc.restore();

    let cx = x;
    values.forEach((value, index) => {
      doc.text(value, cx + 5, ry + 6, { width: widths[index] - 10, height: rowH - 10 });
      cx += widths[index];
    });
    doc.y = ry + rowH + 2;
  }
}

function renderFactsBars(doc, rows, { font, boldFont, accent }) {
  const chartRows = rows.filter((row) => Number(row.numericValue || 0) > 0);
  if (!chartRows.length) return;

  ensureSpace(doc, 110);
  doc.moveDown(0.8);
  doc.font(boldFont).fontSize(11).fillColor("#111827").text("Vue graphique des principales valeurs");
  doc.moveDown(0.35);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelW = Math.min(170, w * 0.35);
  const valueW = 82;
  const barW = w - labelW - valueW - 16;
  const max = Math.max(...chartRows.map((row) => Number(row.numericValue || 0)), 1);

  doc.font(font).fontSize(8.5);
  for (const row of chartRows) {
    ensureSpace(doc, 24);
    const y = doc.y;
    const fillW = Math.max(6, Math.round((Number(row.numericValue || 0) / max) * barW));
    doc.fillColor("#334155").text(row.section || "Section", x, y, { width: labelW, lineBreak: false });
    doc.save();
    doc.roundedRect(x + labelW + 8, y + 2, barW, 10, 5).fillOpacity(0.08).fill("#0f172a");
    doc.roundedRect(x + labelW + 8, y + 2, fillW, 10, 5).fillOpacity(0.82).fill(accent);
    doc.restore();
    doc.fillColor("#0f172a").text(row.value || "", x + labelW + 12 + barW, y, { width: valueW, lineBreak: false });
    doc.y = y + 20;
  }
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
