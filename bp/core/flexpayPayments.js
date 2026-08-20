// bp/core/flexpayPayments.js
import crypto from "node:crypto";
import { getJob, nowMs, patchJob, putJob } from "./jobStore.js";

const PAYMENT_NAMESPACE = "payments";
const DEFAULT_PAYMENT_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const QDRANT_PAYMENT_COLLECTION = process.env.QDRANT_PAYMENTS_COLLECTION || "droitgpt_payments";
const QDRANT_VECTOR_SIZE = 4;

const DOCUMENTS = {
  businessplan: {
    label: "Plan d'affaires Premium",
    envBase: "PAYMENT_PRICE_BUSINESSPLAN",
    prefix: "BP",
  },
  memoire: {
    label: "Memoire de licence",
    envBase: "PAYMENT_PRICE_MEMOIRE",
    prefix: "MEM",
  },
  ngo_project: {
    label: "Projet ONG Premium",
    envBase: "PAYMENT_PRICE_NGO_PROJECT",
    prefix: "ONG",
  },
  grants_management: {
    label: "Gestion de subventions IA",
    envBase: "PAYMENT_PRICE_GRANTS_MANAGEMENT",
    prefix: "GRANTS",
  },
  excel_app: {
    label: "Progiciel Excel IA",
    envBase: "PAYMENT_PRICE_EXCEL_APP",
    prefix: "EXCEL",
  },
};

