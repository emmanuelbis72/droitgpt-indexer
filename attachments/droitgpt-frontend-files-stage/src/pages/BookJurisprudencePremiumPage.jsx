// src/pages/BookJurisprudencePremiumPage.jsx
import React, { useMemo, useRef, useState } from "react";

const DEFAULT_API_BASE = "https://businessplan-v9yy.onrender.com";
const API_BASE = (import.meta?.env?.VITE_BP_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");

function safeFilename(s) {
  return String(s || "livre")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 90);
}

function prettyDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampText(v, max = 2500) {
  const s = String(v || "");
  if (s.length <= max) return s;
  return s.slice(0, max);
}

async function readErrorBody(res) {
  try {
    if (!res) return "NO_RESPONSE";
    const hasText = typeof res.text === "function";
    const hasJson = typeof res.json === "function";
    const headersGet =
      res.headers && typeof res.headers.get === "function" ? res.headers.get.bind(res.headers) : null;
    const ct = headersGet ? headersGet("content-type") || "" : "";

    if (ct.includes("application/json") && hasJson) {
      try {
        const j = await res.json();
        return j?.details || j?.error || j?.message || JSON.stringify(j);
      } catch {
        // fallthrough
      }
    }

    if (hasText) {
      try {
        const t = await res.text();
        return t || "";
      } catch (e) {
        return String(e?.message || e);
      }
    }

    return "NOT_A_RESPONSE";
  } catch (e) {
    return String(e?.message || e);
  }
}

