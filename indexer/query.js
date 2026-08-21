/**
 * ============================================
 * DroitGPT – Backend principal (query.js)
 * Mode : REST JSON (sans streaming SSE)
 * Optimisé pour réduire la latence réelle
 * + Justice Lab: generate-case + audience + score + appeal + instant-feedback (hybride)
 * + NEW: IA-Juge (solo multi-rôles)
 * + NEW: Rooms Co-op 2–3 joueurs (MVP mémoire + TTL)
 * ============================================
 */

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";
import { normalizeQdrantUrl } from "./qdrantUrl.js";

// 🔐 Auth
import authRoutes from "./auth/auth.routes.js";
import * as requireAuthModule from "./auth/requireAuth.js";
const requireAuth = requireAuthModule.default || requireAuthModule.requireAuth;

/* =======================
   ENV
======================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, ".env") });

const app = express();

/* =======================
   Keep-alive agents (latence réseau ↓)
======================= */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
// NOTE: OpenAI SDK utilise fetch. Agents keep-alive OK même si non exploités.

/* =======================
   CORS
======================= */
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

/* =======================
   MongoDB
======================= */
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB connecté"))
    .catch((err) => console.error("❌ Erreur MongoDB :", err.message));
}

/* =======================
   Clients
======================= */
const qdrant = new QdrantClient({
  url: normalizeQdrantUrl(),
  apiKey: process.env.QDRANT_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =======================
   Mini cache embeddings (mémoire)
======================= */
const EMB_CACHE_TTL_MS = 1000 * 60 * 60; // 1h
const embCache = new Map(); // key -> { vec, exp }

function getEmbCache(key) {
  const it = embCache.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) {
    embCache.delete(key);
    return null;
  }
  return it.vec;
}
function setEmbCache(key, vec) {
  if (embCache.size > 1500) {
    let n = 0;
    for (const k of embCache.keys()) {
      embCache.delete(k);
      n += 1;
      if (n > 150) break;
    }
  }
  embCache.set(key, { vec, exp: Date.now() + EMB_CACHE_TTL_MS });
}

/* =======================
   Utils
======================= */
function isValidMessage(m) {
  return (
    m &&
    typeof m === "object" &&
    typeof m.from === "string" &&
    typeof m.text === "string" &&
    m.text.trim().length > 0
  );
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function cleanDocText(input) {
  let t = String(input || "");
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/\uFFFD/g, "");
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  t = t.replace(/[ \u00A0]+/g, " ");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{4,}/g, "\n\n\n");
  return t.trim();
}

function clampDocForPrompt(docText) {
  const max = Number(process.env.DOC_MAX_CHARS || 45000);
  const s = cleanDocText(docText);
  if (!s) return "";
  if (s.length <= max) return s;

  const headLen = Math.floor(max * 0.7);
  const tailLen = max - headLen;
  const head = s.slice(0, headLen);
  const tail = s.slice(-tailLen);
  return `${head}\n\n[...DOCUMENT TRONQUÉ POUR LIMITES TECHNIQUES...]\n\n${tail}`;
}

function buildSystemPrompt(lang = "fr", hasDocument = false) {
  if (lang === "en") {
    return `
You are DroitGPT, a professional Congolese legal assistant.
Answer in simple HTML only (<p>, <h3>, <ul>, <li>, <strong>, <br/>).

Structure:
- Summary
- Legal basis
- Legal explanation
- Practical application
- Remedies and steps
- Caution points
${
  hasDocument
    ? "\nIMPORTANT: When a document is provided, answer strictly based on it. If not found in the document, say so clearly.\n"
    : ""
}
`;
  }

  return `
Tu es DroitGPT, un assistant juridique congolais professionnel,
spécialisé en droit de la République Démocratique du Congo (RDC)
et, lorsque pertinent, en droit OHADA.

Réponds UNIQUEMENT en HTML simple :
<p>, <h3>, <ul>, <li>, <strong>, <br/>

Structure obligatoire :
<p><strong>Résumé</strong></p>
<h3>Base légale</h3>
<h3>Explications juridiques</h3>
<h3>Application au cas concret</h3>
<h3>Recours et démarches possibles</h3>
<h3>Points de vigilance</h3>

${
  hasDocument
    ? `
IMPORTANT (MODE DOCUMENT) :
- Le document fourni est la source PRIORITAIRE.
- Ne pas inventer.
- Si une information n’apparaît pas dans le document, dis-le explicitement.
- Quand possible, cite des éléments du document (ex: "Selon la section...") sans inventer de pagination si inconnue.
`
    : ""
}
`;
}

/**
 * Prompt système pour le scoring Justice Lab
 */
function buildJusticeLabSystemPrompt() {
  return `
Tu es un évaluateur judiciaire expert (RDC). Tu notes une simulation "Justice Lab".
Ta mission : évaluer la qualité du raisonnement et de la décision, pas un cours théorique.

Contraintes :
- Tu dois retourner UNIQUEMENT un JSON valide (aucun texte autour).
- Scores entre 0 et 100.
- appealRisk doit être exactement : "Faible" ou "Moyen" ou "Élevé".
- criticalErrors = erreurs graves (compétence, contradiction, droits de la défense, motivation inexistante, dispositif incohérent, etc.).
- warnings = problèmes non critiques.
- strengths = 2 à 5 points.
- feedback = 3 à 7 recommandations actionnables (pratiques).
- recommendedNext = 3 suggestions d’exercices/cas courts.

NOUVEAU :
- Ajoute une note "audience" (gestion d'audience) :
  maîtrise du contradictoire, traitement des objections, gestion des débats, pertinence des décisions.
`;
}

function buildJusticeLabAppealSystemPrompt() {
  return `
Tu es une Cour d'appel (simulation pédagogique RDC).
Tu dois rendre une décision structurée et prudente, sans inventer des articles précis.
Tu retournes UNIQUEMENT un JSON strict.

Règles:
- Si atteinte grave aux garanties procédurales (droits de la défense, contradictoire, compétence, absence totale de motivation) => ANNULATION probable.
- Si dossier incomplet / nécessitant mesures d’instruction => RENVOI probable.
- Si motivation cohérente + procédure régulière => CONFIRMATION possible.
- Pas de markdown, pas de texte hors JSON.
- decision doit être exactement: "CONFIRMATION" ou "ANNULATION" ou "RENVOI".
`;
}

function buildJusticeLabGenerateCaseSystemPrompt() {
  return `
Tu es un générateur de DOSSIERS JUDICIAIRES pédagogiques pour la RDC, destinés à la formation (magistrats, juges, parquet, avocats).
Tu dois produire des dossiers réalistes, professionnels, plausibles (contexte congolais), avec suffisamment de matière pour une audience simulée.

Règles STRICTES :
- Tu retournes UNIQUEMENT un JSON valide (aucun texte autour).
- Ne cite pas d'articles numérotés (pas de numéros d’articles). Tu peux dire "au regard des règles de procédure", "contradictoire", "droits de la défense", etc.
- Le dossier doit contenir des tensions procédurales: tardiveté, contradiction, compétence, authenticité, renvoi, mesure d'instruction, etc.
- Les pièces doivent avoir des IDs uniques P1..P8 (max 10).
- Style RDC (tribunaux, villes, vocabulaire, acteurs).
`;
}

function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeoutPromise = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(t));
}

function safeStr(s, max = 8000) {
  return String(s || "").slice(0, max);
}

function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  if (r.includes("proc")) return "Procureur";
  if (r.includes("greff")) return "Greffier";

  // Avocats (2 côtés)
  if (r.includes("avoc")) {
    // civil (demandeur / défendeur)
    if (r.includes('demandeur') || r.includes('requérant') || r.includes('requerant')) return 'Avocat Demandeur';
    if (r.includes('defendeur') || r.includes('défendeur') || r.includes('intimé') || r.includes('intime')) return 'Avocat Défendeur';
    const isDefense =
      r.includes("def") ||
      r.includes("déf") ||
      r.includes("defense") ||
      r.includes("défense") ||
      r.includes("accus") ||
      r.includes("prevenu") ||
      r.includes("prévenu");

    const isCivil =
      r.includes("civ") ||
      r.includes("partie") ||
      r.includes("plaign") ||
      r.includes("victim") ||
      r.includes("demande") ||
      r.includes("requérant") ||
      r.includes("requérant") ||
      r.includes("requete") ||
      r.includes("requête");

    if (isDefense && !isCivil) return "Avocat Défense";
    if (isCivil && !isDefense) return "Avocat Partie civile";
    // défaut: défense
    return "Avocat Défense";
  }

  // défaut: juge
  return "Juge";
}

/** Helpers — pièces */
function normalizePieceId(p, idx = 0) {
  const id = p?.id ?? p?.pieceId ?? p?.pid ?? p?.code ?? null;
  return String(id || `P${idx + 1}`);
}
function normalizePieceTitle(p, idx = 0) {
  return String(p?.title || p?.titre || p?.label || `Pièce ${idx + 1}`);
}
function buildPiecesCatalog(caseData, max = 12) {
  const pieces = Array.isArray(caseData?.pieces) ? caseData.pieces : [];
  return pieces.slice(0, max).map((p, idx) => ({
    id: normalizePieceId(p, idx),
    title: normalizePieceTitle(p, idx),
    type: String(p?.type || p?.kind || p?.categorie || ""),
    reliability: typeof p?.reliability === "number" ? p.reliability : undefined,
    isLate: Boolean(p?.isLate || p?.late),
  }));
}

