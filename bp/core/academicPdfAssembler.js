// academicPdfAssembler.js
import PDFDocument from "pdfkit";

export function writeLicenceMemoirePdf({ res, title, ctx, plan, sections }) {
  const MAX_PDF_PAGES = 70;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(title)}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margins: { top: 50, left: 55, right: 55, bottom: 50 } });
  doc.pipe(res);

  let pageCount = 1;
  let stopWriting = false;
  doc.on("pageAdded", () => {
    pageCount += 1;
    if (pageCount > MAX_PDF_PAGES) {
      stopWriting = true;
    }
  });

  const charsPerPage = Number(process.env.ACAD_CHARS_PER_PAGE || 1800); // conservative
  function truncateToRemainingPages(text) {
    if (stopWriting) return "";
    const remaining = Math.max(MAX_PDF_PAGES - pageCount + 1, 0);
    const maxChars = remaining * charsPerPage;
    const t = String(text || "");
    if (t.length <= maxChars) return t;
    return t.slice(0, Math.max(maxChars - 200, 0)) + "\n\n[Document tronqué automatiquement pour respecter la limite de 70 pages.]";
  }


  // Cover
  doc.font("Helvetica-Bold").fontSize(16).text(ctx.university || "Université", { align: "center" });
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(12).text(ctx.faculty || "Faculté", { align: "center" });
  if (ctx.department) {
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(11).text(ctx.department, { align: "center" });
  }
  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").fontSize(18).text(title, { align: "center" });
  doc.moveDown(1.2);

  doc.font("Helvetica").fontSize(11);
  if (ctx.studentName) doc.text(`Étudiant : ${ctx.studentName}`, { align: "center" });
  if (ctx.supervisorName) doc.text(`Encadreur : ${ctx.supervisorName}`, { align: "center" });
  if (ctx.academicYear) doc.text(`Année académique : ${ctx.academicYear}`, { align: "center" });
  if (pageCount >= MAX_PDF_PAGES) { stopWriting = true; doc.end(); return; }
  doc.addPage();

  // Plan
  doc.font("Helvetica-Bold").fontSize(14).text("Plan", { align: "left" });
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(11).text(truncateToRemainingPages(String(plan || "").trim() || "—"), { align: "left" });

  // Sections
  for (const s of sections || []) {
  if (pageCount >= MAX_PDF_PAGES) { stopWriting = true; doc.end(); return; }
  doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text(s.title || "Section", { align: "left" });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(11).text(truncateToRemainingPages(String(s.content || "").trim()), { align: "left" });
  }


// Notes de bas de page / Sources (optionnel)
if (ctx?.mode === "droit_congolais" && Array.isArray(ctx?.sourcesUsed) && ctx.sourcesUsed.length) {
  if (pageCount < MAX_PDF_PAGES) {
    doc.addPage();
  } else {
    stopWriting = true;
  }
  if (!stopWriting) doc.font("Helvetica-Bold").fontSize(14).text("Notes de bas de page (sources)", { align: "left" });
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(10);

  const maxNotes = 40;
  ctx.sourcesUsed.slice(0, maxNotes).forEach((s, i) => {
    const n = s?.n || s?.idx || i + 1;
    const title = s?.title || s?.source || "Source";
    const author = s?.author ? ` — ${s.author}` : "";
    const year = s?.year ? `, ${s.year}` : "";
    const src = s?.source ? ` — ${s.source}` : "";
    const type = s?.type ? ` (${s.type})` : "";
    doc.text(`[${n}] ${title}${type}${author}${year}${src}`);
    doc.moveDown(0.2);
  });

  if (ctx.sourcesUsed.length > maxNotes) {
    doc.moveDown(0.4);
    doc.fillColor("#999999").text(`… ${ctx.sourcesUsed.length - maxNotes} autre(s) source(s) non affichée(s).`);
    doc.fillColor("black");
  }
}

  doc.end();
}

function safeFileName(s) {
  return String(s || "memoire")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
}
