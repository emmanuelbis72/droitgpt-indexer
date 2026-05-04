// bp/core/grantsPdfAssembler.js
import PDFDocument from "pdfkit";

export function writeGrantsManagementPdf({ res, title, ctx, workspace }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(title)}.pdf"`);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, left: 52, right: 52, bottom: 56 },
  });

  doc.on("error", (err) => {
    try {
      res.destroy(err);
    } catch (_) {}
  });

  doc.pipe(res);
  renderPdf(doc, { title, ctx, workspace });
  doc.end();
}

function renderPdf(doc, { title, ctx, workspace }) {
  const s = workspace?.summary || {};

  doc.font("Helvetica-Bold").fontSize(21).text(title || "AI Assisted Grants Management", {
    align: "left",
  });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).text(
    [
      `Projet: ${ctx.projectName || ""}`,
      `Bailleur: ${ctx.donor || ""}`,
      `Pays / zone: ${ctx.country || ""}`,
      `Secteur: ${ctx.sector || ""}`,
      `Deadline: ${ctx.deadline || ""}`,
    ]
      .filter((x) => !x.endsWith(": "))
      .join(" | ")
  );

  doc.moveDown(1);
  renderScoreCard(doc, s);
  renderSection(doc, "Decision simple", s.plain_language_reason || "");

  renderKeyValues(doc, "Intake", workspace?.intake?.known_information, "label", "value");
  renderQuestions(doc, workspace?.intake?.missing_information);
  renderChecks(doc, "Eligibilite", workspace?.eligibility?.checks);
  renderBullets(doc, "Adequation bailleur - forces", workspace?.donor_fit?.strengths);
  renderBullets(doc, "Adequation bailleur - points faibles", workspace?.donor_fit?.weaknesses);
  renderBullets(doc, "Angles de positionnement", workspace?.donor_fit?.positioning_angles);
  renderDocuments(doc, workspace?.compliance?.required_documents);
  renderRules(doc, workspace?.compliance?.submission_rules);
  renderBudget(doc, workspace?.budget_review);
  renderOutline(doc, workspace?.proposal_plan?.outline);
  renderChecklist(doc, workspace?.proposal_plan?.review_checklist);
  renderTimeline(doc, workspace?.timeline);
  renderActions(doc, workspace?.ai_next_actions);
  renderBullets(doc, "Demarrage rapide", workspace?.quick_start?.first_3_steps);
  renderSection(doc, "Brief en une page", workspace?.quick_start?.one_screen_brief || "");

  renderFooter(doc);
}

function renderScoreCard(doc, s) {
  const recommendation = String(s?.recommendation || "needs_more_info");
  const readiness = clampScore(s?.readiness_score);
  const fit = clampScore(s?.fit_score);
  const confidence = String(s?.confidence || "medium");

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.y;
  doc.save();
  doc.rect(x, y, w, 70).fillOpacity(0.06).fill("#000000");
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(12).text(`Recommandation: ${recommendation}`, x + 12, y + 12);
  doc.font("Helvetica").fontSize(10).text(`Readiness: ${readiness}/100`, x + 12, y + 34);
  doc.text(`Donor fit: ${fit}/100`, x + 170, y + 34);
  doc.text(`Confiance: ${confidence}`, x + 310, y + 34);
  doc.y = y + 84;
}

function renderSection(doc, title, text) {
  if (!String(text || "").trim()) return;
  ensureSpace(doc, 70);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(14).text(title);
  drawDivider(doc);
  doc.font("Helvetica").fontSize(10).text(clean(text), { lineGap: 3 });
}

function renderBullets(doc, title, items) {
  const arr = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!arr.length) return;
  ensureSpace(doc, 60);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(13).text(title);
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(9.8);
  for (const item of arr) {
    ensureSpace(doc, 22);
    doc.text(`- ${clean(item)}`, { lineGap: 2.5 });
  }
}

function renderKeyValues(doc, title, rows, k1, k2) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(doc, title, ["Element", "Valeur"], arr.map((r) => [r?.[k1] || "", r?.[k2] || ""]), [0.34, 0.66]);
}

function renderQuestions(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    "Informations manquantes",
    ["Question", "Pourquoi", "Priorite"],
    arr.map((r) => [r?.question || "", r?.why_it_matters || "", r?.priority || ""]),
    [0.42, 0.43, 0.15]
  );
}

function renderChecks(doc, title, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    title,
    ["Critere", "Statut", "Preuve", "Action"],
    arr.map((r) => [r?.criterion || "", r?.status || "", r?.evidence || "", r?.action || ""]),
    [0.28, 0.13, 0.29, 0.30]
  );
}

function renderDocuments(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    "Pieces de conformite",
    ["Document", "Statut", "Owner", "Notes"],
    arr.map((r) => [r?.document || "", r?.status || "", r?.owner || "", r?.notes || ""]),
    [0.34, 0.16, 0.20, 0.30]
  );
}