/** ✅ Sanitize caseData (sécurité minimale) */
function sanitizeCaseData(input, fallback = {}) {
  const cd = input && typeof input === "object" ? input : {};
  const out = {
    id: safeStr(cd.id || cd.caseId || fallback.id || fallback.caseId || `JL-${Date.now()}`, 60),
    caseId: safeStr(cd.caseId || cd.id || fallback.caseId || `JL-${Date.now()}`, 60),
    domaine: safeStr(cd.domaine || fallback.domaine || "Pénal", 40),
    niveau: safeStr(cd.niveau || fallback.niveau || "Intermédiaire", 24),
    titre: safeStr(cd.titre || cd.title || fallback.titre || "Dossier simulé (RDC)", 140),
    resume: safeStr(cd.resume || cd.summary || fallback.resume || "", 1800),
    parties: cd.parties && typeof cd.parties === "object" ? cd.parties : fallback.parties || {},
    qualificationInitiale: safeStr(cd.qualificationInitiale || cd.qualification || fallback.qualificationInitiale || "", 500),
    pieces: Array.isArray(cd.pieces)
      ? cd.pieces.slice(0, 10).map((p, idx) => ({
          id: normalizePieceId(p, idx),
          title: safeStr(p?.title || p?.titre || `Pièce ${idx + 1}`, 140),
          type: safeStr(p?.type || p?.kind || "", 40),
          isLate: Boolean(p?.isLate || p?.late),
          reliability: typeof p?.reliability === "number" ? p.reliability : undefined,
        }))
      : Array.isArray(fallback.pieces)
      ? fallback.pieces
      : [],
    audienceSeed: Array.isArray(cd.audienceSeed)
      ? cd.audienceSeed.slice(0, 14).map((s) => safeStr(s, 220))
      : Array.isArray(fallback.audienceSeed)
      ? fallback.audienceSeed
      : [],
    risquesProceduraux: Array.isArray(cd.risquesProceduraux)
      ? cd.risquesProceduraux.slice(0, 10).map((s) => safeStr(s, 220))
      : Array.isArray(fallback.risquesProceduraux)
      ? fallback.risquesProceduraux
      : [],
    // ✅ Conservé pour la simulation (incidents/objections)
    objectionTemplates: Array.isArray(cd.objectionTemplates)
      ? cd.objectionTemplates.slice(0, 60)
      : Array.isArray(fallback.objectionTemplates)
      ? fallback.objectionTemplates
      : [],
    // ✅ Conservé pour le déroulé (appel → comparution → incidents → débats → plaidoiries/réquisitions → délibéré)
    eventsDeck: Array.isArray(cd.eventsDeck)
      ? cd.eventsDeck.slice(0, 80)
      : Array.isArray(fallback.eventsDeck)
      ? fallback.eventsDeck
      : [],
    meta: cd.meta && typeof cd.meta === "object" ? cd.meta : fallback.meta || {},
  };

  if (!out.parties || typeof out.parties !== "object") out.parties = {};
  if (!out.parties.demandeur && cd.parties?.demandeur) out.parties.demandeur = cd.parties.demandeur;
  if (!out.parties.defendeur && cd.parties?.defendeur) out.parties.defendeur = cd.parties.defendeur;

  return out;
}

