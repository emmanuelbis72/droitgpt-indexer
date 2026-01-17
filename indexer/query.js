/**
 * ============================================
 * DroitGPT – Backend principal (query.js)
 * Mode : REST JSON (sans streaming SSE)
 * Optimisé pour réduire la latence réelle
 * + Justice Lab: generate-case + audience + score + appeal + instant-feedback (hybride)
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
import { Server as SocketIOServer } from "socket.io";

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

// ✅ HTTP server + Socket.IO (JusticeLab V4 lobby temps réel)
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});
app.set("io", io);

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
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =======================
   Mini cache embeddings (mémoire)
   - réduit le temps sur questions répétées
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

function buildSystemPrompt(lang = "fr") {
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
`;
}

/**
 * Prompt système pour le scoring Justice Lab
 * - Retour JSON strict (pas HTML)
 * - Évaluation type magistrature / pratique congolaise
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

/** ✅ NOUVEAU : Prompt système pour génération de dossier (caseData) */
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
  if (r.includes("avoc")) return "Avocat";
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
    // champs “pédago”
    reliability: typeof p?.reliability === "number" ? p.reliability : undefined,
    isLate: Boolean(p?.isLate || p?.late),
  }));
}

/** ✅ Sanitize caseData (sécurité minimale) */
function sanitizeCaseData(input, fallback = {}) {
  const cd = input && typeof input === "object" ? input : {};
  const out = {
    caseId: safeStr(cd.caseId || cd.id || fallback.caseId || `JL-${Date.now()}`, 60),
    domaine: safeStr(cd.domaine || fallback.domaine || "Pénal", 40),
    niveau: safeStr(cd.niveau || fallback.niveau || "Intermédiaire", 24),
    titre: safeStr(cd.titre || cd.title || fallback.titre || "Dossier simulé (RDC)", 140),
    resume: safeStr(cd.resume || cd.summary || fallback.resume || "", 1800),
    parties: cd.parties && typeof cd.parties === "object" ? cd.parties : (fallback.parties || {}),
    qualificationInitiale: safeStr(cd.qualificationInitiale || cd.qualification || fallback.qualificationInitiale || "", 500),
    pieces: Array.isArray(cd.pieces) ? cd.pieces.slice(0, 10).map((p, idx) => ({
      id: normalizePieceId(p, idx),
      title: safeStr(p?.title || p?.titre || `Pièce ${idx + 1}`, 140),
      type: safeStr(p?.type || p?.kind || "", 40),
      isLate: Boolean(p?.isLate || p?.late),
      // optionnel, pas obligatoire
      reliability: typeof p?.reliability === "number" ? p.reliability : undefined,
    })) : (Array.isArray(fallback.pieces) ? fallback.pieces : []),
    audienceSeed: Array.isArray(cd.audienceSeed) ? cd.audienceSeed.slice(0, 14).map((s) => safeStr(s, 220)) : (Array.isArray(fallback.audienceSeed) ? fallback.audienceSeed : []),
    risquesProceduraux: Array.isArray(cd.risquesProceduraux) ? cd.risquesProceduraux.slice(0, 10).map((s) => safeStr(s, 220)) : (Array.isArray(fallback.risquesProceduraux) ? fallback.risquesProceduraux : []),
    // meta optionnel
    meta: cd.meta && typeof cd.meta === "object" ? cd.meta : (fallback.meta || {}),
  };

  // Normaliser parties (minimum)
  if (!out.parties || typeof out.parties !== "object") out.parties = {};
  if (!out.parties.demandeur && cd.parties?.demandeur) out.parties.demandeur = cd.parties.demandeur;
  if (!out.parties.defendeur && cd.parties?.defendeur) out.parties.defendeur = cd.parties.defendeur;

  return out;
}

