// src/pages/ScientificArticlePage.jsx
import React, { useMemo, useRef, useState } from "react";

const DEFAULT_API_BASE = "https://businessplan-v9yy.onrender.com";
const API_BASE = (import.meta?.env?.VITE_BP_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");

function safeFilename(s) {
  return String(s || "article")
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

async function readErrorBody(res) {
  try {
    if (!res) return "NO_RESPONSE";
    const ct = res.headers?.get?.("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        const j = await res.json();
        return j?.details || j?.error || j?.message || JSON.stringify(j);
      } catch {
        // fallthrough
      }
    }
    return (await res.text()) || "";
  } catch (e) {
    return String(e?.message || e);
  }
}

export default function ScientificArticlePage() {
  const endpoint = useMemo(() => `${API_BASE}/generate-article`, []);

  const [form, setForm] = useState({
    lang: "fr",
    mode: "law_rag", // law_rag | scientific
    title: "",
    topic: "Jurisprudence congolaise : tendances récentes et enjeux pratiques",
    researchQuestion: "Quels principes jurisprudentiels dominants se dégagent et comment orientent-ils la pratique ?",
    targetPages: 20,
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
    const DURATION_MS = 15 * 60 * 1000; // ✅ 15 minutes

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
      mode: form.mode,
      lite: form.lite,
      ctx: {
        title: String(form.title || "").trim(),
        topic: String(form.topic || "").trim(),
        researchQuestion: String(form.researchQuestion || "").trim(),
        targetPages: Number(form.targetPages) || 12,
        audience:
          form.mode === "law_rag" ? "magistrats, avocats, universitaires" : "professionnels et universitaires",
      },
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccessHint("");

    if (!String(form.topic).trim()) return setError("Le thème (topic) est requis.");

    setLoading(true);
    startFakeProgress();

    const controller = new AbortController();
    abortRef.current = controller;

    // 25 min timeout local (articles)
    const timeoutId = setTimeout(() => controller.abort(), 25 * 60 * 1000);

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
        const details = await readErrorBody(startRes);
        throw new Error(details || `HTTP ${startRes?.status || "?"}`);
      }

      const started = await startRes.json().catch(async () => {
        const t = await readErrorBody(startRes);
        throw new Error(t || "Réponse backend invalide (start).");
      });

      const jobId = started?.jobId;
      if (!jobId) throw new Error("JOB_ID manquant (backend ?async=1 non actif).");

      const statusUrl = `${API_BASE}/generate-article/jobs/${encodeURIComponent(jobId)}`;
      const resultUrl = `${API_BASE}/generate-article/jobs/${encodeURIComponent(jobId)}/result`;

      setStatusText(form.mode === "law_rag" ? "Récupération RAG + rédaction…" : "Rédaction scientifique…");

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
        if (st.status === "done") break;
        await new Promise((r) => setTimeout(r, 3500));
      }

      setStatusText("Assemblage et téléchargement PDF…");
      const pdfRes = await fetch(resultUrl, { signal: controller.signal });
      if (!pdfRes?.ok) {
        const details = await readErrorBody(pdfRes);
        throw new Error(details || `HTTP ${pdfRes?.status || "?"}`);
      }

      const blob = await pdfRes.blob();
      const base = form.mode === "law_rag" ? "Article_Droit_RAG" : "Article_Scientifique";
      const fname = `${safeFilename(base)}_${prettyDate()}.pdf`;
      setPersistentDownload(blob, fname);

      stopFakeProgress("Téléchargement prêt ✅");
      setSuccessHint("L’article a été généré et téléchargé.");
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
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-6 border-b border-white/10 bg-slate-950/70">
          <div className="text-[11px] uppercase tracking-[0.25em] text-slate-300 font-bold">
            Génération d’articles scientifiques
          </div>
          <h1 className="text-2xl font-semibold mt-1">DroitGPT — Articles</h1>
          <p className="mt-1 text-sm text-slate-300">
            Mode <strong>Droit (RAG)</strong> pour exploiter ta base Qdrant, ou mode <strong>Scientifique</strong> général.
          </p>
        </div>

        <form onSubmit={onSubmit} className="px-6 py-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-slate-300">Type</span>
              <select
                className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2"
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
              >
                <option value="law_rag">Droit congolais (RAG Qdrant)</option>
                <option value="scientific">Article scientifique (général)</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="text-slate-300">Langue</span>
              <select
                className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2"
                value={form.lang}
                onChange={(e) => setForm((f) => ({ ...f, lang: e.target.value }))}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>

          <label className="text-sm block">
            <span className="text-slate-300">Titre (optionnel)</span>
            <input
              className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Synthèse jurisprudentielle sur la preuve pénale en RDC"
            />
          </label>

          <label className="text-sm block">
            <span className="text-slate-300">Thème / Topic</span>
            <textarea
              className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2 min-h-[92px]"
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
            />
          </label>

          <label className="text-sm block">
            <span className="text-slate-300">Question de recherche (optionnel mais recommandé)</span>
            <textarea
              className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2 min-h-[72px]"
              value={form.researchQuestion}
              onChange={(e) => setForm((f) => ({ ...f, researchQuestion: e.target.value }))}
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-slate-300">Pages cible</span>
              <input
                type="number"
                min={6}
                max={30}
                className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2"
                value={form.targetPages}
                onChange={(e) => setForm((f) => ({ ...f, targetPages: e.target.value }))}
              />
            </label>

            <label className="text-sm flex items-center gap-2 mt-6 md:mt-0">
              <input
                type="checkbox"
                checked={form.lite}
                onChange={(e) => setForm((f) => ({ ...f, lite: e.target.checked }))}
              />
              <span className="text-slate-300">Mode lite (plus rapide)</span>
            </label>
          </div>

          {/* Progress */}
          <div className="pt-2">
            <div className="h-3 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 text-xs text-slate-300 flex items-center justify-between">
              <span>{statusText || ""}</span>
              <span>{progress ? `${progress}%` : ""}</span>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          {successHint ? (
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {successHint}
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 disabled:opacity-60 font-semibold"
            >
              {loading ? "Génération…" : "Générer l’article (PDF)"}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={!loading}
                className="px-4 py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50"
              >
                Annuler
              </button>

              {lastFile?.url ? (
                <a
                  href={lastFile.url}
                  download={lastFile.name}
                  className="px-4 py-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15"
                >
                  Re-télécharger
                </a>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