// ✅ Force un résumé en EXACTEMENT 6 phrases (utile pour import PDF/DOCX)
function enforceSixSentences(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";

  // Découpe simple par ponctuation de fin de phrase
  const parts = raw
    .split(/(?<=[\.!\?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 6) return parts.join(" ");
  if (parts.length > 6) return parts.slice(0, 6).join(" ");

  // Pas assez de phrases: on complète sans inventer trop de détails
  const filler = [
    "Les pièces versées au dossier seront discutées contradictoirement.",
    "Chaque partie soutient sa version des faits et la Cour encadre les débats.",
    "La procédure doit respecter le contradictoire et les droits de la défense.",
    "La Cour examinera la recevabilité, la force probante des pièces et les demandes.",
    "L'audience se déroulera en phases (incidents, débats, plaidoiries/réquisitions, délibéré).",
    "La décision sera motivée au regard des éléments produits et des observations des parties.",
  ];
  const out = [...parts];
  for (const f of filler) {
    if (out.length >= 6) break;
    out.push(f);
  }
  return out.slice(0, 6).join(" ");
}

/* =======================
   Fallbacks Justice Lab (déjà présents)
======================= */
function fallbackAudienceFromTemplates(caseData, role = "Juge") {
  const templates = Array.isArray(caseData?.objectionTemplates) ? caseData.objectionTemplates : [];

  const obs = templates.slice(0, 3).map((t, i) => ({
    id: t.id || `OBJ${i + 1}`,
    by: t.by || "Avocat",
    title: t.title || "Objection",
    statement: t.statement || "",
    options: ["Accueillir", "Rejeter", "Demander précision"],
    bestChoiceByRole: { Juge: "Demander précision", Procureur: "Rejeter", Avocat: "Accueillir" },
    effects: {
      onAccueillir: { excludePieceIds: [], admitLatePieceIds: [], why: "Mesure conservatoire (fallback).", risk: { dueProcessBonus: 1, appealRiskPenalty: 0 } },
      onRejeter: { excludePieceIds: [], admitLatePieceIds: [], why: "Objection écartée (fallback).", risk: { dueProcessBonus: 0, appealRiskPenalty: 1 } },
      onDemander: { clarification: { label: "Clarification demandée", detail: "La Cour demande des précisions avant de statuer." }, why: "Clarification (fallback).", risk: { dueProcessBonus: 2, appealRiskPenalty: 0 } },
    },
  }));

  const piecesCatalog = buildPiecesCatalog(caseData, 10);

  return {
    scene: {
      court: "Juridiction (simulation)",
      chamber: "Audience (simulation)",
      city: "RDC",
      date: new Date().toISOString().slice(0, 10),
      formation: "Siège",
      roles: { juge: "Le Tribunal", procureur: "Ministère public", avocat: "Défense", greffier: "Greffe" },
      vibe: "Pédagogique, dynamique.",
    },
    phases: [
      { id: "OPENING", title: "Ouverture", objective: "Installer le contradictoire." },
      { id: "DEBATE", title: "Débat", objective: "Clarifier les faits et la procédure." },
      { id: "OBJECTIONS", title: "Incidents", objective: "Trancher les objections." },
      { id: "CLOSING", title: "Clôture", objective: "Annoncer renvoi / mise en délibéré." },
    ],
    piecesCatalog,
    turns: [
      { speaker: "Greffier", text: "Affaire appelée. Les parties sont présentes. La Cour prend place.", phase: "OPENING" },
      { speaker: "Juge", text: `L'audience est ouverte. Rôle du joueur: ${role}. Les parties confirment leurs identités.`, phase: "OPENING" },
      { speaker: "Procureur", text: "Le ministère public précise l'objet de l'audience et annonce un point de procédure.", phase: "DEBATE" },
      { speaker: "Avocat", text: "La défense répond, conteste un élément et soulève une objection.", phase: "OBJECTIONS" },
      { speaker: "Juge", text: "La Cour rappelle le contradictoire et invite à produire/clarifier les pièces pertinentes.", phase: "OBJECTIONS" },
    ],
    objections: obs.length
      ? obs
      : [
          {
            id: "OBJ1",
            by: "Avocat",
            title: "Demande de précision",
            statement: "La défense sollicite des précisions sur la recevabilité et le contradictoire.",
            options: ["Accueillir", "Rejeter", "Demander précision"],
            bestChoiceByRole: { Juge: "Demander précision", Procureur: "Rejeter", Avocat: "Accueillir" },
            effects: {
              onAccueillir: { risk: { dueProcessBonus: 1, appealRiskPenalty: 0 } },
              onRejeter: { risk: { dueProcessBonus: 0, appealRiskPenalty: 1 } },
              onDemander: { clarification: { label: "Clarification demandée", detail: "Préciser les arguments et pièces." }, risk: { dueProcessBonus: 2, appealRiskPenalty: 0 } },
            },
          },
        ],
  };
}

function fallbackAppealFromScored(scored) {
  const scoreGlobal = Number(scored?.scoreGlobal || 0);
  const aud = Number(scored?.scores?.audience || 0);
  const critical = Array.isArray(scored?.criticalErrors) ? scored.criticalErrors : [];
  const warnings = Array.isArray(scored?.warnings) ? scored.warnings : [];

  let decision = "RENVOI";
  if (critical.length >= 1) decision = "ANNULATION";
  else if (scoreGlobal >= 78 && aud >= 65) decision = "CONFIRMATION";

  const grounds =
    decision === "ANNULATION"
      ? ["Atteinte substantielle aux garanties procédurales (simulation).", ...critical.slice(0, 2).map((c) => c.label)]
      : decision === "CONFIRMATION"
      ? ["Motivation suffisante et procédure globalement régulière (simulation)."]
      : ["Dossier à compléter / points à clarifier avant décision définitive (simulation).", ...warnings.slice(0, 2).map((w) => w.label)];

  const dispositif =
    decision === "ANNULATION"
      ? "Annule la décision entreprise et renvoie la cause devant la juridiction compétente."
      : decision === "CONFIRMATION"
      ? "Confirme la décision entreprise en toutes ses dispositions."
      : "Renvoie la cause pour réouverture des débats et/ou complément d’instruction.";

  return {
    decision,
    grounds: grounds.slice(0, 6),
    dispositif: safeStr(dispositif, 700),
    recommendations: [
      "Structurer la motivation (faits → questions → droit → application → conclusion).",
      "Justifier chaque décision sur objection (contradictoire/recevabilité).",
      "Si nécessaire, ordonner une mesure d’instruction plutôt que trancher sur dossier incomplet.",
    ],
  };
}

/* =======================
   ROUTES
======================= */
app.use("/auth", authRoutes);

app.get("/", (_req, res) => {
  res.send("✅ API DroitGPT opérationnelle");
});

/* =========================================================
   ✅ NEW — Congo Law search (Qdrant) pour "Coin Droit congolais"
   POST /congo-law/search
   body: { query: string, limit?: number }
   returns: { sources: [...], passages: [...] }
   - Utilise les données déjà indexées (docs/) dans la collection Qdrant existante
   - Filtre/rerank léger via heuristique RDC (sans réindexation)
========================================================= */
app.post("/congo-law/search", async (req, res) => {
  try {
    const { query, limit = 7 } = req.body || {};
    const q = String(query || "").trim();
    if (q.length < 3) return res.status(400).json({ error: "query requis" });

    // 1) Embedding
    const embeddingResponse = await openai.embeddings.create({
      model: process.env.EMBED_MODEL || "text-embedding-3-small",
      input: q,
    });
    const vector = embeddingResponse.data?.[0]?.embedding;
    if (!vector) return res.status(500).json({ error: "Erreur embedding OpenAI." });

    // 2) Search Qdrant (large puis rerank)
    let hits = [];
    try {
      hits = await withTimeout(
        qdrant.search(process.env.QDRANT_COLLECTION || "documents", {
          vector,
          limit: 30,
          with_payload: true,
          with_vector: false,
        }),
        Number(process.env.QDRANT_TIMEOUT_MS || 2500),
        "QDRANT_TIMEOUT"
      );
    } catch (e) {
      console.warn("⚠️ Qdrant /congo-law/search skipped:", e.message);
      hits = [];
    }

    const passagesAll = (hits || [])
      .map((h) => {
        const p = h?.payload || {};
        const text = String(p.pageContent || p.text || p.content || p.chunk || "").trim();
        const source = String(p.source || p.filename || p.path || "").trim();
        const title = String(p.title || p.source || "Source").trim();
        return {
          title,
          source,
          text,
          score: typeof h?.score === "number" ? h.score : 0,
          type: p.type || p.doc_type || null,
          year: p.year || p.date || null,
          author: p.author || null,
        };
      })
      .filter((x) => x.text);

    // 3) Rerank: score Qdrant + bonus Congo
    const want = Math.min(Math.max(Number(limit) || 7, 1), 15);
    const passages = passagesAll
      .sort((a, b) => (b.score) - (a.score))
      .slice(0, want);

    // 4) Sources dédupliquées (pour l'encadré UI)
    const seen = new Set();
    const sources = [];
    for (const p of passages) {
      const key = `${p.title || ""}::${p.year || ""}::${p.author || ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        title: p.title,
        type: p.type,
        year: p.year,
        author: p.author,
        source: p.source,
      });
    }

    return res.json({ sources, passages });
  } catch (e) {
    console.error("❌ /congo-law/search error:", e);
    return res.status(500).json({ error: "server_error", details: String(e?.message || e) });
  }
});


/* =======================
   /ASK — ENDPOINT UNIQUE (public)
======================= */
app.post("/ask", async (req, res) => {
  const t0 = Date.now();
  let embMs = 0;
  let qdrantMs = 0;
  let openaiMs = 0;

  try {
    const { messages, lang = "fr", documentText = null, documentTitle = null } = req.body || {};

    // ✅ Contenu/consignes choisies côté UI (si fourni)
    const userSelectedContent = safeStr(req.body?.prompt || req.body?.contenu || req.body?.casePrompt || "", 3000);


    if (!Array.isArray(messages) || !messages.every(isValidMessage)) {
      return res.status(400).json({ error: "Format des messages invalide." });
    }

    const lastUserMessage = messages[messages.length - 1].text.trim();

    const hasDocument = typeof documentText === "string" && documentText.trim().length >= 40;
    const docTitleSafe = safeStr(documentTitle || "Document", 140);
    const docTextClamped = hasDocument ? clampDocForPrompt(documentText) : "";

    const tEmb0 = Date.now();
    const cacheKey = `v1:${lastUserMessage.toLowerCase()}`;
    let embeddingVector = getEmbCache(cacheKey);

    if (!embeddingVector) {
      const embeddingResponse = await openai.embeddings.create({
        model: process.env.EMBED_MODEL || "text-embedding-3-small",
        input: lastUserMessage,
      });
      embeddingVector = embeddingResponse.data?.[0]?.embedding;

      if (!embeddingVector) {
        return res.status(500).json({ error: "Erreur embedding OpenAI." });
      }
      setEmbCache(cacheKey, embeddingVector);
    }
    embMs = Date.now() - tEmb0;

    const tQ0 = Date.now();
    let searchResult = [];
    try {
      const qLimit = hasDocument
        ? Number(process.env.QDRANT_LIMIT_DOC || 2)
        : Number(process.env.QDRANT_LIMIT || 3);

      searchResult = await withTimeout(
        qdrant.search(process.env.QDRANT_COLLECTION || "documents", {
          vector: embeddingVector,
          limit: qLimit,
          with_payload: true,
        }),
        Number(process.env.QDRANT_TIMEOUT_MS || 2500),
        "QDRANT_TIMEOUT"
      );
    } catch (e) {
      console.warn("⚠️ Qdrant search skipped:", e.message);
      searchResult = [];
    }
    qdrantMs = Date.now() - tQ0;

    let context = (searchResult || [])
      .map((item) => item.payload?.content)
      .filter(Boolean)
      .join("\n");

    const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 6000);
    if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS);

    const historyWindow = Number(process.env.HISTORY_WINDOW || 4);

    const chatHistory = [
      { role: "system", content: buildSystemPrompt(lang, hasDocument) },

      ...(hasDocument
        ? [{
            role: "user",
            content:
              `DOCUMENT FOURNI (${docTitleSafe}). Utilise-le comme source prioritaire.\n\n` +
              `--- DÉBUT DOCUMENT ---\n${docTextClamped}\n--- FIN DOCUMENT ---`,
          }]
        : []),

      ...(context
        ? [{ role: "user", content: `Contexte juridique pertinent (base DroitGPT) :\n${context}` }]
        : []),

      ...messages.slice(-historyWindow).map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      })),
    ];

    const tA0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      messages: chatHistory,
      temperature: Number(process.env.TEMPERATURE || 0.3),
      max_tokens: Number(process.env.MAX_TOKENS || 650),
    });
    openaiMs = Date.now() - tA0;

    const answer = completion.choices?.[0]?.message?.content || "<p>❌ Réponse vide.</p>";

    const totalMs = Date.now() - t0;
    res.setHeader("X-Ask-Time-Ms", String(totalMs));
    res.setHeader("X-Ask-Has-Document", hasDocument ? "1" : "0");
    res.setHeader("X-Ask-Breakdown", JSON.stringify({ embMs, qdrantMs, openaiMs, totalMs, hasDocument }));

    return res.json({ answer });
  } catch (error) {
    const totalMs = Date.now() - t0;
    console.error("❌ Erreur /ask :", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
});

/* =========================================================
   JUSTICE LAB — GÉNÉRATION DOSSIER
========================================================= */
app.post("/justice-lab/generate-case", requireAuth, async (req, res) => {
  try {
    const {
      mode = "full",
      domaine = "Pénal",
      domain = null,
      level = "Intermédiaire",
      seed = String(Date.now()),
      lang = "fr",
      // ✅ Import dossier réel (PDF/DOCX) -> texte extrait par analyse-service
      documentText = null,
      filename = null,
      // ✅ Import optimisé: résumé structuré court (pour réduire tokens/latence)
      summaryText = null,
      structuredSummary = null,
      documentTitleHint = null,
      resumeHint = null,
      draft = null,
      templateId = null,
      caseSeed = null,
      city = null,
      tribunal = null,
      chambre = null,
    } = req.body || {};

    const modeLower = String(mode || "full").toLowerCase();
    const isFromDocument = modeLower === "from_document" || modeLower === "document" || modeLower === "import";
    const isFromSummary = modeLower === "from_summary" || modeLower === "summary";
    const safeMode = modeLower === "enrich" ? "enrich" : isFromSummary ? "from_summary" : isFromDocument ? "from_document" : "full";

    // ✅ compat: "domain" (slug) ou "domaine" (label)
    const domaineLabel = safeStr(domaine || domain || "Pénal", 40);

    const metaHints = {
      templateId: templateId ? safeStr(templateId, 80) : undefined,
      seed: safeStr(caseSeed || seed, 80),
      city: city ? safeStr(city, 80) : undefined,
      tribunal: tribunal ? safeStr(tribunal, 120) : undefined,
      chambre: chambre ? safeStr(chambre, 120) : undefined,
    };

    // ✅ Contenu/consignes choisies côté UI (si fourni)
    const userSelectedContent = safeStr(req.body?.prompt || req.body?.contenu || req.body?.casePrompt || "", 3000);

    const system = buildJusticeLabGenerateCaseSystemPrompt().trim();

    const userFull = `
PARAMÈTRES:
- Mode: full
- Domaine: ${domaineLabel}
- Niveau: ${level}
- Langue: ${lang}
- Seed: ${metaHints.seed}
- Contenu/Consignes: ${userSelectedContent ? userSelectedContent : "(non spécifié)"}

Tu dois retourner EXACTEMENT un JSON au format suivant:
{
  "caseId": string,
  "domaine": string,
  "niveau": string,
  "titre": string,
  "resume": string,
  "parties": {
    "demandeur": string,
    "defendeur": string,
    "ministerePublic": string | null
  },
  "qualificationInitiale": string,
  "pieces": [
    { "id": "P1", "title": string, "type": string, "isLate": boolean, "reliability": number }
  ],
  "audienceSeed": [ string ],
  "risquesProceduraux": [ string ],
  "meta": {
    "templateId": string,
    "seed": string,
    "city": string,
    "tribunal": string,
    "chambre": string,
    "generatedAt": string
  }
}

Contraintes:
- pieces: 5 à 8 pièces (P1..P8), cohérentes.
- Ajoute au moins 1 pièce tardive (isLate=true) et 1 pièce contestable (reliability faible).
- resume: 5 à 10 lignes, contexte RDC.
- audienceSeed: 6 à 10 points.
- risquesProceduraux: 4 à 7 risques.
- Ne mentionne pas d'articles numérotés.
`.trim();

    const userFromDocument = `
PARAMÈTRES:
- Mode: from_document
- Domaine: ${domaineLabel}
- Niveau: ${level}
- Langue: ${lang}
- Seed: ${metaHints.seed}
- Fichier: ${safeStr(filename || "document", 140)}

TEXTE DU DOSSIER (extrait):
"""
${safeStr(String(documentText || ""), 12000)}
"""

Objectif:
- Génère un dossier JusticeLab UNIQUE en te basant STRICTEMENT sur le texte ci-dessus.
- Adapte les noms, dates et lieux au contexte RDC si le texte est ambigu, sans contredire le texte.

Règles impératives:
- Retourne EXACTEMENT un JSON au format attendu.
- resume: EXACTEMENT 6 phrases (pas de puces, pas de sauts de ligne).
- pieces: 5 à 8 pièces cohérentes avec le texte.
- audienceSeed: 6 à 10 points.
- risquesProceduraux: 4 à 7.
- Ajoute objectionTemplates: AU MOINS 5 objections pour chaque rôle (Procureur, Avocat Demandeur, Avocat Défendeur) => minimum 15.
  Chaque objection doit avoir: {id, by, title, statement, options, bestChoiceByRole, effects}.
- Ajoute eventsDeck: déroulé réaliste (appel de cause → comparution → incidents → débats → plaidoiries/réquisitions → mise en délibéré).
- Ne mentionne pas d'articles numérotés.
`.trim();

    const userFromSummary = `
PARAMÈTRES:
- Mode: from_summary
- Domaine: ${domaineLabel}
- Niveau: ${level}
- Langue: ${lang}
- Seed: ${metaHints.seed}
- Fichier: ${safeStr(filename || "document", 140)}

TITRE PROPOSÉ (si pertinent): ${safeStr(documentTitleHint || "", 160)}
RÉSUMÉ PROPOSÉ (si pertinent): ${safeStr(resumeHint || "", 800)}

RÉSUMÉ STRUCTURÉ (source):
${safeStr(
  structuredSummary ? JSON.stringify(structuredSummary, null, 2) : String(summaryText || ""),
  4200
)}

Objectif:
- Génère un dossier JusticeLab UNIQUE et LOGIQUE, basé STRICTEMENT sur le résumé structuré ci-dessus (qui vient du document importé).
- Le titre du dossier doit reprendre le TITRE PROPOSÉ s'il est non vide et cohérent.
- Le résumé du dossier doit être un résumé fidèle du document (pas générique).

Règles impératives:
- Retourne EXACTEMENT un JSON au format attendu.
- titre: 1 phrase courte, fidèle, non marketing.
- resume: EXACTEMENT 6 phrases (pas de puces, pas de sauts de ligne).
- pieces: 5 à 7 pièces cohérentes avec le résumé.
- audienceSeed: 6 à 8 points.
- risquesProceduraux: 4 à 6.
- objectionTemplates: 3 objections par rôle (Procureur, Avocat Demandeur, Avocat Défendeur) => minimum 9.
- eventsDeck: 6 à 8 événements réalistes.
- Ne mentionne pas d'articles numérotés.
`.trim();

    const userEnrich = `
PARAMÈTRES:
- Mode: enrich
- Domaine: ${domaine}
- Niveau: ${level}
- Langue: ${lang}
- Seed: ${metaHints.seed}
- Contenu/Consignes: ${userSelectedContent ? userSelectedContent : "(non spécifié)"}

DRAFT:
${safeStr(JSON.stringify(draft || {}, null, 2), 9000)}

Règles:
- Retourne EXACTEMENT un JSON.
- Conserve les IDs des pièces déjà présentes.
- Améliore résumé, audienceSeed, risques, pièces, parties, qualificationInitiale.
- Ne mets pas d'articles numérotés.
- Ne change pas caseId si présent.
`.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_CASE_MODEL || process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            safeMode === "enrich"
              ? userEnrich
              : safeMode === "from_document"
                ? userFromDocument
                : safeMode === "from_summary"
                  ? userFromSummary
                  : userFull,
        },
      ],
      temperature: Number(process.env.JUSTICE_LAB_CASE_TEMPERATURE || 0.6),
      max_tokens: (() => {
        const base = Number(process.env.JUSTICE_LAB_CASE_MAX_TOKENS || 0);
        if (base > 0) return base;
        // from_document et full demandent plus de tokens (objections + eventsDeck)
        if (safeMode === "from_document") return 2600;
        if (safeMode === "from_summary") return 1600;
        if (safeMode === "full") return 2200;
        return 1600;
      })(),
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    const tryParse = (txt) => {
      try {
        return JSON.parse(txt);
      } catch {
        return null;
      }
    };

    let parsed = tryParse(raw);

    // ✅ Si le modèle tronque (JSON invalide), on tente une réparation 1-pass plutôt que renvoyer un dossier vide
    if (!parsed) {
      try {
        const repair = await openai.chat.completions.create({
          model: process.env.JUSTICE_LAB_CASE_MODEL || process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
          temperature: 0,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Tu es un validateur JSON. Convertis le contenu fourni en un JSON STRICTEMENT valide, sans ajouter de commentaires. Retourne uniquement le JSON.",
            },
            { role: "user", content: raw },
          ],
        });
        const repaired = repair.choices?.[0]?.message?.content || "{}";
        parsed = tryParse(repaired);
      } catch (e) {
        // ignore
      }
    }

    if (!parsed) {
      const fallback = safeMode === "enrich" ? draft || {} : {};
      const caseData = sanitizeCaseData(fallback, {
        domaine,
        niveau: level,
        meta: { ...metaHints, generatedAt: new Date().toISOString() },
      });
      return res.json({ caseData, warning: "json_repair_failed" });
    }

    const fallbackBase = safeMode === "enrich" ? (draft && typeof draft === "object" ? draft : {}) : {};
    const sanitized = sanitizeCaseData(parsed, {
      ...fallbackBase,
      domaine: domaineLabel,
      niveau: level,
      meta: { ...metaHints, generatedAt: new Date().toISOString() },
    });

    // ✅ Résumé EXACTEMENT 6 phrases si import dossier réel (texte complet ou résumé)
    if (safeMode === "from_document" || safeMode === "from_summary") {
      // Si on a un résumé proposé par l'analyse-service, on le privilégie (plus fidèle au doc)
      if (typeof resumeHint === "string" && resumeHint.trim().length > 30) {
        sanitized.resume = enforceSixSentences(resumeHint.trim());
      } else {
        sanitized.resume = enforceSixSentences(sanitized.resume);
      }
    }

    // ✅ Titre: si l'analyse-service a déjà trouvé un titre cohérent, on l'impose (stabilité UX)
    if (safeMode === "from_summary" && typeof documentTitleHint === "string" && documentTitleHint.trim().length > 6) {
      sanitized.titre = documentTitleHint.trim().slice(0, 140);
    }

    sanitized.meta = {
      ...(sanitized.meta || {}),
      templateId:
        sanitized.meta?.templateId ||
        metaHints.templateId ||
        (safeMode === "from_document" ? "AI_IMPORT" : safeMode === "from_summary" ? "AI_IMPORT_SUMMARY" : "AI_FULL"),
      seed: sanitized.meta?.seed || metaHints.seed,
      city: sanitized.meta?.city || metaHints.city || "RDC",
      tribunal: sanitized.meta?.tribunal || metaHints.tribunal || "Juridiction (simulation)",
      chambre: sanitized.meta?.chambre || metaHints.chambre || "Chambre (simulation)",
      generatedAt: sanitized.meta?.generatedAt || new Date().toISOString(),
      source: sanitized.meta?.source || (safeMode === "from_document" || safeMode === "from_summary" ? "import" : "ai"),
      filename:
        safeMode === "from_document" || safeMode === "from_summary"
          ? safeStr(filename || "document", 200)
          : sanitized.meta?.filename,
    };

    return res.json({ caseData: sanitized });
  } catch (e) {
    console.error("❌ /justice-lab/generate-case error:", e);
    const fallback = req.body?.mode === "enrich" ? req.body?.draft || {} : {};
    const caseData = sanitizeCaseData(fallback, {
      domaine: req.body?.domaine || "Pénal",
      niveau: req.body?.level || "Intermédiaire",
      meta: { generatedAt: new Date().toISOString() },
    });
    return res.status(200).json({ caseData, warning: "fallback" });
  }
});

/* =========================================================
   JUSTICE LAB — AUDIENCE IA
========================================================= */
app.post("/justice-lab/audience", requireAuth, async (req, res) => {
  try {
    // ✅ Compat: accepte {caseData, run} OU {caseData, runData} OU payload léger
    let caseData = req.body?.caseData || null;
    let run = req.body?.run || req.body?.runData || null;

    if (!caseData) {
      // payload léger (fallback) — évite 400 et permet au front de récupérer une audience
      const b = req.body || {};
      caseData = {
        caseId: b.caseId || b.case_id || "DOSSIER",
        domaine: b.domaine || b.matiere || "RDC",
        niveau: b.niveau || b.difficulty || "Intermédiaire",
        titre: b.titre || b.title || "Audience simulée",
        resume: b.resume || b.facts || b.brief || "",
        parties: b.parties || {},
        pieces: Array.isArray(b.pieces) ? b.pieces : [],
        audienceSeed: Array.isArray(b.audienceSeed) ? b.audienceSeed : [],
      };
    }

    if (!run) {
      const b = req.body || {};
      run = {
        eventCard: b.eventCard || null,
        answers: {
          role: b.role || "Juge",
          qualification: b.qualification || "",
          procedureChoice: b.procedureChoice || null,
          procedureJustification: b.procedureJustification || "",
          city: b.city || b.ville || "RDC",
          court: b.court || b.juridiction || "Tribunal (simulation)",
        },
      };
    }

    const role = normalizeRole(run?.answers?.role || "Juge");
    const piecesCatalog = buildPiecesCatalog(caseData, 12);

    const pieceIds = piecesCatalog.map((p) => p.id);
    const latePieceIds = piecesCatalog.filter((p) => p.isLate).map((p) => p.id);

    const payload = {
      meta: {
        caseId: caseData.caseId,
        domaine: caseData.domaine,
        niveau: caseData.niveau,
        titre: caseData.titre || caseData.title,
        resume: safeStr(caseData.resume || caseData.brief, 1500),
        roleJoueur: role,
        ville: run?.answers?.city || run?.answers?.ville || "RDC",
        juridiction: run?.answers?.court || run?.answers?.juridiction || "Tribunal (simulation)",
      },
      parties: caseData.parties,
      piecesCatalog,
      pieceIds,
      latePieceIds,
      audienceSeed: Array.isArray(caseData.audienceSeed) ? caseData.audienceSeed.slice(0, 12) : [],
      eventCard: run?.eventCard || null,
      answers: {
        qualification: safeStr(run?.answers?.qualification || "", 900),
        procedureChoice: run?.answers?.procedureChoice || null,
        procedureJustification: safeStr(run?.answers?.procedureJustification || "", 1200),
      },
    };

        const audienceStyle = String(req.body?.audienceStyle || req.body?.data?.audienceStyle || "STANDARD").toUpperCase();
    const ultraPro = audienceStyle === "ULTRA_PRO";

    const minTurns = clamp(
      Number(req.body?.minTurns || (ultraPro ? 55 : 40)),
      18,
      120
    );
    const minObjections = clamp(
      Number(req.body?.minObjections || (ultraPro ? 10 : 8)),
      2,
      25
    );
    const includeIncidents = req.body?.includeIncidents !== false; // default true
    const includePiecesLinks = req.body?.includePiecesLinks !== false; // default true

    const system = `
Tu es un "Moteur d'audience judiciaire" (RDC) pour un jeu de FORMATION CONTINUE (magistrats, parquet, avocats, greffe).
Objectif : produire une audience TRÈS réaliste, professionnelle, pratico-pratique, cohérente avec un dossier RDC.

STYLE: formel, vocabulaire judiciaire RDC, phrases courtes, rythme d'audience.

PARAMÈTRES:
- audienceStyle: ${audienceStyle}
- minTurns: ${minTurns} (obligatoire)
- minObjections: ${minObjections} (obligatoire)
- includeIncidents: ${includeIncidents}
- includePiecesLinks: ${includePiecesLinks}

RÈGLES STRICTES (NON NÉGOCIABLES) :
1) Tu retournes UNIQUEMENT un JSON valide (aucun texte autour).
2) Pas d'articles numérotés inventés. Utilise des principes: contradictoire, droits de la défense, compétence, recevabilité, motivation.
3) Tu dois référencer les pièces UNIQUEMENT via les IDs dans piecesCatalog (ex: "P3").
4) turns.length >= minTurns ; objections.length >= minObjections.
5) Chaque objection:
   - options EXACTES: ["Accueillir","Rejeter","Demander précision"]
   - bestChoiceByRole.Juge doit être une des 3 options
   - doit référencer au moins 1 pièce via pieceIds (dans statement et/ou dans effects)
   - effects doit contenir onAccueillir/onRejeter/onDemander avec au minimum excludePieceIds/admitLatePieceIds (tableaux) + why (texte court).
6) Si includeIncidents=true => au moins 2 incidents procéduraux (tardiveté, compétence, nullité, renvoi, communication de pièces, témoin absent, jonction/disjonction…).
7) Progression pédagogique: le juge pose des questions, recadre, protège le contradictoire, tranche les incidents, mène au fond, conclut et met en délibéré.
8) Tu dois mentionner explicitement au moins 6 pièces dans les turns (si le dossier en contient moins, mentionne toutes).

