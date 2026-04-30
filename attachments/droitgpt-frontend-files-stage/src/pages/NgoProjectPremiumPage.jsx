// src/pages/NgoProjectPremiumPage.jsx
import React, { useMemo, useRef, useState } from "react";

const DEFAULT_API_BASE = "https://businessplan-v9yy.onrender.com";
const API_BASE = (import.meta?.env?.VITE_BP_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");

const DONOR_STYLES = [
  { value: "", label: "Standard international (générique)" },
  { value: "UN", label: "ONU (UN/UNDP/UNICEF)" },
  { value: "USAID", label: "USAID" },
  { value: "EU", label: "Union Européenne (EU)" },
  { value: "WorldBank", label: "Banque Mondiale" },
];

function safeFilename(s) {
  return String(s || "document")
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

/**
 * Ultra-defensive error body reader.
 * - Never throws
 * - Never calls .text() unless it exists
 * - Handles JSON + plain text
 */
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
        return j?.details || j?.error || JSON.stringify(j);
      } catch (_) {
        // fallthrough to text
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

export default function NgoProjectPremiumPage() {
  const endpointNgo = useMemo(() => `${API_BASE}/generate-ngo-project/premium`, []);

  const [form, setForm] = useState({
    lang: "fr",
    projectTitle: "",
    organization: "",
    country: "RDC",
    provinceCity: "",
    sector: "",
    donorStyle: "",
    durationMonths: 12,
    budgetTotal: "",
    startDate: "",
    problem: "",
    targetGroups: "",
    overallGoal: "",
    specificObjectives: "",
    assumptions: "",
    risks: "",
    partners: "",
    implementationApproach: "",
    sustainability: "",
    safeguarding: "",
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
    const DURATION_MS = 21 * 60 * 1000;

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
        projectTitle: clampText(form.projectTitle, 160),
        organization: clampText(form.organization, 160),
        country: clampText(form.country, 80),
        provinceCity: clampText(form.provinceCity, 120),
        sector: clampText(form.sector, 120),
        donorStyle: clampText(form.donorStyle, 40),
        durationMonths: Number(form.durationMonths || 0) || null,
        budgetTotal: clampText(form.budgetTotal, 60),
        startDate: clampText(form.startDate, 40),
        problem: clampText(form.problem, 3500),
        targetGroups: clampText(form.targetGroups, 2500),
        overallGoal: clampText(form.overallGoal, 1200),
        specificObjectives: clampText(form.specificObjectives, 1800),
        assumptions: clampText(form.assumptions, 2500),
        risks: clampText(form.risks, 2500),
        partners: clampText(form.partners, 1500),
        implementationApproach: clampText(form.implementationApproach, 2000),
        sustainability: clampText(form.sustainability, 2000),
        safeguarding: clampText(form.safeguarding, 1200),
      },
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccessHint("");

    if (!String(form.projectTitle).trim()) return setError("Le titre du projet est requis.");
    if (!String(form.organization).trim()) return setError("Le nom de l’ONG / organisation est requis.");

    setLoading(true);
    startFakeProgress();

    const controller = new AbortController();
    abortRef.current = controller;

    const timeoutId = setTimeout(() => controller.abort(), 1800000);

    try {
      const payload = buildPayload();

      setStatusText("Démarrage génération (mode job)…");
      let startRes;
      try {
        startRes = await fetch(`${endpointNgo}?async=1`, {
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
          details = j?.details || j?.error || JSON.stringify(j);
        } catch {
          details = await readErrorBody(startRes);
        }
        throw new Error(details || `HTTP ${startRes?.status || "?"}`);
      }

      let started;
      try {
        started = await startRes.json();
      } catch {
        const t = await readErrorBody(startRes);
        throw new Error(t || "Réponse backend invalide (start).");
      }

      const jobId = started?.jobId;
      if (!jobId) throw new Error("JOB_ID manquant (backend ?async=1 non actif).");

      const statusUrl = `${API_BASE}/generate-ngo-project/premium/jobs/${encodeURIComponent(jobId)}`;
      const resultUrl = `${API_BASE}/generate-ngo-project/premium/jobs/${encodeURIComponent(jobId)}/result`;

      setStatusText("Génération en cours… (mode job)");

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

        let st;
        try {
          st = await stRes.json();
        } catch {
          const t = await readErrorBody(stRes);
          throw new Error(t || "Réponse backend invalide (status).");
        }

        if (st.status === "error") throw new Error(st.error || "Erreur job inconnue.");
        if (st.status === "rejected") throw new Error(st.error || "Job rejeté.");
        if (st.status === "done") break;

        await new Promise((r) => setTimeout(r, 4000));
      }

      setStatusText("Téléchargement PDF…");
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
          details = j?.details || j?.error || JSON.stringify(j);
        } catch {
          details = await readErrorBody(pdfRes);
        }
        throw new Error(details || `HTTP ${pdfRes?.status || "?"}`);
      }

      const blob = await pdfRes.blob();
      const fname = `${safeFilename(form.organization)}_Projet_ONG_Premium_${prettyDate()}.pdf`;
      setPersistentDownload(blob, fname);

      stopFakeProgress("Téléchargement prêt ✅");
      setSuccessHint("Ton projet ONG Premium a été généré et téléchargé.");
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
          <div className="text-lg font-semibold">Projets ONG — Premium (bailleurs internationaux)</div>
          <div className="text-sm text-slate-600">
            Génération automatique : narratif + LogFrame + Budget + SDGs + M&E + risques + chronogramme (PDF).
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

          <Field label="Style bailleur">
            <select
              value={form.donorStyle}
              onChange={(e) => setForm((f) => ({ ...f, donorStyle: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              disabled={loading}
            >
              {DONOR_STYLES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Titre du projet *">
            <input
              value={form.projectTitle}
              onChange={(e) => setForm((f) => ({ ...f, projectTitle: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ex: Réduction de la malnutrition infantile…"
              disabled={loading}
            />
          </Field>

          <Field label="Organisation / ONG *">
            <input
              value={form.organization}
              onChange={(e) => setForm((f) => ({ ...f, organization: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Nom de l’organisation"
              disabled={loading}
            />
          </Field>

          <Field label="Pays">
            <input
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              disabled={loading}
            />
          </Field>

          <Field label="Zone (province/ville)">
            <input
              value={form.provinceCity}
              onChange={(e) => setForm((f) => ({ ...f, provinceCity: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ex: Nord-Kivu, Goma"
              disabled={loading}
            />
          </Field>

          <Field label="Secteur / Thème">
            <input
              value={form.sector}
              onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ex: Santé, Nutrition, Education, WASH…"
              disabled={loading}
            />
          </Field>

          <Field label="Durée (mois)">
            <input
              type="number"
              value={form.durationMonths}
              onChange={(e) => setForm((f) => ({ ...f, durationMonths: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              min={1}
              max={60}
              disabled={loading}
            />
          </Field>

          <Field label="Budget total (optionnel)">
            <input
              value={form.budgetTotal}
              onChange={(e) => setForm((f) => ({ ...f, budgetTotal: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ex: USD 250,000"
              disabled={loading}
            />
          </Field>

          <Field label="Date de démarrage (optionnel)">
            <input
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ex: 2026-03-01"
              disabled={loading}
            />
          </Field>

          <div className="md:col-span-2">
            <TextArea
              label="Problème / justification (résumé)"
              value={form.problem}
              onChange={(v) => setForm((f) => ({ ...f, problem: v }))}
              disabled={loading}
              placeholder="Décris la problématique, causes, contexte…"
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Groupes cibles / bénéficiaires"
              value={form.targetGroups}
              onChange={(v) => setForm((f) => ({ ...f, targetGroups: v }))}
              disabled={loading}
              placeholder="Ex: enfants <5 ans, femmes enceintes, ménages vulnérables…"
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Objectif global"
              value={form.overallGoal}
              onChange={(v) => setForm((f) => ({ ...f, overallGoal: v }))}
              disabled={loading}
              placeholder="Ex: réduire durablement la malnutrition…"
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Objectifs spécifiques"
              value={form.specificObjectives}
              onChange={(v) => setForm((f) => ({ ...f, specificObjectives: v }))}
              disabled={loading}
              placeholder="Liste 3–5 objectifs spécifiques…"
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Hypothèses (optionnel)"
              value={form.assumptions}
              onChange={(v) => setForm((f) => ({ ...f, assumptions: v }))}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Risques (optionnel)"
              value={form.risks}
              onChange={(v) => setForm((f) => ({ ...f, risks: v }))}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Partenaires (optionnel)"
              value={form.partners}
              onChange={(v) => setForm((f) => ({ ...f, partners: v }))}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Approche de mise en œuvre (optionnel)"
              value={form.implementationApproach}
              onChange={(v) => setForm((f) => ({ ...f, implementationApproach: v }))}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Durabilité / stratégie de sortie (optionnel)"
              value={form.sustainability}
              onChange={(v) => setForm((f) => ({ ...f, sustainability: v }))}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <TextArea
              label="Safeguarding / protection (optionnel)"
              value={form.safeguarding}
              onChange={(v) => setForm((f) => ({ ...f, safeguarding: v }))}
              disabled={loading}
            />
          </div>
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
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
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

function TextArea({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-slate-600">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}
