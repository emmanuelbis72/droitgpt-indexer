// core/bookOrchestrator.js
// DroitGPT Editions — Book Orchestrator (Jurisprudence RDC)
// Generates a professional book (target 350 pages) chapter-by-chapter using RAG (Qdrant proxy).
// Strict anti-hallucination: no invented cases; missing metadata -> INCOMPLET.

import { deepseekChat } from './deepseekClient.js';
import { searchCongoLawSources, formatPassagesForPrompt } from './qdrantRag.js';
import { BOOK_SYSTEM_PROMPT_FR, BOOK_SYSTEM_PROMPT_EN, chapterPrompt } from './bookPrompts.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeStr(v) {
  return String(v || '');
}

function normalizeLang(lang) {
  const l = String(lang || 'fr').toLowerCase();
  return l.startsWith('en') ? 'en' : 'fr';
}

function tryParseJson(s) {
  const t = safeStr(s).trim();
  // remove accidental code fences
  const cleaned = t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

async function strictJsonFromModel({ messages, temperature, max_tokens, retries = 1 }) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    const out = await deepseekChat({ messages, temperature, max_tokens });
    try {
      return tryParseJson(out);
    } catch (e) {
      last = { out, e };
      // Ask model to re-output strict JSON only
      messages = [
        messages[0],
        {
          role: 'user',
          content:
            'Ta réponse précédente n\'était pas un JSON strict. Renvoie UNIQUEMENT un JSON valide conforme au schéma, sans markdown, sans commentaire.',
        },
      ];
      await sleep(250);
    }
  }
  throw new Error(`JSON_PARSE_FAILED: ${String(last?.e?.message || last?.e || 'unknown')} | sample=${safeStr(last?.out).slice(0, 200)}`);
}