SPÉCIAL "ULTRA_PRO":
- Si audienceStyle = ULTRA_PRO, phases OBLIGATOIRES = 5 :
  1) OUVERTURE (police d'audience, appel de la cause, vérification comparution/citations)
  2) INCIDENTS (exceptions/renvoi/communication pièces)
  3) FOND (débat factuel + discussion de pièces + questions du siège)
  4) CONCLUSIONS (positions finales / réquisitions / plaidoiries)
  5) CLOTURE (clôture des débats + mise en délibéré + annonce date)
- Chaque phase doit être clairement identifiable dans phases[] et utilisée dans turns[].phase.
`.trim();

    const user = `
INPUT:
${JSON.stringify(payload, null, 2)}

FORMAT JSON attendu (retourne EXACTEMENT ce JSON, sans texte autour) :
{
  "scene": {
    "court": string,
    "chamber": string,
    "city": string,
    "date": "YYYY-MM-DD",
    "formation": string,
    "roles": { "juge": string, "procureur": string, "avocatDefense": string, "avocatPartieCivile": string, "greffier": string },
    "vibe": string
  },
  "phases": [
    { "id": string, "title": string, "objective": string }
  ],
  "turns": [
    {
      "speaker": "Greffier"|"Juge"|"Procureur"|"Avocat Défense"|"Avocat Partie civile",
      "text": string,
      "phase": string,
      "pieceRefs": [ "P1", "P2" ]
    }
  ],
  "objections": [
    {
      "id": "OBJ1",
      "by": "Procureur"|"Avocat Défense"|"Avocat Partie civile",
      "title": string,
      "statement": string,
      "options": ["Accueillir","Rejeter","Demander précision"],
      "bestChoiceByRole": { "Juge": "Accueillir"|"Rejeter"|"Demander précision", "Procureur": string, "Avocat Défense": string, "Avocat Partie civile": string },
      "effects": {
        "onAccueillir": { "excludePieceIds": [string], "admitLatePieceIds": [string], "why": string },
        "onRejeter": { "excludePieceIds": [string], "admitLatePieceIds": [string], "why": string },
        "onDemander": { "excludePieceIds": [string], "admitLatePieceIds": [string], "why": string, "clarification": { "label": string, "detail": string } }
      }
    }
  ]
}

