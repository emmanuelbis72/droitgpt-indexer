// src/pages/ExcelAppsPage.jsx
import React, { useEffect, useRef, useState } from "react";

const API_BASE =
  import.meta.env.VITE_BP_API_BASE || "https://businessplan-v9yy.onrender.com";

const TOTAL_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const TEMPLATES = [
  { id: "cash_management", title: "Gestion Caisse & Dépenses", desc: "Journal de caisse, catégories, synthèse mensuelle, dashboard KPI." },
  { id: "school_management", title: "Gestion d’École", desc: "Inscriptions, paiements, présence, notes, rapports." },
  { id: "stock_sales", title: "Stock & Ventes", desc: "Inventaire, entrées/sorties, alertes, dashboard." },
  { id: "project_budget", title: "Budget Projet (ONG)", desc: "Budget par activité/catégorie, suivi exécution, rapports." },
];

export default function ExcelAppsPage() {
  const [template, setTemplate] = useState("cash_management");
  const [appName, setAppName] = useState("Progiciel Excel");
  const [notes, setNotes] = useState("");
  const [lang, setLang] = useState("fr");

  const [status, setStatus] = useState("idle");
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);

  const startTimeRef = useRef(null);
  const progressTimerRef = useRef(null);

  const selected = TEMPLATES.find((t) => t.id === template);

  function startProgressTimer() {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - (startTimeRef.current || Date.now());
      const p = Math.min((elapsed / TOTAL_DURATION_MS) * 100, 99);
      setProgress(p);
    }, 1000);
  }

  async function handleGenerate() {
    setError(null);
    setDownloadUrl(null);
    setProgress(0);
    setStatus("starting");

    const res = await fetch(`${API_BASE}/generate-excel-app?async=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang,
        ctx: {
          type: template,
          appName: appName || selected?.title || "Progiciel Excel",
          notes,
          modules: [],
        },
      }),
    }).catch((e) => {
      setError(String(e?.message || e));
      setStatus("error");
      return null;
    });

    if (!res) return;

    const data = await res.json().catch(() => null);
    if (!data?.jobId) {
      setError(data?.message || "Impossible de démarrer la génération.");
      setStatus("error");
      return;
    }

    setJobId(data.jobId);
    setStatus("running");
    startTimeRef.current = Date.now();
    startProgressTimer();
  }

  useEffect(() => {
    if (!jobId) return;
    const poll = setInterval(async () => {
      const r = await fetch(`${API_BASE}/generate-excel-app/jobs/${jobId}`).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (!j) return;

      if (j.status === "error") {
        clearInterval(poll);
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        setStatus("error");
        setError(j.error || "Erreur inconnue");
        return;
      }

      if (j.status === "done") {
        clearInterval(poll);
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        setProgress(100);
        setStatus("done");
        setDownloadUrl(`${API_BASE}/generate-excel-app/jobs/${jobId}/result`);
      }
    }, 4000);

    return () => clearInterval(poll);
  }, [jobId]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-6 border-b border-white/10 bg-slate-950/70">
          <div className="text-[11px] uppercase tracking-[0.25em] text-slate-300 font-bold">DroitGPT • Ultra Pro</div>
          <h1 className="text-2xl font-semibold mt-1">Progiciels Excel (IA)</h1>
          <p className="mt-1 text-sm text-slate-300">Génère des outils Excel modernes : formulaires, validations, formules, tableaux et dashboard KPI.</p>
        </div>

        <div className="px-6 py-6 bg-slate-950/60">
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <label className="text-xs text-slate-300">Template</label>
              <select value={template} onChange={(e) => setTemplate(e.target.value)} className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 p-3 text-sm outline-none">
                {TEMPLATES.map((t) => (<option key={t.id} value={t.id}>{t.title}</option>))}
              </select>
              <p className="mt-2 text-xs text-slate-400">{selected?.desc}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300">Nom du fichier / progiciel</label>
                  <input value={appName} onChange={(e) => setAppName(e.target.value)} className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 p-3 text-sm outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-300">Langue</label>
                  <select value={lang} onChange={(e) => setLang(e.target.value)} className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 p-3 text-sm outline-none">
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <label className="mt-3 block text-xs text-slate-300">Notes / Besoins (optionnel)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="mt-1 w-full rounded-xl bg-slate-950/70 border border-white/10 p-3 text-sm outline-none" />
            </div>

            <button onClick={handleGenerate} disabled={status === "starting" || status === "running"} className="rounded-2xl px-6 py-4 font-semibold bg-gradient-to-r from-emerald-500 to-indigo-500 hover:from-emerald-600 hover:to-indigo-600 transition disabled:opacity-60">
              🚀 Générer le progiciel Excel
            </button>

            {status !== "idle" && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
                  <div className="h-3 bg-emerald-400 transition-all duration-1000" style={{ width: `${Math.floor(progress)}%` }} />
                </div>
                <div className="mt-2 text-xs text-slate-300">
                  {status === "starting" && "Démarrage de la génération…"}
                  {status === "running" && "Génération en cours… (≈ 15 minutes max)"}
                  {status === "done" && "Terminé ✅"}
                  {status === "error" && "Erreur ❌"}
                </div>
                {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}
              </div>
            )}

            {downloadUrl && (
              <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-center rounded-2xl px-6 py-4 font-semibold border border-emerald-400/50 bg-slate-900/60 hover:bg-slate-900 transition">
                ⬇️ Télécharger le fichier Excel (.xlsx)
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
