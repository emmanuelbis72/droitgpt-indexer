// bp/core/grantsSearch.js
import { classifyOpportunityWithAI } from "./grantsAi.js";
import { indexOpportunity } from "./grantsIndexer.js";
import { listSources, saveOpportunity, saveOpportunities } from "./grantsStorage.js";
import { clean, cleanUrl, normalizeArray, verifyOpportunity } from "./grantsVerifier.js";

const USER_AGENT = process.env.GRANTS_DISCOVERY_USER_AGENT || "DroitGPT-Grants/1.0 (+https://www.droitgpt.com)";

export async function searchWeb(query, { maxResults = 10, includeDomains = [] } = {}) {
  const q = clean(query, 500);
  if (!q) return [];

  if (process.env.EXA_API_KEY) return searchExa(q, maxResults, { includeDomains });

  const err = new Error("WEB_SEARCH_NOT_CONFIGURED");
  err.code = "WEB_SEARCH_NOT_CONFIGURED";
  err.details = "EXA_API_KEY is required for live web search.";
  throw err;
}

export async function searchAndIndexOpportunities(params = {}) {
  const maxResults = clampInt(params.maxResults, 1, 25, 12);
  const candidateLimit = clampInt(params.candidateLimit, maxResults, 80, Math.max(maxResults * 5, 30));
  const query = buildSearchQuery(params);
  const customSites = normalizeCustomSites(params.sites || params.customSites || params.sourceUrls || params.sources);
  console.log("[GRANTS] search started", { query, maxResults, candidateLimit, customSites: customSites.urls.length });

  let searchResults = [];
  let warning = null;
  try {
    searchResults = await runAgentWebSearch({ params, query, maxResults, candidateLimit, customSites });
  } catch (e) {
    if (e.code !== "WEB_SEARCH_NOT_CONFIGURED") throw e;
    warning = "WEB_SEARCH_NOT_CONFIGURED";
    searchResults = await searchConfiguredSourcesIndex({ ...params, query, maxResults: candidateLimit });
  }
  if (customSites.urls.length) {
    const customLinks = await searchCustomSitesIndex(customSites.urls, params);
    searchResults = dedupeByUrl([...customLinks, ...searchResults]);
  }
  if (!searchResults.length) {
    warning = warning || "WEB_SEARCH_EMPTY_FALLBACK_TO_SOURCES";
    searchResults = await searchConfiguredSourcesIndex({ ...params, query, maxResults: candidateLimit });
  }

  const extracted = [];
  for (const result of searchResults.slice(0, candidateLimit)) {
    if (!result.url) continue;
    const opp = await extractOpportunityFromPage(result.url, {
      sourceName: result.sourceName || hostLabel(result.url),
      seed: result,
      defaults: params,
    });
    if (opp) extracted.push(opp);
  }

  const saved = [];
  const skippedInactive = [];
  for (const raw of extracted) {
    const verified = verifyOpportunity(raw);
    if (!verified.sourceUrl) continue;
    if (!isCurrentOpportunity(verified)) {
      skippedInactive.push({ title: verified.title, sourceUrl: verified.sourceUrl, status: verified.status, deadline: verified.deadline });
      continue;
    }
    const write = await saveOpportunity(verified);
    if (write.saved) {
      saved.push(write.saved);
      await indexOpportunity(write.saved);
      console.log("[GRANTS] saved", { id: write.saved.id, status: write.saved.status, sourceUrl: write.saved.sourceUrl });
      if (saved.length >= maxResults) break;
    }
  }

  return {
    query,
    warning,
    results: saved,
    total: saved.length,
    candidates: searchResults.length,
    extracted: extracted.length,
    skippedInactive: skippedInactive.length,
    customSites: customSites.urls.length,
  };
}