NOTES:
- pieceRefs est optionnel mais recommandé si includePiecesLinks=true.
- excludePieceIds/admitLatePieceIds doivent utiliser uniquement les IDs présents dans piecesCatalog.
- Les phases Ultra Pro attendues : OUVERTURE, INCIDENTS, FOND, CONCLUSIONS, CLOTURE.
`.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: Number(process.env.JUSTICE_LAB_AUDIENCE_TEMPERATURE || 0.5),
      max_tokens: Number(process.env.JUSTICE_LAB_AUDIENCE_MAX_TOKENS || 2600),
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    }

    if (!Array.isArray(data?.turns) || !Array.isArray(data?.objections)) {
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    }

    // ✅ Validation minimale (qualité Ultra Pro)
    const turnsLen = data.turns.length;
    const objectionsLen = data.objections.length;

    if (turnsLen < minTurns || objectionsLen < minObjections) {
      res.setHeader("X-JusticeLab-Audience-Fallback", "true");
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    }

    if (!Array.isArray(data?.phases) || data.phases.length < 2) {
      res.setHeader("X-JusticeLab-Audience-Fallback", "true");
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    }

    if (ultraPro) {
      const reqPhaseIds = ["OUVERTURE", "INCIDENTS", "FOND", "CONCLUSIONS", "CLOTURE"];
      const got = new Set(data.phases.map((p) => String(p?.id || "").toUpperCase()));
      const missing = reqPhaseIds.filter((id) => !got.has(id));
      if (missing.length) {
        res.setHeader("X-JusticeLab-Audience-Fallback", "true");
        return res.json(fallbackAudienceFromTemplates(caseData, role));
      }
    }
    return res.json({
      scene: data.scene,
      phases: data.phases,
      piecesCatalog,
      turns: data.turns,
      objections: data.objections,
    });
  } catch (e) {
    console.error("❌ /justice-lab/audience error:", e);
    try {
      const caseData = req.body?.caseData;
      const run = req.body?.run || req.body?.runData;
      const role = normalizeRole(run?.answers?.role || "Juge");
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    } catch {
      return res.status(500).json({ error: "Erreur audience IA", detail: e?.message });
    }
  }
});

/* =========================================================
   ✅ NEW — IA JUGE (solo multi-rôles)
   - Si l'utilisateur joue Procureur / Avocat, l'IA tranche comme Juge
========================================================= */
app.post("/justice-lab/ai-judge", requireAuth, async (req, res) => {
  try {
    const { caseData, runData, objection, recommendation, playerSuggestion } = req.body || {};
    const rec = recommendation || playerSuggestion || null;
    if (!caseData || !runData || !objection) {
      return res.status(400).json({ error: "caseData, runData et objection sont requis." });
    }

    // choix de secours : si bestChoiceByRole.Juge existe
    const fallbackChoice = objection?.bestChoiceByRole?.Juge || "Demander précision";

    const payload = {
      caseId: caseData.caseId,
      domaine: caseData.domaine,
      niveau: caseData.niveau,
      titre: caseData.titre || caseData.title,
      resume: safeStr(caseData.resume || caseData.brief, 1200),
      parties: caseData.parties || {},
      pieces: Array.isArray(caseData.pieces) ? caseData.pieces.slice(0, 10) : [],
      roleJoueur: normalizeRole(runData?.answers?.role || "Juge"),
      objection: {
        id: safeStr(objection.id, 40),
        by: safeStr(objection.by, 30),
        title: safeStr(objection.title, 160),
        statement: safeStr(objection.statement, 1200),
        options: Array.isArray(objection.options) ? objection.options.slice(0, 3) : ["Accueillir", "Rejeter", "Demander précision"],
      },
      recommendation: rec
        ? {
            byRole: safeStr(rec.byRole || rec.role || "", 20),
            choice: safeStr(rec.choice || rec.decision || "", 40),
            reasoning: safeStr(rec.reasoning || rec.reason || "", 1200),
          }
        : null,
    };

    const system = `