/* =======================
   Fallbacks Justice Lab (déjà présents)
======================= */
function fallbackAudienceFromTemplates(caseData, role = "Juge") {
  const templates = Array.isArray(caseData?.objectionTemplates)
    ? caseData.objectionTemplates
    : [];

  const obs = templates.slice(0, 3).map((t, i) => ({
    id: t.id || `OBJ${i + 1}`,
    by: t.by || "Avocat",
    title: t.title || "Objection",
    statement: t.statement || "",
    options: ["Accueillir", "Rejeter", "Demander précision"],
    bestChoiceByRole: {
      Juge: "Demander précision",
      Procureur: "Rejeter",
      Avocat: "Accueillir",
    },
    effects: {
      onAccueillir: {
        excludePieceIds: [],
        admitLatePieceIds: [],
        why: "Mesure conservatoire (fallback).",
        risk: { dueProcessBonus: 1, appealRiskPenalty: 0 },
      },
      onRejeter: {
        excludePieceIds: [],
        admitLatePieceIds: [],
        why: "Objection écartée (fallback).",
        risk: { dueProcessBonus: 0, appealRiskPenalty: 1 },
      },
      onDemander: {
        clarification: {
          label: "Clarification demandée",
          detail: "La Cour demande des précisions avant de statuer.",
        },
        why: "Clarification (fallback).",
        risk: { dueProcessBonus: 2, appealRiskPenalty: 0 },
      },
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
      roles: {
        juge: "Le Tribunal",
        procureur: "Ministère public",
        avocat: "Défense",
        greffier: "Greffe",
      },
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
      { speaker: "Greffier", text: "Affaire appelée. Les parties sont présentes. La Cour prend place." },
      { speaker: "Juge", text: `L'audience est ouverte. Rôle du joueur: ${role}. Les parties confirment leurs identités.` },
      { speaker: "Procureur", text: "Le ministère public précise l'objet de l'audience et annonce un point de procédure." },
      { speaker: "Avocat", text: "La défense répond, conteste un élément et soulève une objection." },
      { speaker: "Juge", text: "La Cour rappelle le contradictoire et invite à produire/clarifier les pièces pertinentes." },
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
              onDemander: {
                clarification: { label: "Clarification demandée", detail: "Préciser les arguments et pièces." },
                risk: { dueProcessBonus: 2, appealRiskPenalty: 0 },
              },
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
      ? [
          "Atteinte substantielle aux garanties procédurales (simulation).",
          ...(critical.slice(0, 2).map((c) => c.label)),
        ]
      : decision === "CONFIRMATION"
      ? ["Motivation suffisante et procédure globalement régulière (simulation)."]
      : [
          "Dossier à compléter / points à clarifier avant décision définitive (simulation).",
          ...(warnings.slice(0, 2).map((w) => w.label)),
        ];

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

/* =======================
   /ASK — ENDPOINT UNIQUE
======================= */
app.post("/ask", requireAuth, async (req, res) => {
  const t0 = Date.now();
  let embMs = 0;
  let qdrantMs = 0;
  let openaiMs = 0;

  try {
    const { messages, lang = "fr" } = req.body || {};

    if (!Array.isArray(messages) || !messages.every(isValidMessage)) {
      return res.status(400).json({ error: "Format des messages invalide." });
    }

    const lastUserMessage = messages[messages.length - 1].text.trim();

    /* 1) Embedding (avec cache) */
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

    /* 2) Qdrant (avec timeout soft) */
    const tQ0 = Date.now();
    let searchResult = [];
    try {
      searchResult = await withTimeout(
        qdrant.search(process.env.QDRANT_COLLECTION || "documents", {
          vector: embeddingVector,
          limit: Number(process.env.QDRANT_LIMIT || 3),
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
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS);
    }

    /* 3) Prompt */
    const historyWindow = Number(process.env.HISTORY_WINDOW || 4);
    const chatHistory = [
      { role: "system", content: buildSystemPrompt(lang) },
      ...(context
        ? [{ role: "user", content: `Contexte juridique pertinent :\n${context}` }]
        : []),
      ...messages.slice(-historyWindow).map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      })),
    ];

    /* 4) OpenAI chat */
    const tA0 = Date.now();
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      messages: chatHistory,
      temperature: Number(process.env.TEMPERATURE || 0.3),
      max_tokens: Number(process.env.MAX_TOKENS || 550),
    });
    openaiMs = Date.now() - tA0;

    const answer =
      completion.choices?.[0]?.message?.content || "<p>❌ Réponse vide.</p>";

    const totalMs = Date.now() - t0;
    res.setHeader("X-Ask-Time-Ms", String(totalMs));
    res.setHeader(
      "X-Ask-Breakdown",
      JSON.stringify({ embMs, qdrantMs, openaiMs, totalMs })
    );
    console.log("⏱️ /ask timings:", { embMs, qdrantMs, openaiMs, totalMs });

    return res.json({ answer });
  } catch (error) {
    const totalMs = Date.now() - t0;
    console.error("❌ Erreur /ask :", error);
    console.log("⏱️ /ask timings (failed):", { embMs, qdrantMs, openaiMs, totalMs });
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
});

/* =========================================================
   ✅ JUSTICE LAB — GÉNÉRATEUR IA DE DOSSIERS (caseData)
   POST /justice-lab/generate-case
   Body:
   - mode="full"  : génère le dossier complet
   - mode="enrich": enrichit un draft existant
   Exemples:
   { mode:"full", domaine:"Foncier", level:"Intermédiaire", seed:"123", lang:"fr" }
   { mode:"enrich", domaine:"Pénal", level:"Avancé", draft:{...}, lang:"fr" }
========================================================= */
app.post("/justice-lab/generate-case", requireAuth, async (req, res) => {
  try {
    const {
      mode = "full",
      domaine = "Pénal",
      level = "Intermédiaire",
      seed = String(Date.now()),
      lang = "fr",
      draft = null,
      templateId = null,
      caseSeed = null,
      city = null,
      tribunal = null,
      chambre = null,
    } = req.body || {};

    const safeMode = String(mode || "full").toLowerCase() === "enrich" ? "enrich" : "full";

    const metaHints = {
      templateId: templateId ? safeStr(templateId, 80) : undefined,
      seed: safeStr(caseSeed || seed, 80),
      city: city ? safeStr(city, 80) : undefined,
      tribunal: tribunal ? safeStr(tribunal, 120) : undefined,
      chambre: chambre ? safeStr(chambre, 120) : undefined,
    };

    const system = buildJusticeLabGenerateCaseSystemPrompt().trim();

    const userFull = `
PARAMÈTRES:
- Mode: full
- Domaine: ${domaine}
- Niveau: ${level}
- Langue: ${lang}
- Seed: ${metaHints.seed}

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
    { "id": "P1", "title": string, "type": string, "isLate": boolean, "reliability": number },
    { "id": "P2", "title": string, "type": string, "isLate": boolean, "reliability": number }
  ],
  "audienceSeed": [ string, string ],
  "risquesProceduraux": [ string, string ],
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
- pieces: 5 à 8 pièces (P1..P8), toutes cohérentes avec les faits.
- Ajoute au moins 1 pièce tardive (isLate=true) et 1 pièce “contestable” (reliability plus faible).
- resume: 5 à 10 lignes, très clair, contexte RDC.
- audienceSeed: 6 à 10 “points de débat” courts (1 phrase chacun).
- risquesProceduraux: 4 à 7 risques.
- meta.*: remplis au mieux (city/tribunal/chambre si possible).
- Ne mentionne pas d'articles numérotés.
`.trim();

    const userEnrich = `
PARAMÈTRES:
- Mode: enrich
- Domaine: ${domaine}
- Niveau: ${level}
- Langue: ${lang}
- Seed: ${metaHints.seed}

Voici un DRAFT (déjà jouable). Tu dois l'enrichir sans casser la structure.
DRAFT:
${safeStr(JSON.stringify(draft || {}, null, 2), 9000)}

Règles:
- Retourne EXACTEMENT un JSON qui ressemble à caseData complet.
- Conserve les IDs des pièces déjà présentes (P1..), tu peux ajouter P6..P8 si besoin.
- Améliore : résumé, audienceSeed, risques, qualité des pièces (titres/types), parties, qualificationInitiale.
- Ne mets pas d'articles numérotés.
- Ne change pas caseId si déjà présent.
`.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_CASE_MODEL || process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: safeMode === "enrich" ? userEnrich : userFull },
      ],
      temperature: Number(process.env.JUSTICE_LAB_CASE_TEMPERATURE || 0.6),
      max_tokens: Number(process.env.JUSTICE_LAB_CASE_MAX_TOKENS || 1400),
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // fallback: si enrich => draft, sinon objet minimal
      const fallback = safeMode === "enrich" ? (draft || {}) : {};
      const caseData = sanitizeCaseData(fallback, {
        domaine,
        niveau: level,
        meta: { ...metaHints, generatedAt: new Date().toISOString() },
      });
      return res.json({ caseData });
    }

    // Injecter meta hints si manquants + sanitization
    const fallbackBase =
      safeMode === "enrich"
        ? (draft && typeof draft === "object" ? draft : {})
        : {};

    const sanitized = sanitizeCaseData(parsed, {
      ...fallbackBase,
      domaine,
      niveau: level,
      meta: { ...metaHints, generatedAt: new Date().toISOString() },
    });

    // S’assurer meta
    sanitized.meta = {
      ...(sanitized.meta || {}),
      templateId: sanitized.meta?.templateId || metaHints.templateId || "AI_FULL",
      seed: sanitized.meta?.seed || metaHints.seed,
      city: sanitized.meta?.city || metaHints.city || "RDC",
      tribunal: sanitized.meta?.tribunal || metaHints.tribunal || "Juridiction (simulation)",
      chambre: sanitized.meta?.chambre || metaHints.chambre || "Chambre (simulation)",
      generatedAt: sanitized.meta?.generatedAt || new Date().toISOString(),
    };

    // Retour compatible front: {caseData}
    return res.json({ caseData: sanitized });
  } catch (e) {
    console.error("❌ /justice-lab/generate-case error:", e);
    const fallback = req.body?.mode === "enrich" ? (req.body?.draft || {}) : {};
    const caseData = sanitizeCaseData(fallback, {
      domaine: req.body?.domaine || "Pénal",
      niveau: req.body?.level || "Intermédiaire",
      meta: { generatedAt: new Date().toISOString() },
    });
    return res.status(200).json({ caseData, warning: "fallback" });
  }
});

