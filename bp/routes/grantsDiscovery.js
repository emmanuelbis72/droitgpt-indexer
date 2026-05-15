// bp/routes/grantsDiscovery.js
import express from "express";
import crypto from "node:crypto";
import {
  classifyOpportunityType,
  discoverGrantOpportunities,
  enrichGrantOpportunity,
  getOpportunityFreshness,
  makeWatchKey,
} from "../core/grantsDiscovery.js";
import {
  getOpportunity,
  getCompanyProfile,
  listOpportunities,
  listWatchConfigs,
  saveApplicationDraft,
  saveCompanyProfile,
  saveWatchConfig,
  updateOpportunityUserState,
  upsertOpportunities,
} from "../core/grantsDb.js";
import { runDueGrantWatches, runGrantWatchConfig } from "../core/grantsScheduler.js";
import { generateGrantApplicationAnswers, normalizeQuestions } from "../core/grantsApplicationAssistant.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Grant discovery and watch endpoint OK.",
    endpoints: {
      discoverGet: "GET /generate-grants-management/discover?country=RDC&sector=education&keywords=education",
      discoverPost: "POST /generate-grants-management/discover",
      opportunities: "GET /generate-grants-management/opportunities",
      opportunityDetail: "GET /generate-grants-management/opportunities/:id",
      importOpportunities: "POST /generate-grants-management/opportunities/import",
      updateOpportunity: "PATCH /generate-grants-management/opportunities/:id",
      profile: "GET/PUT /generate-grants-management/profile",
      autofill: "POST /generate-grants-management/opportunities/:id/autofill",
      createWatch: "POST /generate-grants-management/watch",
      listWatches: "GET /generate-grants-management/watch",
      watchRun: "POST /generate-grants-management/watch/run",
    },
    sources: [
      "grants.gov",
      "undp",
      "opportunities-for-youth",
      "vc4a",
      "scholarshipset",
      "eu",
      "worldbank",
      "ungm",
      "linkedin",
      "foundations",
      "embassies",
    ],
    customSites: {
      description: "Optionnel: ajoute des portails publics a scanner.",
      example: [{ name: "Example donor", url: "https://example.org/search?q={q}" }],
    },
  });
});

router.get("/profile", async (_req, res) => {
  try {
    const profile = await getCompanyProfile();
    return res.json({ ok: true, profile });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_PROFILE_GET_FAILED", details: String(e?.message || e) });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const profile = await saveCompanyProfile(req.body || {});
    return res.json({ ok: true, profile });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_PROFILE_SAVE_FAILED", details: String(e?.message || e) });
  }
});

router.get("/discover", async (req, res) => {
  try {
    const result = await discoverGrantOpportunities(req.query || {});
    if (String(req.query?.save || "") === "1") {
      await upsertOpportunities(result.opportunities || []);
    }
    return res.json(result);
  } catch (e) {
    return res.status(502).json({
      error: "GRANTS_DISCOVERY_FAILED",
      details: String(e?.message || e),
    });
  }
});

router.post("/discover", async (req, res) => {
  try {
    const result = await discoverGrantOpportunities(req.body || {});
    if (req.body?.save !== false) {
      const write = await upsertOpportunities(result.opportunities || {});
      result.db = { inserted: write.inserted, updated: write.updated };
    }
    return res.json(result);
  } catch (e) {
    return res.status(502).json({
      error: "GRANTS_DISCOVERY_FAILED",
      details: String(e?.message || e),
    });
  }
});

router.get("/opportunities", async (req, res) => {
  try {
    const result = await listOpportunities(req.query || {});
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_LIST_FAILED", details: String(e?.message || e) });
  }
});