export default function BookJurisprudencePremiumPage() {
  const endpoint = useMemo(() => `${API_BASE}/generate-book/jurisprudence`, []);

  const [form, setForm] = useState({
    lang: "fr",
    title: "TRAITÉ ANALYTIQUE DE JURISPRUDENCE CONGOLAISE",
    subtitle: "Ouvrage doctrinal automatisé — magistrats, avocats, universitaires",
    publisher: "DroitGPT",
    year: new Date().getFullYear(),
    edition: "Édition professionnelle",
    lite: false,
  });

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [successHint, setSuccessHint] = useState("");
  const [progress, setProgress] = useState(0);

  const abortRef = useRef(null);
  const progressTimerRef = useRef(null);
  const lastDownloadUrlRef = useRef(null);
  const [lastFile, setLastFile] = useState(null);

  function startFakeProgress() {
    setProgress(1);
    setStatusText("Préparation…");
    const start = Date.now();
    const DURATION_MS = 200 * 60 * 1000; //  200minutes

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const t = Date.now() - start;
      const p = Math.min(96, Math.floor((t / DURATION_MS) * 100));
      setProgress((prev) => (p > prev ? p : prev));
    }, 800);
  }

  function stopFakeProgress(finalText) {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
    setProgress(100);
    setStatusText(finalText || "Terminé ✅");
  }

  function setPersistentDownload(blob, suggestedName) {
    const url = window.URL.createObjectURL(blob);
    if (lastDownloadUrlRef.current) URL.revokeObjectURL(lastDownloadUrlRef.current);
    lastDownloadUrlRef.current = url;
    setLastFile({ url, name: suggestedName });

    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function buildPayload() {
    return {
      lang: form.lang,
      lite: form.lite,
      ctx: {
        title: clampText(form.title, 160),
        subtitle: clampText(form.subtitle, 240),
        publisher: clampText(form.publisher, 80),
        year: Number(form.year) || new Date().getFullYear(),
        edition: clampText(form.edition, 80),
      },
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccessHint("");

    if (!String(form.title).trim()) return setError("Le titre du livre est requis.");

    setLoading(true);
    startFakeProgress();

    const controller = new AbortController();
    abortRef.current = controller;

    // 45 min timeout local (livre long)
    const timeoutId = setTimeout(() => controller.abort(), 45 * 60 * 1000);

    try {
      const payload = buildPayload();

      setStatusText("Démarrage génération (mode job)…");
      let startRes;
      try {
        startRes = await fetch(`${endpoint}?async=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (netErr) {
        throw new Error(`NETWORK_ERROR: ${String(netErr?.message || netErr)}`);
      }

      if (!startRes?.ok) {
        let details = "";
        try {
          const j = await startRes.json();
          details = j?.details || j?.error || j?.message || JSON.stringify(j);
        } catch {
          details = await readErrorBody(startRes);
        }
        throw new Error(details || `HTTP ${startRes?.status || "?"}`);
      }

      const started = await startRes.json().catch(async () => {
        const t = await readErrorBody(startRes);
        throw new Error(t || "Réponse backend invalide (start).");
      });

      const jobId = started?.jobId;
      if (!jobId) throw new Error("JOB_ID manquant (backend ?async=1 non actif).");

      const statusUrl = `${API_BASE}/generate-book/jurisprudence/jobs/${encodeURIComponent(jobId)}`;
      const resultUrl = `${API_BASE}/generate-book/jurisprudence/jobs/${encodeURIComponent(jobId)}/result`;

      setStatusText("Génération en cours… (chapitres + annexes)");

      while (true) {
        let stRes;
        try {
          stRes = await fetch(statusUrl, { signal: controller.signal });
        } catch (netErr) {
          throw new Error(`NETWORK_ERROR: ${String(netErr?.message || netErr)}`);
        }

        if (!stRes?.ok) {
          const t = await readErrorBody(stRes);
          throw new Error(t || `HTTP ${stRes?.status || "?"}`);
        }

        const st = await stRes.json().catch(async () => {
          const t = await readErrorBody(stRes);
          throw new Error(t || "Réponse backend invalide (status).");
        });

        if (st.status === "error") throw new Error(st.error || "Erreur job inconnue.");
        if (st.status === "rejected") throw new Error(st.error || "Job rejeté.");
        if (st.status === "done") break;

        await new Promise((r) => setTimeout(r, 5000));
      }

      setStatusText("Assemblage et téléchargement PDF…");
      let pdfRes;
      try {
        pdfRes = await fetch(resultUrl, { signal: controller.signal });
      } catch (netErr) {
        throw new Error(`NETWORK_ERROR: ${String(netErr?.message || netErr)}`);
      }

      if (!pdfRes?.ok) {
        let details = "";
        try {
          const j = await pdfRes.json();
          details = j?.details || j?.error || j?.message || JSON.stringify(j);
        } catch {
          details = await readErrorBody(pdfRes);
        }
        throw new Error(details || `HTTP ${pdfRes?.status || "?"}`);
      }

      const blob = await pdfRes.blob();
      const fname = `${safeFilename(form.publisher)}_Livre_Jurisprudence_RDC_${prettyDate()}.pdf`;
      setPersistentDownload(blob, fname);

      stopFakeProgress("Téléchargement prêt ✅");
      setSuccessHint("Le livre a été généré et téléchargé.");
    } catch (err) {
      const msg =
        err?.name === "AbortError"
          ? "Opération interrompue (timeout local). Réessaie."
          : String(err?.message || err);
      setError(msg);
      setStatusText("Erreur.");
      setProgress(0);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      abortRef.current = null;
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function onCancel() {
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="text-lg font-semibold">📘 Livre — Jurisprudence RDC (Édition pro)</div>
          <div className="text-sm text-slate-600">
            Génération automatique d’un traité doctrinal basé sur ton corpus RAG (Qdrant). Les métadonnées manquantes
            sont affichées comme <strong>INCOMPLET</strong> (jamais inventées).
          </div>
          <div className="text-xs text-slate-500">API: {API_BASE}</div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Langue">
            <select
              value={form.lang}
              onChange={(e) => setForm((f) => ({ ...f, lang: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              disabled={loading}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </Field>

          <Field label="Année">
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              min={1990}
              max={2100}
              disabled={loading}
            />
          </Field>

          <div className="md:col-span-2">
            <TextArea
              label="Titre du livre *"
              value={form.title}
              onChange={(v) => setForm((f) => ({ ...f, title: v }))}
              disabled={loading}
              placeholder="Ex: TRAITÉ ANALYTIQUE DE JURISPRUDENCE CONGOLAISE"
              rows={2}
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Sous-titre"
              value={form.subtitle}
              onChange={(v) => setForm((f) => ({ ...f, subtitle: v }))}
              disabled={loading}
              placeholder="Ex: Ouvrage doctrinal automatisé — magistrats, avocats, universitaires"
              rows={2}
            />
          </div>

          <Field label="Éditeur">
            <input
              value={form.publisher}
              onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              disabled={loading}
            />
          </Field>

          <Field label="Édition">
            <input
              value={form.edition}
              onChange={(e) => setForm((f) => ({ ...f, edition: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              disabled={loading}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.lite}
              onChange={(e) => setForm((f) => ({ ...f, lite: e.target.checked }))}
              disabled={loading}
            />
            Mode rapide (Lite)
          </label>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Générer & Télécharger (PDF)
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={!loading}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Annuler
            </button>
          </div>
        </div>

        {(loading || progress > 0) && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{statusText || "Génération…"}</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Astuce : si la génération dépasse 15 min, la barre reste à 96% jusqu’à la fin.
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {successHint && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {successHint}
          </div>
        )}

        {lastFile?.url && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-semibold">Dernier PDF généré</div>
            <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="truncate">{lastFile.name}</div>
              <a
                href={lastFile.url}
                download={lastFile.name}
                className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-100"
              >
                Re-télécharger
              </a>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-slate-600">{label}</div>
      {children}
    </label>
  );
}

function TextArea({ label, value, onChange, disabled, placeholder, rows = 4 }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-slate-600">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}