function dedupePassages(passages) {
  const out = [];
  const seen = new Set();
  for (const p of passages || []) {
    const ref = safeStr(p?.ref || p?.id || p?.point_id || '').trim();
    const text = safeStr(p?.text || p?.chunk || p?.content || '').trim();
    const key = (ref || '') + '|' + text.slice(0, 180);
    if (!text) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function makeOutlineFR() {
  // ~40 chapitres (8-10 pages chacun ≈ 350 pages)
  return [
    // Introduction + théorie
    { title: 'Introduction générale : autorité et rôle de la jurisprudence en RDC', scope: 'hiérarchie des juridictions, valeur persuasive, sécurité juridique' },
    { title: 'Méthodologie de lecture des décisions : ratio decidendi, obiter dictum et motivation', scope: 'méthode, motivation, charge de la preuve' },
    { title: 'Revirements et jurisprudence constante : conditions et effets', scope: 'revirement, stabilité, prévisibilité' },

    // Civil
    { title: 'Responsabilité civile : faute, dommage, causalité', scope: 'responsabilité délictuelle, réparation, dommages-intérêts' },
    { title: 'Contrats : formation, validité, nullités', scope: 'consentement, cause/objet, nullité, restitution' },
    { title: 'Exécution du contrat : inexécution, résolution, pénalités', scope: 'inexécution, exception d\'inexécution, clause pénale' },
    { title: 'Preuve en matière civile : modes et charge', scope: 'preuve, écrit, témoignage, présomptions' },
    { title: 'Droit de la famille : mariage, filiation, divorce', scope: 'mariage, divorce, garde, pension' },
    { title: 'Droit foncier : titres, possession, conflits', scope: 'foncier, concession, titre, expulsion' },

    // Pénal
    { title: 'Principes directeurs du procès pénal : présomption, droits de la défense', scope: 'présomption d\'innocence, défense, contradictoire' },
    { title: 'Preuve pénale et appréciation souveraine : limites', scope: 'preuve pénale, aveu, témoignage, expertises' },
    { title: 'Détention préventive et liberté : conditions et contrôle', scope: 'détention préventive, liberté provisoire' },
    { title: 'Infractions économiques : fraude, abus, détournement', scope: 'détournement, abus de biens, fraude' },
    { title: 'Corruption et infractions de probité : tendances jurisprudentielles', scope: 'corruption, concussion, trafic d\'influence' },

    // OHADA / Commercial
    { title: 'OHADA : articulation avec le droit interne congolais', scope: 'primauté, applicabilité, conflits de normes' },
    { title: 'Droit commercial : actes de commerce, commerçant, preuve', scope: 'actes de commerce, registre, preuve commerciale' },
    { title: 'Sûretés : garanties, nantissement, hypothèque', scope: 'sûretés, hypothèque, nantissement, saisies' },
    { title: 'Procédures collectives : prévention, redressement, liquidation', scope: 'procédures collectives, créanciers, privilèges' },
    { title: 'Arbitrage et modes alternatifs : reconnaissance et exequatur', scope: 'arbitrage, exequatur, clause compromissoire' },

    // Admin / Constitutionnel
    { title: 'Contentieux administratif : actes, excès de pouvoir, responsabilité', scope: 'administratif, excès de pouvoir, responsabilité de l\'Etat' },
    { title: 'Contentieux électoral et constitutionnel : recevabilité et preuve', scope: 'électoral, recevabilité, preuve, délais' },
    { title: 'Droits fondamentaux : liberté, propriété, procédure', scope: 'droits fondamentaux, propriété, liberté' },

    // Travail
    { title: 'Droit du travail : contrat, licenciement, contentieux', scope: 'licenciement, faute lourde, indemnités' },

    // Synthèse
    { title: 'Tendances contemporaines : digitalisation, preuve électronique, nouvelles pratiques', scope: 'preuve électronique, numérique, modernisation' },
    { title: 'Synthèse doctrinale : principes transversaux et recommandations pratiques', scope: 'synthèse, recommandations, checklists' },
  ];
}

function makeOutlineEN() {
  return [
    { title: 'General Introduction: authority and role of case law in the DRC', scope: 'hierarchy of courts, persuasive value, legal certainty' },
    { title: 'Reading judgments: ratio decidendi, obiter dictum and reasoning', scope: 'method, reasoning, burden of proof' },
  ];
}

function chapterQuery({ title, scope }) {
  // Query tuned to pull jurisprudence-like chunks even without metadata
  const base = `${title}. ${scope || ''}`;
  return `${base} jurisprudence arrêt jugement Cour Tribunal RDC "Cour d\'appel" "Cour de cassation" "Cour constitutionnelle" RPA RP RC`;
}

export async function generateJurisprudenceBook({ lang = 'fr', ctx = {}, lite = false }) {
  const L = normalizeLang(lang);
  const temperature = Number(process.env.BOOK_TEMPERATURE || 0.2);
  const maxTokens = Number(process.env.BOOK_MAX_TOKENS || (lite ? 2800 : 5200));
  const retries = Number(process.env.BOOK_JSON_RETRIES || 1);

  const outline = L === 'fr' ? makeOutlineFR() : makeOutlineEN();

  const system = L === 'fr' ? BOOK_SYSTEM_PROMPT_FR : BOOK_SYSTEM_PROMPT_EN;

  const chapters = [];
  const allJuris = [];
  const allPrinciples = [];
  const sourcesUsed = [];

  let jurCounter = 1;

  for (let i = 0; i < outline.length; i++) {
    const ch = outline[i];

    const q = chapterQuery(ch);

    // Pass A: "strict" attempt (proxy may ignore filter, that's OK)
    const strictFilter = {
      must: [{ key: 'type', match: { value: 'jurisprudence' } }],
    };

    const a = await searchCongoLawSources({ query: q, limit: 18, filter: strictFilter, score_threshold: 0.15 }).catch(
      () => ({ sources: [], passages: [] })
    );

    // Pass B: fallback wide
    const b = await searchCongoLawSources({ query: q, limit: 18 }).catch(() => ({ sources: [], passages: [] }));

    const mergedPassages = dedupePassages([...(a.passages || []), ...(b.passages || [])]);
    const mergedSources = [...(a.sources || []), ...(b.sources || [])];

    mergedSources.forEach((s) => sourcesUsed.push(s));

    const excerpts = formatPassagesForPrompt(mergedPassages, { max: 18 });

    const userPrompt =
      chapterPrompt({ lang: L, chapterTitle: ch.title, chapterScope: ch.scope, maxPagesHint: 10 }) +
      `\n\nCHAPITRE: ${ch.title}\n\nEXTRAITS (RAG) — utilise uniquement ces extraits:\n${excerpts || '(Aucun extrait pertinent trouvé)'}\n`;

    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ];

    const json = await strictJsonFromModel({ messages, temperature, max_tokens: maxTokens, retries });

    // Normalize chapter
    const chapterTitle = safeStr(json?.title || ch.title || `Chapitre ${i + 1}`).trim();
    let chapterText = safeStr(json?.text || '').trim();

    // Normalize jurisprudences and assign stable IDs
    const juris = Array.isArray(json?.jurisprudences) ? json.jurisprudences : [];
    const normalizedJuris = juris
      .filter((j) => safeStr(j?.principe || j?.principle || j?.solution || j?.holding).trim())
      .slice(0, 60)
      .map((j) => {
        const id = `JUR-${String(jurCounter++).padStart(4, '0')}`;
        return {
          id,
          juridiction: safeStr(j?.juridiction || j?.court || 'INCOMPLET').trim() || 'INCOMPLET',
          date: safeStr(j?.date || 'INCOMPLET').trim() || 'INCOMPLET',
          numero: safeStr(j?.numero || j?.number || 'INCOMPLET').trim() || 'INCOMPLET',
          matiere: safeStr(j?.matiere || j?.field || 'autre').trim() || 'autre',
          probleme: safeStr(j?.probleme || j?.issue || '').trim(),
          solution: safeStr(j?.solution || j?.holding || '').trim(),
          principe: safeStr(j?.principe || j?.principle || '').trim(),
          source_ref: safeStr(j?.source_ref || '').trim(),
        };
      });

    // Replace any placeholder [JUR-xxxx] with the new IDs if model used its own.
    // We don't try to map old->new; instead we append a "Jurisprudences citées" block to keep trace.
    if (normalizedJuris.length) {
      const lines = normalizedJuris.map((j) => `- [${j.id}] ${j.juridiction} | ${j.date} | ${j.numero} | ${j.matiere}`);
      chapterText += `\n\n**Jurisprudences citées (références internes)**\n${lines.join('\n')}`;
    }

    const principles = Array.isArray(json?.principes)
      ? json.principes
      : Array.isArray(json?.principles)
        ? json.principles
        : [];

    const pNorm = principles
      .map((p) => safeStr(p).trim())
      .filter(Boolean)
      .slice(0, 80);

    allPrinciples.push(...pNorm);
    allJuris.push(...normalizedJuris);

    chapters.push({ title: chapterTitle, text: chapterText, jurisprudences: normalizedJuris, principes: pNorm });
  }

  // Deduplicate jurisprudence rows
  const dedup = new Map();
  for (const j of allJuris) {
    const key = `${j.juridiction}|${j.date}|${j.numero}|${j.principe.slice(0, 120)}`;
    if (!dedup.has(key)) dedup.set(key, j);
  }
  const annexRows = Array.from(dedup.values());

  // Deduplicate principles
  const pSet = new Set();
  const uniqPrinciples = [];
  for (const p of allPrinciples) {
    const k = p.toLowerCase();
    if (pSet.has(k)) continue;
    pSet.add(k);
    uniqPrinciples.push(p);
  }

  const indexTerms = uniqPrinciples
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .slice(0, 2500)
    .map((term) => ({ term, pages: [] }));

  const title = ctx?.title || (L === 'fr' ? 'TRAITÉ ANALYTIQUE DE JURISPRUDENCE CONGOLAISE' : 'ANALYTICAL TREATISE OF CONGOLESE CASE LAW');
  const subtitle = ctx?.subtitle || (L === 'fr'
    ? 'Ouvrage doctrinal automatisé — magistrats, avocats, universitaires'
    : 'Automated doctrinal book — judges, lawyers, academics');

  const meta = {
    edition: ctx?.edition || (L === 'fr' ? 'Édition professionnelle' : 'Professional edition'),
    year: ctx?.year || new Date().getFullYear(),
    publisher: ctx?.publisher || 'DroitGPT',
    disclaimer:
      ctx?.disclaimer ||
      (L === 'fr'
        ? "Ouvrage généré automatiquement à partir d'extraits indexés. Les métadonnées manquantes sont indiquées 'INCOMPLET'."
        : "Automatically generated from indexed excerpts. Missing metadata is marked 'INCOMPLETE'."),
  };

  return { title, subtitle, meta, chapters, annexRows, indexTerms, sourcesUsed };
}
