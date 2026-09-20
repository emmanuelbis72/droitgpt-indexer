// bp/core/academicWordAssembler.js
// Word-compatible HTML export for licence memoires.

function safeText(value) {
  return String(value || "");
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeFileName(value) {
  return safeText(value || "memoire")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80) || "memoire";
}

function htmlText(value) {
  return escapeHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function metaRows(ctx = {}) {
  const rows = [
    ["Université", ctx.university],
    ["Faculté", ctx.faculty],
    ["Département", ctx.department],
    ["Étudiant", ctx.studentName],
    ["Encadreur", ctx.supervisorName],
    ["Année académique", ctx.academicYear],
    ["Mode", ctx.mode === "droit_congolais" ? "Droit congolais / sources Qdrant" : "Standard"],
  ].filter(([, value]) => safeText(value).trim());

  return rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
}

function sectionsHtml(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .filter((section) => safeText(section?.title).trim() || safeText(section?.content).trim())
    .map((section) => {
      const title = htmlText(section?.title || "Section");
      const content = htmlText(section?.content || "(Section vide : relancer la génération.)");
      return `<section><h2>${title}</h2><p>${content}</p></section>`;
    })
    .join("\n");
}

function sourcesHtml(ctx = {}) {
  if (ctx.mode !== "droit_congolais" || !Array.isArray(ctx.sourcesUsed) || !ctx.sourcesUsed.length) {
    return "";
  }

  const rows = ctx.sourcesUsed
    .slice(0, 80)
    .map((source, index) => {
      const title = source?.title || source?.source || "Source";
      const details = [source?.type, source?.author, source?.year].filter(Boolean).join(" - ");
      return `<li><strong>${index + 1}. ${escapeHtml(title)}</strong>${details ? ` - ${escapeHtml(details)}` : ""}</li>`;
    })
    .join("");

  return `<section><h2>SOURCES UTILISÉES (RAG)</h2><ul>${rows}</ul></section>`;
}

function buildMemoireWordHtml({ title, ctx, plan, sections }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || "Mémoire")}</title>
  <style>
    body { font-family: "Times New Roman", serif; color: #111827; line-height: 1.55; margin: 48px; }
    h1 { font-size: 22px; text-align: center; text-transform: uppercase; margin: 0 0 18px; }
    h2 { font-size: 16px; color: #1f2937; margin-top: 26px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 18px 0 28px; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; text-align: left; }
    th { width: 180px; background: #f3f4f6; }
    p { margin: 10px 0; text-align: justify; }
    .cover { text-align: center; margin-bottom: 28px; }
    .note { color: #64748b; font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>MÉMOIRE DE LICENCE</h1>
    <p><strong>${escapeHtml(title || "Mémoire")}</strong></p>
  </div>
  <table>${metaRows(ctx)}</table>
  <section>
    <h2>PLAN</h2>
    <p>${htmlText(plan || "—")}</p>
  </section>
  ${sectionsHtml(sections)}
  ${sourcesHtml(ctx)}
  <p class="note">Document généré automatiquement par DroitGPT à partir des informations fournies. Vérifier les références, citations et données avant dépôt officiel.</p>
</body>
</html>`;
}

export function writeLicenceMemoireWord({ res, title, ctx, plan, sections }) {
  if (!res) throw new Error("writeLicenceMemoireWord: res is required");
  res.setHeader("Content-Type", "application/msword; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(title)}.doc"`);
  return res.send(Buffer.from(`\ufeff${buildMemoireWordHtml({ title, ctx, plan, sections })}`, "utf8"));
}