function renderRules(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    "Regles de soumission",
    ["Regle", "Risque", "Action"],
    arr.map((r) => [r?.rule || "", r?.risk_level || "", r?.action || ""]),
    [0.45, 0.15, 0.40]
  );
}

function renderBudget(doc, b) {
  if (!b || typeof b !== "object") return;
  renderSection(doc, "Logique budgetaire", b.budget_logic || "");
  const risks = Array.isArray(b.eligible_cost_risks) ? b.eligible_cost_risks : [];
  if (risks.length) {
    renderTable(
      doc,
      "Risques couts eligibles",
      ["Poste", "Risque", "Correction"],
      risks.map((r) => [r?.cost_area || "", r?.risk || "", r?.fix || ""]),
      [0.25, 0.38, 0.37]
    );
  }
  const lines = Array.isArray(b.simple_budget_lines) ? b.simple_budget_lines : [];
  if (lines.length) {
    renderTable(
      doc,
      "Budget simple",
      ["Categorie", "Description", "Montant/base", "Notes"],
      lines.map((r) => [r?.category || "", r?.description || "", r?.amount_or_basis || "", r?.notes || ""]),
      [0.20, 0.38, 0.20, 0.22]
    );
  }
}

function renderOutline(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    "Plan de proposition",
    ["Section", "Objectif", "Inputs requis"],
    arr.map((r) => [r?.section || "", r?.purpose || "", join(r?.inputs_needed)]),
    [0.24, 0.36, 0.40]
  );
}

function renderChecklist(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    "Checklist de revue",
    ["Item", "Pourquoi", "Statut"],
    arr.map((r) => [r?.item || "", r?.why || "", r?.status || ""]),
    [0.40, 0.45, 0.15]
  );
}

function renderTimeline(doc, timeline) {
  const rows = Array.isArray(timeline?.workplan) ? timeline.workplan : [];
  if (!rows.length) return;
  renderTable(
    doc,
    `Retroplanning${timeline?.deadline ? ` - deadline: ${timeline.deadline}` : ""}`,
    ["Moment", "Tache", "Owner", "Livrable"],
    rows.map((r) => [r?.day_or_week || "", r?.task || "", r?.owner || "", r?.output || ""]),
    [0.15, 0.38, 0.20, 0.27]
  );
}

function renderActions(doc, rows) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return;
  renderTable(
    doc,
    "Actions IA suivantes",
    ["Action", "Input utilisateur", "Output"],
    arr.map((r) => [r?.action || "", r?.user_input_needed || "", r?.output || ""]),
    [0.35, 0.35, 0.30]
  );
}

function renderTable(doc, title, headers, rows, fracs) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return;
  ensureSpace(doc, 90);
  doc.moveDown(0.7);
  doc.font("Helvetica-Bold").fontSize(13).text(title);
  doc.moveDown(0.25);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = normalizeFracs(fracs, headers.length).map((f) => f * w);
  const headerH = 20;

  ensureSpace(doc, headerH + 10);
  let y = doc.y;
  doc.save();
  doc.rect(x, y, w, headerH).fillOpacity(0.08).fill("#000000");
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(8.5);
  let cx = x;
  headers.forEach((h, i) => {
    doc.text(String(h), cx + 5, y + 5, { width: colW[i] - 8, lineBreak: false });
    cx += colW[i];
  });
  doc.y = y + headerH + 4;

  doc.font("Helvetica").fontSize(8.2);
  for (const row of safeRows) {
    const values = Array.isArray(row) ? row : [row];
    const heights = values.map((v, i) => doc.heightOfString(clean(v), { width: (colW[i] || 80) - 8 }));
    const rowH = Math.max(26, Math.min(86, Math.max(...heights) + 10));
    ensureSpace(doc, rowH + 4);
    y = doc.y;
    doc.save();
    doc.rect(x, y, w, rowH).strokeOpacity(0.14).stroke();
    doc.restore();
    cx = x;
    for (let i = 0; i < headers.length; i++) {
      doc.text(clean(values[i]), cx + 5, y + 5, { width: colW[i] - 8, height: rowH - 8 });
      cx += colW[i];
    }
    doc.y = y + rowH + 2;
  }
}

function renderFooter(doc) {
  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
  if (!pages) return;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function drawDivider(doc) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveDown(0.2);
  doc.save();
  doc.moveTo(x, doc.y).lineTo(x + w, doc.y).strokeOpacity(0.16).stroke();
  doc.restore();
  doc.moveDown(0.45);
}

function clean(v) {
  if (Array.isArray(v)) return v.map(clean).filter(Boolean).join("; ");
  if (v && typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function join(v) {
  return Array.isArray(v) ? v.map(clean).filter(Boolean).join("; ") : clean(v);
}

function normalizeFracs(fracs, n) {
  const arr = Array.isArray(fracs) ? fracs.slice(0, n) : [];
  while (arr.length < n) arr.push(1 / n);
  const sum = arr.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return arr.map((v) => (Number(v) || 0) / sum);
}

function sanitizeFilename(name) {
  return String(name || "grants-management")
    .trim()
    .slice(0, 90)
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