/* =========================================================
   ✅ JUSTICE LAB — AUDIENCE IA (ULTRA PRO)
   POST /justice-lab/audience
   Body accepté: { caseData, run } OU { caseData, runData }
========================================================= */
app.post("/justice-lab/audience", requireAuth, async (req, res) => {
  try {
    const { caseData } = req.body || {};
    const run = req.body?.run || req.body?.runData; // compat

    if (!caseData || !run) {
      return res.status(400).json({ error: "caseData et run (ou runData) sont requis." });
    }

    const role = normalizeRole(run?.answers?.role || "Juge");

    const piecesCatalog = buildPiecesCatalog(caseData, 12);

    // Petites aides pour ancrer l'IA dans des pièces réelles
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
        juridiction:
          run?.answers?.court ||
          run?.answers?.juridiction ||
          "Tribunal (simulation)",
      },
      parties: caseData.parties,
      piecesCatalog, // IMPORTANT : l'IA doit référencer ces IDs
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

    const system = `
Tu es un "Moteur d'audience judiciaire" (RDC) pour un jeu pédagogique de magistrature.
Objectif : produire une audience TRÈS réaliste, professionnelle, détaillée, mais rythmée et agréable.

Règles strictes :
- Tu retournes UNIQUEMENT un JSON valide (aucun texte autour).
- Le style doit ressembler à une vraie audience: appel de la cause, police d'audience, contradictoire, relances, demandes de précision, rythme.
- Pas d'articles inventés (pas de numéros d'articles). Tu peux dire "selon les règles de procédure" ou "au regard du contradictoire".
- IMPORTANT : tu dois référencer les pièces UNIQUEMENT via les IDs fournis dans piecesCatalog (ex: "P3"), jamais inventer d'autres IDs.
- "options" doit être EXACTEMENT ["Accueillir","Rejeter","Demander précision"].
- Les objections doivent être exploitables par un moteur de jeu :
    objection.bestChoiceByRole = { "Juge": "...", "Procureur":"...", "Avocat":"..." }
    objection.effects = { onAccueillir, onRejeter, onDemander }
    Chaque effect peut contenir:
      - excludePieceIds: [IDs existants]
      - admitLatePieceIds: [IDs existants]
      - addTask: { type:"instruction"|"production"|"delai"|"renvoi", label, detail }
      - clarification: { label, detail }
      - why: string
      - risk: { dueProcessBonus:number, appealRiskPenalty:number }

Qualité / Fun :
- Ajoute 1 "moment d'audience" léger (ex: tension contrôlée, une contradiction qui ressort, une relance vive du juge), sans caricature.
- Le juge doit "piloter" : rappeler l'ordre, cadrer, reformuler, imposer le contradictoire.
`.trim();

    const user = `
INPUT:
${JSON.stringify(payload, null, 2)}

FORMAT JSON EXACT attendu :
{
  "scene": {
    "court": string,
    "chamber": string,
    "city": string,
    "date": "YYYY-MM-DD",
    "formation": string,
    "roles": { "juge": string, "procureur": string, "avocat": string, "greffier": string },
    "vibe": string
  },
  "phases": [
    { "id": "OPENING"|"DEBATE"|"OBJECTIONS"|"CLOSING", "title": string, "objective": string }
  ],
  "turns": [
    { "speaker": "Greffier"|"Juge"|"Procureur"|"Avocat", "text": string, "phase": "OPENING"|"DEBATE"|"OBJECTIONS"|"CLOSING" }
  ],
  "objections": [
    {
      "id": "OBJ1",
      "by": "Procureur"|"Avocat",
      "title": string,
      "statement": string,
      "options": ["Accueillir","Rejeter","Demander précision"],
      "bestChoiceByRole": { "Juge": "Accueillir"|"Rejeter"|"Demander précision", "Procureur": "...", "Avocat": "..." },
      "effects": {
        "onAccueillir": { "excludePieceIds": [string], "admitLatePieceIds": [string], "addTask": { "type": string, "label": string, "detail": string }, "clarification": { "label": string, "detail": string }, "why": string, "risk": { "dueProcessBonus": number, "appealRiskPenalty": number } },
        "onRejeter":    { "excludePieceIds": [string], "admitLatePieceIds": [string], "addTask": { "type": string, "label": string, "detail": string }, "clarification": { "label": string, "detail": string }, "why": string, "risk": { "dueProcessBonus": number, "appealRiskPenalty": number } },
        "onDemander":   { "excludePieceIds": [string], "admitLatePieceIds": [string], "addTask": { "type": string, "label": string, "detail": string }, "clarification": { "label": string, "detail": string }, "why": string, "risk": { "dueProcessBonus": number, "appealRiskPenalty": number } }
      }
    }
  ]
}

Contraintes de volume:
- turns : 10 à 16 (court mais vivant, 1 à 3 phrases par turn).
- objections : 3 à 5 (variées: recevabilité, contradictoire, tardiveté, authenticité, renvoi, compétence selon le cas).
- Au moins 1 objection doit viser une pièce: soit tardive, soit contestée, en utilisant les IDs réels.
`.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.JUSTICE_LAB_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: Number(process.env.JUSTICE_LAB_AUDIENCE_TEMPERATURE || 0.5),
      max_tokens: Number(process.env.JUSTICE_LAB_AUDIENCE_MAX_TOKENS || 1400),
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_e) {
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    }

    if (!Array.isArray(data?.turns) || !Array.isArray(data?.objections)) {
      return res.json(fallbackAudienceFromTemplates(caseData, role));
    }

    // Sanitization + compat moteur
    const safeScene = {
      court: safeStr(data?.scene?.court || payload.meta.juridiction, 180),
      chamber: safeStr(data?.scene?.chamber || "Chambre (simulation)", 180),
      city: safeStr(data?.scene?.city || payload.meta.ville, 80),
      date: safeStr(data?.scene?.date || new Date().toISOString().slice(0, 10), 10),
      formation: safeStr(data?.scene?.formation || "Siège", 80),
      roles: {
        juge: safeStr(data?.scene?.roles?.juge || "Le Tribunal", 80),
        procureur: safeStr(data?.scene?.roles?.procureur || "Ministère public", 80),
        avocat: safeStr(data?.scene?.roles?.avocat || "Défense", 80),
        greffier: safeStr(data?.scene?.roles?.greffier || "Greffe", 80),
      },
      vibe: safeStr(data?.scene?.vibe || "Audience rythmée et professionnelle.", 160),
    };

    const safePhases = Array.isArray(data?.phases) && data.phases.length
      ? data.phases.slice(0, 6).map((p) => ({
          id: String(p?.id || "DEBATE"),
          title: safeStr(p?.title || "Phase", 80),
          objective: safeStr(p?.objective || "", 200),
        }))
      : [
          { id: "OPENING", title: "Ouverture", objective: "Installer le contradictoire et cadrer l'audience." },
          { id: "DEBATE", title: "Débat", objective: "Clarifier les faits/procédure." },
          { id: "OBJECTIONS", title: "Incidents", objective: "Trancher les objections et statuer sur les pièces." },
          { id: "CLOSING", title: "Clôture", objective: "Mise en état: renvoi, calendrier ou délibéré." },
        ];

    const turns = data.turns.slice(0, 18).map((t) => ({
      speaker: String(t?.speaker || "Juge"),
      text: safeStr(t?.text || "", 650),
      phase: String(t?.phase || "DEBATE"),
    }));

    // Filtre de sécurité: ne garder que des IDs de pièces connues
    const allowedPieceIds = new Set(pieceIds);

    function cleanEffect(eff) {
      if (!eff || typeof eff !== "object") return null;
      const excludePieceIds = Array.isArray(eff.excludePieceIds)
        ? eff.excludePieceIds.map(String).filter((id) => allowedPieceIds.has(id)).slice(0, 6)
        : [];
      const admitLatePieceIds = Array.isArray(eff.admitLatePieceIds)
        ? eff.admitLatePieceIds.map(String).filter((id) => allowedPieceIds.has(id)).slice(0, 6)
        : [];

      const addTask =
        eff.addTask && typeof eff.addTask === "object"
          ? {
              type: String(eff.addTask.type || "instruction"),
              label: safeStr(eff.addTask.label || "Mesure", 120),
              detail: safeStr(eff.addTask.detail || "", 260),
            }
          : null;

      const clarification =
        eff.clarification && typeof eff.clarification === "object"
          ? {
              label: safeStr(eff.clarification.label || "Clarification", 120),
              detail: safeStr(eff.clarification.detail || "", 260),
            }
          : null;

      const risk =
        eff.risk && typeof eff.risk === "object"
          ? {
              dueProcessBonus: Number.isFinite(Number(eff.risk.dueProcessBonus)) ? Number(eff.risk.dueProcessBonus) : 0,
              appealRiskPenalty: Number.isFinite(Number(eff.risk.appealRiskPenalty)) ? Number(eff.risk.appealRiskPenalty) : 0,
            }
          : { dueProcessBonus: 0, appealRiskPenalty: 0 };

      return {
        excludePieceIds,
        admitLatePieceIds,
        ...(addTask ? { addTask } : {}),
        ...(clarification ? { clarification } : {}),
        why: safeStr(eff.why || "", 220),
        risk,
      };
    }

    const objections = data.objections.slice(0, 6).map((o, idx) => {
      const id = String(o?.id || `OBJ${idx + 1}`);
      const by = String(o?.by || "Avocat");
      const title = safeStr(o?.title || "Objection", 160);
      const statement = safeStr(o?.statement || "", 900);

      const bestChoiceByRole = {
        Juge: ["Accueillir", "Rejeter", "Demander précision"].includes(o?.bestChoiceByRole?.Juge)
          ? o.bestChoiceByRole.Juge
          : "Demander précision",
        Procureur: ["Accueillir", "Rejeter", "Demander précision"].includes(o?.bestChoiceByRole?.Procureur)
          ? o.bestChoiceByRole.Procureur
          : "Rejeter",
        Avocat: ["Accueillir", "Rejeter", "Demander précision"].includes(o?.bestChoiceByRole?.Avocat)
          ? o.bestChoiceByRole.Avocat
          : "Accueillir",
      };

      const effects = o?.effects || {};
      const onAccueillir = cleanEffect(effects.onAccueillir) || { risk: { dueProcessBonus: 1, appealRiskPenalty: 0 } };
      const onRejeter = cleanEffect(effects.onRejeter) || { risk: { dueProcessBonus: 0, appealRiskPenalty: 1 } };
      const onDemander =
        cleanEffect(effects.onDemander) || {
          clarification: { label: "Clarification", detail: "La Cour exige des précisions avant de statuer." },
          risk: { dueProcessBonus: 2, appealRiskPenalty: 0 },
        };

      return {
        id,
        by,
        title,
        statement,
        options: ["Accueillir", "Rejeter", "Demander précision"],
        bestChoiceByRole,
        effects: { onAccueillir, onRejeter, onDemander },
      };
    });

    return res.json({
      scene: safeScene,
      phases: safePhases,
      piecesCatalog,
      turns,
      objections,
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
   ✅ JUSTICE LAB — SCORING IA (JSON strict)
   POST /justice-lab/score
   Body: { caseData: {...}, runData: {...} }
========================================================= */
app.post("/justice-lab/score", requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { caseData, runData } = req.body || {};

    if (!caseData || !runData) {
      return res.status(400).json({ error: "caseData et runData sont requis." });
    }

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

Rappels :
- scores 0..100
- "audience" = gestion des objections, contradictoire, tenue des débats
- criticalErrors uniquement les erreurs graves
- feedback = recommandations actionnables
- recommendedNext = 3 exercices/cas
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
    } catch (_e) {
      return res.status(500).json({
        error: "Réponse IA non-JSON (invalide).",
        raw: raw.slice(0, 1200),
      });
    }

    if (
      typeof result?.scoreGlobal !== "number" ||
      !result?.scores ||
      typeof result?.scores?.qualification !== "number"
    ) {
      return res.status(500).json({
        error: "Réponse IA invalide (structure).",
        raw: result,
      });
    }

    if (typeof result?.scores?.audience !== "number") {
      result.scores.audience = 0;
    }

    const totalMs = Date.now() - t0;
    res.setHeader("X-JusticeLab-Time-Ms", String(totalMs));
    res.setHeader("X-JusticeLab-Breakdown", JSON.stringify({ openaiMs, totalMs }));

    return res.json(result);
  } catch (error) {
    const totalMs = Date.now() - t0;
    console.error("❌ Erreur /justice-lab/score :", error);
    return res.status(500).json({
      error: "Erreur serveur Justice Lab.",
      detail: error?.message,
      totalMs,
    });
  }
});