export async function crawlConfiguredSources(params = {}) {
  const sources = (await listSources()).filter((source) => source.active !== false);
  const maxPerSource = clampInt(params.maxPerSource, 1, 8, 3);
  const maxSources = clampInt(params.maxSources, 1, 40, 20);
  const collected = [];
  const sourceStatus = [];

  console.log("[GRANTS] crawl started", { sources: sources.length });

  for (const source of sources.slice(0, maxSources)) {
    try {
      const links = await extractLinksFromSource(source, params);
      sourceStatus.push({ source: source.name, ok: true, count: links.length });
      console.log("[GRANTS] source crawled", { source: source.name, count: links.length });
      for (const link of links.slice(0, maxPerSource)) {
        const opp = await extractOpportunityFromPage(link.url, {
          sourceName: source.name,
          seed: link,
          defaults: { ...params, type: source.type, region: source.region },
        });
        if (opp) collected.push(opp);
      }
    } catch (e) {
      sourceStatus.push({ source: source.name, ok: false, error: String(e?.message || e) });
      console.warn("[GRANTS] error", { source: source.name, error: String(e?.message || e) });
    }
  }

  const verified = collected.map(verifyOpportunity).filter((opp) => opp.sourceUrl);
  const current = verified.filter(isCurrentOpportunity);
  const skippedInactive = verified.length - current.length;
  const write = await saveOpportunities(current);
  for (const opp of write.saved) await indexOpportunity(opp);
  return { sourceStatus, results: write.saved, skipped: write.skipped, skippedInactive, total: write.saved.length };
}

export async function extractOpportunityFromPage(url, { sourceName, seed = {}, defaults = {} } = {}) {
  const sourceUrl = cleanUrl(url);
  if (!sourceUrl) return null;

  let html = "";
  let usedSearchExtract = false;
  if (seed.rawText) {
    html = String(seed.rawText || "");
    usedSearchExtract = true;
  } else {
    try {
      html = await fetchText(sourceUrl);
    } catch (e) {
      return verifyOpportunity({
        title: seed.title || titleFromUrl(sourceUrl),
        sourceUrl,
        applicationUrl: sourceUrl,
        sourceName,
        type: defaults.type,
        region: defaults.region,
        status: "draft_review",
        reliabilityScore: 30,
        verificationNotes: `Contenu source inaccessible: ${String(e?.message || e)}`,
      });
    }
  }

  const text = stripTags(html);
  const ai = await classifyOpportunityWithAI({ rawText: text, sourceUrl, sourceName });
  const heuristic = extractHeuristicOpportunity({ html, text, sourceUrl, sourceName, seed, defaults });
  return {
    ...heuristic,
    ...dropEmpty(ai),
    sourceUrl,
    applicationUrl: ai.applicationUrl || heuristic.applicationUrl || sourceUrl,
    verificationNotes: [
      usedSearchExtract ? "Texte extrait via Exa utilise car la page source bloque le fetch direct." : "",
      ai.verificationNotes || heuristic.verificationNotes || "",
    ].filter(Boolean).join(" "),
    rawContent: clean(text, 18000),
    extractedAt: new Date().toISOString(),
  };
}

async function searchConfiguredSourcesIndex(params = {}) {
  const sources = (await listSources()).filter((source) => source.active !== false);
  const terms = tokenize(buildSearchQuery(params));
  const out = [];
  for (const source of sources.slice(0, 20)) {
    try {
      const links = await extractLinksFromSource(source, params);
      out.push(...links.filter((link) => terms.some((t) => `${link.title} ${link.url}`.toLowerCase().includes(t))));
    } catch {
      // keep searching other sources
    }
  }
  return out.slice(0, clampInt(params.maxResults, 1, 25, 10));
}