router.post("/opportunities/import", async (req, res) => {
  try {
    const parsed = parseImportedOpportunities(req.body || {});
    if (!parsed.opportunities.length) {
      return res.status(400).json({
        error: "NO_IMPORTABLE_OPPORTUNITIES",
        details:
          "Ajoute des opportunites en JSON, CSV ou lignes texte avec au moins un titre ou une URL.",
        issues: parsed.issues,
      });
    }

    const write = await upsertOpportunities(parsed.opportunities);
    return res.status(201).json({
      ok: true,
      total: parsed.opportunities.length,
      inserted: write.inserted,
      updated: write.updated,
      issues: parsed.issues,
    });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_IMPORT_FAILED", details: String(e?.message || e) });
  }
});

router.get("/opportunities/:id", async (req, res) => {
  try {
    const opp = await getOpportunity(String(req.params.id || ""));
    if (!opp) return res.status(404).json({ error: "OPPORTUNITY_NOT_FOUND" });
    return res.json({ ok: true, opportunity: opp });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_GET_FAILED", details: String(e?.message || e) });
  }
});

router.post("/opportunities/:id/enrich", async (req, res) => {
  try {
    const opp = await getOpportunity(String(req.params.id || ""));
    if (!opp) return res.status(404).json({ error: "OPPORTUNITY_NOT_FOUND" });
    const enrichment = await enrichGrantOpportunity(opp);
    const write = await upsertOpportunities([{ ...opp, enrichment, closeDate: enrichment.deadline || opp.closeDate }], {
      enriched: true,
    });
    const updated = write.db.opportunities.find((x) => x.id === opp.id);
    return res.json({ ok: true, opportunity: updated, enrichment });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_ENRICH_FAILED", details: String(e?.message || e) });
  }
});

router.post("/opportunities/:id/autofill", async (req, res) => {
  try {
    const opp = await getOpportunity(String(req.params.id || ""));
    if (!opp) return res.status(404).json({ error: "OPPORTUNITY_NOT_FOUND" });

    const companyProfile = req.body?.profile || (await getCompanyProfile());
    const questions = normalizeQuestions(
      req.body?.questions ||
        opp.enrichment?.formQuestions ||
        []
    );

    if (!questions.length) {
      return res.status(400).json({
        error: "NO_QUESTIONS",
        details: "Ajoute des questions dans le corps de la requete ou lance l'enrichissement pour extraire les questions visibles.",
      });
    }

    const lang = req.body?.lang || companyProfile?.languagePreference || opp.language || "fr";
    const result = await generateGrantApplicationAnswers({
      lang,
      companyProfile,
      opportunity: opp,
      questions,
    });
    const draft = await saveApplicationDraft({
      opportunityId: opp.id,
      questions,
      answers: result.answers,
      meta: {
        missingProfileFields: result.missingProfileFields,
        warnings: result.warnings,
        language: result.language,
      },
    });

    return res.json({ ok: true, draft, result });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_AUTOFILL_FAILED", details: String(e?.message || e) });
  }
});

router.patch("/opportunities/:id", async (req, res) => {
  try {
    const updated = await updateOpportunityUserState(String(req.params.id || ""), req.body || {});
    if (!updated) return res.status(404).json({ error: "OPPORTUNITY_NOT_FOUND" });
    return res.json({ ok: true, opportunity: updated });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_UPDATE_FAILED", details: String(e?.message || e) });
  }
});

router.get("/watch", async (_req, res) => {
  try {
    const watches = await listWatchConfigs();
    return res.json({ ok: true, watches });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_WATCH_LIST_FAILED", details: String(e?.message || e) });
  }
});

router.post("/watch", async (req, res) => {
  try {
    const body = req.body || {};
    const watch = await saveWatchConfig({
      id: body.id || makeWatchKey(body.query || body),
      name: body.name || "Veille grants",
      enabled: body.enabled !== false,
      intervalHours: body.intervalHours || 24,
      query: body.query || body,
      alerts: body.alerts || {},
    });
    return res.status(201).json({ ok: true, watch });
  } catch (e) {
    return res.status(500).json({ error: "GRANTS_WATCH_SAVE_FAILED", details: String(e?.message || e) });
  }
});

