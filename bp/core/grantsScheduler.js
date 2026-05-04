// bp/core/grantsScheduler.js
import { discoverGrantOpportunities, enrichGrantOpportunity } from "./grantsDiscovery.js";
import {
  listWatchConfigs,
  markWatchRun,
  upsertOpportunities,
} from "./grantsDb.js";
import { sendGrantAlerts } from "./grantsAlerts.js";

let schedulerTimer = null;
let running = false;

export function startGrantsScheduler() {
  if (schedulerTimer || process.env.GRANTS_SCHEDULER_ENABLED === "0") return;
  const intervalMs = Number(process.env.GRANTS_SCHEDULER_TICK_MS || 5 * 60 * 1000);
  schedulerTimer = setInterval(() => {
    runDueGrantWatches().catch((e) => console.error("[GRANTS][scheduler]", e));
  }, intervalMs);
  schedulerTimer.unref?.();
  setTimeout(() => runDueGrantWatches().catch((e) => console.error("[GRANTS][scheduler:init]", e)), 1500).unref?.();
}

export async function runDueGrantWatches({ force = false } = {}) {
  if (running) return { skipped: "already_running" };
  running = true;
  try {
    const now = Date.now();
    const configs = await listWatchConfigs();
    const due = configs.filter((cfg) => cfg.enabled && (force || !cfg.nextRunAt || new Date(cfg.nextRunAt).getTime() <= now));
    const results = [];
    for (const cfg of due) {
      results.push(await runGrantWatchConfig(cfg));
    }
    return { ok: true, due: due.length, results };
  } finally {
    running = false;
  }
}

export async function runGrantWatchConfig(cfg) {
  const discovery = await discoverGrantOpportunities(cfg.query || {});
  const current = discovery.opportunities || [];
  const before = await upsertOpportunities([], {});
  const knownFingerprints = new Set(before.db.opportunities.map((x) => x.fingerprint));

  const enrichLimit = Number(process.env.GRANTS_ENRICH_LIMIT_PER_RUN || 8);
  const enriched = [];
  for (const opp of current.slice(0, enrichLimit)) {
    const enrichment = await enrichGrantOpportunity(opp);
    enriched.push({
      ...opp,
      closeDate: enrichment.deadline || opp.closeDate,
      eligibility: enrichment.eligibility || opp.eligibility,
      language: enrichment.language,
      enrichment,
    });
  }

  const rest = current.slice(enrichLimit);
  const all = [...enriched, ...rest];
  const write = await upsertOpportunities(all, { enriched: true });
  const newItems = write.db.opportunities.filter((opp) => {
    const isFromRun = all.some((x) => x.id === opp.id || x.url === opp.url);
    return isFromRun && !knownFingerprints.has(opp.fingerprint);
  });

  const alertResult = await sendGrantAlerts({ watchConfig: cfg, newOpportunities: newItems });
  await markWatchRun(cfg.id, {
    ok: true,
    discovered: current.length,
    inserted: write.inserted,
    updated: write.updated,
    newCount: newItems.length,
    sourceStatus: discovery.sourceStatus,
    alerts: alertResult,
  });

  return {
    id: cfg.id,
    name: cfg.name,
    discovered: current.length,
    inserted: write.inserted,
    updated: write.updated,
    newCount: newItems.length,
  };
}