async function runAgentWebSearch({ params = {}, query, maxResults, candidateLimit, customSites }) {
  const queries = buildAgentQueries(params, query);
  const perQuery = Math.min(12, Math.max(5, Math.ceil(candidateLimit / Math.max(1, queries.length - 1))));
  const sources = (await listSources()).filter((source) => source.active !== false);
  const sourceDomains = [...new Set(sources.map((source) => domainFromUrl(source.url || source.baseUrl)).filter(Boolean))];
  const domainBatches = [
    customSites.domains.length ? customSites.domains : [],
    sourceDomains,
  ].filter((domains) => domains.length);

  const results = [];
  for (const q of queries) {
    const batch = await safeWebSearch(q, { maxResults: perQuery, includeDomains: [] });
    results.push(...batch);
    if (results.length >= candidateLimit) break;
  }

  for (const domains of domainBatches) {
    for (const q of queries.slice(0, 4)) {
      const batch = await safeWebSearch(q, { maxResults: perQuery, includeDomains: domains });
      results.push(...batch);
      if (results.length >= candidateLimit * 2) break;
    }
  }

  return dedupeByUrl(results).slice(0, Math.max(candidateLimit, maxResults));
}

async function safeWebSearch(query, options) {
  try {
    return await searchWeb(query, options);
  } catch (e) {
    if (e.code === "WEB_SEARCH_NOT_CONFIGURED") throw e;
    console.warn("[GRANTS] error", { search: query, error: String(e?.message || e) });
    return [];
  }
}

async function searchCustomSitesIndex(sites = [], params = {}) {
  const out = [];
  for (const site of sites.slice(0, 12)) {
    try {
      const links = await extractLinksFromSource({
        name: site.name || hostLabel(site.url),
        url: site.url,
        baseUrl: site.url,
      }, params);
      out.push(...links);
    } catch (e) {
      console.warn("[GRANTS] error", { customSite: site.url, error: String(e?.message || e) });
      out.push({ title: site.name || titleFromUrl(site.url), url: site.url, sourceName: site.name || hostLabel(site.url) });
    }
  }
  return dedupeByUrl(out);
}

async function extractLinksFromSource(source, params = {}) {
  const html = await fetchText(source.url || source.baseUrl);
  const links = extractLinks(html, source.url || source.baseUrl);
  const terms = tokenize(buildSearchQuery(params));
  return links
    .filter((link) => isOpportunityLike(`${link.title} ${link.url}`))
    .filter((link) => !terms.length || terms.some((term) => `${link.title} ${link.url}`.toLowerCase().includes(term)))
    .slice(0, 20)
    .map((link) => ({ ...link, sourceName: source.name }));
}

function extractHeuristicOpportunity({ html, text, sourceUrl, sourceName, seed, defaults }) {
  const title = extractTitle(html) || seed.title || titleFromUrl(sourceUrl);
  const applicationUrl = findApplicationUrl(html, sourceUrl) || sourceUrl;
  return {
    title,
    organization: sourceName || hostLabel(sourceUrl),
    type: defaults.type || inferType(`${title} ${text} ${sourceUrl}`),
    summary: seed.snippet || firstSentence(text, 650),
    description: firstSentence(text, 2500),
    eligibility: extractSection(text, /(eligib|eligible|who can apply|qui peut postuler|criteres)/i),
    countries: normalizeArray(defaults.country || extractCountries(text).join(";")),
    region: clean(defaults.region || inferRegion(text), 120),
    sectors: normalizeArray(defaults.sectors || defaults.sector || inferSectors(text).join(";")),
    amount: extractAmount(text),
    deadline: extractDeadline(text),
    deadlineText: extractDeadline(text),
    applicationUrl,
    sourceUrl,
    sourceName,
    language: detectLanguage(text),
    rawContent: text,
  };
}

async function searchExa(query, maxResults, { includeDomains = [] } = {}) {
  const body = {
    query,
    type: process.env.EXA_SEARCH_TYPE || "auto",
    numResults: maxResults,
    contents: { text: { maxCharacters: 12000 } },
    additionalQueries: [
      `${query} deadline apply now`,
      `${query} currently accepting applications`,
      `${query} date limite candidature ouverte`,
    ],
  };
  if (includeDomains.length) body.includeDomains = includeDomains.slice(0, 1200);

  const json = await fetchJson("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY },
    body: JSON.stringify(body),
  });
  return (json?.results || []).map((r) => ({
    title: clean(r.title, 260),
    url: cleanUrl(r.url),
    snippet: clean(r.text || r.contents?.text || r.summary || "", 700),
    sourceName: hostLabel(r.url),
    publishedDate: clean(r.publishedDate, 80),
    rawText: clean(r.text || r.contents?.text || "", 12000),
  })).filter((r) => r.url);
}