/* =========================================================
   ✅ JUSTICE LAB — APPEAL IA (V4)
   POST /justice-lab/appeal
========================================================= */
app.post("/justice-lab/appeal", requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { caseData, scored } = req.body || {};
    const run = req.body?.run || req.body?.runData;

    if (!caseData || !run) {
      return res.status(400).json({ error: "caseData et run (ou runData) sont requis." });
    }

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

Contraintes:
- grounds: 3 à 6 points, concis.
- dispositif: court, style juridiction.
- recommendations: 3 à 6 recommandations actionnables.
`.trim();

    const tA0 = Date.now();
    const completion = await openai.chat.completions.create({
      model:
        process.env.JUSTICE_LAB_APPEAL_MODEL ||
        process.env.JUSTICE_LAB_MODEL ||
        "gpt-4o-mini",
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
    } catch (_e) {
      result = null;
    }

    const decision = String(result?.decision || "").toUpperCase();
    const okDecision = ["CONFIRMATION", "ANNULATION", "RENVOI"].includes(decision);

    if (!result || !okDecision || !Array.isArray(result?.grounds) || typeof result?.dispositif !== "string") {
      const fallback = fallbackAppealFromScored(scored || {});
      const totalMs = Date.now() - t0;
      res.setHeader("X-JusticeLab-Appeal-Time-Ms", String(totalMs));
      res.setHeader(
        "X-JusticeLab-Appeal-Breakdown",
        JSON.stringify({ openaiMs: 0, totalMs, fallback: true })
      );
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
    res.setHeader(
      "X-JusticeLab-Appeal-Breakdown",
      JSON.stringify({ openaiMs, totalMs })
    );

    return res.json({ decision, grounds, dispositif, recommendations });
  } catch (error) {
    console.error("❌ Erreur /justice-lab/appeal :", error);
    const fallback = fallbackAppealFromScored(req.body?.scored || {});
    return res.json(fallback);
  }
});

/* =========================================================
   ✅ JUSTICE LAB — INSTANT FEEDBACK IA (HYBRIDE)
   POST /justice-lab/instant-feedback
========================================================= */
app.post("/justice-lab/instant-feedback", requireAuth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { caseData, runData, objection, userDecision } = req.body || {};

    if (!caseData || !runData || !objection || !userDecision) {
      return res.status(400).json({
        error: "caseData, runData, objection et userDecision sont requis.",
      });
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
        options: Array.isArray(objection.options)
          ? objection.options.slice(0, 3)
          : ["Accueillir", "Rejeter", "Demander précision"],
      },
      userDecision: {
        choice: safeStr(userDecision.choice, 40),
        reasoning: safeStr(userDecision.reasoning, 1200),
      },
      procedureChoice: runData?.answers?.procedureChoice || null,
      procedureJustification: safeStr(runData?.answers?.procedureJustification, 900),
      qualification: safeStr(runData?.answers?.qualification, 900),
      lastAudit: Array.isArray(runData?.state?.auditLog)
        ? runData.state.auditLog.slice(-3)
        : [],
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

    const user = `
INPUT:
${JSON.stringify(payload, null, 2)}
`.trim();

    const completion = await withTimeout(
      openai.chat.completions.create({
        model:
          process.env.JUSTICE_LAB_INSTANT_MODEL ||
          process.env.JUSTICE_LAB_MODEL ||
          "gpt-4o-mini",
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
    } catch (_e) {
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
        explanation:
          "Le format IA est inexploitable ou incomplet. Le feedback instant offline reste la référence.",
        suggestion:
          "Motive (contradictoire/recevabilité) et précise l’impact sur les pièces et les droits de la défense.",
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
      explanation:
        "Le service IA n’a pas répondu à temps. Le jeu continue en mode hybride: feedback instant offline prioritaire.",
      suggestion:
        "Justifie brièvement (contradictoire, régularité, recevabilité) et précise l’impact sur les pièces/actes.",
    });
  }
});





/* =========================================================
   ✅ JusticeLab Rooms (V4) — Persistantes + Lobby + Rôles uniques
   - MongoDB si dispo (sinon fallback mémoire)
   - Rôles uniques
   - Créateur seul peut démarrer
   - Actions signées par participantId

   Endpoints REST (compat + fallback si Socket.IO indispo):
     POST /justice-lab/rooms/create   { caseId, displayName, role, aiRole }
     POST /justice-lab/rooms/join     { roomId, caseId, displayName, role }
     GET  /justice-lab/rooms/:roomId?participantId=...
     POST /justice-lab/rooms/action   { roomId, participantId, action:{type,payload} }
========================================================= */

const ROOMS_TTL_MS = Number(process.env.JUSTICE_LAB_ROOMS_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const ROOMS_MAX_PLAYERS = Number(process.env.JUSTICE_LAB_ROOMS_MAX_PLAYERS || 5); // V4: jusqu'à 5 (Juge/Greffier/Procureur/2 avocats)

function nowMs() {
  return Date.now();
}
function nowIso() {
  return new Date().toISOString();
}
function randCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function makeRoomId() {
  return `JL-${randCode(6)}`;
}
function makeParticipantId() {
  return `p_${nowMs().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

// Roles V4 (inclut 2 avocats)
function ensureRoleValid(role) {
  const r = normalizeRole(role || "");
  const rr = r === "Avocat" ? "Avocat Défense" : r;
  if (!["Juge", "Procureur", "Greffier", "Avocat Défense", "Avocat Partie civile"].includes(rr)) {
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
    caseId: room.caseId || null,
    meta: {
      ...(room.meta || {}),
      // ne pas exposer tout snapshot interne si trop gros
    },
    players: players.map((p) => ({
      participantId: p.participantId,
      displayName: p.displayName,
      role: p.role,
      isHost: Boolean(p.isHost),
      ready: Boolean(p.ready),
      joinedAt: p.joinedAt,
      lastSeenAt: p.lastSeenAt,
      connected: p.connected !== false,
    })),
    snapshot: room.snapshot || null,
    suggestions: Array.isArray(room.suggestions) ? room.suggestions.slice(0, 50) : [],
    decisions: Array.isArray(room.decisions) ? room.decisions.slice(0, 50) : [],
  };
}

function roleTaken(room, role) {
  const players = Array.isArray(room?.players) ? room.players : [];
  return players.some((p) => String(p?.role) === String(role));
}

function getParticipant(room, participantId) {
  const players = Array.isArray(room?.players) ? room.players : [];
  return players.find((p) => String(p?.participantId) === String(participantId));
}

// --------- Mongo persistence (optionnel) ---------
let JusticeLabRoomModel = null;
try {
  if (mongoose?.models?.JusticeLabRoom) {
    JusticeLabRoomModel = mongoose.models.JusticeLabRoom;
  } else {
    const RoomSchema = new mongoose.Schema(
      {
        roomId: { type: String, unique: true, index: true },
        version: { type: Number, default: 0 },
        createdAt: { type: String },
        updatedAt: { type: String },
        expiresAt: { type: Number, index: true },
        caseId: { type: String },
        meta: { type: Object, default: {} },
        players: { type: Array, default: [] },
        snapshot: { type: Object, default: null },
        suggestions: { type: Array, default: [] },
        decisions: { type: Array, default: [] },
      },
      { minimize: false }
    );
    // TTL
    RoomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    JusticeLabRoomModel = mongoose.model("JusticeLabRoom", RoomSchema);
  }
} catch (e) {
  JusticeLabRoomModel = null;
}

const roomsMem = new Map(); // fallback mémoire

async function roomSave(room) {
  if (!room) return;
  roomsMem.set(room.roomId, room);
  if (!JusticeLabRoomModel || !process.env.MONGODB_URI) return;
  try {
    await JusticeLabRoomModel.updateOne(
      { roomId: room.roomId },
      { $set: room },
      { upsert: true }
    );
  } catch (e) {
    // fallback silence
  }
}

async function roomLoad(roomId) {
  const id = String(roomId || "").trim().toUpperCase();
  if (!id) return null;
  // mémoire d'abord
  const inMem = roomsMem.get(id);
  if (inMem && Number(inMem.expiresAt || 0) > nowMs()) return inMem;
  if (!JusticeLabRoomModel || !process.env.MONGODB_URI) return inMem || null;
  try {
    const doc = await JusticeLabRoomModel.findOne({ roomId: id }).lean();
    if (!doc) return null;
    if (Number(doc.expiresAt || 0) <= nowMs()) return null;
    roomsMem.set(id, doc);
    return doc;
  } catch {
    return inMem || null;
  }
}

async function roomDelete(roomId) {
  roomsMem.delete(roomId);
  if (!JusticeLabRoomModel || !process.env.MONGODB_URI) return;
  try {
    await JusticeLabRoomModel.deleteOne({ roomId });
  } catch {}
}

function cleanupRoomsMem() {
  const t = nowMs();
  for (const [id, r] of roomsMem.entries()) {
    if (!r) roomsMem.delete(id);
    else if (Number(r.expiresAt || 0) <= t) roomsMem.delete(id);
  }
}
setInterval(cleanupRoomsMem, 60_000).unref?.();

async function getRoomOr404(roomId) {
  const room = await roomLoad(roomId);
  if (!room) return null;
  return room;
}

function emitRoomUpdate(room) {
  try {
    if (!room?.roomId) return;
    io.to(room.roomId).emit("jl:room:update", scrubRoomForClient(room));
  } catch {}
}

function emitRoomToast(roomId, message, level = "info") {
  try {
    io.to(roomId).emit("jl:toast", { level, message, ts: nowIso() });
  } catch {}
}

// --------- REST endpoints (fallback) ---------
app.post("/justice-lab/rooms/create", requireAuth, async (req, res) => {
  try {
    const caseId = safeStr(req.body?.caseId || "", 80);
    const displayName = safeStr(req.body?.displayName || "Créateur", 50) || "Créateur";
    const r = ensureRoleValid(req.body?.role || "Greffier");
    if (r === "ROLE_INVALID") return res.status(400).json({ error: "Role invalide." });

    const aiRoleNorm = ensureRoleValid(req.body?.aiRole || "Juge");
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
        title: safeStr(req.body?.title || "Procès co-op", 140),
        aiRole: aiRoleNorm === "ROLE_INVALID" ? "Juge" : aiRoleNorm,
        started: false,
        startedAt: null,
      },
      players: [
        {
          participantId,
          displayName,
          role: r,
          isHost: true,
          ready: false,
          joinedAt: createdAt,
          lastSeenAt: createdAt,
          connected: true,
        },
      ],
      snapshot: null,
      suggestions: [],
      decisions: [],
    };

    await roomSave(room);
    return res.json({ roomId, participantId, version: room.version, snapshot: room.snapshot });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/create:", e);
    return res.status(500).json({ error: "Erreur création room." });
  }
});


