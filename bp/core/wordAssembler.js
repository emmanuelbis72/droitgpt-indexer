// business-plan-service/core/wordAssembler.js
// ✅ DOCX premium synchronisé avec le PDF (mêmes sections + mêmes JSON tables)
// Dépendance: "docx"
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
} from "docx";

function cleanText(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asBullets(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return a.map((x) => cleanText(x)).filter(Boolean);
}

function cell(text, opts = {}) {
  return new TableCell({
    width: opts.width
      ? { size: opts.width, type: WidthType.PERCENTAGE }
      : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text: cleanText(text), bold: !!opts.bold })],
      }),
    ],
  });
}

function makeTable(headers, rows) {
  const border = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    insideH: { style: BorderStyle.SINGLE, size: 1, color: "E5E5E5" },
    insideV: { style: BorderStyle.SINGLE, size: 1, color: "E5E5E5" },
  };

  const headerRow = new TableRow({
    children: headers.map((h) => cell(h, { bold: true })),
  });

  const dataRows = (rows || []).map(
    (r) =>
      new TableRow({
        children: r.map((v) => cell(v)),
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: border,
    rows: [headerRow, ...dataRows],
  });
}

function titleFromSection(s) {
  return String(s?.title || s?.key || "Section").trim() || "Section";
}

function isJsonKey(key) {
  return ["canvas_json", "swot_json", "kpi_calendar_json", "financials_json"].includes(
    String(key || "")
  );
}

function formatMoney(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "—";
  return Math.round(x).toLocaleString("en-US");
}

function formatPercent(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "—";
  const v = Math.round(x * 10) / 10;
  return `${v.toLocaleString("en-US")}%`;
}

