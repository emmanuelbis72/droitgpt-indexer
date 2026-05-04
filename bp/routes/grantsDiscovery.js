// bp/routes/grantsDiscovery.js
import express from "express";
import {
  discoverGrantOpportunities,
  enrichGrantOpportunity,
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

export default router;
