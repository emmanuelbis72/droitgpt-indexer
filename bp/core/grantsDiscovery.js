// bp/core/grantsDiscovery.js
import crypto from "node:crypto";

const GRANTS_GOV_SEARCH_URL =
  process.env.GRANTS_GOV_SEARCH_URL || "https://api.grants.gov/v1/api/search2";

const DEFAULT_LIMIT = 20;
const USER_AGENT =
  process.env.GRANTS_DISCOVERY_USER_AGENT ||
  "DroitGPT-GrantsDiscovery/1.0 (+https://www.droitgpt.com)";

export async function discoverGrantOpportunities(input = {}) {
  const query = normalizeDiscoveryQuery(input);
  const sources = normalizeSources(input.sources);
  const startedAt = new Date().toISOString();

  const sourceTasks = [
    ...sources.map((source) => ({ source, run: () => searchSource(source, query) })),
    ...normalizeCustomSites(input.customSites).map((site) => ({
      source: site.source,
      run: () =>
        searchHtmlSource({
          source: site.source,
          donor: site.donor,
          url: site.url.replace("{q}", encodeURIComponent(query.keywords)),
          query,
          includeHosts: site.includeHosts,
        }),
    })),
  ];

  const batches = await Promise.allSettled(sourceTasks.map((task) => task.run()));

  const opportunities = [];
  const sourceStatus = [];

  for (let i = 0; i < batches.length; i++) {
    const source = sourceTasks[i].source;
    const result = batches[i];
    if (result.status === "fulfilled") {
      opportunities.push(...result.value);
      sourceStatus.push({ source, ok: true, count: result.value.length });
    } else {
      sourceStatus.push({
        source,
        ok: false,
        count: 0,
        error: String(result.reason?.message || result.reason),
      });
    }
  }

  const normalized = opportunities.map((opp) => normalizeOpportunityForDiscovery(opp, query));
  const active = normalized.filter((opp) => shouldKeepDiscoveredOpportunity(opp, query));
  const filteredOut = normalized.length - active.length;

  const deduped = dedupeOpportunities(active)
    .map((opp) => ({
      ...opp,
      freshness: getOpportunityFreshness(opp),
      match: scoreOpportunity(opp, query),
    }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, query.limit);

  return {
    ok: true,
    query,
    sourceStatus,
    total: deduped.length,
    filteredOut,
    categories: countOpportunityTypes(deduped),
    generatedAt: new Date().toISOString(),
    startedAt,
    opportunities: deduped,
    nextActions: buildDiscoveryNextActions(query, deduped),
  };
}

export async function enrichGrantOpportunity(opportunity = {}) {
  const url = clean(opportunity.url || "", 800);
  const base = {
    extractedAt: new Date().toISOString(),
    sourceUrl: url,
    ok: false,
    title: clean(opportunity.title || "", 300),
    deadline: clean(opportunity.closeDate || "", 120),
    countries: [],
    eligibility: clean(opportunity.eligibility || "", 700),
    budget: "",
    formQuestions: [],
    contactEmails: [],
    summaryText: clean(opportunity.description || "", 1200),
    language: detectLanguage([opportunity.title, opportunity.description].join(" ")),
    warnings: [],
  };

  if (!url || opportunity.status === "search_link") {
    return {
      ...base,
      warnings: ["Lien de recherche ou URL indisponible: enrichissement detail non applicable."],
    };
  }

  let html = "";
  try {
    html = await fetchText(url);
  } catch (e) {
    return {
      ...base,
      warnings: [`Impossible d'ouvrir la page detail: ${String(e?.message || e)}`],
    };
  }

  const text = clean(stripTags(html), 12000);
  const title = extractTitle(html) || base.title;
  const deadline = extractDeadline(text) || base.deadline;
  const countries = extractCountries(text);
  const budget = extractBudget(text);
  const eligibility = extractEligibility(text) || base.eligibility;
  const formQuestions = extractFormQuestions(html, text);
  const contactEmails = extractEmails(text);

  return {
    ...base,
    ok: true,
    title,
    deadline,
    countries,
    eligibility,
    budget,
    formQuestions,
    contactEmails,
    summaryText: clean(text, 1800),
    language: detectLanguage(text),
    warnings: [],
  };
}

export function diffGrantWatch(previous = [], current = []) {
  const prevIds = new Set((Array.isArray(previous) ? previous : []).map((x) => x.id).filter(Boolean));
  return (Array.isArray(current) ? current : []).map((opp) => ({
    ...opp,
    watch: {
      isNew: opp?.id ? !prevIds.has(opp.id) : false,
    },
  }));
}

export function makeWatchKey(input = {}) {
  const normalized = normalizeDiscoveryQuery(input);
  const raw = JSON.stringify({
    q: normalized.keywords,
    country: normalized.country,
    sector: normalized.sector,
    organizationType: normalized.organizationType,
    sources: normalizeSources(input.sources),
  });
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function canonicalOpportunityKey(opportunity = {}) {
  const title = clean(opportunity.title || "", 240).toLowerCase();
  const donor = clean(opportunity.donor || "", 160).toLowerCase();
  const number = clean(opportunity.opportunityNumber || "", 120).toLowerCase();
  const urlHostPath = normalizeUrlForKey(opportunity.url || "");
  const raw = [number, title, donor, urlHostPath].filter(Boolean).join("|");
  return crypto.createHash("sha256").update(raw || JSON.stringify(opportunity)).digest("hex");
}

function normalizeDiscoveryQuery(input = {}) {
  const opportunityType = normalizeOpportunityType(input.opportunityType || input.type || "ngo");
  const target = normalizeTarget(input.target || input.audience || input.organizationType || "ong");
  const country = clean(input.country || input.targetCountry || "RDC", 80);
  const sector = clean(input.sector || input.domain || "", 120);
  const organizationType = clean(input.organizationType || targetToOrganizationType(target), 80);
  const domainTerms = domainKeywords(sector);
  const typeTerms = opportunityTypeKeywords(opportunityType, target);
  const drcTerms = countryKeywords(country);
  const keywords = clean(
    input.keywords ||
      input.query ||
      [sector, ...domainTerms, ...typeTerms, ...drcTerms, input.theme, input.donor].filter(Boolean).join(" "),
    320
  );
  const limit = clampInt(input.limit, 1, 50, DEFAULT_LIMIT);

  return {
    keywords,
    country,
    sector,
    domain: sector,
    opportunityType,
    target,
    organizationType,
    donor: clean(input.donor || "", 120),
    language: clean(input.language || "fr", 10),
    limit,
    includeClosed: Boolean(input.includeClosed),
    onlyActive: input.onlyActive !== false,
    includeUndated: input.includeUndated !== false,
    includeSearchLinks: Boolean(input.includeSearchLinks),
    prioritizeDrc: input.prioritizeDrc !== false,
  };
}

function normalizeSources(sources) {
  const arr =
    Array.isArray(sources) && sources.length
      ? sources
      : [
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
          "scholarships",
          "entrepreneurship",
          "ngo-portals",
          "drc-local",
        ];

  const aliases = {
    "grantsgov": "grants.gov",
    "grants-gov": "grants.gov",
    "grants.gov": "grants.gov",
    "un": "undp",
    "onu": "undp",
    "undp": "undp",
    "pnud": "undp",
    "opportunitiesforyouth": "opportunities-for-youth",
    "opportunitiesforyouth.org": "opportunities-for-youth",
    "opportunities-for-youth": "opportunities-for-youth",
    "vc4a": "vc4a",
    "vc4a.com": "vc4a",
    "scholarshipset": "scholarshipset",
    "scholarshipset.com": "scholarshipset",
    "eu": "eu",
    "ue": "eu",
    "european-union": "eu",
    "union-europeenne": "eu",
    "world-bank": "worldbank",
    "worldbank": "worldbank",
    "banque-mondiale": "worldbank",
    "ungm": "ungm",
    "linkedin": "linkedin",
    "linkedin.com": "linkedin",
    "foundations": "foundations",
    "fondations": "foundations",
    "embassies": "embassies",
    "ambassades": "embassies",
    "scholarships": "scholarships",
    "bourses": "scholarships",
    "bourse": "scholarships",
    "entrepreneurship": "entrepreneurship",
    "entrepreneurs": "entrepreneurship",
    "startup": "entrepreneurship",
    "startups": "entrepreneurship",
    "ngo-portals": "ngo-portals",
    "ong-portals": "ngo-portals",
    "ong": "ngo-portals",
    "drc-local": "drc-local",
    "rdc-local": "drc-local",
    "congo-local": "drc-local",
  };

  const allowed = new Set(Object.values(aliases));
  const normalized = [];
  for (const s of arr) {
    const key = String(s || "").trim().toLowerCase();
    const value = aliases[key] || key;
    if (allowed.has(value) && !normalized.includes(value)) normalized.push(value);
  }
  return normalized.length ? normalized : ["grants.gov"];
}

async function searchSource(source, query) {
  if (source === "grants.gov") return searchGrantsGov(query);
  if (source === "undp") return searchUndpRss(query);
  if (source === "opportunities-for-youth") return searchWordPressRest({
    source,
    donor: "Opportunities for Youth",
    baseUrl: "https://opportunitiesforyouth.org",
    query,
  });
  if (source === "vc4a") return searchHtmlSource({
    source,
    donor: "VC4A",
    url: `https://vc4a.com/programs/?lang=en-US`,
    query,
    includeHosts: ["vc4a.com"],
  });
  if (source === "scholarshipset") return searchHtmlSource({
    source,
    donor: "ScholarshipSet",
    url: `https://www.scholarshipset.com/search?q=${encodeURIComponent(query.keywords)}`,
    query,
    includeHosts: ["scholarshipset.com", "www.scholarshipset.com"],
  });
  if (source === "eu") return searchEuFundingTenders(query);
  if (source === "worldbank") return searchWorldBankProjects(query);
  if (source === "ungm") return searchHtmlSource({
    source,
    donor: "UNGM",
    url: `https://www.ungm.org/Public/Notice?SearchText=${encodeURIComponent(query.keywords)}`,
    query,
    includeHosts: ["ungm.org", "www.ungm.org"],
    fallbackOnly: true,
  });
  if (source === "linkedin") return searchLinkedInPublic(query);
  if (source === "foundations") return searchCuratedSearchLinks({
    source,
    donor: "Foundations and philanthropy portals",
    query,
    templates: [
      "https://www.fundsforngos.org/?s={q}",
      "https://www.fordfoundation.org/work/our-grants/?search={q}",
      "https://www.rockefellerfoundation.org/grants/?s={q}",
      "https://www.hewlett.org/grants/?keyword={q}",
      "https://mastercardfdn.org/?s={q}",
      "https://www.gatesfoundation.org/about/committed-grants?q={q}",
      "https://www.usaid.gov/grants/search?keyword={q}",
    ],
  });
  if (source === "embassies") return searchCuratedSearchLinks({
    source,
    donor: "Embassies and bilateral donors",
    query,
    templates: [
      "https://www.usaid.gov/work-usaid/find-a-funding-opportunity?search={q}",
      "https://www.eeas.europa.eu/delegations_en?s={q}",
      "https://www.gov.uk/search/all?keywords={q}",
      "https://www.diplomatie.gouv.fr/en/search/?recherche={q}",
      "https://cd.usembassy.gov/?s={q}",
      "https://www.eeas.europa.eu/delegations/democratic-republic-congo_en?s={q}",
    ],
  });
  if (source === "scholarships") return searchCuratedSearchLinks({
    source,
    donor: "Scholarship portals",
    query,
    templates: [
      "https://www.scholarshipset.com/search?q={q}",
      "https://www.opportunitiesforafricans.com/?s={q}",
      "https://www.afterschoolafrica.com/?s={q}",
      "https://www2.fundsforngos.org/category/fellowships/",
      "https://opportunitiesforyouth.org/?s={q}",
      "https://www.studygreen.info/?s={q}",
    ],
  });
  if (source === "entrepreneurship") return searchCuratedSearchLinks({
    source,
    donor: "Entrepreneurship and startup portals",
    query,
    templates: [
      "https://vc4a.com/programs/?lang=en-US",
      "https://www.f6s.com/programs?search={q}",
      "https://www.seedstars.com/community/entrepreneurs/programs/",
      "https://www.tonyelumelufoundation.org/?s={q}",
      "https://www.opportunitiesforafricans.com/?s={q}",
      "https://www.youthbusiness.org/initiatives?search={q}",
    ],
  });
  if (source === "ngo-portals") return searchCuratedSearchLinks({
    source,
    donor: "NGO funding portals",
    query,
    templates: [
      "https://www2.fundsforngos.org/?s={q}",
      "https://reliefweb.int/jobs?search={q}",
      "https://www.devex.com/jobs/search?q={q}",
      "https://www.bond.org.uk/jobs/?_sf_s={q}",
      "https://www.globalgiving.org/search/?q={q}",
    ],
  });
  if (source === "drc-local") return searchCuratedSearchLinks({
    source,
    donor: "DRC / Congo local opportunity sources",
    query,
    templates: [
      "https://www.google.com/search?q=site%3Acd.usembassy.gov+DRC+Congo+grant+{q}",
      "https://www.google.com/search?q=site%3Awww.eeas.europa.eu%2Fdelegations%2Fdemocratic-republic-congo+appel+projets+RDC+{q}",
      "https://www.google.com/search?q=site%3Awww.undp.org%2Ffr%2Fdrcongo+appel+projets+{q}",
      "https://www.google.com/search?q=site%3Areliefweb.int+DRC+Congo+grant+{q}",
    ],
  });
  return [];
}

async function searchEuFundingTenders(query) {
  const portalUrl = `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?keywords=${encodeURIComponent(query.keywords)}`;
  const url = `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=${encodeURIComponent(query.keywords)}`;
  const body = {
    pageSize: Math.min(Math.max(query.limit, 10), 50),
    pageNumber: 1,
    languages: [query.language === "fr" ? "fr" : "en"],
    displayFields: [
      "type",
      "identifier",
      "reference",
      "title",
      "status",
      "deadlineDate",
      "frameworkProgramme",
      "programmePeriod",
      "callTitle",
      "topicTitle",
      "destinationDetails",
      "typesOfAction",
    ],
  };

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`EU search HTTP ${resp.status}`);
    const json = await resp.json();
    const rows = Array.isArray(json?.results) ? json.results : [];
    const opportunities = rows.map(normalizeEuOpportunity).filter(Boolean);
    if (opportunities.length) return opportunities;
  } catch (e) {
    console.warn("[GRANTS][EU] official search fallback", String(e?.message || e));
  }

  return query.includeSearchLinks
    ? [makeSearchLinkOpportunity({ source: "eu", donor: "European Union Funding & Tenders", url: portalUrl, query })]
    : [];
}

