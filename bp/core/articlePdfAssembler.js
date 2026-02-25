// core/articlePdfAssembler.js
// PDFKit renderer for scientific articles.

import PDFDocument from "pdfkit";

function sanitizeFilename(name) {
  return String(name || "article")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 90);
}

function addHeaderFooter(doc, { title }) {
  const margin = doc.page.margins.left;
  const w = doc.page.width;
  const h = doc.page.height;

  doc.save();
  doc.fontSize(8).fillColor("#666");
  doc.text("DroitGPT", margin, 18, { width: w - margin * 2, align: "left" });
  doc.text(String(title || ""), margin, 18, { width: w - margin * 2, align: "right" });
  doc.restore();

  const pageNumber = doc.page.number;
  doc.save();
  doc.fontSize(8).fillColor("#666");
  doc.text(`Page ${pageNumber}`, margin, h - 28, { width: w - margin * 2, align: "center" });
  doc.restore();
}

function sectionTitle(doc, text) {
  doc.moveDown(0.8);
  doc.fontSize(14).fillColor("#111").font("Helvetica-Bold");
  doc.text(text, { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#111").font("Helvetica");
}

export function writeScientificArticlePdf({
  res,
  title,
  abstract,
  keywords,
  sections,
  jurisprudences,
  references,
  meta,
}) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, bottom: 56, left: 56, right: 56 },
    autoFirstPage: true,
  });

  const fileName = sanitizeFilename(title || "article") + ".pdf";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  doc.pipe(res);

  // header/footer per page
  doc.on("pageAdded", () => addHeaderFooter(doc, { title }));
  addHeaderFooter(doc, { title });

  // Cover-like header
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#0b1220");
  doc.text(title || "Article", { align: "center" });
  doc.moveDown(0.6);

  doc.font("Helvetica").fontSize(10).fillColor("#111");
  const metaLine = meta?.mode === "law_rag" ? "Droit congolais (RAG)" : "Article scientifique";
  doc.text(`${metaLine} • ${new Date(meta?.generatedAt || Date.now()).toLocaleString()}`, { align: "center" });
  doc.moveDown(1.0);

  // Abstract
  sectionTitle(doc, doc._fontFamilies ? "Résumé" : "Résumé");
  doc.font("Helvetica").fontSize(10).fillColor("#111");
  doc.text(abstract || "", { align: "justify" });

  if (Array.isArray(keywords) && keywords.length) {
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").text("Mots-clés : ", { continued: true });
    doc.font("Helvetica").text(keywords.join(", "));
  }

  // Disclaimer
  if (meta?.disclaimer) {
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(9).fillColor("#555");
    doc.text(meta.disclaimer, { align: "justify" });
    doc.fontSize(10).fillColor("#111");
  }

  // Main sections
  (sections || []).forEach((s) => {
    sectionTitle(doc, s.heading);
    doc.font("Helvetica").fontSize(10).fillColor("#111");
    doc.text(s.content || "", { align: "justify" });
  });

  // Jurisprudence annex (only for law)
  if (Array.isArray(jurisprudences) && jurisprudences.length) {
    doc.addPage();
    sectionTitle(doc, "Annexe — Jurisprudences citées");
    doc.font("Helvetica").fontSize(10).fillColor("#111");

    for (const j of jurisprudences) {
      doc.font("Helvetica-Bold");
      doc.text(`[${j.id}] ${j.juridiction} — ${j.date} — ${j.numero} (${j.matiere})`);
      doc.font("Helvetica");
      if (j.principe) doc.text(`Principe: ${j.principe}`, { align: "justify" });
      if (j.resume) doc.text(`Résumé: ${j.resume}`, { align: "justify" });
      doc.moveDown(0.4);
    }
  }

  // References
  if (Array.isArray(references) && references.length) {
    doc.addPage();
    sectionTitle(doc, "Références");
    doc.font("Helvetica").fontSize(10).fillColor("#111");
    references.forEach((r, i) => {
      doc.text(`${i + 1}. ${String(r)}`);
    });
  }

  doc.end();
}
