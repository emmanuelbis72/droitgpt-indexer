import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";

import generatePdfRoute from "./generatePdf.js";
import generateBusinessPlanRoute from "./routes/generateBusinessPlan.js";
import generateLicenceMemoireRoute from "./routes/generateLicenceMemoire.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

/**
 * ✅ CORS (fix stable)
 * - Reflect l'Origin automatiquement (origin: true)
 * - Supporte OPTIONS preflight partout
 * - Évite les erreurs "No 'Access-Control-Allow-Origin' header"
 */
const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposedHeaders: ["Content-Disposition", "x-sources-used", "X-BP-Mode"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
  credentials: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Certains navigateurs ajoutent des headers en preflight. On les reflète pour éviter des blocages.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const reqHeaders = req.headers["access-control-request-headers"];
    if (reqHeaders) res.setHeader("Access-Control-Allow-Headers", reqHeaders);
  }
  next();
});

// Body parsers
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

/* -------------------------
   JOB STORE (in-memory)
   - utilisé par ?async=1 dans /generate-business-plan/premium
------------------------- */
app.locals.jobs = new Map();

const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 2 * 60 * 60 * 1000); // 2h
const JOB_MAX = Number(process.env.JOB_MAX || 200);

function pruneJobs() {
  try {
    const now = Date.now();
    for (const [id, j] of app.locals.jobs.entries()) {
      const age = now - Number(j?.createdAt || now);
      if (age > JOB_TTL_MS) app.locals.jobs.delete(id);
    }

    // Limite soft: supprime les plus anciens si trop de jobs
    if (app.locals.jobs.size > JOB_MAX) {
      const ids = Array.from(app.locals.jobs.keys());
      for (let i = 0; i < ids.length - JOB_MAX; i++) app.locals.jobs.delete(ids[i]);
    }
  } catch {
    // ignore
  }
}
setInterval(pruneJobs, 60_000).unref();

/* -------------------------
   JOB endpoints
------------------------- */
app.get("/jobs/:id/status", (req, res) => {
  const id = String(req.params.id || "");
  const j = app.locals.jobs.get(id);
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });

  return res.json({
    id,
    status: j.status, // queued | running | done | failed
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    filename: j.filename || "",
    error: j.error || "",
  });
});

app.get("/jobs/:id/download", (req, res) => {
  const id = String(req.params.id || "");
  const j = app.locals.jobs.get(id);
  if (!j) return res.status(404).json({ error: "JOB_NOT_FOUND" });

  if (j.status !== "done" || !j.buffer) {
    return res.status(409).json({
      error: "JOB_NOT_READY",
      status: j.status,
      details: j.error || "Le document n'est pas encore prêt.",
    });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${j.filename || "business_plan.pdf"}"`
  );
  return res.status(200).send(j.buffer);
});

/* -------------------------
   Timeouts long-running
------------------------- */
const LONG_MS = 46 * 60 * 1000;
app.use((req, res, next) => {
  const p = req.path || "";
  if (p.startsWith("/generate-academic") || p.startsWith("/generate-memoire")) {
    req.setTimeout(LONG_MS);
    res.setTimeout(LONG_MS);
  }
  next();
});

/* -------------------------
   Routes existantes
------------------------- */
app.use("/generate-pdf", generatePdfRoute);
app.use("/generate-business-plan", generateBusinessPlanRoute);
// compat: certains fronts appellent directement /generate-business-plan/premium
app.use("/generate-business-plan/premium", generateBusinessPlanRoute);

app.use("/generate-academic", generateLicenceMemoireRoute);
app.use("/generate-memoire", generateLicenceMemoireRoute);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Service opérationnel.",
    endpoints: [
      "/generate-business-plan/premium",
      "/generate-business-plan/premium?async=1",
      "/jobs/:id/status",
      "/jobs/:id/download",
    ],
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    method: req.method,
    path: req.originalUrl,
  });
});

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "INVALID_JSON",
      details: "Corps JSON invalide.",
    });
  }

  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    details: String(err?.message || err),
    path: req.originalUrl,
  });
});

const PORT = process.env.PORT || 5001;

// Render/Node 22: timeouts serveur
const server = http.createServer(app);
server.requestTimeout = LONG_MS;
server.headersTimeout = LONG_MS + 5000;
server.keepAliveTimeout = 70 * 1000;

server.listen(PORT, () => {
  console.log(`Service en ligne sur http://localhost:${PORT}`);
});