async function searchWorldBankProjects(query) {
  const procurementUrl = `https://projects.worldbank.org/en/projects-operations/procurement?srce=both&lang=en&searchTerm=${encodeURIComponent(query.keywords)}`;
  const url = `https://search.worldbank.org/api/v3/projects?format=json&qterm=${encodeURIComponent(query.keywords)}&rows=${Math.min(Math.max(query.limit, 10), 50)}`;
  try {
    const resp = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!resp.ok) throw new Error(`World Bank projects HTTP ${resp.status}`);
    const json = await resp.json();
    const rows = Object.values(json?.projects || {});
    const opportunities = rows.map(normalizeWorldBankProject).filter(Boolean);
    if (query.includeSearchLinks) {
      opportunities.push(makeSearchLinkOpportunity({
        source: "worldbank",
        donor: "World Bank Procurement Notices",
        url: procurementUrl,
        query,
      }));
    }
    return opportunities;
  } catch (e) {
    console.warn("[GRANTS][WorldBank] official API fallback", String(e?.message || e));
    return query.includeSearchLinks
      ? [makeSearchLinkOpportunity({ source: "worldbank", donor: "World Bank", url: procurementUrl, query })]
      : [];
  }
}

async function searchGrantsGov(query) {
  const body = {
    keyword: query.keywords || [query.country, query.sector].filter(Boolean).join(" "),
    oppStatuses: query.includeClosed ? "forecasted|posted|closed|archived" : "forecasted|posted",
    rows: Math.max(query.limit, 10),
    startRecordNum: 0,
  };

  const resp = await fetchWithTimeout(GRANTS_GOV_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Grants.gov HTTP ${resp.status}: ${txt.slice(0, 250)}`);
  }

  const json = await resp.json();
  const rows = Array.isArray(json?.data?.oppHits)
    ? json.data.oppHits
    : Array.isArray(json?.oppHits)
      ? json.oppHits
      : Array.isArray(json?.data?.searchResults)
        ? json.data.searchResults
        : [];

  return rows.map(normalizeGrantsGovOpportunity).filter(Boolean);
}

async function searchUndpRss(query) {
  const xml = await fetchText("https://procurement-notices.undp.org/proc_notices_rss_feed.cfm");
  const items = parseRssItems(xml);
  return items
    .map((item) => normalizeRssOpportunity(item, "undp", "UNDP Procurement Notices"))
    .filter((opp) => matchesQuery(opp, query))
    .slice(0, query.limit);
}

async function searchWordPressRest({ source, donor, baseUrl, query }) {
  const url = `${baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/search?search=${encodeURIComponent(
    query.keywords
  )}&subtype=post&per_page=${Math.min(query.limit, 20)}`;

  const resp = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!resp.ok) throw new Error(`${source} HTTP ${resp.status}`);
  const json = await resp.json();
  const rows = Array.isArray(json) ? json : [];

  return rows.map((row) => ({
    id: `${source}:${row?.id || row?.url || row?.title}`,
    source,
    title: clean(row?.title || "Untitled opportunity", 260),
    donor,
    opportunityNumber: "",
    status: "public_page",
    postedDate: "",
    closeDate: "",
    category: clean(row?.subtype || row?.type || "", 100),
    eligibility: "",
    description: "",
    url: clean(row?.url || baseUrl, 500),
    raw: row,
  }));
}

async function searchHtmlSource({ source, donor, url, query, includeHosts = [], fallbackOnly = false }) {
  if (fallbackOnly) {
    return query.includeSearchLinks ? [makeSearchLinkOpportunity({ source, donor, url, query })] : [];
  }

  let html = "";
  try {
    html = await fetchText(url);
  } catch {
    return query.includeSearchLinks ? [makeSearchLinkOpportunity({ source, donor, url, query })] : [];
  }
  const links = extractLinks(html, url)
    .filter((link) => {
      if (!includeHosts.length) return true;
      try {
        const host = new URL(link.url).host.toLowerCase();
        return includeHosts.some((h) => host === h || host.endsWith(`.${h}`));
      } catch {
        return false;
      }
    })
    .filter((link) => link.title.length >= 12)
    .filter((link) => matchesTerms([link.title, link.url].join(" "), query))
    .slice(0, query.limit);

  if (!links.length) return query.includeSearchLinks ? [makeSearchLinkOpportunity({ source, donor, url, query })] : [];

  return links.map((link, idx) => ({
    id: `${source}:${hash(`${link.url}:${link.title}`)}`,
    source,
    title: link.title,
    donor,
    opportunityNumber: "",
    status: "public_page",
    postedDate: "",
    closeDate: "",
    category: "",
    eligibility: "",
    description: "",
    url: link.url,
    raw: { rank: idx + 1 },
  }));
}

async function searchLinkedInPublic(query) {
  const keywords = [query.keywords, "grant OR funding OR fellowship OR call for proposals"]
    .filter(Boolean)
    .join(" ");
  const location = query.country || "";
  const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
    keywords
  )}&location=${encodeURIComponent(location)}&f_TPR=r604800`;

  return query.includeSearchLinks
    ? [
        {
          ...makeSearchLinkOpportunity({
            source: "linkedin",
            donor: "LinkedIn public search",
            url,
            query,
          }),
          description:
            "LinkedIn est ajoute comme lien de recherche public. Le systeme ne contourne pas l'authentification et ne scrape pas les pages protegees.",
        },
      ]
    : [];
}

async function searchCuratedSearchLinks({ source, donor, query, templates }) {
  const tasks = templates.slice(0, 8).map((template) => {
    const url = template.replace("{q}", encodeURIComponent(query.keywords));
    const host = hostFromUrl(url);
    return searchHtmlSource({
      source,
      donor,
      url,
      query,
      includeHosts: host ? [host] : [],
    });
  });

  const batches = await Promise.allSettled(tasks);
  const rows = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") rows.push(...batch.value);
  }

  if (rows.length || !query.includeSearchLinks) return rows;
  return templates.map((template) => {
    const url = template.replace("{q}", encodeURIComponent(query.keywords));
    return makeSearchLinkOpportunity({ source, donor, url, query });
  });
}

function normalizeCustomSites(customSites) {
  const arr = Array.isArray(customSites) ? customSites : [];
  return arr
    .map((site, idx) => {
      const url = clean(site?.url || site?.searchUrl || "", 700);
      if (!url || !/^https?:\/\//i.test(url)) return null;
      let includeHosts = [];
      try {
        includeHosts = [new URL(url.replace("{q}", "test")).host.toLowerCase()];
      } catch {
        includeHosts = [];
      }
      return {
        source: clean(site?.source || `custom-${idx + 1}`, 80).toLowerCase(),
        donor: clean(site?.donor || site?.name || "Custom grant source", 140),
        url,
        includeHosts,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function hostFromUrl(url) {
  try {
    return new URL(String(url || "").replace("{q}", "test")).host.toLowerCase();
  } catch {
    return "";
  }
}

function makeSearchLinkOpportunity({ source, donor, url, query }) {
  return {
    id: `${source}:search:${hash(url)}`,
    source,
    title: `Recherche ${donor}: ${query.keywords}`,
    donor,
    opportunityNumber: "",
    status: "search_link",
    postedDate: "",
    closeDate: "",
    category: query.sector || "",
    eligibility: query.organizationType || "",
    opportunityType: query.opportunityType || "ngo",
    audienceCategory: query.opportunityType || "ngo",
    categoryLabel: opportunityTypeLabel(query.opportunityType || "ngo"),
    freshness: {
      active: true,
      status: "search_link",
      hasDeadline: false,
      deadline: "",
      daysUntilDeadline: null,
    },
    description:
      "Source dynamique ou portail sans API publique simple. Ouvre ce lien pour consulter les resultats et coller l'appel choisi dans l'analyse grants.",
    url,
    raw: { searchLink: true },
  };
}

function normalizeGrantsGovOpportunity(row) {
  const number = value(row, ["number", "oppNum", "opportunityNumber", "fundingOpportunityNumber"]);
  const title = value(row, ["title", "opportunityTitle", "oppTitle"]);
  const id = `grants.gov:${number || title || value(row, ["id", "oppId"])}`;
  const synopsisUrl = number
    ? `https://www.grants.gov/search-results-detail/${encodeURIComponent(String(value(row, ["id", "oppId", "opportunityId"]) || number))}`
    : "https://www.grants.gov/search-grants";

  return {
    id,
    source: "grants.gov",
    title: clean(title || "Untitled opportunity", 300),
    donor: clean(value(row, ["agency", "agencyName", "agencyCode"]) || "U.S. Federal Grants", 180),
    opportunityNumber: clean(number || "", 120),
    status: clean(value(row, ["oppStatus", "status", "opportunityStatus"]) || "", 80),
    postedDate: clean(value(row, ["openDate", "postedDate"]) || "", 80),
    closeDate: clean(value(row, ["closeDate", "closeDateExplanation"]) || "", 120),
    category: clean(value(row, ["cfdaList", "category", "fundingActivityCategory"]) || "", 180),
    eligibility: clean(value(row, ["eligibility", "applicantEligibilityDesc"]) || "", 280),
    description: clean(value(row, ["synopsis", "description"]) || "", 700),
    url: synopsisUrl,
    raw: row,
  };
}

function normalizeEuOpportunity(row) {
  const metadata = row?.metadata || {};
  const reference = clean(row?.reference || metadata?.identifier || metadata?.reference || "", 180);
  const url = clean(row?.url || "", 700);
  const topicId = extractEuTopicId(url, reference);
  const detailUrl = topicId
    ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${encodeURIComponent(topicId)}`
    : "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals";
  const rawTitle =
    row?.title ||
    metadata?.title ||
    metadata?.topicTitle ||
    metadata?.callTitle ||
    row?.content ||
    row?.summary ||
    reference;

  return {
    id: `eu:${reference || topicId || hash(detailUrl)}`,
    source: "eu",
    title: clean(stripHtmlFragments(rawTitle) || "EU funding opportunity", 320),
    donor: "European Union Funding & Tenders",
    opportunityNumber: clean(topicId || reference, 140),
    status: clean(metadata?.status || metadata?.sortStatus || "", 90),
    postedDate: clean(metadata?.startDate || metadata?.publicationDate || "", 90),
    closeDate: clean(metadata?.deadlineDate || metadata?.deadline || "", 120),
    category: clean(metadata?.frameworkProgramme || metadata?.programmePeriod || metadata?.type || "", 220),
    eligibility: clean(metadata?.destinationDetails || metadata?.typesOfAction || "", 420),
    description: clean(stripHtmlFragments(row?.summary || row?.content || ""), 900),
    url: detailUrl,
    raw: row,
  };
}

function normalizeWorldBankProject(row) {
  const projectId = clean(row?.id || row?.proj_id || "", 80);
  const title = clean(row?.project_name || row?.projectname || row?.project_name_en || row?.project_abstract || projectId, 320);
  const grantAmount = clean(row?.grantamt || row?.grant_amount || "", 80);
  const totalAmount = clean(row?.totalamt || row?.curr_total_commitment || "", 80);
  const country = Array.isArray(row?.countryname) ? row.countryname.join("; ") : row?.countryshortname || row?.countryname || "";
  const url = projectId
    ? `https://projects.worldbank.org/en/projects-operations/project-detail/${encodeURIComponent(projectId)}`
    : "https://projects.worldbank.org/en/projects-operations/projects-list";
  return {
    id: `worldbank:${projectId || hash(title)}`,
    source: "worldbank",
    title,
    donor: "World Bank Projects API",
    opportunityNumber: projectId,
    status: clean(row?.projectstatusdisplay || row?.status || "", 90),
    postedDate: clean(row?.boardapprovaldate || row?.projectfinancialtype || "", 90),
    closeDate: clean(row?.closingdate || row?.closing_date || "", 120),
    category: clean(row?.sector1?.Name || row?.sector_name || row?.theme_namecode || row?.lendinginstr || "", 220),
    eligibility: clean(country, 260),
    description: clean(row?.project_abstract || row?.impagency || row?.borrower || "", 900),
    url,
    raw: row,
    enrichment: {
      ok: true,
      extractedAt: new Date().toISOString(),
      sourceUrl: url,
      title,
      deadline: clean(row?.closingdate || "", 120),
      countries: country ? [clean(country, 120)] : [],
      eligibility: clean(country, 260),
      budget: grantAmount ? `Grant: ${grantAmount}${totalAmount ? `; Total: ${totalAmount}` : ""}` : totalAmount ? `Total: ${totalAmount}` : "",
      formQuestions: [],
      contactEmails: [],
      summaryText: clean(row?.project_abstract || "", 1200),
      language: "en",
      warnings: [],
    },
  };
}

function normalizeOpportunityForDiscovery(opp = {}, query = {}) {
  const opportunityType = classifyOpportunityType(opp, query);
  const freshness = getOpportunityFreshness(opp);
  return {
    ...opp,
    opportunityType,
    audienceCategory: opportunityType,
    categoryLabel: opportunityTypeLabel(opportunityType),
    freshness,
  };
}

function shouldKeepDiscoveredOpportunity(opp = {}, query = {}) {
  if (!query.includeSearchLinks && String(opp.status || "") === "search_link") return false;
  if (!query.onlyActive) return true;

  const freshness = opp.freshness || getOpportunityFreshness(opp);
  if (!freshness.active) return false;
  if (!query.includeUndated && !freshness.hasDeadline) return false;
  return true;
}

function countOpportunityTypes(items = []) {
  return items.reduce(
    (acc, opp) => {
      const type = opp.opportunityType || "ngo";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    },
    { ngo: 0, entrepreneur: 0, scholarship: 0 }
  );
}

function scoreOpportunity(opp, query) {
  const text = [
    opp.title,
    opp.description,
    opp.category,
    opp.eligibility,
    opp.donor,
    opp.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const terms = tokenize([query.keywords, query.sector, query.country].filter(Boolean).join(" "));
  let score = 35;
  const reasons = [`Categorie: ${opportunityTypeLabel(opp.opportunityType || classifyOpportunityType(opp, query))}`];

  for (const term of terms) {
    if (text.includes(term)) {
      score += 7;
      reasons.push(`Mot-cle trouve: ${term}`);
    }
  }

  if (query.organizationType && /ngo|ong|nonprofit|non-profit|association|university|education/i.test(text)) {
    score += 10;
    reasons.push("Type d'organisation potentiellement compatible");
  }

  const drcRegex = /(drc|rdc|democratic republic of congo|congo-kinshasa|congo kinshasa|république démocratique du congo|republique democratique du congo|africa|afrique|sub-saharan|subsaharan)/i;
  if (query.prioritizeDrc && drcRegex.test(text)) {
    score += 18;
    reasons.push("Pertinent pour RDC/Congo ou Afrique");
  } else if (query.prioritizeDrc) {
    score -= 8;
    reasons.push("Pertinence RDC/Congo non confirmee");
  }

  const typePattern = opportunityTypePattern(query.opportunityType);
  if (typePattern && typePattern.test(text)) {
    score += 14;
    reasons.push(`Correspond au type: ${query.opportunityType}`);
  }

  const targetPattern = targetPatternFor(query.target);
  if (targetPattern && targetPattern.test(text)) {
    score += 10;
    reasons.push(`Cible compatible: ${query.target}`);
  }

  if (query.domain) {
    const domainTerms = tokenize(domainKeywords(query.domain).join(" "));
    if (domainTerms.some((term) => text.includes(term))) {
      score += 8;
      reasons.push(`Domaine compatible: ${query.domain}`);
    }
  }

  if (/posted|forecasted|open/i.test(String(opp.status))) {
    score += 8;
    reasons.push("Statut actif ou previsionnel");
  }

  if (String(opp.status || "") === "search_link") {
    score -= 18;
    reasons.push("Lien de recherche a verifier manuellement");
  }

  const closeDate = parseDate(opp.closeDate);
  if (closeDate) {
    const days = Math.round((closeDate.getTime() - Date.now()) / 86400000);
    if (days >= 0) {
      score += days <= 14 ? 4 : 10;
      reasons.push(`Deadline dans ${days} jours`);
    } else {
      score -= 30;
      reasons.push("Deadline probablement depassee");
    }
  } else if (opp.freshness?.status === "unknown_deadline") {
    reasons.push("Date limite a verifier");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: reasons.slice(0, 8),
  };
}

function normalizeOpportunityType(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["scholarship", "bourse", "bourses", "fellowship"].includes(s)) return "scholarship";
  if (["entrepreneur", "entrepreneurs", "startup", "business", "incubator", "accelerator"].includes(s)) return "entrepreneur";
  if (["ngo", "ong", "appel-projet", "appel_a_projet", "call", "grant"].includes(s)) return "ngo";
  return "ngo";
}

export function classifyOpportunityType(opp = {}, query = {}) {
  const source = String(opp.source || "").toLowerCase();
  const text = [
    opp.title,
    opp.description,
    opp.category,
    opp.eligibility,
    opp.donor,
    opp.url,
    opp.enrichment?.summaryText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const scores = { ngo: 0, entrepreneur: 0, scholarship: 0 };

  if (/(scholarship|scholarships|bourse|bourses|fellowship|tuition|master|phd|doctorat|students?|etudiant|etudiants|universit)/i.test(text)) {
    scores.scholarship += 4;
  }
  if (/(startup|start-up|entrepreneur|sme|pme|business|accelerator|incubator|seed|venture|innovation|founder|vc4a)/i.test(text)) {
    scores.entrepreneur += 4;
  }
  if (/(grant|subvention|call for proposals|appel.{0,12}projets|ngo|ong|asbl|association|nonprofit|civil society|cso|community based)/i.test(text)) {
    scores.ngo += 3;
  }

  if (/(scholarship|scholarshipset|bourse)/i.test(source)) scores.scholarship += 5;
  if (/(vc4a|entrepreneur|startup|linkedin)/i.test(source)) scores.entrepreneur += 4;
  if (/(grants\.gov|undp|ungm|ngo|foundation|embass|drc-local|eu)/i.test(source)) scores.ngo += 2;

  const requested = normalizeOpportunityType(query.opportunityType || query.type || "");
  if (query.opportunityType || query.type) scores[requested] += 1;

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best?.[1] > 0 ? best[0] : requested;
}

export function getOpportunityFreshness(opp = {}, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const statusText = String(opp.status || "").toLowerCase();
  const deadlineRaw = opp.closeDate || opp.enrichment?.deadline || opp.deadline || "";
  const deadline = parseDate(deadlineRaw);

  if (/(closed|expired|archived|cancelled|canceled|awarded|inactive|cloture|ferme|expire|passe)/i.test(statusText)) {
    return {
      active: false,
      status: "closed",
      hasDeadline: Boolean(deadline),
      deadline: deadline ? deadline.toISOString().slice(0, 10) : clean(deadlineRaw, 80),
      daysUntilDeadline: deadline ? Math.floor((endOfDay(deadline).getTime() - today.getTime()) / 86400000) : null,
    };
  }

  if (deadline) {
    const days = Math.floor((endOfDay(deadline).getTime() - today.getTime()) / 86400000);
    return {
      active: days >= 0,
      status: days < 0 ? "expired" : days <= 14 ? "closing_soon" : "active",
      hasDeadline: true,
      deadline: deadline.toISOString().slice(0, 10),
      daysUntilDeadline: days,
    };
  }

  if (statusText === "search_link") {
    return {
      active: true,
      status: "search_link",
      hasDeadline: false,
      deadline: "",
      daysUntilDeadline: null,
    };
  }

  const staleYear = hasOnlyPastYearSignals(opp, now.getFullYear());
  if (staleYear) {
    return {
      active: false,
      status: "stale_year",
      hasDeadline: false,
      deadline: "",
      daysUntilDeadline: null,
    };
  }

  return {
    active: true,
    status: "unknown_deadline",
    hasDeadline: false,
    deadline: "",
    daysUntilDeadline: null,
  };
}

function hasOnlyPastYearSignals(opp = {}, currentYear) {
  const text = [opp.title, opp.description, opp.category, opp.url, opp.enrichment?.summaryText]
    .filter(Boolean)
    .join(" ");
  const years = [...String(text).matchAll(/\b(20\d{2}|21\d{2})\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 2000 && y <= 2200);
  if (!years.length) return false;
  return Math.max(...years) < currentYear;
}

function opportunityTypeLabel(type) {
  if (type === "scholarship") return "Bourses";
  if (type === "entrepreneur") return "Entrepreneurs";
  return "ONG / appels a projets";
}

function normalizeTarget(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["student", "students", "etudiant", "etudiants"].includes(s)) return "students";
  if (["entrepreneur", "entrepreneurs", "startup", "pme"].includes(s)) return "entrepreneurs";
  if (["ngo", "ong", "asbl", "association", "nonprofit"].includes(s)) return "ong";
  return "ong";
}

function targetToOrganizationType(target) {
  if (target === "students") return "Etudiants";
  if (target === "entrepreneurs") return "Entrepreneurs / PME / Startup";
  return "ONG / ASBL / Association";
}

function countryKeywords(country) {
  const c = String(country || "").toLowerCase();
  if (/rdc|drc|congo/.test(c)) {
    return ["DRC", "RDC", "Congo", "Democratic Republic of Congo", "Congo Kinshasa", "Africa"];
  }
  return [country].filter(Boolean);
}

function opportunityTypeKeywords(type, target) {
  if (type === "scholarship") return ["scholarship", "bourse", "fellowship", "students", "master", "training"];
  if (type === "entrepreneur") return ["startup", "entrepreneur", "SME", "PME", "accelerator", "incubator", "seed grant", "business"];
  return ["grant", "call for proposals", "appel a projets", "funding", "subvention", target];
}

function domainKeywords(domain) {
  const d = String(domain || "").toLowerCase();
  const map = {
    education: ["education", "enseignement", "training", "formation", "school", "students"],
    sante: ["health", "sante", "medical", "clinic", "public health"],
    santé: ["health", "sante", "medical", "clinic", "public health"],
    agriculture: ["agriculture", "agri", "food security", "nutrition", "farming"],
    climat: ["climate", "climat", "environment", "energie", "energy", "adaptation"],
    droits: ["rights", "human rights", "droits", "justice", "governance"],
    femmes: ["women", "girls", "gender", "femmes", "filles"],
    jeunes: ["youth", "jeunes", "young leaders", "leadership"],
    numerique: ["digital", "tech", "innovation", "numerique", "numérique"],
  };
  return map[d] || [domain].filter(Boolean);
}

function opportunityTypePattern(type) {
  if (type === "scholarship") return /(scholarship|bourse|fellowship|tuition|students?|master|phd|training)/i;
  if (type === "entrepreneur") return /(startup|entrepreneur|sme|pme|accelerator|incubator|seed|business|innovation|vc4a)/i;
  return /(grant|subvention|call for proposals|appel.{0,10}projets|funding|ngo|ong|nonprofit|civil society)/i;
}

function targetPatternFor(target) {
  if (target === "students") return /(student|etudiant|étudiant|university|master|phd|scholarship|fellowship)/i;
  if (target === "entrepreneurs") return /(entrepreneur|startup|sme|pme|business|founder|accelerator|incubator)/i;
  return /(ngo|ong|asbl|association|nonprofit|civil society|community based|cso)/i;
}

function buildDiscoveryNextActions(query, opportunities) {
  if (!opportunities.length) {
    return [
      "Elargir les mots-cles ou chercher par secteur en anglais.",
      "Ajouter d'autres sources officielles via configuration.",
      "Verifier manuellement les portails bailleurs prioritaires.",
    ];
  }

  return [
    "Ouvrir les opportunites avec les meilleurs scores et copier le texte complet de l'appel.",
    "Envoyer l'appel choisi vers /generate-grants-management dans callText pour l'analyse eligibilite/conformite.",
    "Lancer /generate-grants-management/watch/run avec les memes criteres pour detecter les nouveaux resultats.",
  ];
}

function parseRssItems(xml) {
  const text = String(xml || "");
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => ({
    title: decodeXml(tagValue(block, "title")),
    link: decodeXml(tagValue(block, "link")),
    description: stripTags(decodeXml(tagValue(block, "description"))),
    pubDate: decodeXml(tagValue(block, "pubDate")),
    guid: decodeXml(tagValue(block, "guid")),
  }));
}

function normalizeRssOpportunity(item, source, donor) {
  const url = clean(item?.link || "", 500);
  const title = clean(item?.title || "Untitled opportunity", 280);
  return {
    id: `${source}:${hash(item?.guid || url || title)}`,
    source,
    title,
    donor,
    opportunityNumber: "",
    status: "posted",
    postedDate: clean(item?.pubDate || "", 90),
    closeDate: extractDeadline(item?.description || item?.title || ""),
    category: "",
    eligibility: "",
    description: clean(item?.description || "", 700),
    url,
    raw: item,
  };
}

function extractLinks(html, baseUrl) {
  const text = String(html || "");
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m = null;
  while ((m = re.exec(text))) {
    const href = decodeXml(m[1]);
    const label = stripTags(decodeXml(m[2]));
    const title = clean(label, 260);
    const url = absolutizeUrl(href, baseUrl);
    if (!title || !url || url.startsWith("mailto:") || url.startsWith("tel:")) continue;
    out.push({ title, url });
  }
  return dedupeLinks(out);
}

function dedupeLinks(links) {
  const seen = new Set();
  const out = [];
  for (const link of links) {
    const key = `${String(link.url).toLowerCase()}|${String(link.title).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

function absolutizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function matchesQuery(opp, query) {
  return matchesTerms(
    [opp.title, opp.description, opp.category, opp.eligibility, opp.donor].join(" "),
    query
  );
}

function matchesTerms(text, query) {
  const terms = tokenize([query.keywords, query.sector, query.country].filter(Boolean).join(" "));
  if (!terms.length) return true;
  const hay = String(text || "").toLowerCase();
  return terms.some((term) => hay.includes(term));
}

function tagValue(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = String(block || "").match(re);
  return m ? String(m[1] || "").trim() : "";
}

function stripTags(html) {
  return String(html || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlFragments(text) {
  return stripTags(String(text || "").replace(/<b>/gi, "").replace(/<\/b>/gi, ""));
}

function decodeXml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractDeadline(text) {
  const s = String(text || "");
  const m =
    s.match(/(?:deadline|closing date|close date|closes|apply by|date limite|limite de soumission|date de cloture|cloture)[:\s-]{0,16}([A-Za-zÀ-ÿ0-9,\s/.\-]{6,70})/i) ||
    s.match(/(?:before|avant le|au plus tard le)\s+([A-Za-zÀ-ÿ0-9,\s/.\-]{6,70})/i);
  return clean(String(m?.[1] || "").split(/[.;|]/)[0], 80);
}

function extractEuTopicId(url, fallback = "") {
  const s = String(url || "");
  const m = s.match(/topicDetails\/([^./?#]+)\.json/i) || s.match(/topic-details\/([^/?#]+)/i);
  if (m?.[1]) return clean(m[1], 160);
  const f = String(fallback || "");
  const fm = f.match(/[A-Z0-9]+-[0-9]{4}-[A-Z0-9-]+/i);
  return fm?.[0] ? clean(fm[0], 160) : "";
}

function extractTitle(html) {
  const s = String(html || "");
  const og = s.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (og?.[1]) return clean(decodeXml(og[1]), 300);
  const title = s.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title?.[1] ? clean(decodeXml(stripTags(title[1])), 300) : "";
}

function extractBudget(text) {
  const s = String(text || "");
  const m =
    s.match(/(?:budget|grant amount|award amount|funding|montant|subvention)[:\s-]{0,12}((?:USD|US\$|\$|EUR|€|GBP|£|CDF|XAF|FCFA)?\s?[0-9][0-9,.\s]*(?:\s?(?:to|-|–|a|à)\s?(?:USD|US\$|\$|EUR|€|GBP|£|CDF|XAF|FCFA)?\s?[0-9][0-9,.\s]*)?)/i) ||
    s.match(/((?:USD|US\$|\$|EUR|€|GBP|£|CDF|XAF|FCFA)\s?[0-9][0-9,.\s]{2,}(?:\s?(?:to|-|–|a|à)\s?(?:USD|US\$|\$|EUR|€|GBP|£|CDF|XAF|FCFA)?\s?[0-9][0-9,.\s]*)?)/i);
  return clean(m?.[1] || "", 120);
}

function extractEligibility(text) {
  const s = String(text || "");
  const m =
    s.match(/(?:eligibility|eligible applicants|who can apply|criteres d'eligibilite|critères d'éligibilité|qui peut postuler)([\s\S]{0,900})/i) ||
    s.match(/(?:applicants must|les candidats doivent)([\s\S]{0,700})/i);
  return clean(m?.[0] || "", 900);
}

function extractFormQuestions(html, text) {
  const questions = [];
  const labelRe = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  let m = null;
  while ((m = labelRe.exec(String(html || "")))) {
    const q = clean(stripTags(decodeXml(m[1])), 220);
    if (isQuestionLike(q)) questions.push(q);
  }

  const textRe = /(?:^|\s)([^.!?\n]{12,180}\?)/g;
  while ((m = textRe.exec(String(text || ""))) && questions.length < 40) {
    const q = clean(m[1], 220);
    if (isQuestionLike(q)) questions.push(q);
  }

  return [...new Set(questions)].slice(0, 30);
}

function isQuestionLike(text) {
  const s = String(text || "").trim();
  if (s.length < 8) return false;
  return /\?$/.test(s) || /^(name|email|organization|country|budget|project|nom|email|courriel|organisation|pays|budget|projet)\b/i.test(s);
}

function extractEmails(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((x) => x.toLowerCase()))].slice(0, 12);
}

function extractCountries(text) {
  const countries = [
    "DRC",
    "RDC",
    "Democratic Republic of Congo",
    "Congo",
    "Africa",
    "Afrique",
    "Cameroon",
    "Cameroun",
    "Senegal",
    "Ghana",
    "Kenya",
    "Nigeria",
    "Rwanda",
    "Burundi",
    "Uganda",
    "Tanzania",
    "Ethiopia",
    "Mali",
    "Niger",
  ];
  const hay = String(text || "").toLowerCase();
  return countries.filter((c) => hay.includes(c.toLowerCase())).slice(0, 12);
}

function detectLanguage(text) {
  const s = String(text || "").toLowerCase();
  const frHits = [" le ", " la ", " les ", " des ", " pour ", " projet ", " subvention ", " eligibilite", "éligibilité"].filter((x) =>
    s.includes(x)
  ).length;
  const enHits = [" the ", " and ", " for ", " grant ", " funding ", " eligibility ", " application "].filter((x) =>
    s.includes(x)
  ).length;
  if (frHits > enHits) return "fr";
  if (enHits > frHits) return "en";
  return "unknown";
}

function normalizeUrlForKey(url) {
  try {
    const u = new URL(String(url || ""));
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return clean(url, 300).toLowerCase();
  }
}

function dedupeOpportunities(items) {
  const out = [];
  for (const item of items || []) {
    const normalized = normalizeForDedupe(item);
    const duplicate = out.find((existing) => areLikelySameOpportunity(normalized, normalizeForDedupe(existing)));
    if (duplicate) {
      duplicate.aliases = [
        ...(Array.isArray(duplicate.aliases) ? duplicate.aliases : []),
        {
          id: item.id,
          source: item.source,
          url: item.url,
          title: item.title,
          donor: item.donor,
        },
      ];
      duplicate.match = bestMatch(duplicate.match, item.match);
      duplicate.description = longer(duplicate.description, item.description);
      duplicate.closeDate = duplicate.closeDate || item.closeDate;
      duplicate.eligibility = longer(duplicate.eligibility, item.eligibility);
      duplicate.raw = duplicate.raw || item.raw;
    } else {
      out.push({ ...item, dedupeKey: normalized.key });
    }
  }
  return out;
}

function normalizeForDedupe(opp = {}) {
  const title = normalizeComparableText(opp.title);
  const donor = normalizeComparableText(opp.donor);
  const number = normalizeComparableText(opp.opportunityNumber);
  const url = normalizeUrlForKey(opp.url || "");
  const deadline = normalizeComparableText(opp.closeDate);
  const key = crypto
    .createHash("sha256")
    .update([number, title, donor, deadline].filter(Boolean).join("|") || url || JSON.stringify(opp))
    .digest("hex");
  return { title, donor, number, url, deadline, key };
}

function areLikelySameOpportunity(a, b) {
  if (!a || !b) return false;
  if (a.number && b.number && a.number === b.number) return true;
  if (a.url && b.url && a.url === b.url) return true;
  if (a.title && b.title) {
    const sim = jaccardSimilarity(a.title, b.title);
    if (sim >= 0.9) return true;
    if (sim >= 0.78 && (a.deadline && a.deadline === b.deadline)) return true;
    if (sim >= 0.82 && a.donor && b.donor && jaccardSimilarity(a.donor, b.donor) >= 0.6) return true;
  }
  return false;
}

function bestMatch(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Number(b.score || 0) > Number(a.score || 0) ? b : a;
}

function longer(a, b) {
  return String(b || "").length > String(a || "").length ? b : a;
}

function normalizeComparableText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\u017f]+/gi, " ")
    .replace(/\b(the|and|for|with|from|grant|grants|funding|programme|program|call|opportunity|project|le|la|les|des|pour|avec|appel|projet|subvention)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardSimilarity(a, b) {
  const aa = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const bb = new Set(String(b || "").split(/\s+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = Number(process.env.GRANTS_DISCOVERY_TIMEOUT_MS || 15000)) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const resp = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) throw new Error(`${url} HTTP ${resp.status}`);
  return await resp.text();
}

function value(row, keys) {
  for (const key of keys) {
    const v = row?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u017f]+/i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .slice(0, 16);
}

function parseDate(v) {
  const raw = clean(v, 160);
  if (!raw) return null;
  const s = normalizeDateText(raw);

  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return dateFromParts(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = normalizeYear(Number(m[3]));
    const dayFirst = a > 12 || b <= 12;
    return dayFirst ? dateFromParts(y, b, a) : dateFromParts(y, a, b);
  }

  const monthNames = monthNameMap();
  const monthPattern = Object.keys(monthNames).join("|");
  m = s.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})\\b`, "i"));
  if (m) return dateFromParts(Number(m[3]), monthNames[m[2].toLowerCase()], Number(m[1]));

  m = s.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  if (m) return dateFromParts(Number(m[3]), monthNames[m[1].toLowerCase()], Number(m[2]));

  if (!/\b\d{4}\b/.test(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function normalizeDateText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeYear(year) {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function dateFromParts(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

function monthNameMap() {
  return {
    jan: 1,
    january: 1,
    janvier: 1,
    feb: 2,
    february: 2,
    fevrier: 2,
    mar: 3,
    march: 3,
    mars: 3,
    apr: 4,
    april: 4,
    avril: 4,
    may: 5,
    mai: 5,
    jun: 6,
    june: 6,
    juin: 6,
    jul: 7,
    july: 7,
    juillet: 7,
    aug: 8,
    august: 8,
    aout: 8,
    sep: 9,
    sept: 9,
    september: 9,
    septembre: 9,
    oct: 10,
    october: 10,
    octobre: 10,
    nov: 11,
    november: 11,
    novembre: 11,
    dec: 12,
    december: 12,
    decembre: 12,
  };
}

function hash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 20);
}

function clean(v, max = 500) {
  if (Array.isArray(v)) return v.map((x) => clean(x, max)).filter(Boolean).join("; ").slice(0, max);
  if (v && typeof v === "object") {
    try {
      return JSON.stringify(v).slice(0, max);
    } catch {
      return "";
    }
  }
  return String(v ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
