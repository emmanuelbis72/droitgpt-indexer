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

// ✅ CORS unique (plus de middleware manuel + app.use(cors()) en double)
const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
  exposedHeaders: ["Content-Disposition", "x-sources-used"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
  credentials: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 5001;

// Routes
app.use("/generate-pdf", generatePdfRoute);

// ✅ FIX : tolérance totale pour /premium (ne casse rien)
app.use("/generate-business-plan", generateBusinessPlanRoute);
app.use("/generate-business-plan/premium", generateBusinessPlanRoute);

app.use("/generate-academic", generateLicenceMemoireRoute);
app.use("/generate-memoire", generateLicenceMemoireRoute);

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

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Serveur de generation PDF operationnel.",
    endpoints: [
      "/generate-business-plan",
      "/generate-business-plan/premium",
      "/generate-memoire",
      "/generate-academic/licence-memoire",
      "/download-business-plan",
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

// ✅ Serveur HTTP avec timeouts longs (utile plans + mémoire)
const server = http.createServer(app);
const LONG_MS = 46 * 60 * 1000;
server.requestTimeout = LONG_MS;
server.headersTimeout = LONG_MS + 5000;
server.keepAliveTimeout = 70 * 1000;

server.listen(PORT, () => {
  console.log(`PDF Service en ligne sur http://localhost:${PORT}`);
});