function buildSearchQuery(params = {}) {
  const currentYear = new Date().getFullYear();
  return [
    params.query,
    params.country,
    params.region,
    ...(Array.isArray(params.sectors) ? params.sectors : [params.sector]).filter(Boolean),
    ...(Array.isArray(params.types) ? params.types : [params.type]).filter(Boolean),
    currentYear,
    "deadline open apply now currently accepting applications",
    params.language === "fr" ? "appel a projets subvention bourse financement" : "grant funding scholarship accelerator",
  ].filter(Boolean).join(" ");
}

function buildAgentQueries(params = {}, baseQuery = "") {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const country = clean(params.country, 120);
  const region = clean(params.region, 120);
  const sectors = Array.isArray(params.sectors) ? params.sectors : [params.sector].filter(Boolean);
  const types = Array.isArray(params.types) ? params.types : [params.type].filter(Boolean);
  const sectorText = sectors.filter(Boolean).join(" ");
  const typeText = types.filter(Boolean).join(" ");
  const place = [country, region].filter(Boolean).join(" ");
  const base = clean(baseQuery || buildSearchQuery(params), 500);

  return dedupeStrings([
    base,
    `${base} deadline ${currentYear} ${nextYear} apply now`,
    `${base} currently accepting applications open call`,
    `${base} date limite ${currentYear} ${nextYear} candidature ouverte`,
    `open grants ${typeText} ${sectorText} ${place} deadline ${currentYear}`,
    `call for proposals ${sectorText} ${place} apply deadline ${currentYear}`,
    `funding opportunities NGOs nonprofits ${sectorText} ${place} currently open`,
    `bourses concours incubateurs accélérateurs financement ${sectorText} ${place} date limite ${currentYear}`,
    `site:fundsforngos.org ${base}`,
    `site:opportunitydesk.org ${base}`,
    `site:opportunitiesforafricans.com ${base}`,
    `site:youthop.com ${base}`,
  ]).slice(0, 12);
}

function dedupeStrings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const value = clean(item, 500);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeCustomSites(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\r?\n|[,;]/);
  const urls = raw
    .map((item) => {
      if (item && typeof item === "object") {
        return { name: clean(item.name, 180), url: cleanUrl(item.url || item.baseUrl) };
      }
      const line = clean(item, 900);
      if (!line) return null;
      const [maybeName, maybeUrl] = line.includes("|") ? line.split("|").map((x) => x.trim()) : ["", line];
      return { name: clean(maybeName, 180), url: cleanUrl(maybeUrl || maybeName) };
    })
    .filter((site) => site?.url);
  return { urls, domains: [...new Set(urls.map((site) => domainFromUrl(site.url)).filter(Boolean))] };
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = Number(process.env.GRANTS_FETCH_TIMEOUT_MS || 12000)) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const title = clean(stripTags(match[2]), 260);
    const url = absoluteUrl(match[1], baseUrl);
    if (!title || !url || url.startsWith("mailto:") || url.startsWith("tel:")) continue;
    out.push({ title, url });
  }
  return dedupeByUrl(out);
}

function isOpportunityLike(text) {
  return /(grant|subvention|funding|appel|bourse|scholarship|fellowship|accelerator|incubator|challenge|competition|concours|apply|application|proposal)/i.test(text);
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const s = String(html || "");
  const og = s.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (og?.[1]) return clean(og[1], 300);
  const title = s.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1] ? clean(stripTags(title[1]), 300) : "";
}

function extractDeadline(text) {
  const m = String(text || "").match(/(?:deadline|closing date|close date|apply by|date limite|date de cloture|cloture)[:\s-]{0,14}([A-Za-zÀ-ÿ0-9,./\-\s]{6,70})/i);
  return clean(String(m?.[1] || "").split(/[.;|]/)[0], 120);
}

