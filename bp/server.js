import express from "express";
import dotenv from "dotenv";
import generatePdfRoute from "./generatePdf.js";
import generateBusinessPlanRoute from "./routes/generateBusinessPlan.js";
import generateLicenceMemoireRoute from "./routes/generateLicenceMemoire.js";
import generateNgoProjectRoute from "./routes/generateNgoProject.js";

dotenv.config();

const app = express();

/* =========================================================
   CORS (single source of truth)
========================================================= */
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/droitgpt-ui\.vercel\.app$/i,
  /^https:\/\/www\.droitgpt\.com$/i,
];

function isAllowedOrigin(origin) {
  // Allow non-browser calls (curl, powershell, server-to-server)
  if (!origin) return true;
  return allowedOriginPatterns.some((p) => p.test(origin));
}

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    else res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 5001;

// Body parsing
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/generate-pdf", generatePdfRoute);
app.use("/generate-business-plan", generateBusinessPlanRoute);
app.use("/generate-academic", generateLicenceMemoireRoute);
app.use("/generate-memoire", generateLicenceMemoireRoute);

// ✅ NEW: NGO Premium project generation
app.use("/generate-ngo-project", generateNgoProjectRoute);

// Download helper (TXT)
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
    message: "Serveur de generation PDF operationnel.",
    endpoints: [
      "/generate-business-plan/premium",
      "/generate-business-plan/premium?async=1",
      "/generate-business-plan/premium/jobs/:id",
      "/generate-business-plan/premium/jobs/:id/result",
      "/generate-ngo-project/premium",
      "/generate-ngo-project/premium?async=1",
      "/generate-ngo-project/premium/jobs/:id",
      "/generate-ngo-project/premium/jobs/:id/result",
      "/generate-memoire",
      "/generate-academic/licence-memoire",
      "/download-business-plan",
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

// Error handler
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

app.listen(PORT, () => {
  console.log(`PDF Service en ligne sur http://localhost:${PORT}`);
});
