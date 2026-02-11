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

// -----------------------------
// ✅ CORS stable (localhost + prod)
// -----------------------------
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/droitgpt-ui\.vercel\.app$/i,
  /^https:\/\/www\.droitgpt\.com$/i,
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl / server-to-server
  return allowedOriginPatterns.some((p) => p.test(origin));
}

const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  // ✅ RAG: on expose aussi x-sources-used
  exposedHeaders: ["Content-Disposition", "x-sources-used"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
  credentials: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// -----------------------------
// ✅ Body parsers
// -----------------------------
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// -----------------------------
// ✅ Long-request middleware (Mémoire + RAG)
// (Ne change pas la route, juste les timeouts req/res)
// -----------------------------
const LONG_MS = 46 * 60 * 1000;

app.use((req, res, next) => {
  // On applique seulement aux endpoints longs
  const p = req.path || "";
  const isAcademic =
    p.startsWith("/generate-academic") || p.startsWith("/generate-memoire");

  if (isAcademic) {
    req.setTimeout(LONG_MS);
    res.setTimeout(LONG_MS);
  }
  next();
});

// -----------------------------
// Routes
// -----------------------------
app.use("/generate-pdf", generatePdfRoute);

// Business plan (inchangé)
app.use("/generate-business-plan", generateBusinessPlanRoute);
// (si ton front appelle /generate-business-plan/premium)
app.use("/generate-business-plan/premium", generateBusinessPlanRoute);

// Académique / Mémoire (avec RAG)
app.use("/generate-academic", generateLicenceMemoireRoute);
app.use("/generate-memoire", generateLicenceMemoireRoute);

// Download TXT BP
app.post("/download-business-plan", (req, res) => {
  try {
    const raw = req.body?.content;
    const content = typeof raw === "string" ? raw : "";

    if (!content.trim()) {
      return res.status(400).json({
        error: "INVALID_CONTENT",
        details: "Le champ 'content' est requis pour telecharger le business plan.",
      });
    }

    const baseName = (
      String(req.body?.fileName || req.body?.companyName || "business-plan")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 80) || "business-plan"
    );

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.txt"`);
    return res.status(200).send(content);
  } catch (e) {
    return res.status(500).json({
      error: "DOWNLOAD_FAILED",
      details: String(e?.message || e),
    });
  }
});

// Health
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Service OK (bp)",
    endpoints: [
      "/generate-business-plan/premium",
      "/generate-academic/licence-memoire",
      "/generate-academic/licence-memoire/revise",
      "/generate-memoire",
    ],
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    method: req.method,
    path: req.originalUrl,
  });
});

// Errors
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);

  if (res.headersSent) return;

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "INVALID_JSON",
      details: "Corps JSON invalide.",
    });
  }

  if (String(err?.message || "").startsWith("CORS blocked for origin:")) {
    return res.status(403).json({
      error: "CORS_BLOCKED",
      details: err.message,
    });
  }

  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    details: String(err?.message || err),
    path: req.originalUrl,
  });
});

const PORT = process.env.PORT || 5001;

// -----------------------------
// ✅ IMPORTANT: HTTP server timeouts (Node 22)
// -----------------------------
const server = http.createServer(app);

// Empêche Node de couper les requêtes longues (RAG + génération)
server.requestTimeout = LONG_MS;
server.headersTimeout = LONG_MS + 5000;

// Keep-alive proxy-friendly
server.keepAliveTimeout = 70 * 1000;

server.listen(PORT, () => {
  console.log(`Service en ligne sur http://localhost:${PORT}`);
});