Tu es un JUGE (RDC) dans une audience simulée de formation continue.
Ta mission: trancher une objection de manière professionnelle en respectant:
- contradictoire,
- droits de la défense,
- recevabilité,
- proportionnalité,
- bonne police d'audience.

Contraintes:
- Tu retournes UNIQUEMENT un JSON valide.
- decision doit être exactement: "Accueillir" ou "Rejeter" ou "Demander précision"
- Pas d'articles numérotés inventés.
- Justification courte et actionnable.

Format:
{
  "decision": "Accueillir"|"Rejeter"|"Demander précision",
  "reason": string
}
`.trim();

    const user = `INPUT:\n${JSON.stringify(payload, null, 2)}`;

    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_JUDGE_MODEL || process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: Number(process.env.JUSTICE_LAB_JUDGE_TEMPERATURE || 0.2),
      max_tokens: Number(process.env.JUSTICE_LAB_JUDGE_MAX_TOKENS || 220),
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let out = null;
    try {
      out = JSON.parse(raw);
    } catch {
      out = null;
    }

    const decision = String(out?.decision || "").trim();
    const ok = ["Accueillir", "Rejeter", "Demander précision"].includes(decision);

    if (!ok) {
      return res.json({ choice: fallbackChoice, reasoning: "Décision IA fallback (format/validation).", decision: fallbackChoice, reason: "Décision IA fallback (format/validation)." });
    }

    return res.json({
      // ✅ compat front: attend parfois {choice, reasoning}
      choice: decision,
      reasoning: safeStr(out?.reason || "Décision motivée (IA).", 380),
      // ✅ clés historiques
      decision,
      reason: safeStr(out?.reason || "Décision motivée (IA).", 380),
    });
  } catch (e) {
    console.warn("⚠️ /justice-lab/ai-judge fallback:", e?.message);
    return res.json({ choice: "Demander précision", reasoning: "IA indisponible, décision prudente.", decision: "Demander précision", reason: "IA indisponible, décision prudente." });
  }
});

/* =========================================================
   JUSTICE LAB — SCORING IA
========================================================= */
app.post("/justice-lab/score", requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { caseData, runData } = req.body || {};
    if (!caseData || !runData) return res.status(400).json({ error: "caseData et runData sont requis." });

    const payload = {
      caseId: caseData.caseId,
      domaine: caseData.domaine,
      niveau: caseData.niveau,
      titre: caseData.titre || caseData.title,
      resume: caseData.resume || caseData.brief,
      parties: caseData.parties,
      pieces: Array.isArray(caseData.pieces) ? caseData.pieces.slice(0, 12) : [],
      eventCard: runData.eventCard || null,
      answers: runData.answers || {},
    };

    const userPrompt = `
Évalue le dossier simulé et la production de l'utilisateur.

INPUT:
${JSON.stringify(payload, null, 2)}

Retourne STRICTEMENT un JSON au format suivant :
{
  "scoreGlobal": number,
  "scores": {
    "qualification": number,
    "procedure": number,
    "audience": number,
    "droits": number,
    "motivation": number
  },
  "appealRisk": "Faible" | "Moyen" | "Élevé",
  "criticalErrors": [{ "label": string, "detail": string }],
  "warnings": [{ "label": string, "detail": string }],
  "strengths": [string],
  "feedback": [string],
  "recommendedNext": [string]
}
`.trim();

    const tA0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: buildJusticeLabSystemPrompt().trim() },
        { role: "user", content: userPrompt },
      ],
      temperature: Number(process.env.JUSTICE_LAB_TEMPERATURE || 0.2),
      max_tokens: Number(process.env.JUSTICE_LAB_MAX_TOKENS || 900),
      response_format: { type: "json_object" },
    });
    const openaiMs = Date.now() - tA0;

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "Réponse IA non-JSON (invalide).", raw: raw.slice(0, 1200) });
    }

    if (typeof result?.scoreGlobal !== "number" || !result?.scores || typeof result?.scores?.qualification !== "number") {
      return res.status(500).json({ error: "Réponse IA invalide (structure).", raw: result });
    }
    if (typeof result?.scores?.audience !== "number") result.scores.audience = 0;

    const totalMs = Date.now() - t0;
    res.setHeader("X-JusticeLab-Time-Ms", String(totalMs));
    res.setHeader("X-JusticeLab-Breakdown", JSON.stringify({ openaiMs, totalMs }));
    return res.json(result);
  } catch (error) {
    const totalMs = Date.now() - t0;
    console.error("❌ Erreur /justice-lab/score :", error);
    return res.status(500).json({ error: "Erreur serveur Justice Lab.", detail: error?.message, totalMs });
  }
});

/* =========================================================
   JUSTICE LAB — APPEAL IA
========================================================= */
app.post("/justice-lab/appeal", requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { caseData, scored } = req.body || {};
    const run = req.body?.run || req.body?.runData;

    if (!caseData || !run) return res.status(400).json({ error: "caseData et run (ou runData) sont requis." });

    const role = normalizeRole(run?.answers?.role || "Juge");

    const appealInput = {
      caseId: caseData.caseId,
      domaine: caseData.domaine,
      niveau: caseData.niveau,
      titre: caseData.titre || caseData.title,
      resume: caseData.resume || caseData.brief,
      parties: caseData.parties,
      pieces: Array.isArray(caseData.pieces) ? caseData.pieces.slice(0, 10) : [],
      eventCard: run?.eventCard || null,
      role,
      answers: run?.answers || {},
      scored: scored || null,
    };

    const userPrompt = `
Rends une décision d'appel pédagogique sur la base de l'INPUT.

INPUT:
${JSON.stringify(appealInput, null, 2)}

Retourne STRICTEMENT ce JSON:
{
  "decision": "CONFIRMATION" | "ANNULATION" | "RENVOI",
  "grounds": [string],
  "dispositif": string,
  "recommendations": [string]
}
`.trim();

    const tA0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_APPEAL_MODEL || process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: buildJusticeLabAppealSystemPrompt().trim() },
        { role: "user", content: userPrompt },
      ],
      temperature: Number(process.env.JUSTICE_LAB_APPEAL_TEMPERATURE || 0.3),
      max_tokens: Number(process.env.JUSTICE_LAB_APPEAL_MAX_TOKENS || 900),
      response_format: { type: "json_object" },
    });
    const openaiMs = Date.now() - tA0;

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = null;
    }

    const decision = String(result?.decision || "").toUpperCase();
    const okDecision = ["CONFIRMATION", "ANNULATION", "RENVOI"].includes(decision);

    if (!result || !okDecision || !Array.isArray(result?.grounds) || typeof result?.dispositif !== "string") {
      const fallback = fallbackAppealFromScored(scored || {});
      const totalMs = Date.now() - t0;
      res.setHeader("X-JusticeLab-Appeal-Time-Ms", String(totalMs));
      res.setHeader("X-JusticeLab-Appeal-Breakdown", JSON.stringify({ openaiMs: 0, totalMs, fallback: true }));
      return res.json(fallback);
    }

    const grounds = result.grounds.slice(0, 6).map((g) => safeStr(g, 300));
    const dispositif = safeStr(result.dispositif, 900);

    const recommendations = Array.isArray(result?.recommendations)
      ? result.recommendations.slice(0, 6).map((r) => safeStr(r, 240))
      : [
          "Structurer la motivation (faits → droit → application).",
          "Justifier les choix sur objections (contradictoire/recevabilité).",
          "Compléter le dossier par mesures d’instruction si nécessaire.",
        ];

    const totalMs = Date.now() - t0;
    res.setHeader("X-JusticeLab-Appeal-Time-Ms", String(totalMs));
    res.setHeader("X-JusticeLab-Appeal-Breakdown", JSON.stringify({ openaiMs, totalMs }));

    return res.json({ decision, grounds, dispositif, recommendations });
  } catch (error) {
    console.error("❌ Erreur /justice-lab/appeal :", error);
    const fallback = fallbackAppealFromScored(req.body?.scored || {});
    return res.json(fallback);
  }
});

/* =========================================================
   JUSTICE LAB — INSTANT FEEDBACK IA
========================================================= */
app.post("/justice-lab/instant-feedback", requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { caseData, runData, objection, userDecision } = req.body || {};

    if (!caseData || !runData || !objection || !userDecision) {
      return res.status(400).json({ error: "caseData, runData, objection et userDecision sont requis." });
    }

    const role = normalizeRole(runData?.answers?.role || "Juge");

    const payload = {
      caseId: caseData.caseId,
      domaine: caseData.domaine,
      niveau: caseData.niveau,
      titre: caseData.titre || caseData.title,
      resume: safeStr(caseData.resume || caseData.brief, 1200),
      role,
      objection: {
        id: safeStr(objection.id, 40),
        by: safeStr(objection.by, 30),
        title: safeStr(objection.title, 160),
        statement: safeStr(objection.statement, 1200),
        options: Array.isArray(objection.options) ? objection.options.slice(0, 3) : ["Accueillir", "Rejeter", "Demander précision"],
      },
      userDecision: {
        choice: safeStr(userDecision.choice, 40),
        reasoning: safeStr(userDecision.reasoning, 1200),
      },
      procedureChoice: runData?.answers?.procedureChoice || null,
      procedureJustification: safeStr(runData?.answers?.procedureJustification, 900),
      qualification: safeStr(runData?.answers?.qualification, 900),
      lastAudit: Array.isArray(runData?.state?.auditLog) ? runData.state.auditLog.slice(-3) : [],
    };

    const system = `
