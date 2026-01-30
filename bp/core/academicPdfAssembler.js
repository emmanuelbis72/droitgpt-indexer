// academicPdfAssembler.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * =========================================================
 * DroitGPT — Academic PDF Assembler (Mémoire)
 * =========================================================
 * ✅ Compatibilité: le routeur attend `writeLicenceMemoirePdf({ res, title, ctx, plan, sections })`
 * ✅ Sortie: PDF (stream) par défaut
 * ✅ Notes de bas de page visibles par défaut (bloc "NOTES DE BAS DE PAGE")
 * ✅ Titres/sous-titres en gras via marqueurs **...**
 */

function safeText(v) {
  return String(v || "");
}

// Détection simple: une ligne " **TITRE** " => rendu en gras
function renderTextWithBold(doc, text, opts = {}) {
  const lines = safeText(text).split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      doc.moveDown(0.5);
      continue;
    }

    // Neutraliser Markdown headings (#/##/###)
    const noMd = line.replace(/^#{1,6}\s+/, "");

    // Ligne entièrement en **...**
    const mFull = noMd.match(/^\*\*(.+?)\*\*\s*$/);
    if (mFull) {
      doc.font("Times-Bold").text(mFull[1], opts);
      doc.font("Times-Roman");
      continue;
    }

    // Ligne avec segments **...**
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

    const baseOpts = { ...opts };
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const isLast = i === parts.length - 1;
      doc.font(p.b ? "Times-Bold" : "Times-Roman");
      doc.text(p.t, { ...baseOpts, continued: !isLast });
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
    const y = doc.page.height - bottom + 18;

    doc.text(String(pageNumber), 0, y, { align: "center" });
  }
}

function buildMemoirePdf(doc, { title, ctx, plan, sections }) {
  const c = ctx || {};

  // ---------------- Cover ----------------
  doc.font("Times-Bold").fontSize(16).text(title || "MÉMOIRE DE LICENCE", { align: "center" });
  doc.moveDown(1.2);

  doc.font("Times-Roman").fontSize(11);
  if (c.university) doc.text(c.university, { align: "center" });
  if (c.faculty) doc.text(`Faculté : ${c.faculty}`, { align: "center" });
  if (c.department) doc.text(`Département : ${c.department}`, { align: "center" });
  if (c.academicYear) doc.text(`Année : ${c.academicYear}`, { align: "center" });

  doc.moveDown(1.0);
  if (c.studentName) doc.text(`Étudiant : ${c.studentName}`, { align: "center" });
  if (c.supervisorName) doc.text(`Encadreur : ${c.supervisorName}`, { align: "center" });

  doc.moveDown(1.4);
  doc.text(new Date().toLocaleDateString(), { align: "center" });

  doc.addPage();

  // ---------------- Plan ----------------
  doc.font("Times-Bold").fontSize(14).text("PLAN DU MÉMOIRE", { align: "left" });
  doc.moveDown(0.8);
  doc.font("Times-Roman").fontSize(11);
  renderTextWithBold(doc, safeText(plan), { align: "left" });

  doc.addPage();

  // ---------------- Sections ----------------
  const secs = Array.isArray(sections) ? sections : [];
  for (let idx = 0; idx < secs.length; idx++) {
    const sec = secs[idx] || {};
    const secTitle = safeText(sec.title);
    const content = safeText(sec.content);

    if (secTitle.trim()) {
      doc.font("Times-Bold").fontSize(13).text(secTitle.trim());
      doc.moveDown(0.6);
    }
    doc.font("Times-Roman").fontSize(11);

    const split = content.split(/\n\s*(?:NOTES DE BAS DE PAGE|NOTES \(FOOTNOTES\))\s*\n/i);
    const mainText = split[0] || "";
    const notesText = split.slice(1).join("\n").trim();

    renderTextWithBold(doc, mainText, { align: "justify" });

    if (notesText) {
      doc.moveDown(0.8);
      doc.font("Times-Bold").fontSize(10).text("NOTES DE BAS DE PAGE");
      doc.moveDown(0.3);
      doc.font("Times-Roman").fontSize(9);
      renderTextWithBold(doc, notesText, { align: "left" });
      doc.font("Times-Roman").fontSize(11);
    }

    if (idx < secs.length - 1) doc.addPage();
  }
}

/**
 * Assemble un PDF et l'écrit sur disque (utile debug/local).
 */
export async function assembleAcademicPdf({ title, ctx, plan, sections, outputPath }) {
  return new Promise((resolve, reject) => {
    try {
      const out = outputPath || path.join(process.cwd(), `memoire_${Date.now()}.pdf`);

      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 56, bottom: 56, left: 64, right: 64 },
        bufferPages: true,
      });

      const stream = fs.createWriteStream(out);
      doc.pipe(stream);

      buildMemoirePdf(doc, { title, ctx, plan, sections });

      addFooter(doc);
      doc.end();

      stream.on("finish", () => resolve(out));
      stream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * ✅ Fonction attendue par le backend Express.
 * Elle stream le PDF directement dans la réponse HTTP.
 *
 * Usage (route):
 * return writeLicenceMemoirePdf({ res, title, ctx, plan, sections });
 */
export async function writeLicenceMemoirePdf({ res, title, ctx, plan, sections }) {
  if (!res) throw new Error("writeLicenceMemoirePdf: res is required");

  // Headers PDF
  const safeName = String(title || "memoire_licence")
    .slice(0, 80)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 64, right: 64 },
    bufferPages: true,
  });

  // Important: pipe to HTTP response
  doc.pipe(res);

  try {
    buildMemoirePdf(doc, { title, ctx, plan, sections });
    addFooter(doc);
    doc.end();
  } catch (e) {
    // If something crashes while writing, end the response
    try { doc.end(); } catch (_) {}
    throw e;
  }
}
