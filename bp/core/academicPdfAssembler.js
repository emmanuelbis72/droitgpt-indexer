// academicPdfAssembler.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * =========================================================
 * DroitGPT — Academic PDF Assembler (Mémoire)
 * =========================================================
 * Objectif: assembler un mémoire long et lisible (A4, 11pt),
 * avec titres en gras + notes de bas de page visibles par défaut.
 *
 * ✅ Règles appliquées:
 * - Format A4, marges académiques, police 11pt
 * - Titres/sous-titres en GRAS (détection des marqueurs **...**)
 * - Pas de titres Markdown (#/##/###): ils sont imprimés en texte normal
 * - Notes de bas de page: bloc "NOTES DE BAS DE PAGE" (ou "NOTES (FOOTNOTES)")
 * - Numérotation de pages en pied de page
 */

function safeText(v) {
  return String(v || "");
}

// Détection simple: une ligne " **TITRE** " => rendu en gras
function renderTextWithBold(doc, text, opts = {}) {
  const lines = safeText(text).split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trimEnd();

    // sauter lignes trop longues vides
    if (!line.trim()) {
      doc.moveDown(0.5);
      continue;
    }

    // Neutraliser Markdown headings
    const noMd = line.replace(/^#{1,6}\s+/, "");

    // Ligne entièrement en **...**
    const mFull = noMd.match(/^\*\*(.+?)\*\*\s*$/);
    if (mFull) {
      doc.font("Times-Bold").text(mFull[1], opts);
      doc.font("Times-Roman");
      continue;
    }

    // Si la ligne contient plusieurs segments **...**
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

    // Rendu segments (utilise continued)
    const baseOpts = { ...opts };
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const isLast = i === parts.length - 1;
      if (p.b) doc.font("Times-Bold");
      else doc.font("Times-Roman");

      doc.text(p.t, { ...baseOpts, continued: !isLast });
    }
    doc.text(""); // terminer la ligne
    doc.font("Times-Roman");
  }
}

function addFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNumber = i + 1;

    doc.font("Times-Roman")
      .fontSize(9);

    const bottom = doc.page.margins.bottom;
    const y = doc.page.height - bottom + 18;

    doc.text(String(pageNumber), 0, y, { align: "center" });
  }
}

/**
 * Assemble un PDF à partir d'un plan + sections.
 * @param {Object} params
 * @param {string} params.plan
 * @param {Array<{title:string, content:string}>} params.sections
 * @param {string} params.outputPath
 */
export async function assembleAcademicPdf({ plan, sections, outputPath }) {
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

      // ---------------- Cover ----------------
      doc.font("Times-Bold").fontSize(16).text("MÉMOIRE DE LICENCE", { align: "center" });
      doc.moveDown(1.2);
      doc.font("Times-Roman").fontSize(11).text("Document généré par DroitGPT", { align: "center" });
      doc.moveDown(2);
      doc.font("Times-Roman").fontSize(11).text(new Date().toLocaleDateString(), { align: "center" });

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
        const title = safeText(sec.title);
        const content = safeText(sec.content);

        // Titre section
        if (title.trim()) {
          doc.font("Times-Bold").fontSize(13).text(title.trim());
          doc.moveDown(0.6);
        }
        doc.font("Times-Roman").fontSize(11);

        // Séparer notes de bas de page
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

        // Nouvelle page uniquement si ce n'est pas la dernière section
        if (idx < secs.length - 1) doc.addPage();
      }

      // Footer page numbers
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
 * Backward-compatible export expected by routes:
 * generateLicenceMemoire.js imports { writeLicenceMemoirePdf } from academicPdfAssembler.js
 * This wrapper calls assembleAcademicPdf.
 */
export async function writeLicenceMemoirePdf({ plan, sections, outputPath }) {
  return assembleAcademicPdf({ plan, sections, outputPath });
}
