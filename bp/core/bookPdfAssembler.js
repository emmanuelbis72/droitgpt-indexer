// core/bookPdfAssembler.js
// DroitGPT Editions — Jurisprudence Book PDF Assembler
// PDFKit, Render-safe, avoids blank page duplication.

import PDFDocument from 'pdfkit';

function safeText(v) {
  return String(v || '');
}

function safeFileName(s) {
  return String(s || 'livre')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 90);
}

function renderTextWithBold(doc, text, opts = {}) {
  const lines = safeText(text).replace(/\r/g, '').split(/\n/);

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      doc.moveDown(0.55);
      continue;
    }

    // sanitize markdown headings
    const noMd = line.replace(/^#{1,6}\s+/, '');

    // remove long separators like ****** or -----
    if (/^[*\-_=]{5,}\s*$/.test(noMd.trim())) {
      doc.moveDown(0.35);
      doc.save();
      doc.opacity(0.2);
      const x = doc.page.margins.left;
      const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.moveTo(x, doc.y).lineTo(x + w, doc.y).stroke();
      doc.restore();
      doc.moveDown(0.6);
      continue;
    }

    // bullets - or *
    let normalized = noMd;
    if (/^\s*[-*]\s+/.test(normalized)) normalized = '• ' + normalized.replace(/^\s*[-*]\s+/, '');

    // full bold **...**
    const mFull = normalized.match(/^\*\*(.+?)\*\*\s*$/);
    if (mFull) {
      doc.font('Times-Bold').text(mFull[1], opts);
      doc.font('Times-Roman');
      continue;
    }

    // mixed bold **...**
    const parts = [];
    let rest = normalized;
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
      doc.font(p.b ? 'Times-Bold' : 'Times-Roman');
      doc.text(p.t, { ...opts, continued: !isLast });
    }
    doc.text('');
    doc.font('Times-Roman');
  }
}

function addFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const prevX = doc.x;
    const prevY = doc.y;

    doc.save();
    doc.font('Times-Roman').fontSize(9).opacity(0.75);

    const pageNumber = i + 1;
    const y = doc.page.height - doc.page.margins.bottom - 14; // inside printable area
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.text(String(pageNumber), x, y, { width: w, align: 'center', lineBreak: false });

    doc.restore();
    doc.x = prevX;
    doc.y = prevY;
  }
}

export function writeJurisprudenceBookPdf({ res, title, subtitle, meta, chapters, annexRows, indexTerms }) {
  if (!res) throw new Error('writeJurisprudenceBookPdf: res is required');

  const file = safeFileName(title || 'Traite_Jurisprudence_Congolaise');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${file}.pdf"`);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, left: 64, right: 64, bottom: 56 },
    bufferPages: true,
  });

  doc.pipe(res);

  // Cover
  doc.font('Times-Bold').fontSize(18).text(safeText(title || 'TRAITÉ'), { align: 'center' });
  if (subtitle) {
    doc.moveDown(0.6);
    doc.font('Times-Roman').fontSize(12).text(safeText(subtitle), { align: 'center' });
  }
  doc.moveDown(1.2);

  doc.font('Times-Roman').fontSize(11);
  if (meta?.edition) doc.text(`Édition: ${safeText(meta.edition)}`, { align: 'center' });
  if (meta?.year) doc.text(`Année: ${safeText(meta.year)}`, { align: 'center' });
  if (meta?.publisher) doc.text(`DroitGPT Éditions — ${safeText(meta.publisher)}`, { align: 'center' });
  if (meta?.disclaimer) {
    doc.moveDown(0.8);
    doc.fontSize(9).opacity(0.8).text(safeText(meta.disclaimer), { align: 'center' });
    doc.opacity(1);
  }

  doc.addPage();

  // Table of contents (simple)
  doc.font('Times-Bold').fontSize(14).text('TABLE DES MATIÈRES', { align: 'left' });
  doc.moveDown(0.6);
  doc.font('Times-Roman').fontSize(11);
  (chapters || []).forEach((c, idx) => {
    const t = safeText(c?.title || `Chapitre ${idx + 1}`);
    doc.text(`${idx + 1}. ${t}`);
  });

  // Chapters
  const chs = Array.isArray(chapters) ? chapters : [];
  for (let i = 0; i < chs.length; i++) {
    const ch = chs[i] || {};
    doc.addPage();
    doc.font('Times-Bold').fontSize(14).text(safeText(ch.title || `Chapitre ${i + 1}`));
    doc.moveDown(0.6);
    doc.font('Times-Roman').fontSize(11);
    renderTextWithBold(doc, safeText(ch.text || '—'), { align: 'justify' });
  }

  // Annex: jurisprudence repository
  if (Array.isArray(annexRows) && annexRows.length) {
    doc.addPage();
    doc.font('Times-Bold').fontSize(13).text('ANNEXE — RÉPERTOIRE DES JURISPRUDENCES ANALYSÉES');
    doc.moveDown(0.4);
    doc.font('Times-Roman').fontSize(9);

    // Render as simple list (table-like). Avoid complex tables for stability.
    annexRows.slice(0, 5000).forEach((r) => {
      const id = safeText(r?.id || 'JUR-XXXX');
      const jur = safeText(r?.juridiction || r?.court || 'INCOMPLET');
      const date = safeText(r?.date || 'INCOMPLET');
      const num = safeText(r?.numero || r?.number || 'INCOMPLET');
      const mat = safeText(r?.matiere || r?.field || 'autre');
      const princ = safeText(r?.principe || r?.principle || '').slice(0, 220);
      doc.text(`${id} | ${mat} | ${jur} | ${date} | ${num}`);
      if (princ) doc.text(`  Principe: ${princ}`);
      doc.moveDown(0.2);
    });
  }

  // Index
  if (Array.isArray(indexTerms) && indexTerms.length) {
    doc.addPage();
    doc.font('Times-Bold').fontSize(13).text('INDEX ALPHABÉTIQUE DES PRINCIPES');
    doc.moveDown(0.4);
    doc.font('Times-Roman').fontSize(10);
    indexTerms.slice(0, 4000).forEach((t) => {
      const term = safeText(t?.term || t?.name || '').trim();
      if (!term) return;
      const pages = Array.isArray(t?.pages) ? t.pages.join(', ') : '';
      doc.text(`• ${term}${pages ? ` — p. ${pages}` : ''}`);
    });
  }

  addFooter(doc);
  doc.end();
}
