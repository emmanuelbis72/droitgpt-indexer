// academicPdfAssembler.js
import PDFDocument from "pdfkit";

/**
 * =========================================================
 * DroitGPT — Academic PDF Assembler (Mémoire)
 * =========================================================
 * But: éviter les pages blanches numérotées.
 * ✅ On NE force PAS 70 pages au niveau PDF. On imprime le contenu réellement généré.
 * ✅ Les 70 pages sont atteintes par la génération (orchestrator).
 *
 * Exports attendus par routes:
 * - writeLicenceMemoirePdf({ res, title, ctx, plan, sections })
 */

function safeText(v) {
  return String(v || "");
}

function safeFileName(s) {
  return String(s || "memoire")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

// Rendu: ligne entièrement en **...** => gras
function renderTextWithBold(doc, text, opts = {}) {
  const lines = safeText(text).split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      doc.moveDown(0.5);
      continue;
    }

    // Neutraliser markdown headings
    const noMd = line.replace(/^#{1,6}\s+/, "");

    // full bold
    const mFull = noMd.match(/^\*\*(.+?)\*\*\s*$/);
    if (mFull) {
      doc.font("Times-Bold").text(mFull[1], opts);
      doc.font("Times-Roman");
      continue;
    }

    // mixed **...**
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
      doc.font(p.b ? "Times-Bold" : "Times-Roman");
      doc.text(p.t, { ...opts, continued: !isLast });
    }
    doc.text("");
    doc.font("Times-Roman");
  }
}

function addFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNumber = i + 1;
    doc.font("Times-Roman").fontSize(9);

    const bottom = doc.page.margins.bottom;
    const y = doc.page.height - 30; // keep inside page to avoid blank extra pages
    doc.text(String(pageNumber), 0, y, { align: "center" });
  }
}

export function writeLicenceMemoirePdf({ res, title, ctx, plan, sections }) {
  if (!res) throw new Error("writeLicenceMemoirePdf: res is required");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(title)}.pdf"`);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, left: 64, right: 64, bottom: 56 },
    bufferPages: true,
  });

  doc.pipe(res);

  const c = ctx || {};

  // Cover
  doc.font("Times-Bold").fontSize(16).text("MÉMOIRE DE LICENCE", { align: "center" });
  doc.moveDown(0.6);
  doc.font("Times-Roman").fontSize(11);
  if (c.university) doc.text(c.university, { align: "center" });
  if (c.faculty) doc.text(c.faculty, { align: "center" });
  if (c.department) doc.text(c.department, { align: "center" });
  doc.moveDown(1.0);
  doc.font("Times-Bold").fontSize(14).text(title || "Mémoire", { align: "center" });
  doc.moveDown(1.2);
  doc.font("Times-Roman").fontSize(11);
  if (c.studentName) doc.text(`Étudiant : ${c.studentName}`, { align: "center" });
  if (c.supervisorName) doc.text(`Encadreur : ${c.supervisorName}`, { align: "center" });
  if (c.academicYear) doc.text(`Année académique : ${c.academicYear}`, { align: "center" });

  doc.addPage();

  // Plan
  doc.font("Times-Bold").fontSize(14).text("PLAN", { align: "left" });
  doc.moveDown(0.6);
  doc.font("Times-Roman").fontSize(11);
  renderTextWithBold(doc, safeText(plan).trim() || "—", { align: "left" });

  // Sections (filter empties)
  const secs = Array.isArray(sections) ? sections : [];
  const filtered = secs.filter((s) => String(s?.title || "").trim() || String(s?.content || "").trim());

  for (const s of filtered) {
    doc.addPage();
    doc.font("Times-Bold").fontSize(13).text(safeText(s.title || "Section").trim(), { align: "left" });
    doc.moveDown(0.5);

    doc.font("Times-Roman").fontSize(11);
    const content = safeText(s.content).trim();

    const split = content.split(/\n\s*(?:NOTES DE BAS DE PAGE|NOTES \(FOOTNOTES\))\s*\n/i);
    const mainText = split[0] || "";
    const notesText = split.slice(1).join("\n").trim();

    if (!mainText.trim() && !notesText) {
      doc.text("(Section vide : relancer la génération.)", { align: "left" });
    } else {
      renderTextWithBold(doc, mainText, { align: "justify" });
    }

    if (notesText) {
      doc.moveDown(0.8);
      doc.font("Times-Bold").fontSize(10).text("NOTES DE BAS DE PAGE", { align: "left" });
      doc.moveDown(0.3);
      doc.font("Times-Roman").fontSize(9);
      renderTextWithBold(doc, notesText, { align: "left" });
    }
  }

  // SourcesUsed optional
  if (c?.mode === "droit_congolais" && Array.isArray(c?.sourcesUsed) && c.sourcesUsed.length) {
    doc.addPage();
    doc.font("Times-Bold").fontSize(12).text("SOURCES UTILISÉES (RAG)", { align: "left" });
    doc.moveDown(0.4);
    doc.font("Times-Roman").fontSize(9);
    c.sourcesUsed.slice(0, 80).forEach((s, i) => {
      const t = s?.title || s?.source || "Source";
      const a = s?.author ? ` — ${s.author}` : "";
      const y = s?.year ? `, ${s.year}` : "";
      doc.text(`• ${t}${a}${y}`);
      doc.moveDown(0.1);
    });
  }

  addFooter(doc);
  doc.end();
}
