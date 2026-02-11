import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';

import generatePdfRoute from './generatePdf.js';
import generateBusinessPlanRoute from './routes/generateBusinessPlan.js';
import generateLicenceMemoireRoute from './routes/generateLicenceMemoire.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

/**
 * ✅ CORS (stable + dev + prod)
 * - Fixes: "No 'Access-Control-Allow-Origin' header" from localhost ports (5173/5174/etc)
 * - Keeps Business Plan routes intact
 */
const allowedOriginPatterns = [
  // Local dev (Vite ports can change)
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
  /^http:\/\/0\.0\.0\.0(:\d+)?$/i,
  // Optional LAN dev (if you test from another device on same network)
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i,

  // Vercel (prod + preview)
  /^https:\/\/droitgpt-ui(-[a-z0-9-]+)?\.vercel\.app$/i,

  // Custom domain
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // IMPORTANT: do NOT hardcode allowedHeaders; let cors reflect Access-Control-Request-Headers
  exposedHeaders: ['Content-Disposition', 'x-sources-used'],
  maxAge: 86400,
  optionsSuccessStatus: 204,
  credentials: false,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Some browsers send extra headers in preflight; echo them back to avoid random failures
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const reqHeaders = req.headers['access-control-request-headers'];
    if (reqHeaders) res.setHeader('Access-Control-Allow-Headers', reqHeaders);
  }
  next();
});

// Body parsers
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ✅ Long-running endpoints (Mémoire + RAG)
const LONG_MS = 46 * 60 * 1000;
app.use((req, res, next) => {
  const p = req.path || '';
  if (p.startsWith('/generate-academic') || p.startsWith('/generate-memoire')) {
    req.setTimeout(LONG_MS);
    res.setTimeout(LONG_MS);
  }
  next();
});

// Routes (Business Plan stays intact)
app.use('/generate-pdf', generatePdfRoute);
app.use('/generate-business-plan', generateBusinessPlanRoute);
// Keep compatibility if frontend calls /generate-business-plan/premium
app.use('/generate-business-plan/premium', generateBusinessPlanRoute);

app.use('/generate-academic', generateLicenceMemoireRoute);
app.use('/generate-memoire', generateLicenceMemoireRoute);

app.post('/download-business-plan', (req, res) => {
  try {
    const raw = req.body?.content;
    const content = typeof raw === 'string' ? raw : '';

    if (!content.trim()) {
      return res.status(400).json({
        error: 'INVALID_CONTENT',
        details: "Le champ 'content' est requis pour telecharger le business plan.",
      });
    }

    const baseName = (
      String(req.body?.fileName || req.body?.companyName || 'business-plan')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 80) || 'business-plan'
    );

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.txt"`);
    return res.status(200).send(content);
  } catch (e) {
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      details: String(e?.message || e),
    });
  }
});

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    message: 'Service operationnel.',
    endpoints: [
      '/generate-business-plan',
      '/generate-business-plan/premium',
      '/generate-memoire',
      '/generate-academic/licence-memoire',
      '/generate-academic/licence-memoire/revise',
      '/download-business-plan',
    ],
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    method: req.method,
    path: req.originalUrl,
  });
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);

  if (res.headersSent) return;

  if (String(err?.message || '').startsWith('CORS blocked for origin:')) {
    return res.status(403).json({
      error: 'CORS_BLOCKED',
      details: err.message,
    });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'INVALID_JSON',
      details: 'Corps JSON invalide.',
    });
  }

  return res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    details: String(err?.message || err),
    path: req.originalUrl,
  });
});

const PORT = process.env.PORT || 5001;

// ✅ IMPORTANT (Render/Node 22): server-level timeouts
const server = http.createServer(app);
server.requestTimeout = LONG_MS;
server.headersTimeout = LONG_MS + 5000;
server.keepAliveTimeout = 70 * 1000;

server.listen(PORT, () => {
  console.log(`Service en ligne sur http://localhost:${PORT}`);
});