let qdrantInitPromise = null;
let qdrantDisabled = false;

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function clean(value, max = 500) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function getPaymentTtlMs() {
  return Math.max(1000 * 60 * 15, Number(process.env.FLEXPAY_PAYMENT_TTL_MS || DEFAULT_PAYMENT_TTL_MS));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDocumentType(value) {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = {
    bp: "businessplan",
    business_plan: "businessplan",
    businessplan_rewrite: "businessplan",
    licence_memoire: "memoire",
    licence: "memoire",
    academic: "memoire",
    ngo: "ngo_project",
    ong: "ngo_project",
    project_ong: "ngo_project",
    grants: "grants_management",
    excel: "excel_app",
    excel_app: "excel_app",
    spreadsheet: "excel_app",
  };
  const normalized = aliases[raw] || raw;
  return DOCUMENTS[normalized] ? normalized : "";
}

function getCurrency() {
  const currency = clean(process.env.FLEXPAY_CURRENCY || "USD", 8).toUpperCase();
  return ["CDF", "USD"].includes(currency) ? currency : "CDF";
}

function readPrice(documentType) {
  const doc = DOCUMENTS[documentType];
  if (!doc) return null;
  const currency = getCurrency();
  const candidates = [
    `${doc.envBase}_${currency}`,
    doc.envBase,
    `PAYMENT_PRICE_${documentType.toUpperCase()}_${currency}`,
    `PAYMENT_PRICE_${documentType.toUpperCase()}`,
  ];

  for (const key of candidates) {
    const raw = process.env[key];
    if (raw == null || raw === "") continue;
    const amount = Number(String(raw).replace(/,/g, "."));
    if (Number.isFinite(amount) && amount > 0) return { amount, currency, envKey: key };
  }

  const defaultRaw =
    process.env[`PAYMENT_DEFAULT_PRICE_${currency}`] ||
    process.env.PAYMENT_DEFAULT_PRICE ||
    (currency === "USD" ? "4" : "");
  const defaultAmount = Number(String(defaultRaw).replace(/,/g, "."));
  if (Number.isFinite(defaultAmount) && defaultAmount > 0) {
    return { amount: defaultAmount, currency, envKey: "PAYMENT_DEFAULT_PRICE" };
  }

  return null;
}

function getPublicApiBase() {
  const raw =
    process.env.FLEXPAY_PUBLIC_API_BASE ||
    process.env.PUBLIC_API_BASE ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.API_BASE_URL ||
    "";
  const base = String(raw || "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(base) ? base : "";
}

function getCallbackUrl() {
  const explicit = clean(process.env.FLEXPAY_CALLBACK_URL || "", 1000);
  if (explicit) return explicit;
  const base = getPublicApiBase();
  return base ? `${base}/payments/flexpay/callback` : "";
}

function normalizeBearer(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  return value.toLowerCase().startsWith("bearer ") ? value : `Bearer ${value.replace(/^Bearer/i, "").trim()}`;
}

function getToken() {
  return normalizeBearer(process.env.FLEXPAY_TOKEN || process.env.FLEXPAIE_TOKEN || "");
}

function getMobileUrl() {
  return clean(process.env.FLEXPAY_MOBILE_URL || "https://backend.flexpay.cd/api/rest/v1/paymentService", 1000);
}

function getCheckBaseUrl() {
  return clean(process.env.FLEXPAY_CHECK_URL || "https://apicheck.flexpaie.com/api/rest/v1/check", 1000);
}

function buildCheckUrl(orderNumber) {
  const base = getCheckBaseUrl();
  const encoded = encodeURIComponent(orderNumber);
  if (base.includes("ORDER_NUMBER_A_REMPLACER")) return base.replace("ORDER_NUMBER_A_REMPLACER", encoded);
  if (/\/check\/[^/]+$/i.test(base)) return base.replace(/\/check\/[^/]+$/i, `/check/${encoded}`);
  return `${base.replace(/\/$/, "")}/${encoded}`;
}

function getMerchant() {
  return clean(process.env.FLEXPAY_MERCHANT || process.env.FLEXPAIE_MERCHANT || "", 80);
}

function isFlexPayEnabled() {
  return envBool("FLEXPAY_ENABLED", true);
}

export function isPaymentRequired() {
  return envBool("FLEXPAY_PAYMENT_REQUIRED", false);
}

export function getPaymentConfig() {
  const token = getToken();
  const merchant = getMerchant();
  const callbackUrl = getCallbackUrl();
  const enabled = isFlexPayEnabled();
  const configured = Boolean(enabled && token && merchant && getMobileUrl() && getCheckBaseUrl() && callbackUrl);
  const currency = getCurrency();

  const documents = Object.entries(DOCUMENTS).reduce((acc, [key, doc]) => {
    const price = readPrice(key);
    acc[key] = {
      label: doc.label,
      amount: price?.amount || null,
      currency,
      configured: Boolean(price?.amount),
    };
    return acc;
  }, {});

  return {
    ok: true,
    provider: "flexpay",
    enabled,
    configured,
    requiresPayment: isPaymentRequired(),
    currency,
    methods: { mobileMoney: true, card: false },
    documents,
    missing: {
      token: !token,
      merchant: !merchant,
      callbackUrl: !callbackUrl,
      mobileUrl: !getMobileUrl(),
      checkUrl: !getCheckBaseUrl(),
    },
  };
}

function assertFlexPayReady() {
  const config = getPaymentConfig();
  if (!config.enabled) throw Object.assign(new Error("FLEXPAY_DISABLED"), { statusCode: 503 });
  if (!config.configured) throw Object.assign(new Error("FLEXPAY_NOT_CONFIGURED"), { statusCode: 503, config });
}

function normalizePhone(phone) {
  let value = String(phone || "").trim().replace(/[\s().-]/g, "");
  if (value.startsWith("+")) value = value.slice(1);
  value = value.replace(/\D/g, "");
  if (value.startsWith("0") && value.length === 10) value = `243${value.slice(1)}`;
  if (!value.startsWith("243") && value.length === 9) value = `243${value}`;
  if (!/^243\d{9}$/.test(value)) {
    throw Object.assign(new Error("INVALID_PHONE"), {
      statusCode: 400,
      details: "Numero requis au format RDC: 243XXXXXXXXX ou 0XXXXXXXXX.",
    });
  }
  return value;
}

function makeReference(documentType) {
  const doc = DOCUMENTS[documentType] || DOCUMENTS.businessplan;
  const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `DGPT-${doc.prefix}-${Date.now()}-${suffix}`;
}

function inferDocumentTypeFromReference(reference) {
  const ref = String(reference || "").toUpperCase();
  if (ref.includes("-BP-")) return "businessplan";
  if (ref.includes("-MEM-")) return "memoire";
  if (ref.includes("-ONG-")) return "ngo_project";
  if (ref.includes("-GRANTS-")) return "grants_management";
  if (ref.includes("-EXCEL-")) return "excel_app";
  return "";
}

function publicPayment(record) {
  if (!record) return null;
  return {
    orderNumber: record.orderNumber || null,
    reference: record.reference || null,
    documentType: record.documentType || null,
    status: record.status || "unknown",
    amount: record.amount || null,
    currency: record.currency || null,
    provider: "flexpay",
    message: record.message || null,
    paidAt: record.paidAt || null,
    consumedAt: record.consumedAt || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

async function flexFetchJson(url, options = {}) {
  const timeoutMs = Math.max(5000, Number(process.env.FLEXPAY_TIMEOUT_MS || 20000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const err = new Error(`FLEXPAY_HTTP_${response.status}`);
      err.statusCode = 502;
      err.providerStatus = response.status;
      err.providerBody = json || text;
      throw err;
    }
    return json || { raw: text };
  } catch (error) {
    if (error?.name === "AbortError") {
      const err = new Error("FLEXPAY_TIMEOUT");
      err.statusCode = 504;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function statusFromProviderPayload(payload = {}) {
  const tx = payload?.transaction || {};
  const txStatus = String(tx.status ?? "").trim();
  const code = String(payload.code ?? "").trim();

  if (code === "0" && txStatus === "0") return "paid";
  if (txStatus === "1") return "failed";
  if (["failed", "fail", "cancelled", "canceled", "declined"].includes(String(payload.status || "").toLowerCase())) {
    return "failed";
  }
  if (code && code !== "0" && !txStatus) return "unknown";
  return "pending";
}

function statusFromCallback(payload = {}) {
  const code = String(payload.code ?? "").trim();
  if (code === "0") return "paid";
  if (code) return "failed";
  return "unknown";
}

function deterministicUuid(value) {
  const hash = crypto.createHash("sha1").update(String(value || "")).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function paymentPointId(orderNumber) {
  return deterministicUuid(`flexpay:${orderNumber}`);
}

function paymentVector(record = {}) {
  const statusScore = record.status === "paid" ? 1 : record.status === "failed" ? -1 : 0;
  const docScore = Object.keys(DOCUMENTS).indexOf(record.documentType) + 1;
  const amountScore = Math.min(1, Number(record.amount || 0) / 1000000);
  return [1, amountScore || 0, statusScore, Math.max(0, docScore) / 10];
}

function isQdrantConfigured() {
  return Boolean(process.env.QDRANT_URL) && !envBool("FLEXPAY_DISABLE_QDRANT_STORE", false) && !qdrantDisabled;
}

async function qdrantFetch(pathname, options = {}) {
  const base = String(process.env.QDRANT_URL || "").replace(/\/$/, "");
  const timeoutMs = Math.max(5000, Number(process.env.QDRANT_TIMEOUT_MS || 15000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function throwQdrantError(response, message) {
  const text = await response.text().catch(() => "");
  throw new Error(`${message}: ${response.status} ${text.slice(0, 300)}`);
}

async function ensureQdrantPaymentsCollection() {
  if (!isQdrantConfigured()) return false;
  if (!qdrantInitPromise) {
    qdrantInitPromise = (async () => {
      const name = encodeURIComponent(QDRANT_PAYMENT_COLLECTION);
      const existing = await qdrantFetch(`/collections/${name}`, { method: "GET" });
      if (existing.ok) return true;
      if (existing.status !== 404) await throwQdrantError(existing, "Qdrant payment collection check failed");
      const created = await qdrantFetch(`/collections/${name}`, {
        method: "PUT",
        body: JSON.stringify({ vectors: { size: QDRANT_VECTOR_SIZE, distance: "Cosine" } }),
      });
      if (!created.ok) await throwQdrantError(created, "Qdrant payment collection create failed");
      return true;
    })().catch((error) => {
      qdrantDisabled = true;
      console.warn("[PAYMENTS] Qdrant store disabled, falling back to jobStore:", String(error?.message || error));
      return false;
    });
  }
  return qdrantInitPromise;
}

async function qdrantGetPayment(orderNumber) {
  if (!orderNumber || !(await ensureQdrantPaymentsCollection())) return null;
  const response = await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_PAYMENT_COLLECTION)}/points`, {
    method: "POST",
    body: JSON.stringify({ ids: [paymentPointId(orderNumber)], with_payload: true, with_vector: false }),
  });
  if (!response.ok) await throwQdrantError(response, "Qdrant payment retrieve failed");
  const json = await response.json();
  return json?.result?.[0]?.payload?.record || null;
}

async function qdrantSavePayment(record) {
  if (!record?.orderNumber || !(await ensureQdrantPaymentsCollection())) return false;
  const response = await qdrantFetch(`/collections/${encodeURIComponent(QDRANT_PAYMENT_COLLECTION)}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: [
        {
          id: paymentPointId(record.orderNumber),
          vector: paymentVector(record),
          payload: { recordKind: "payment", orderNumber: record.orderNumber, reference: record.reference, record },
        },
      ],
    }),
  });
  if (!response.ok) await throwQdrantError(response, "Qdrant payment upsert failed");
  return true;
}

async function getStoredPayment(orderNumber) {
  const id = clean(orderNumber, 120);
  if (!id) return null;

  if (isQdrantConfigured()) {
    try {
      const q = await qdrantGetPayment(id);
      if (q) return q;
    } catch (error) {
      qdrantDisabled = true;
      console.warn("[PAYMENTS] Qdrant read failed, falling back to jobStore:", String(error?.message || error));
    }
  }

  return getJob(id, { namespace: PAYMENT_NAMESPACE });
}

async function savePayment(record) {
  const next = { ...record, updatedAt: nowIso() };
  if (isQdrantConfigured()) {
    try {
      const saved = await qdrantSavePayment(next);
      if (saved) return next;
    } catch (error) {
      qdrantDisabled = true;
      console.warn("[PAYMENTS] Qdrant write failed, falling back to jobStore:", String(error?.message || error));
    }
  }

  await putJob({ id: next.orderNumber, ...next }, { ttlMs: getPaymentTtlMs(), namespace: PAYMENT_NAMESPACE });
  return next;
}

async function patchStoredPayment(orderNumber, patch = {}) {
  const current = (await getStoredPayment(orderNumber)) || { orderNumber, createdAt: nowIso() };
  const next = { ...current, ...patch, orderNumber, updatedAt: nowIso() };
  return savePayment(next);
}

export async function initiateMobileMoneyPayment(input = {}) {
  assertFlexPayReady();

  const documentType = normalizeDocumentType(input.documentType);
  if (!documentType) {
    throw Object.assign(new Error("INVALID_DOCUMENT_TYPE"), { statusCode: 400 });
  }

  const price = readPrice(documentType);
  if (!price) {
    throw Object.assign(new Error("PRICE_NOT_CONFIGURED"), {
      statusCode: 503,
      details: `Configure ${DOCUMENTS[documentType].envBase}_${getCurrency()} sur Render.`,
    });
  }

  const phone = normalizePhone(input.phone);
  const reference = makeReference(documentType);
  const callbackUrl = getCallbackUrl();
  const payload = {
    merchant: getMerchant(),
    type: 1,
    reference,
    phone,
    amount: price.amount,
    currency: price.currency,
    callbackUrl,
  };

  console.log("[PAYMENTS] mobile money init", { documentType, reference, amount: price.amount, currency: price.currency });

  const provider = await flexFetchJson(getMobileUrl(), {
    method: "POST",
    headers: {
      Authorization: getToken(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (String(provider?.code ?? "") !== "0") {
    const message = clean(provider?.message || "Paiement refuse par FlexPay.", 500);
    throw Object.assign(new Error("FLEXPAY_INIT_FAILED"), { statusCode: 502, details: message, provider });
  }

  const orderNumber = clean(provider?.orderNumber || provider?.order_number || "", 120);
  if (!orderNumber) {
    throw Object.assign(new Error("FLEXPAY_ORDER_NUMBER_MISSING"), { statusCode: 502, provider });
  }

  const now = nowIso();
  const record = await savePayment({
    orderNumber,
    reference,
    documentType,
    phone,
    amount: price.amount,
    currency: price.currency,
    provider: "flexpay",
    status: "pending",
    message: clean(provider?.message || "Transaction envoyee.", 500),
    createdAt: now,
    updatedAt: now,
    rawInit: provider,
  });

  return publicPayment(record);
}

export async function refreshPaymentStatus(orderNumber) {
  assertFlexPayReady();
  const id = clean(orderNumber, 120);
  if (!id) throw Object.assign(new Error("ORDER_NUMBER_REQUIRED"), { statusCode: 400 });

  const current = await getStoredPayment(id);
  const provider = await flexFetchJson(buildCheckUrl(id), {
    method: "GET",
    headers: {
      Authorization: getToken(),
      Accept: "application/json",
    },
  });

  const tx = provider?.transaction || {};
  const reference = clean(tx.reference || provider.reference || current?.reference || "", 160);
  const documentType = current?.documentType || inferDocumentTypeFromReference(reference);
  const nextStatus = statusFromProviderPayload(provider);
  const paidAt = nextStatus === "paid" ? current?.paidAt || nowIso() : current?.paidAt || null;
  const failedAt = nextStatus === "failed" ? current?.failedAt || nowIso() : current?.failedAt || null;

  const record = await patchStoredPayment(id, {
    reference,
    documentType: documentType || current?.documentType || "unknown",
    status: nextStatus,
    amount: Number(tx.amount || current?.amount || 0) || current?.amount || null,
    currency: clean(tx.currency || current?.currency || getCurrency(), 8),
    provider: "flexpay",
    message: clean(provider?.message || current?.message || "", 500),
    rawCheck: provider,
    lastCheckedAt: nowIso(),
    paidAt,
    failedAt,
  });

  return publicPayment(record);
}

export async function getPaymentStatus(orderNumber) {
  const id = clean(orderNumber, 120);
  if (!id) throw Object.assign(new Error("ORDER_NUMBER_REQUIRED"), { statusCode: 400 });

  let record = await getStoredPayment(id);
  if (!record && getPaymentConfig().configured) {
    try {
      return refreshPaymentStatus(id);
    } catch {
      return null;
    }
  }

  if (record?.status === "pending" && getPaymentConfig().configured) {
    try {
      return refreshPaymentStatus(id);
    } catch (error) {
      console.warn("[PAYMENTS] status refresh failed:", String(error?.message || error));
    }
    record = await getStoredPayment(id);
  }

  return publicPayment(record);
}

export async function handleFlexPayCallback(payload = {}) {
  const orderNumber = clean(payload.orderNumber || payload.order_number || payload.order || "", 120);
  if (!orderNumber) throw Object.assign(new Error("ORDER_NUMBER_REQUIRED"), { statusCode: 400 });

  console.log("[PAYMENTS] callback received", { orderNumber, code: payload.code });

  await patchStoredPayment(orderNumber, {
    rawCallback: payload,
    callbackAt: nowIso(),
    callbackStatus: statusFromCallback(payload),
  });

  try {
    return refreshPaymentStatus(orderNumber);
  } catch (error) {
    console.warn("[PAYMENTS] callback verification failed:", String(error?.message || error));
    const current = await getStoredPayment(orderNumber);
    return publicPayment(current);
  }
}

function orderNumberFromRequest(req) {
  return clean(
    req?.headers?.["x-payment-order"] ||
      req?.headers?.["x-flexpay-order"] ||
      req?.body?.paymentOrderNumber ||
      req?.body?.payment?.orderNumber ||
      "",
    120
  );
}

export async function verifyPaidPaymentForRequest(req, documentType) {
  const normalizedType = normalizeDocumentType(documentType);
  if (!isPaymentRequired()) return { ok: true, required: false, orderNumber: null, payment: null };

  const config = getPaymentConfig();
  if (!config.configured) {
    return {
      ok: false,
      statusCode: 503,
      body: {
        ok: false,
        error: "PAYMENT_SYSTEM_NOT_CONFIGURED",
        details: "Le paiement est requis mais FlexPay n'est pas completement configure cote serveur.",
        missing: config.missing,
      },
    };
  }

  const orderNumber = orderNumberFromRequest(req);
  if (!orderNumber) {
    return {
      ok: false,
      statusCode: 402,
      body: {
        ok: false,
        error: "PAYMENT_REQUIRED",
        details: "Paiement Mobile Money requis avant la generation.",
        documentType: normalizedType,
      },
    };
  }

  let payment = await getPaymentStatus(orderNumber);
  if (!payment) {
    return {
      ok: false,
      statusCode: 402,
      body: { ok: false, error: "PAYMENT_NOT_FOUND", details: "Transaction introuvable ou non verifiable.", orderNumber },
    };
  }

  const paymentType = normalizeDocumentType(payment.documentType);
  if (!paymentType) {
    return {
      ok: false,
      statusCode: 402,
      body: {
        ok: false,
        error: "PAYMENT_DOCUMENT_UNKNOWN",
        details: "La transaction est verifiee mais le type de document paye est introuvable.",
        orderNumber,
      },
    };
  }

  if (paymentType && normalizedType && paymentType !== normalizedType) {
    return {
      ok: false,
      statusCode: 402,
      body: {
        ok: false,
        error: "PAYMENT_DOCUMENT_MISMATCH",
        details: "Cette transaction ne correspond pas au document demande.",
        orderNumber,
        expected: normalizedType,
        actual: paymentType,
      },
    };
  }

  if (payment.consumedAt) {
    return {
      ok: false,
      statusCode: 402,
      body: { ok: false, error: "PAYMENT_ALREADY_USED", details: "Cette transaction a deja ete utilisee.", orderNumber },
    };
  }

  if (payment.status !== "paid") {
    return {
      ok: false,
      statusCode: 402,
      body: {
        ok: false,
        error: "PAYMENT_NOT_CONFIRMED",
        details: "Paiement non encore confirme par FlexPay.",
        orderNumber,
        status: payment.status,
      },
    };
  }

  return { ok: true, required: true, orderNumber, payment };
}

export async function consumePaymentForGeneration(orderNumber, { documentType, jobId } = {}) {
  if (!orderNumber || !isPaymentRequired()) return null;
  const current = await getStoredPayment(orderNumber);
  if (!current) return null;
  const now = nowIso();
  const next = await patchStoredPayment(orderNumber, {
    status: current.status,
    consumedAt: current.consumedAt || now,
    consumedByJobId: current.consumedByJobId || clean(jobId, 120),
    consumedForDocumentType: normalizeDocumentType(documentType) || current.documentType,
  });
  return publicPayment(next);
}

export function paymentErrorResponse(error) {
  return {
    statusCode: Number(error?.statusCode || 500),
    body: {
      ok: false,
      error: String(error?.message || error || "PAYMENT_ERROR"),
      details: error?.details || undefined,
    },
  };
}