router.post("/watch/run", async (req, res) => {
  try {
    const body = req.body || {};
    if (body.id) {
      const watches = await listWatchConfigs();
      const cfg = watches.find((x) => x.id === body.id);
      if (!cfg) return res.status(404).json({ error: "WATCH_NOT_FOUND" });
      const result = await runGrantWatchConfig(cfg);
      return res.json({ ok: true, result });
    }

    if (body.query || body.keywords || body.sector || body.country) {
      const cfg = await saveWatchConfig({
        id: body.id || makeWatchKey(body.query || body),
        name: body.name || "Veille grants manuelle",
        enabled: body.enabled !== false,
        intervalHours: body.intervalHours || 24,
        query: body.query || body,
        alerts: body.alerts || {},
      });
      const result = await runGrantWatchConfig(cfg);
      return res.json({ ok: true, result });
    }

    const result = await runDueGrantWatches({ force: Boolean(body.force) });
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(502).json({
      error: "GRANTS_WATCH_FAILED",
      details: String(e?.message || e),
    });
  }
});

function parseImportedOpportunities(body = {}) {
  const issues = [];
  const source = cleanImport(body.source || body.platform || "import-externe", 80);
  const donor = cleanImport(body.donor || body.bailleur || body.platform || "", 160);
  const includeClosed = body.includeClosed === true;
  const items = [];

  if (Array.isArray(body.items)) items.push(...body.items);
  else if (body.item && typeof body.item === "object") items.push(body.item);

  const text = String(body.text || body.raw || body.csv || "").trim();
  if (text) {
    const jsonItems = parseImportJson(text);
    if (jsonItems) items.push(...jsonItems);
    else {
      const delimited = parseDelimitedImport(text);
      if (delimited.length) items.push(...delimited);
      else items.push(...parseLineImport(text));
    }
  }

  const opportunities = items
    .slice(0, 200)
    .map((item, idx) => normalizeImportedOpportunity(item, { source, donor, idx, issues }))
    .filter((opp) => {
      if (!opp) return false;
      if (includeClosed) return true;
      if (opp.freshness?.active) return true;
      issues.push(`Ignoree car expiree: ${opp.title}`);
      return false;
    })
    .filter(Boolean);

  if (items.length > 200) issues.push("Import limite aux 200 premieres lignes pour garder le traitement stable.");

  return { opportunities, issues };
}

function parseImportJson(text) {
  const s = String(text || "").trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.opportunities)) return parsed.opportunities;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (parsed && typeof parsed === "object") return [parsed];
    return null;
  } catch {
    return null;
  }
}

function parseDelimitedImport(text) {
  const lines = String(text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]);
  if (!delimiter) return [];

  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeImportHeader);
  const usefulHeaders = new Set(["title", "donor", "url", "deadline", "description", "eligibility", "category", "source"]);
  if (!headers.some((h) => usefulHeaders.has(h))) return [];

  return lines.slice(1).map((line) => {
    const cols = parseDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, idx) => {
      if (header) row[header] = cols[idx] || "";
    });
    return row;
  });
}

function parseLineImport(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const url = extractFirstUrl(line);
      const parts = line.split("|").map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const urlPart = parts.find((p) => isUrl(p)) || url;
        const nonUrl = parts.filter((p) => p !== urlPart);
        return {
          title: nonUrl[0] || titleFromUrl(urlPart),
          donor: nonUrl[1] || "",
          deadline: nonUrl[2] || "",
          url: urlPart || "",
          description: nonUrl.slice(3).join(" | "),
        };
      }
      return {
        title: cleanImport(line.replace(url, ""), 260) || titleFromUrl(url),
        url,
        description: url ? "" : line,
      };
    });
}