Tu es un assesseur judiciaire expert (RDC) spécialisé en pratique d'audience.
Tu donnes un avis "instantané" sur UNE objection et la décision du joueur.

Contraintes:
- Retourne UNIQUEMENT un JSON valide.
- verdict = "OK" ou "RISQUE"
- riskLevel = "Faible" ou "Moyen" ou "Élevé"
- Pas d'articles inventés. Pas de citations fausses.
- suggestion: 1 à 2 phrases actionnables.

Format EXACT:
{
  "verdict": "OK" | "RISQUE",
  "riskLevel": "Faible" | "Moyen" | "Élevé",
  "headline": string,
  "explanation": string,
  "suggestion": string
}
`.trim();

    const user = `INPUT:\n${JSON.stringify(payload, null, 2)}`;

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: process.env.JUSTICE_LAB_INSTANT_MODEL || process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: Number(process.env.JUSTICE_LAB_INSTANT_TEMPERATURE || 0.25),
        max_tokens: Number(process.env.JUSTICE_LAB_INSTANT_MAX_TOKENS || 350),
        response_format: { type: "json_object" },
      }),
      Number(process.env.JUSTICE_LAB_INSTANT_TIMEOUT_MS || 7000),
      "INSTANT_FEEDBACK_TIMEOUT"
    );

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let out;
    try {
      out = JSON.parse(raw);
    } catch {
      out = null;
    }

    const verdict = String(out?.verdict || "").toUpperCase();
    const riskLevel = String(out?.riskLevel || "");

    const okVerdict = ["OK", "RISQUE"].includes(verdict);
    const okRisk = ["Faible", "Moyen", "Élevé"].includes(riskLevel);

    if (!out || !okVerdict || !okRisk || typeof out?.headline !== "string") {
      res.setHeader("X-JusticeLab-Instant-Fallback", "true");
      return res.json({
        verdict: "RISQUE",
        riskLevel: "Moyen",
        headline: "Analyse IA indisponible (fallback)",
        explanation: "Le format IA est inexploitable ou incomplet.",
        suggestion: "Motive (contradictoire/recevabilité) et précise l’impact sur les pièces et les droits de la défense.",
      });
    }

    const clean = {
      verdict,
      riskLevel,
      headline: safeStr(out.headline, 220),
      explanation: safeStr(out.explanation || "", 900),
      suggestion: safeStr(out.suggestion || "", 380),
    };

    const totalMs = Date.now() - t0;
    res.setHeader("X-JusticeLab-Instant-Time-Ms", String(totalMs));
    return res.json(clean);
  } catch (e) {
    const totalMs = Date.now() - t0;
    console.warn("⚠️ /justice-lab/instant-feedback error:", e?.message);

    res.setHeader("X-JusticeLab-Instant-Time-Ms", String(totalMs));
    return res.json({
      verdict: "RISQUE",
      riskLevel: "Moyen",
      headline: "IA indisponible (fallback)",
      explanation: "Le service IA n’a pas répondu à temps.",
      suggestion: "Justifie brièvement (contradictoire, régularité, recevabilité) et précise l’impact sur les pièces/actes.",
    });
  }
});

/* =========================================================
   ✅ NEW — ROOMS CO-OP 2–3 joueurs (Render-friendly, polling)
   Endpoints attendus par JusticeLabPlay.jsx :
     POST /justice-lab/rooms/create   { caseId, displayName, role }
     POST /justice-lab/rooms/join     { roomId, caseId, displayName, role }
     GET  /justice-lab/rooms/:roomId?participantId=...
     POST /justice-lab/rooms/action   { roomId, participantId, action:{type,payload} }
   + Compat anciens endpoints :
     GET  /justice-lab/rooms/state/:roomId
     POST /justice-lab/rooms/suggest
     POST /justice-lab/rooms/judge-decision
========================================================= */

const ROOMS_TTL_MS = Number(process.env.JUSTICE_LAB_ROOMS_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const ROOMS_MAX_PLAYERS = Number(process.env.JUSTICE_LAB_ROOMS_MAX_PLAYERS || 3);

const rooms = new Map(); // roomId -> room

function nowMs() {
  return Date.now();
}
function nowIso() {
  return new Date().toISOString();
}
function randCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/I/1
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function makeRoomId() {
  // format simple (copiable)
  return `JL-${randCode(6)}`;
}
function makeParticipantId() {
  return `p_${nowMs().toString(36)}_${Math.random().toString(16).slice(2)}`;
}
function cleanupRooms() {
  const t = nowMs();
  for (const [id, r] of rooms.entries()) {
    if (!r) {
      rooms.delete(id);
      continue;
    }
    const exp = Number(r.expiresAt || 0);
    if (exp && exp <= t) rooms.delete(id);
  }
}
setInterval(cleanupRooms, 60 * 1000).unref?.();

function ensureRoleValid(role) {
  const r = normalizeRole(role || "");
  // compat legacy "Avocat"
  const rr = r === "Avocat" ? "Avocat Défense" : r;
  if (!["Juge", "Procureur", "Greffier", "Avocat Demandeur", "Avocat Défendeur", "Avocat Défense", "Avocat Partie civile"].includes(rr)) {
    return "ROLE_INVALID";
  }
  return rr;
}

function scrubRoomForClient(room) {
  if (!room) return null;
  const players = Array.isArray(room.players) ? room.players : [];
  return {
    roomId: room.roomId,
    version: Number(room.version || 0),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt,
    meta: room.meta || {},
    caseId: room.caseId || null,
    players: players.map((p) => ({
      participantId: p.participantId,
      displayName: p.displayName,
      role: p.role,
      joinedAt: p.joinedAt,
      isHost: Boolean(p.isHost),
      lastSeenAt: p.lastSeenAt || null,
    })),
    snapshot: room.snapshot || null,
    suggestions: Array.isArray(room.suggestions) ? room.suggestions.slice(0, 60) : [],
    decisions: Array.isArray(room.decisions) ? room.decisions.slice(0, 120) : [],
  };
}

function getRoomOr404(roomId) {
  cleanupRooms();
  const rid = String(roomId || "").trim().toUpperCase();
  const room = rooms.get(rid);
  if (!room) return null;
  room.expiresAt = nowMs() + ROOMS_TTL_MS;
  return room;
}

function roleTaken(room, role) {
  const players = Array.isArray(room.players) ? room.players : [];
  const wanted = String(role);
  // rôle réservé par l'IA (si activée)
  const aiRole = String(room?.meta?.aiRole || "").trim();
  if (aiRole && wanted === aiRole) return true;
  return players.some((p) => String(p.role) === wanted);
}

function getParticipant(room, participantId) {
  const pid = String(participantId || "").trim();
  const players = Array.isArray(room.players) ? room.players : [];
  return players.find((p) => p.participantId === pid) || null;
}

/**
 * POST /justice-lab/rooms/create
 * body: { caseId, displayName, role }
 */
app.post("/justice-lab/rooms/create", requireAuth, async (req, res) => {
  try {
    cleanupRooms();

    const caseId = safeStr(req.body?.caseId || "", 80);
    const displayName = safeStr(req.body?.displayName || "Joueur", 50) || "Joueur";

    // ✅ IA : par défaut, le juge est l'IA (modifiable par le créateur)
    const aiRoleIn = safeStr(req.body?.aiRole || "Juge", 40);
    const aiRoleNorm =
      String(aiRoleIn || "").trim().toLowerCase() === "aucun" || String(aiRoleIn || "").trim() === ""
        ? null
        : ensureRoleValid(aiRoleIn);
    if (aiRoleNorm === "ROLE_INVALID") return res.status(400).json({ error: "aiRole invalide." });

    const r = ensureRoleValid(req.body?.role || (aiRoleNorm === "Juge" ? "Procureur" : "Juge"));
    if (r === "ROLE_INVALID") return res.status(400).json({ error: "Role invalide." });

    if (aiRoleNorm && r === aiRoleNorm) {
      return res.status(409).json({ error: `Rôle réservé à l'IA: ${aiRoleNorm}` });
    }

    const roomId = makeRoomId();
    const participantId = makeParticipantId();

    const createdAt = nowIso();
    const room = {
      roomId,
      version: 0,
      createdAt,
      updatedAt: createdAt,
      expiresAt: nowMs() + ROOMS_TTL_MS,
      caseId: caseId || null,
      meta: {
        title: safeStr(req.body?.title || "Audience co-op", 140),
        aiRole: aiRoleNorm, // ex: "Juge" par défaut
      },
      players: [
        {
          participantId,
          displayName,
          role: r,
          isHost: true,
          joinedAt: createdAt,
          lastSeenAt: createdAt,
        },
      ],
      snapshot: null, // host pousse l'état via /rooms/action
      suggestions: [],
      decisions: [],
    };

    rooms.set(roomId, room);
    return res.json({ roomId, participantId, version: room.version, snapshot: room.snapshot });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/create:", e);
    return res.status(500).json({ error: "Erreur création room." });
  }
});

/**
 * POST /justice-lab/rooms/join
 * body: { roomId, caseId, displayName, role }
 */