app.post("/justice-lab/rooms/join", requireAuth, async (req, res) => {
  try {
    const roomId = String(req.body?.roomId || "").trim().toUpperCase();
    if (!roomId) return res.status(400).json({ error: "roomId requis." });

    const room = await getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const displayName = safeStr(req.body?.displayName || "Joueur", 50) || "Joueur";
    const r = ensureRoleValid(req.body?.role || "Avocat Défense");
    if (r === "ROLE_INVALID") return res.status(400).json({ error: "Role invalide." });

    const joinCaseId = safeStr(req.body?.caseId || "", 80);
    if (room.caseId && joinCaseId && room.caseId !== joinCaseId) {
      return res.status(409).json({ error: "CASE_MISMATCH" });
    }

    const players = Array.isArray(room.players) ? room.players : [];
    if (players.length >= ROOMS_MAX_PLAYERS) return res.status(409).json({ error: "ROOM_FULL" });

    if (roleTaken(room, r)) return res.status(409).json({ error: `ROLE_TAKEN:${r}` });

    const participantId = makeParticipantId();
    const t = nowIso();

    room.players = players;
    room.players.push({
      participantId,
      displayName,
      role: r,
      isHost: false,
      ready: false,
      joinedAt: t,
      lastSeenAt: t,
      connected: true,
    });

    room.updatedAt = t;
    room.expiresAt = nowMs() + ROOMS_TTL_MS;
    room.version = Number(room.version || 0) + 1;

    await roomSave(room);
    emitRoomUpdate(room);
    emitRoomToast(room.roomId, `${displayName} a rejoint la salle.`, "info");
    return res.json({ roomId: room.roomId, participantId, version: room.version || 0, snapshot: room.snapshot || null });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/join:", e);
    return res.status(500).json({ error: "Erreur join room." });
  }
});