export async function writeBusinessPlanDocxPremium({ title, ctx, sections }) {
  const company = String(ctx?.companyName || "Business Plan").trim() || "Business Plan";

  const children = [];

  // Cover (simple + clean)
  children.push(
    new Paragraph({
      text: String(title || "Business Plan"),
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: company, bold: true }),
        new TextRun({ text: "\n" }),
        new TextRun({ text: `Secteur: ${ctx?.sector || "—"}` }),
        new TextRun({ text: `  |  Pays: ${ctx?.country || "—"}` }),
        new TextRun({ text: `  |  Ville(s): ${ctx?.city || "—"}` }),
        new TextRun({ text: `  |  Audience: ${(ctx?.audience || "—").toString()}` }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "" })
  );

  // Sections
  const safe = Array.isArray(sections) ? sections : [];
  for (const s of safe) {
    const secTitle = titleFromSection(s);
    children.push(
      new Paragraph({ text: secTitle, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" })
    );

    const key = String(s?.key || "").toLowerCase();

    // Canvas
    if (key === "canvas_json" && s?.meta?.canvas) {
      const c = s.meta.canvas || {};
      const rows = [
        ["Partenaires clés", asBullets(c.partenaires_cles || c.key_partners).join("\n")],
        ["Activités clés", asBullets(c.activites_cles || c.key_activities).join("\n")],
        ["Ressources clés", asBullets(c.ressources_cles || c.key_resources).join("\n")],
        ["Propositions de valeur", asBullets(c.propositions_de_valeur || c.value_propositions).join("\n")],
        ["Relations clients", asBullets(c.relations_clients || c.customer_relationships).join("\n")],
        ["Canaux", asBullets(c.canaux || c.channels).join("\n")],
        ["Segments clients", asBullets(c.segments_clients || c.customer_segments).join("\n")],
        ["Structure de coûts", asBullets(c.structure_de_couts || c.cost_structure).join("\n")],
        ["Sources de revenus", asBullets(c.sources_de_revenus || c.revenue_streams).join("\n")],
      ];
      children.push(makeTable(["Bloc", "Contenu"], rows), new Paragraph({ text: "" }));
      continue;
    }

    // SWOT
    if (key === "swot_json" && s?.meta?.swot) {
      const sw = s.meta.swot || {};
      const rows = [
        ["Forces", asBullets(sw.forces || sw.strengths).join("\n")],
        ["Faiblesses", asBullets(sw.faiblesses || sw.weaknesses).join("\n")],
        ["Opportunités", asBullets(sw.opportunites || sw.opportunities).join("\n")],
        ["Menaces", asBullets(sw.menaces || sw.threats).join("\n")],
      ];
      children.push(makeTable(["Axe", "Éléments"], rows));
      if (sw.interpretation) {
        children.push(
          new Paragraph({
            text: "Interprétation stratégique",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph(cleanText(sw.interpretation)),
          new Paragraph({ text: "" })
        );
      } else {
        children.push(new Paragraph({ text: "" }));
      }
      continue;
    }

    // KPI + calendrier
    if (key === "kpi_calendar_json" && s?.meta?.kpiCalendar) {
      const d = s.meta.kpiCalendar || {};
      const cal = Array.isArray(d.calendrier || d.calendar) ? (d.calendrier || d.calendar) : [];
      const kpis = Array.isArray(d.kpis) ? d.kpis : [];

      if (cal.length) {
        children.push(
          new Paragraph({ text: "Calendrier d’exécution", heading: HeadingLevel.HEADING_2 })
        );
        const rows = cal.map((r) => [
          cleanText(r.periode || r.period || ""),
          asBullets(r.jalons || r.milestones).join("\n"),
          asBullets(r.livrables || r.deliverables).join("\n"),
          cleanText(r.responsable || r.owner || ""),
        ]);
        children.push(makeTable(["Période", "Jalons", "Livrables", "Responsable"], rows));
        children.push(new Paragraph({ text: "" }));
      }

      if (kpis.length) {
        children.push(
          new Paragraph({
            text: "Indicateurs Clés de Performance (KPIs)",
            heading: HeadingLevel.HEADING_2,
          })
        );
        const rows = kpis.map((r) => [
          cleanText(r.kpi || ""),
          cleanText(r.definition || ""),
          cleanText(r.cible_12m || r.target_12m || ""),
          cleanText(r.frequence || r.frequency || ""),
          cleanText(r.responsable || r.owner || ""),
        ]);
        children.push(makeTable(["KPI", "Définition", "Cible 12m", "Fréquence", "Responsable"], rows));
        children.push(new Paragraph({ text: "" }));
      }
      continue;
    }

    // Financials
    if (key === "financials_json" && s?.meta?.financials) {
      const fin = s.meta.financials || {};
      const years = Array.isArray(fin.years) ? fin.years : ["Y1", "Y2", "Y3", "Y4", "Y5"];

      const addYearTable = (title2, rows, defaultFmt) => {
        children.push(new Paragraph({ text: title2, heading: HeadingLevel.HEADING_2 }));
        const header = ["Ligne", ...years];
        const body = (rows || []).map((r) => {
          const fmt = String(r?.__format || defaultFmt);
          const vals = years.map((y) => {
            const v = r?.[y];
            if (fmt === "percent") return formatPercent(v);
            if (fmt === "number") return formatMoney(v);
            return formatMoney(v);
          });
          return [cleanText(r?.label || ""), ...vals];
        });
        children.push(makeTable(header, body), new Paragraph({ text: "" }));
      };

      if (Array.isArray(fin.assumptions) && fin.assumptions.length) {
        children.push(new Paragraph({ text: "Hypothèses clés", heading: HeadingLevel.HEADING_2 }));
        const rows = fin.assumptions.map((a) => [cleanText(a.label || ""), cleanText(a.value || "")]);
        children.push(makeTable(["Indicateur", "Valeur"], rows), new Paragraph({ text: "" }));
      }

      addYearTable("Drivers de revenus", fin.revenue_drivers || [], "number");
      addYearTable("Compte de résultat (P&L)", fin.pnl || [], "money");
      addYearTable("Cashflow", fin.cashflow || [], "money");
      addYearTable("Bilan simplifié", fin.balance_sheet || [], "money");

      if (fin.break_even) {
        children.push(
          new Paragraph({ text: "Point mort / Break-even", heading: HeadingLevel.HEADING_2 }),
          new Paragraph(
            `Estimation : ${cleanText(fin.break_even.estimate)} ${cleanText(fin.break_even.metric)}`
          ),
          new Paragraph(cleanText(fin.break_even.explanation || "")),
          new Paragraph({ text: "" })
        );
      }

      if (Array.isArray(fin.use_of_funds) && fin.use_of_funds.length) {
        children.push(new Paragraph({ text: "Utilisation des fonds", heading: HeadingLevel.HEADING_2 }));
        const rows = fin.use_of_funds.map((u) => [
          cleanText(u.label || ""),
          formatMoney(u.amount || 0),
          cleanText(u.notes || ""),
        ]);
        children.push(makeTable(["Poste", "Montant", "Notes"], rows), new Paragraph({ text: "" }));
      }

      if (Array.isArray(fin.scenarios) && fin.scenarios.length) {
        children.push(new Paragraph({ text: "Scénarios", heading: HeadingLevel.HEADING_2 }));
        fin.scenarios.forEach((sc) => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `• ${cleanText(sc.name || "")}: ${cleanText(sc.note || "")}` })],
            })
          );
        });
        children.push(new Paragraph({ text: "" }));
      }

      continue;
    }

    // Default: plain text content
    const lines = cleanText(s?.content || "").split("\n");
    for (const ln of lines) {
      const t = ln.trim();
      if (!t) {
        children.push(new Paragraph({ text: "" }));
        continue;
      }
      // heuristic: treat "TITLE" or "Numbered" lines as sub-headings
      const isSub =
        t.endsWith(":") ||
        /^[0-9]+\.\s+/.test(t) ||
        /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ\s]{6,}$/.test(t);

      if (isSub) {
        children.push(
          new Paragraph({
            text: t.replace(/:$/, ""),
            heading: HeadingLevel.HEADING_2,
          })
        );
      } else {
        children.push(new Paragraph({ text: t }));
      }
    }

    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}