app.post("/justice-lab/rooms/join", requireAuth, async (req, res) => {
  try {
    const roomId = String(req.body?.roomId || "").trim().toUpperCase();
    if (!roomId) return res.status(400).json({ error: "roomId requis." });

    const room = getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const displayName = safeStr(req.body?.displayName || "Joueur", 50) || "Joueur";
    const r = ensureRoleValid(req.body?.role || "Avocat");
    if (r === "ROLE_INVALID") return res.status(400).json({ error: "Role invalide." });

    const joinCaseId = safeStr(req.body?.caseId || "", 80);
    if (room.caseId && joinCaseId && room.caseId !== joinCaseId) {
      return res.status(409).json({ error: "CASE_MISMATCH" });
    }

    const players = Array.isArray(room.players) ? room.players : [];
    if (players.length >= ROOMS_MAX_PLAYERS) return res.status(409).json({ error: "ROOM_FULL" });

    if (roleTaken(room, r)) return res.status(409).json({ error: `Rôle déjà occupé: ${r}` });

    const participantId = makeParticipantId();
    const t = nowIso();

    room.players.push({
      participantId,
      displayName,
      role: r,
      isHost: false,
      joinedAt: t,
      lastSeenAt: t,
    });

    room.updatedAt = t;
    room.expiresAt = nowMs() + ROOMS_TTL_MS;

    rooms.set(room.roomId, room);
    return res.json({ roomId: room.roomId, participantId, version: room.version || 0, snapshot: room.snapshot || null });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/join:", e);
    return res.status(500).json({ error: "Erreur join room." });
  }
});

/**
 * GET /justice-lab/rooms/:roomId?participantId=...
 * Le front poll. Si participantId présent, on "ping" présence.
 */
app.get("/justice-lab/rooms/:roomId", requireAuth, async (req, res) => {
  try {
    const roomId = String(req.params?.roomId || "").trim().toUpperCase();
    const room = getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const participantId = String(req.query?.participantId || "").trim();
    if (participantId) {
      const me = getParticipant(room, participantId);
      if (me) {
        me.lastSeenAt = nowIso();
        room.updatedAt = me.lastSeenAt;
      }
    }

    room.expiresAt = nowMs() + ROOMS_TTL_MS;
    rooms.set(room.roomId, room);
    return res.json(scrubRoomForClient(room));
  } catch (e) {
    console.error("❌ /justice-lab/rooms/:roomId:", e);
    return res.status(500).json({ error: "Erreur get room." });
  }
});

/**
 * POST /justice-lab/rooms/action
 * body: { roomId, participantId, action: { type, payload } }
 *
 * type supportés (on accepte plusieurs alias pour compat) :
 * - SNAPSHOT / SYNC_SNAPSHOT : payload { snapshot } (host only) -> version++
 * - SUGGESTION             : payload { objectionId, decision, reasoning } (MP/Avocat)
 * - JUDGE_DECISION         : payload { objectionId, decision, reasoning, effects? } (Juge) -> decisions[]
 * - PING                   : keepalive
 */
app.post("/justice-lab/rooms/action", requireAuth, async (req, res) => {
  try {
    const { roomId, participantId, action } = req.body || {};
    if (!roomId) return res.status(400).json({ error: "roomId requis." });

    const room = getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const me = participantId ? getParticipant(room, participantId) : null;
    if (participantId && !me) return res.status(403).json({ error: "PARTICIPANT_NOT_FOUND" });

    const type = String(action?.type || "").trim().toUpperCase();
    const payload = action?.payload || {};
    const t = nowIso();

    if (me) me.lastSeenAt = t;
    room.updatedAt = t;
    room.expiresAt = nowMs() + ROOMS_TTL_MS;

    if (!type || type === "PING") {
      rooms.set(room.roomId, room);
      return res.json({ ok: true, version: Number(room.version || 0) });
    }

    // --- snapshot sync (host) ---
    if (type === "SNAPSHOT" || type === "SYNC_SNAPSHOT") {
      if (!me?.isHost) return res.status(403).json({ error: "HOST_ONLY" });
      const snap = payload?.snapshot || action?.snapshot;
      if (!snap || typeof snap !== "object") return res.status(400).json({ error: "SNAPSHOT_REQUIRED" });

      room.snapshot = snap;
      room.version = Number(room.version || 0) + 1;

      rooms.set(room.roomId, room);
      return res.json({ ok: true, version: room.version });
    }

    // --- suggestion (Procureur/Avocat) ---
    if (type === "SUGGESTION") {
            const sugIn = payload?.suggestion && typeof payload.suggestion === "object" ? payload.suggestion : payload;
      const legacySug = action?.suggestion && typeof action.suggestion === "object" ? action.suggestion : null;
      const src = legacySug || sugIn || {};

const sug = {
        id: `SUG_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ts: t,
        role: me?.role || safeStr(src?.role || src?.byRole || "", 20),
        participantId: me?.participantId || null,
        displayName: me?.displayName || safeStr(src?.displayName || "", 60),
        objectionId: safeStr(src?.objectionId || "", 40),
        decision: safeStr(src?.decision || src?.choice || "", 40),
        reasoning: safeStr(src?.reasoning || src?.reason || "", 1400),
      };



      room.suggestions = Array.isArray(room.suggestions) ? room.suggestions : [];
      room.suggestions.unshift(sug);
      room.suggestions = room.suggestions.slice(0, 60);

      rooms.set(room.roomId, room);
      return res.json({ ok: true, version: Number(room.version || 0), suggestion: sug });
    }

    // --- judge decision (Juge) ---
    if (type === "JUDGE_DECISION") {
      const aiRole = String(room?.meta?.aiRole || "").trim();
      const asAI = Boolean(payload?.asAI || action?.asAI || payload?.by === "AI" || payload?.by === "IA");

      // ✅ Si le juge est l'IA, on autorise l'host à soumettre la décision "au nom" de l'IA.
      const allowedAsHumanJudge = me?.role === "Juge";
      const allowedAsAIJudge = aiRole === "Juge" && me?.isHost && asAI;

      if (!allowedAsHumanJudge && !allowedAsAIJudge) {
        return res.status(403).json({ error: "JUDGE_ONLY" });
      }

      const d = safeStr(payload?.decision || "", 40);
      if (!["Accueillir", "Rejeter", "Demander précision"].includes(d)) {
        return res.status(400).json({ error: "Decision invalide." });
      }

      const dec = {
        id: `DEC_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ts: t,
        objectionId: safeStr(payload?.objectionId || "", 40),
        decision: d,
        reasoning: safeStr(payload?.reasoning || "", 1400),
        effects: payload?.effects && typeof payload.effects === "object" ? payload.effects : null,
        by: allowedAsAIJudge ? "IA" : (me?.role || "Juge"),
      };

      room.decisions = Array.isArray(room.decisions) ? room.decisions : [];
      room.decisions.push(dec);

      room.version = Number(room.version || 0) + 1;
      rooms.set(room.roomId, room);
      return res.json({ ok: true, version: room.version, decision: dec });
    }

    return res.status(400).json({ error: "ACTION_UNKNOWN" });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/action:", e);
    return res.status(500).json({ error: "Erreur action room." });
  }
});

/* -------------------------
   ✅ COMPAT : anciens endpoints
   ------------------------- */

/**
 * GET /justice-lab/rooms/state/:roomId
 * (ancien) -> renvoie { room }
 */
app.get("/justice-lab/rooms/state/:roomId", requireAuth, async (req, res) => {
  try {
    const roomId = String(req.params?.roomId || "").trim().toUpperCase();
    const room = getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });
    return res.json({ room: scrubRoomForClient(room) });
  } catch (e) {
    return res.status(500).json({ error: "Erreur state room." });
  }
});

/**
 * POST /justice-lab/rooms/suggest
 * (ancien) body: { roomId, userId, role, objectionId, choice, reasoning }
 */
app.post("/justice-lab/rooms/suggest", requireAuth, async (req, res) => {
  try {
    const { roomId, role, objectionId, choice, reasoning } = req.body || {};
    if (!roomId || !role || !objectionId || !choice) {
      return res.status(400).json({ error: "roomId, role, objectionId, choice requis." });
    }

    const room = getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const sug = {
      id: `SUG_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: nowIso(),
      role: normalizeRole(role),
      participantId: null,
      displayName: safeStr(req.body?.userName || role, 60),
      objectionId: safeStr(objectionId, 40),
      decision: safeStr(choice, 40),
      reasoning: safeStr(reasoning || "", 1400),
    };

    room.suggestions = Array.isArray(room.suggestions) ? room.suggestions : [];
    room.suggestions.unshift(sug);
    room.suggestions = room.suggestions.slice(0, 60);

    room.updatedAt = nowIso();
    room.expiresAt = nowMs() + ROOMS_TTL_MS;

    rooms.set(room.roomId, room);
    return res.json({ ok: true, suggestion: sug, room: scrubRoomForClient(room) });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/suggest:", e);
    return res.status(500).json({ error: "Erreur suggest." });
  }
});

/**
 * POST /justice-lab/rooms/judge-decision
 * (ancien) body: { roomId, userId, objectionId, decision, reasoning, effects? }
 */
app.post("/justice-lab/rooms/judge-decision", requireAuth, async (req, res) => {
  try {
    const { roomId, objectionId, decision, reasoning, effects } = req.body || {};
    if (!roomId || !objectionId || !decision) {
      return res.status(400).json({ error: "roomId, objectionId, decision requis." });
    }

    const room = getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const d = safeStr(decision, 40);
    if (!["Accueillir", "Rejeter", "Demander précision"].includes(d)) {
      return res.status(400).json({ error: "Decision invalide." });
    }

    const dec = {
      id: `DEC_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: nowIso(),
      objectionId: safeStr(objectionId, 40),
      decision: d,
      reasoning: safeStr(reasoning || "", 1400),
      effects: effects && typeof effects === "object" ? effects : null,
    };

    room.decisions = Array.isArray(room.decisions) ? room.decisions : [];
    room.decisions.push(dec);

    room.updatedAt = nowIso();
    room.expiresAt = nowMs() + ROOMS_TTL_MS;
    room.version = Number(room.version || 0) + 1;

    rooms.set(room.roomId, room);
    return res.json({ ok: true, decision: dec, room: scrubRoomForClient(room) });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/judge-decision:", e);
    return res.status(500).json({ error: "Erreur judge-decision." });
  }
});

/* =======================
   START SERVER
======================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 DroitGPT API démarrée sur le port ${port}`);
});