app.get("/justice-lab/rooms/:roomId", requireAuth, async (req, res) => {
  try {
    const roomId = String(req.params?.roomId || "").trim().toUpperCase();
    const room = await getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const participantId = String(req.query?.participantId || "").trim();
    if (participantId) {
      const me = getParticipant(room, participantId);
      if (me) {
        me.lastSeenAt = nowIso();
        me.connected = true;
        room.updatedAt = me.lastSeenAt;
      }
    }

    room.expiresAt = nowMs() + ROOMS_TTL_MS;
    await roomSave(room);
    return res.json(scrubRoomForClient(room));
  } catch (e) {
    console.error("❌ /justice-lab/rooms/:roomId:", e);
    return res.status(500).json({ error: "Erreur get room." });
  }
});

app.post("/justice-lab/rooms/action", requireAuth, async (req, res) => {
  try {
    const { roomId, participantId, action } = req.body || {};
    if (!roomId) return res.status(400).json({ error: "roomId requis." });

    const room = await getRoomOr404(roomId);
    if (!room) return res.status(404).json({ error: "Room introuvable/expirée." });

    const me = participantId ? getParticipant(room, participantId) : null;
    if (participantId && !me) return res.status(403).json({ error: "PARTICIPANT_NOT_FOUND" });

    const type = String(action?.type || "").trim().toUpperCase();
    const payload = action?.payload || {};
    const t = nowIso();

    if (me) {
      me.lastSeenAt = t;
      me.connected = true;
    }
    room.updatedAt = t;
    room.expiresAt = nowMs() + ROOMS_TTL_MS;

    if (!type || type === "PING") {
      await roomSave(room);
      return res.json({ ok: true, version: Number(room.version || 0) });
    }

    // Host-only start
    if (type === "START") {
      if (!me?.isHost) return res.status(403).json({ error: "HOST_ONLY" });
      room.meta = room.meta || {};
      room.meta.started = true;
      room.meta.startedAt = t;
      room.version = Number(room.version || 0) + 1;
      await roomSave(room);
      emitRoomUpdate(room);
      emitRoomToast(room.roomId, "Audience démarrée par le créateur.", "success");
      return res.json({ ok: true, version: room.version });
    }

    // Ready toggle
    if (type === "READY") {
      if (!me) return res.status(403).json({ error: "PARTICIPANT_NOT_FOUND" });
      me.ready = Boolean(payload?.ready);
      room.version = Number(room.version || 0) + 1;
      await roomSave(room);
      emitRoomUpdate(room);
      return res.json({ ok: true, version: room.version });
    }

    // Snapshot: host only
    if (type === "SNAPSHOT" || type === "SYNC_SNAPSHOT") {
      if (!me?.isHost) return res.status(403).json({ error: "HOST_ONLY" });
      room.snapshot = payload?.snapshot || payload || null;
      room.version = Number(room.version || 0) + 1;
      await roomSave(room);
      emitRoomUpdate(room);
      return res.json({ ok: true, version: room.version });
    }

    // Suggestions by non-judge roles
    if (type === "SUGGESTION") {
      if (!me) return res.status(403).json({ error: "PARTICIPANT_NOT_FOUND" });
      room.suggestions = Array.isArray(room.suggestions) ? room.suggestions : [];
      room.suggestions.unshift({ ...payload, ts: t, by: me.displayName, role: me.role });
      room.suggestions = room.suggestions.slice(0, 80);
      room.version = Number(room.version || 0) + 1;
      await roomSave(room);
      emitRoomUpdate(room);
      return res.json({ ok: true, version: room.version });
    }

    // Judge decisions (human judge only)
    if (type === "JUDGE_DECISION") {
      if (!me) return res.status(403).json({ error: "PARTICIPANT_NOT_FOUND" });
      if (me.role !== "Juge") return res.status(403).json({ error: "JUDGE_ONLY" });
      room.decisions = Array.isArray(room.decisions) ? room.decisions : [];
      room.decisions.unshift({ ...payload, ts: t, by: me.displayName, role: me.role });
      room.decisions = room.decisions.slice(0, 80);
      room.version = Number(room.version || 0) + 1;
      await roomSave(room);
      emitRoomUpdate(room);
      return res.json({ ok: true, version: room.version });
    }

    await roomSave(room);
    return res.json({ ok: true, version: Number(room.version || 0) });
  } catch (e) {
    console.error("❌ /justice-lab/rooms/action:", e);
    return res.status(500).json({ error: "Erreur action room." });
  }
});