function extractAmount(text) {
  const m = String(text || "").match(/((?:USD|US\$|\$|EUR|€|GBP|£|CDF|XAF|FCFA)\s?[0-9][0-9,.\s]{2,}(?:\s?(?:to|-|–|a|à)\s?(?:USD|US\$|\$|EUR|€|GBP|£|CDF|XAF|FCFA)?\s?[0-9][0-9,.\s]*)?)/i);
  return clean(m?.[1] || "", 160);
}

function extractSection(text, pattern) {
  const s = String(text || "");
  const idx = s.search(pattern);
  if (idx < 0) return "";
  return clean(s.slice(idx, idx + 1200), 1200);
}

function extractCountries(text) {
  const countries = ["RDC", "DRC", "Congo", "Africa", "Afrique", "Rwanda", "Burundi", "Cameroon", "Cameroun", "Senegal", "Ghana", "Kenya", "Nigeria", "Uganda", "Tanzania", "Ethiopia"];
  const hay = String(text || "").toLowerCase();
  return countries.filter((country) => hay.includes(country.toLowerCase())).slice(0, 12);
}

function inferSectors(text) {
  const map = {
    education: /(education|enseignement|school|formation|students?)/i,
    health: /(health|sante|santé|medical|clinic)/i,
    climate: /(climate|climat|environment|energie|energy)/i,
    agriculture: /(agriculture|agri|farming|nutrition|food security)/i,
    entrepreneurship: /(startup|entrepreneur|business|sme|pme)/i,
  };
  return Object.entries(map).filter(([, re]) => re.test(text)).map(([key]) => key);
}

function inferRegion(text) {
  if (/(africa|afrique|sub-saharan|subsaharan)/i.test(text)) return "Africa";
  if (/(global|worldwide|international)/i.test(text)) return "global";
  return "";
}

function inferType(text) {
  if (/(scholarship|bourse|tuition|students?|master|phd)/i.test(text)) return "scholarship";
  if (/(accelerator|incubator|startup|entrepreneur)/i.test(text)) return "accelerator";
  if (/(challenge|competition|concours|prize)/i.test(text)) return "competition";
  if (/(fellowship|fellows)/i.test(text)) return "fellowship";
  if (/(ngo|ong|asbl|civil society|nonprofit)/i.test(text)) return "ngo_funding";
  if (/(call for proposals|appel)/i.test(text)) return "call_for_projects";
  if (/(grant|funding|subvention)/i.test(text)) return "grant";
  return "other";
}

function findApplicationUrl(html, sourceUrl) {
  const links = extractLinks(html, sourceUrl);
  const hit = links.find((link) => /(apply|application|postuler|candidature|submit|proposal)/i.test(`${link.title} ${link.url}`));
  return hit?.url || "";
}

function firstSentence(text, max) {
  return clean(String(text || "").slice(0, max), max);
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    return clean(decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname).replace(/[-_]+/g, " "), 220);
  } catch {
    return "";
  }
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function detectLanguage(text) {
  const s = String(text || "").toLowerCase();
  const fr = [" le ", " la ", " les ", " des ", " pour ", " projet ", " subvention "].filter((x) => s.includes(x)).length;
  const en = [" the ", " and ", " for ", " grant ", " funding ", " application "].filter((x) => s.includes(x)).length;
  if (fr > en) return "fr";
  if (en > fr) return "en";
  return "unknown";
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = cleanUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, url: key });
  }
  return out;
}

function isCurrentOpportunity(opportunity = {}) {
  if (opportunity.status === "expired" || opportunity.status === "hidden") return false;
  if (!opportunity.deadline) return true;
  const deadline = new Date(opportunity.deadline);
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() >= Date.now();
}

function dropEmpty(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    out[key] = value;
  }
  return out;
}

function tokenize(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9\u00c0-\u017f]+/i).filter((x) => x.length >= 3).slice(0, 20);
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
