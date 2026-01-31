// server.js — Business Plan + Mémoire service (Render)
// Notes:
// - Fixes 404 "Cannot POST /generate-academic/licence-memoire" by ensuring the correct router file is mounted
//   even if the repo layout uses /bp/routes or /routes.
// - Adds robust CORS (dev localhost any port + production domains) with OPTIONS preflight support.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ===== CORS (robuste) =====
const allowedOriginPatterns = [
  /^http:\/\/localhost:\d+$/i,
  /^http:\/\/127\.0\.0\.1:\d+$/i,
  /^https:\/\/droitgpt-ui\.vercel\.app$/i,
  /^https:\/\/www\.droitgpt\.com$/i,
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/postman
  return allowedOriginPatterns.some((p) => p.test(origin));
}

app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
    maxAge: 86400,
  })
);

// Preflight global (double-safety)
app.options("*", cors());

app.use(express.json({ limit: "20mb" }));

// ===== Route loader (supports multiple repo layouts) =====
async function loadRouter(possiblePaths) {
  let lastErr = null;
  for (const p of possiblePaths) {
    try {
      const mod = await import(p);
      return mod.default || mod;
    } catch (e) {
      lastErr = e;
    }
  }
  const hint = possiblePaths.join(" OR ");
  throw new Error(`Cannot load router module. Tried: ${hint}. Last error: ${String(lastErr?.message || lastErr)}`);
}

// Load routers (top-level await supported in Node 22)
const generatePdfRoute = await loadRouter([
  "./generatePdf.js",
  "./bp/generatePdf.js",
  "./pdf-service/generatePdf.js",
]);

const generateLicenceMemoireRoute = await loadRouter([
  "./bp/routes/generateLicenceMemoire.js",
  "./routes/generateLicenceMemoire.js",
  "./bp/routes/generateLicenceMemoireRoute.js",
]);

// Mount routes
app.use("/generate-pdf", generatePdfRoute);
app.use("/generate-academic", generateLicenceMemoireRoute);

// Simple health routes
app.get("/", (_req, res) => {
  res.send("✅ businessplan-v9yy backend OK");
});

// Debug: confirms which server is running
app.get("/__whoami", (_req, res) => {
  res.json({ ok: true, service: "businessplan-v9yy", time: new Date().toISOString(), pid: process.pid });
});

// Helpful: list endpoints (minimal)
app.get("/__routes", (_req, res) => {
  res.json({
    ok: true,
    routes: [
      "POST /generate-academic/licence-memoire",
      "GET  /generate-academic/licence-memoire",
      "POST /generate-pdf",
    ],
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Server listening on :${PORT}`));