/* =========================================================
   ✅ JusticeLab V4 — Socket.IO Lobby temps réel
   Events:
     - jl:join  { roomId, participantId }
     - jl:ready { roomId, participantId, ready:boolean }
     - jl:start { roomId, participantId }
     - jl:action { roomId, participantId, action:{type,payload} }
   Server emits:
     - jl:room:update (scrubbed room)
     - jl:toast (messages)
========================================================= */

io.on("connection", (socket) => {
  socket.on("jl:join", async (payload = {}) => {
    try {
      const roomId = String(payload?.roomId || "").trim().toUpperCase();
      const participantId = String(payload?.participantId || "").trim();
      if (!roomId || !participantId) return;
      const room = await getRoomOr404(roomId);
      if (!room) {
        socket.emit("jl:toast", { level: "error", message: "Salle introuvable/expirée.", ts: nowIso() });
        return;
      }
      const me = getParticipant(room, participantId);
      if (!me) {
        socket.emit("jl:toast", { level: "error", message: "Participant non reconnu.", ts: nowIso() });
        return;
      }
      socket.join(roomId);
      socket.data = { roomId, participantId };

      me.lastSeenAt = nowIso();
      room.updatedAt = me.lastSeenAt;
      room.expiresAt = nowMs() + ROOMS_TTL_MS;
      await roomSave(room);

      // Push initial state
      socket.emit("jl:room:update", scrubRoomForClient(room));
      emitRoomToast(roomId, `${me.displayName} a rejoint le lobby.`, "info");
      emitRoomUpdate(room);
    } catch (e) {
      socket.emit("jl:toast", { level: "error", message: "Erreur join realtime.", ts: nowIso() });
    }
  });

  socket.on("jl:ready", async (payload = {}) => {
    try {
      const roomId = String(payload?.roomId || socket.data?.roomId || "").trim().toUpperCase();
      const participantId = String(payload?.participantId || socket.data?.participantId || "").trim();
      const ready = Boolean(payload?.ready);
      if (!roomId || !participantId) return;
      const room = await getRoomOr404(roomId);
      if (!room) return;
      const me = getParticipant(room, participantId);
      if (!me) return;
      me.ready = ready;
      me.lastSeenAt = nowIso();
      room.updatedAt = me.lastSeenAt;
      room.expiresAt = nowMs() + ROOMS_TTL_MS;
      await roomSave(room);
      emitRoomUpdate(room);
    } catch {}
  });

  socket.on("jl:start", async (payload = {}) => {
    try {
      const roomId = String(payload?.roomId || socket.data?.roomId || "").trim().toUpperCase();
      const participantId = String(payload?.participantId || socket.data?.participantId || "").trim();
      if (!roomId || !participantId) return;
      const room = await getRoomOr404(roomId);
      if (!room) return;
      const me = getParticipant(room, participantId);
      if (!me || !me.isHost) {
        socket.emit("jl:toast", { level: "error", message: "Seul le créateur peut démarrer.", ts: nowIso() });
        return;
      }

      const players = Array.isArray(room.players) ? room.players : [];
      const readyCount = players.filter((x) => x?.ready).length;
      // host must be ready too
            // Démarrage : au moins 2 joueurs, et (option) tout le monde prêt
      if (players.length < 2) {
        socket.emit("jl:toast", { level: "warning", message: "Attends au moins 1 autre participant.", ts: nowIso() });
        return;
      }
      const everyoneReady = players.every((x) => x?.ready === true);
      if (!everyoneReady) {
        socket.emit("jl:toast", { level: "warning", message: "Tous les participants ne sont pas prêts.", ts: nowIso() });
        return;
      }

      room.meta = room.meta || {};
      room.meta.started = true;
      room.meta.startedAt = nowIso();
      room.version = Number(room.version || 0) + 1;
      room.updatedAt = room.meta.startedAt;
      room.expiresAt = nowMs() + ROOMS_TTL_MS;
      await roomSave(room);

      emitRoomToast(roomId, "Audience démarrée par le créateur.", "success");
      emitRoomUpdate(room);    } catch {}
  });

  socket.on("jl:action", async (payload = {}) => {
    try {
      const roomId = String(payload?.roomId || socket.data?.roomId || "").trim().toUpperCase();
      const participantId = String(payload?.participantId || socket.data?.participantId || "").trim();
      const action = payload?.action || {};
      if (!roomId || !participantId) return;
      const room = await getRoomOr404(roomId);
      if (!room) return;
      const me = getParticipant(room, participantId);
      if (!me) return;

      // Hard rule: each user can only act for their own role
      action.payload = action.payload || {};
      if (action.payload.role && String(action.payload.role) !== String(me.role)) {
        socket.emit("jl:toast", { level: "error", message: "Action refusée: rôle non autorisé.", ts: nowIso() });
        return;
      }
      action.payload.role = me.role;

      // Reuse REST logic by calling the same code path (minimal):
      const type = String(action?.type || "").trim().toUpperCase();
      const t = nowIso();
      me.lastSeenAt = t;
      room.updatedAt = t;
      room.expiresAt = nowMs() + ROOMS_TTL_MS;

      if (!type || type === "PING") {
        await roomSave(room);
        emitRoomUpdate(room);
        return;
      }

      if (type === "SNAPSHOT" || type === "SYNC_SNAPSHOT") {
        if (!me.isHost) {
          socket.emit("jl:toast", { level: "error", message: "Seul l'hôte peut synchroniser l'état.", ts: nowIso() });
          return;
        }
        room.snapshot = action.payload?.snapshot || null;
        room.version = Number(room.version || 0) + 1;
        await roomSave(room);
        emitRoomUpdate(room);
        return;
      }

      if (type === "CHAT" || type === "UTTERANCE") {
        room.timeline = Array.isArray(room.timeline) ? room.timeline : [];
        const msg = {
          id: `m_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`,
          ts: t,
          by: me.displayName,
          role: me.role,
          text: String(action.payload?.text || "").slice(0, 1200),
        };
        room.timeline.unshift(msg);
        room.timeline = room.timeline.slice(0, 120);
        room.version = Number(room.version || 0) + 1;
        await roomSave(room);
        emitRoomUpdate(room);
        return;
      }

      // suggestions/decisions handled by existing arrays
      if (type === "SUGGESTION") {
        room.suggestions = Array.isArray(room.suggestions) ? room.suggestions : [];
        room.suggestions.unshift({ ...action.payload, ts: t, by: me.displayName, role: me.role });
        room.suggestions = room.suggestions.slice(0, 80);
        room.version = Number(room.version || 0) + 1;
        await roomSave(room);
        emitRoomUpdate(room);
        return;
      }

      if (type === "JUDGE_DECISION") {
        if (me.role !== "Juge") {
          socket.emit("jl:toast", { level: "error", message: "Seul le juge peut trancher.", ts: nowIso() });
          return;
        }
        room.decisions = Array.isArray(room.decisions) ? room.decisions : [];
        room.decisions.unshift({ ...action.payload, ts: t, by: me.displayName, role: me.role });
        room.decisions = room.decisions.slice(0, 80);
        room.version = Number(room.version || 0) + 1;
        await roomSave(room);
        emitRoomUpdate(room);
        return;
      }
    } catch (e) {
      socket.emit("jl:toast", { level: "error", message: "Erreur action realtime.", ts: nowIso() });
    }
  });


  socket.on("disconnect", async () => {
    try {
      const roomId = String(socket.data?.roomId || "").trim().toUpperCase();
      const participantId = String(socket.data?.participantId || "").trim();
      if (!roomId || !participantId) return;
      const room = await getRoomOr404(roomId);
      if (!room) return;
      const me = getParticipant(room, participantId);
      if (me) {
        me.lastSeenAt = nowIso();
        me.connected = false;
      }
      room.updatedAt = nowIso();
      room.expiresAt = nowMs() + ROOMS_TTL_MS;
      await roomSave(room);
      emitRoomUpdate(room);
    } catch {}
  });
});
/* =======================
   START SERVER
======================= */
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🚀 DroitGPT API + Socket.IO démarrée sur le port ${port}`);
});
