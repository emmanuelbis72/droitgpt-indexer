import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_API_BASE = "https://businessplan-v9yy.onrender.com";
const STATUSES = [
  { value: "a_analyser", label: "A analyser" },
  { value: "candidat", label: "Candidat" },
  { value: "rejete", label: "Rejete" },
  { value: "soumis", label: "Soumis" },
  { value: "archive", label: "Archive" },
];

const PROFILE_FIELDS = [
  ["name", "Nom de l'organisation"],
  ["legalStatus", "Statut legal"],
  ["country", "Pays"],
  ["city", "Ville"],
  ["contactEmail", "Email contact"],
  ["mission", "Mission"],
  ["sectors", "Secteurs"],
  ["targetGroups", "Groupes cibles"],
  ["geographicFocus", "Zone d'intervention"],
  ["pastProjects", "Projets passes / references"],
  ["team", "Equipe"],
  ["partners", "Partenaires"],
  ["annualBudget", "Budget annuel"],
  ["financialSystems", "Systemes financiers"],
  ["safeguarding", "Safeguarding / protection"],
  ["monitoringEvaluation", "Suivi-evaluation"],
  ["impactEvidence", "Preuves d'impact"],
  ["documentsReady", "Documents disponibles"],
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function GrantsManagementPage() {
  const API_BASE = import.meta.env.VITE_BP_API_BASE || DEFAULT_API_BASE;
  const grantsApi = useMemo(() => `${API_BASE.replace(/\/$/, "")}/generate-grants-management`, [API_BASE]);

  const [tab, setTab] = useState("opportunities");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [search, setSearch] = useState({
    keywords: "education grant africa",
    country: "RDC",
    sector: "education",
    sources: "grants.gov,undp,opportunities-for-youth,vc4a,scholarshipset,eu,worldbank,ungm,linkedin,foundations,embassies",
    limit: 30,
  });

  const [filters, setFilters] = useState({ q: "", source: "", userStatus: "" });
  const [opportunities, setOpportunities] = useState([]);
  const [profile, setProfile] = useState({});
  const [selected, setSelected] = useState(null);
  const [questions, setQuestions] = useState("");
  const [answers, setAnswers] = useState(null);
  const [watch, setWatch] = useState({
    intervalValue: 24,
    intervalUnit: "hours",
    email: true,
    emailTo: "",
  });

  async function api(path, options = {}) {
    const res = await fetch(`${grantsApi}${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.details || json.error || `HTTP ${res.status}`);
    return json;
  }

  async function loadOpportunities() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    params.set("limit", "100");
    const json = await api(`/opportunities?${params.toString()}`);
    setOpportunities(json.rows || []);
  }

  async function loadProfile() {
    const json = await api("/profile");
    setProfile(json.profile || {});
  }

  useEffect(() => {
    loadOpportunities().catch((e) => setError(e.message));
    loadProfile().catch(() => {});
  }, []);

  async function runSearch() {
    setLoading(true);
    setError("");
    setMessage("Recherche en cours...");
    try {
      const payload = {
        ...search,
        limit: Number(search.limit || 30),
        sources: search.sources.split(",").map((x) => x.trim()).filter(Boolean),
        save: true,
      };
      const json = await api("/discover", { method: "POST", body: JSON.stringify(payload) });
      setMessage(`${json.total || 0} resultats trouves. ${json.db?.inserted || 0} nouveaux, ${json.db?.updated || 0} mis a jour.`);
      await loadOpportunities();
      setTab("opportunities");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function createWatch() {
    setLoading(true);
    setError("");
    try {
      const interval = Math.max(1, Number(watch.intervalValue || 24));
      const intervalHours = watch.intervalUnit === "days" ? interval * 24 : interval;
      const payload = {
        name: `Veille ${search.sector || "grants"}`,
        intervalHours,
        query: {
          ...search,
          limit: Number(search.limit || 30),
          sources: search.sources.split(",").map((x) => x.trim()).filter(Boolean),
        },
        alerts: { email: watch.email, emailTo: watch.emailTo },
      };
      const json = await api("/watch", { method: "POST", body: JSON.stringify(payload) });
      setMessage(`Veille creee. Prochaine execution: ${new Date(json.watch.nextRunAt).toLocaleString()}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateOpportunity(id, patch) {
    await api(`/opportunities/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    await loadOpportunities();
  }

  async function enrichOpportunity(opp) {
    setLoading(true);
    setError("");
    try {
      const json = await api(`/opportunities/${encodeURIComponent(opp.id)}/enrich`, { method: "POST", body: "{}" });
      setSelected(json.opportunity);
      setQuestions((json.enrichment?.formQuestions || []).join("\n"));
      await loadOpportunities();
      setMessage("Opportunite enrichie.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setLoading(true);
    setError("");
    try {
      const json = await api("/profile", { method: "PUT", body: JSON.stringify(profile) });
      setProfile(json.profile || {});
      setMessage("Profil sauvegarde.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function autofill() {
    if (!selected) return setError("Selectionne une opportunite.");
    const qs = questions.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (!qs.length) return setError("Ajoute les questions du formulaire ou enrichis l'opportunite.");

    setLoading(true);
    setError("");
    setAnswers(null);
    try {
      const json = await api(`/opportunities/${encodeURIComponent(selected.id)}/autofill`, {
        method: "POST",
        body: JSON.stringify({ questions: qs, profile }),
      });
      setAnswers(json.result);
      setMessage("Reponses IA generees.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-slate-950 p-6 text-white shadow">
        <p className="text-sm uppercase tracking-wide text-emerald-300">AI Assisted Grants Management</p>
        <h1 className="mt-2 text-2xl font-bold">Recherche, veille et candidature automatique aux grants</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Trouve les appels a projets, sauvegarde les opportunites, gere les favoris et statuts, puis remplis les questions de candidature avec le profil de ton organisation.
        </p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

      <div className="flex flex-wrap gap-2">
        {[
          ["opportunities", "Opportunites"],
          ["search", "Recherche & veille"],
          ["profile", "Profil organisation"],
          ["application", "Remplissage IA"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cx(
              "rounded-xl px-4 py-2 text-sm font-semibold",
              tab === value ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "search" ? (
        <Panel title="Recherche multi-sources et veille planifiee">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Mots-cles" value={search.keywords} onChange={(v) => setSearch({ ...search, keywords: v })} />
            <Field label="Pays" value={search.country} onChange={(v) => setSearch({ ...search, country: v })} />
            <Field label="Secteur" value={search.sector} onChange={(v) => setSearch({ ...search, sector: v })} />
          </div>
          <Area label="Sources" value={search.sources} onChange={(v) => setSearch({ ...search, sources: v })} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Field label="Limite" value={search.limit} onChange={(v) => setSearch({ ...search, limit: v })} />
            <Field label="Intervalle" value={watch.intervalValue} onChange={(v) => setWatch({ ...watch, intervalValue: v })} />
            <Select label="Unite" value={watch.intervalUnit} onChange={(v) => setWatch({ ...watch, intervalUnit: v })} options={[["hours", "Heures"], ["days", "Jours"]]} />
            <Field label="Email alerte" value={watch.emailTo} onChange={(v) => setWatch({ ...watch, emailTo: v })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={watch.email} onChange={(e) => setWatch({ ...watch, email: e.target.checked })} />
            Envoyer des alertes email
          </label>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton onClick={runSearch} disabled={loading}>Rechercher et sauvegarder</PrimaryButton>
            <SecondaryButton onClick={createWatch} disabled={loading}>Planifier la veille</SecondaryButton>
          </div>
        </Panel>
      ) : null}

      {tab === "profile" ? (
        <Panel title="Profil de l'entreprise / organisation">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {PROFILE_FIELDS.map(([key, label]) =>
              ["mission", "targetGroups", "pastProjects", "team", "partners", "financialSystems", "safeguarding", "monitoringEvaluation", "impactEvidence", "documentsReady"].includes(key) ? (
                <Area key={key} label={label} value={profile[key] || ""} onChange={(v) => setProfile({ ...profile, [key]: v })} />
              ) : (
                <Field key={key} label={label} value={profile[key] || ""} onChange={(v) => setProfile({ ...profile, [key]: v })} />
              )
            )}
          </div>
          <PrimaryButton onClick={saveProfile} disabled={loading}>Sauvegarder le profil</PrimaryButton>
        </Panel>
      ) : null}

      {tab === "opportunities" ? (
        <Panel title="Pipeline des opportunites">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Filtre" value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} />
            <Field label="Source" value={filters.source} onChange={(v) => setFilters({ ...filters, source: v })} />
            <Select label="Statut" value={filters.userStatus} onChange={(v) => setFilters({ ...filters, userStatus: v })} options={[["", "Tous"], ...STATUSES.map((s) => [s.value, s.label])]} />
            <div className="flex items-end">
              <SecondaryButton onClick={loadOpportunities}>Rafraichir</SecondaryButton>
            </div>
          </div>
          <div className="space-y-3">
            {opportunities.map((opp) => (
              <OpportunityCard
                key={opp.id}
                opp={opp}
                onSelect={() => {
                  setSelected(opp);
                  setQuestions((opp.enrichment?.formQuestions || []).join("\n"));
                  setTab("application");
                }}
                onEnrich={() => enrichOpportunity(opp)}
                onFavorite={() => updateOpportunity(opp.id, { favorite: !opp.user?.favorite })}
                onStatus={(status) => updateOpportunity(opp.id, { status })}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {tab === "application" ? (
        <Panel title="Remplir les questions d'un grant avec l'IA">
          {selected ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="font-semibold text-slate-900">{selected.title}</div>
              <div className="mt-1 text-sm text-slate-600">{selected.donor} - {selected.source}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Selectionne une opportunite dans le pipeline.
            </div>
          )}
          <Area
            label="Questions du formulaire (une question par ligne)"
            value={questions}
            onChange={setQuestions}
            placeholder="Quel est l'objectif du projet ?&#10;Quelle est l'experience de votre organisation ?"
          />
          <PrimaryButton onClick={autofill} disabled={loading || !selected}>Remplir automatiquement par l'IA</PrimaryButton>

          {answers ? (
            <div className="space-y-4">
              {(answers.answers || []).map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">{a.question}</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{a.answer}</p>
                  <div className="mt-2 text-xs text-slate-500">Confiance: {a.confidence} {a.needsUserReview ? "- revue humaine requise" : ""}</div>
                </div>
              ))}
              {answers.missingProfileFields?.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <div className="font-semibold">Informations manquantes</div>
                  <ul className="mt-2 list-disc pl-5">
                    {answers.missingProfileFields.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

function OpportunityCard({ opp, onSelect, onEnrich, onFavorite, onStatus }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-base font-semibold text-slate-900">{opp.title}</div>
          <div className="mt-1 text-sm text-slate-600">{opp.donor} - {opp.source}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-1">Score {opp.match?.score || 0}/100</span>
            <span className="rounded-full bg-slate-100 px-2 py-1">{opp.closeDate || opp.enrichment?.deadline || "Deadline inconnue"}</span>
            <span className="rounded-full bg-slate-100 px-2 py-1">{opp.user?.status || "a_analyser"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={onFavorite}>{opp.user?.favorite ? "Favori" : "Ajouter favori"}</button>
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={opp.user?.status || "a_analyser"} onChange={(e) => onStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={onEnrich}>Enrichir</button>
          <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={onSelect}>Remplir IA</button>
        </div>
      </div>
      {opp.url ? <a className="mt-3 inline-block text-sm text-blue-700 underline" href={opp.url} target="_blank" rel="noreferrer">Ouvrir la source</a> : null}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Area({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea className="mt-1 min-h-[110px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function PrimaryButton({ children, ...props }) {
  return <button type="button" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" {...props}>{children}</button>;
}

function SecondaryButton({ children, ...props }) {
  return <button type="button" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60" {...props}>{children}</button>;
}