function normalizeImportedOpportunity(item, { source, donor, idx, issues }) {
  const raw = item && typeof item === "object" ? item : { title: String(item || "") };
  const url = cleanImport(raw.url || raw.link || raw.href || raw.sourceUrl || "", 700);
  const resolvedSource = cleanImport(raw.source || inferSourceFromUrl(url, source), 80);
  const title = cleanImport(
    raw.title || raw.name || raw.opportunity || raw.titre || raw.appel || titleFromUrl(url),
    300
  );

  if (!title && !url) {
    issues.push(`Ligne ${idx + 1} ignoree: titre et URL absents.`);
    return null;
  }

  const resolvedDonor = cleanImport(
    raw.donor || raw.bailleur || raw.funder || raw.organization || raw.organisation || donor || resolvedSource,
    180
  );
  const closeDate = cleanImport(raw.closeDate || raw.deadline || raw.dateLimite || raw.closingDate || "", 120);
  const description = cleanImport(raw.description || raw.summary || raw.resume || raw.text || raw.texte || "", 1400);
  const eligibility = cleanImport(raw.eligibility || raw.eligibilite || raw.criteria || raw.criteres || "", 900);
  const category = cleanImport(raw.category || raw.sector || raw.domain || raw.domaine || "", 180);
  const idSeed = [resolvedSource, title, resolvedDonor, url, closeDate].filter(Boolean).join("|");
  const base = {
    id: raw.id || `import:${crypto.createHash("sha256").update(idSeed || JSON.stringify(raw)).digest("hex").slice(0, 24)}`,
    source: resolvedSource || "import-externe",
    title: title || "Opportunite importee",
    donor: resolvedDonor,
    opportunityNumber: cleanImport(raw.opportunityNumber || raw.reference || raw.ref || "", 120),
    status: cleanImport(raw.status || "imported", 80),
    postedDate: cleanImport(raw.postedDate || raw.publicationDate || "", 120),
    closeDate,
    category,
    eligibility,
    description,
    url,
    language: cleanImport(raw.language || "fr", 20),
    raw,
  };
  const opportunityType = raw.opportunityType || raw.type || classifyOpportunityType(base);
  const freshness = getOpportunityFreshness(base);

  return {
    ...base,
    opportunityType,
    audienceCategory: opportunityType,
    categoryLabel: labelForOpportunityType(opportunityType),
    freshness,
    match: {
      score: Number(raw.score || raw.match?.score || 55),
      reasons: [labelForOpportunityType(opportunityType), "Import externe", url ? "URL source disponible" : "Source a verifier"],
    },
  };
}

function labelForOpportunityType(type) {
  if (type === "scholarship") return "Bourses";
  if (type === "entrepreneur") return "Entrepreneurs";
  return "ONG / appels a projets";
}

function detectDelimiter(headerLine) {
  const line = String(headerLine || "");
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes(",")) return ",";
  return "";
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let cur = "";
  let quoted = false;
  const s = String(line || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (quoted && s[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === delimiter && !quoted) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normalizeImportHeader(header) {
  const h = String(header || "").toLowerCase().trim();
  const compact = h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const map = {
    titre: "title",
    title: "title",
    opportunity: "title",
    opportunite: "title",
    appel: "title",
    bailleur: "donor",
    donor: "donor",
    funder: "donor",
    organisation: "donor",
    organization: "donor",
    url: "url",
    link: "url",
    lien: "url",
    deadline: "deadline",
    datelimite: "deadline",
    closingdate: "deadline",
    description: "description",
    resume: "description",
    summary: "description",
    eligibilite: "eligibility",
    eligibility: "eligibility",
    criteres: "eligibility",
    criteria: "eligibility",
    source: "source",
    categorie: "category",
    category: "category",
    secteur: "category",
    sector: "category",
  };
  return map[compact] || compact;
}

function inferSourceFromUrl(url, fallback) {
  try {
    const host = new URL(String(url || "")).hostname.replace(/^www\./, "");
    return host || fallback;
  } catch {
    return fallback;
  }
}

function extractFirstUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s|,;]+/i);
  return cleanImport(m?.[0] || "", 700);
}

function isUrl(text) {
  return /^https?:\/\//i.test(String(text || "").trim());
}

function titleFromUrl(url) {
  try {
    const u = new URL(String(url || ""));
    const last = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return cleanImport(decodeURIComponent(last).replace(/[-_]+/g, " "), 220);
  } catch {
    return "";
  }
}

function cleanImport(value, max = 500) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export default router;
