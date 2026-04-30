import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_API_BASE = "https://businessplan-v9yy.onrender.com";

const AUDIENCES = [
  {
    value: "bank",
    label: "Banque (dossier de crédit)",
    hint: "Ton document sera écrit pour convaincre une banque : prudence, garanties, capacité de remboursement.",
  },
  {
    value: "investor",
    label: "Investisseur (equity)",
    hint: "Ton document sera écrit pour convaincre un investisseur : traction, croissance, avantage concurrentiel.",
  },
  {
    value: "incubator",
    label: "Incubateur (programme)",
    hint: "Ton document sera écrit pour un incubateur : vision, exécution, apprentissage, roadmap.",
  },
  {
    value: "donor",
    label: "Bailleur / Donor",
    hint: "Ton document sera écrit pour un bailleur : impact, résultats, théorie du changement, durabilité.",
  },
];

const DOCTYPES = [
  { value: "startup", label: "Startup / PME" },
  { value: "commerce", label: "Commerce / Négoce / Boutique" },
  { value: "services", label: "Entreprise de services" },
  { value: "agri", label: "Agri / Agro-industrie" },
  { value: "industry", label: "Industrie / Production" },
  { value: "construction", label: "BTP / Construction / Immobilier" },
  { value: "transport", label: "Transport / Logistique" },
  { value: "mining", label: "Mines / Ressources naturelles" },
  { value: "energy", label: "Énergie / Eau / Environnement" },
  { value: "health", label: "Santé / Clinique / Pharma" },
  { value: "education", label: "Éducation / Formation" },
  { value: "tourism", label: "Hôtellerie / Tourisme / Loisirs" },
  { value: "tech", label: "Tech / Plateforme / SaaS" },
  { value: "manufacturing", label: "Manufacture / Transformation" },
  { value: "ngo", label: "ONG / ASBL / Projet social" },
  { value: "cooperative", label: "Coopérative" },
  { value: "informal", label: "Activité informelle structurée" },
  { value: "other", label: "Autre (à préciser)" },
];


const STAGES = [
  { value: "Ideation", label: "Idée (pas encore lancé)", hint: "Tu as une idée claire, mais pas encore de clients." },
  { value: "Prelaunch", label: "Pré-lancement (préparation)", hint: "Tu prépares : local, fournisseurs, équipe, tests." },
  { value: "Launch", label: "Lancement (début d’activité)", hint: "Tu viens de lancer et tu commences à vendre." },
  { value: "Traction", label: "Traction (clients réguliers)", hint: "Tu as des clients et des ventes récurrentes." },
  { value: "Growth", label: "Croissance (accélération)", hint: "Tu augmentes volume, canaux, équipe." },
  { value: "ScaleUp", label: "Scale-up (forte expansion)", hint: "Tu ouvres plusieurs villes/sites et industrialises." },
  { value: "Mature", label: "Mature (stabilité/optimisation)", hint: "Tu optimises marge, process, gouvernance." },
];

const COMPANY_TYPE_PRESETS = [
  "Entreprise individuelle",
  "SARL",
  "SA",
  "Coopérative",
  "ONG / ASBL",
  "Autre",
];

function safeFilename(name) {
  return String(name || "Business_Plan")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
}

function prettyDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampText(s, max = 6000) {
  const x = String(s || "").trim();
  if (x.length <= max) return x;
  return x.slice(0, max) + "…";
}

function buildMultiline(label, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return `- ${label} : ${v}\n`;
}

export default function BusinessPlanPremiumPage() {
  const API_BASE = import.meta.env.VITE_BP_API_BASE || DEFAULT_API_BASE;

  const endpointGenerate = useMemo(
    () => `${API_BASE.replace(/\/$/, "")}/generate-business-plan/premium`,
    [API_BASE]
  );

  // Endpoint optionnel (non cassant) pour “corriger un brouillon”
  const endpointRewrite = useMemo(
    () => `${API_BASE.replace(/\/$/, "")}/generate-business-plan/premium/rewrite`,
    [API_BASE]
  );

  const [mode, setMode] = useState("generate"); // "generate" | "rewrite"

  const [form, setForm] = useState({
    // Identité / cadrage
    lang: "fr",
    docType: "startup",
    audience: "bank",

    companyName: "",
    country: "RDC",
    city: "Kinshasa",

    stage: "Launch",

    // Type d'entreprise (liste OU libre)
    companyTypeMode: "preset", // "preset" | "free"
    companyTypePreset: "SARL",
    companyTypeFree: "",

    // Activité
    sector: "",
    mission: "",
    problem: "",
    solution: "",
    product: "",

    customers: "",
    market: "",
    competition: "",
    differentiation: "",


    strategicPartnerships: "",
    pricing: "",
    channels: "",
    operations: "",
    team: "",
    traction: "",

    risks: "",
    finAssumptions: "",
    fundingAsk: "",

    // Sortie
    output: "pdf", // PDF par défaut (stable)
    lite: false,

    // Mode rewrite
    rewriteNotes: "",
    rewriteTextFallback: "",
  });

  const [draftFile, setDraftFile] = useState(null);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [successHint, setSuccessHint] = useState("");

  // Last generated files (for re-download without regenerating)
  const [lastGenerateFile, setLastGenerateFile] = useState({ url: "", name: "" });
  const [lastRewriteFile, setLastRewriteFile] = useState({ url: "", name: "" });
  const lastGenerateUrlRef = useRef("");
  const lastRewriteUrlRef = useRef("");

  const abortRef = useRef(null);
  const progressTimerRef = useRef(null);

  // Auto-save (localStorage)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bp_premium_form_v3");
      if (raw) {
        const saved = JSON.parse(raw);
        setForm((prev) => ({ ...prev, ...saved }));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("bp_premium_form_v3", JSON.stringify(form));
    } catch {
      // ignore
    }
  }, [form]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (abortRef.current) abortRef.current.abort();

      // Clean ObjectURLs
      if (lastGenerateUrlRef.current) URL.revokeObjectURL(lastGenerateUrlRef.current);
      if (lastRewriteUrlRef.current) URL.revokeObjectURL(lastRewriteUrlRef.current);
    };
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startFakeProgress(kind = "generate") {
    // 14 minutes fake progress (840s) that caps at 95% until backend responds
    const DURATION_MS = 840000;
    const CAP = 95;

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;

    setProgress(0);
    setSuccessHint("");

    const steps =
      kind === "rewrite"
        ? [
            { at: 10, text: "Analyse du brouillon…" },
            { at: 28, text: "Réorganisation & corrections…" },
            { at: 48, text: "Amélioration du style (niveau banque/investisseur)…" },
            { at: 70, text: "Reconstruction des sections manquantes…" },
            { at: 86, text: "Finances (Y1–Y5) & cohérence…" },
            { at: 95, text: "Finalisation & export…" },
          ]
        : [
{ at: 8, text: "Analyse du contexte…" },
{ at: 20, text: "Executive Summary…" },
{ at: 34, text: "Marché…" },
{ at: 44, text: "Concurrence & différenciation…" },
{ at: 54, text: "Modèle économique…" },
{ at: 62, text: "Partenariats stratégiques…" },
{ at: 72, text: "Go-To-Market…" },
{ at: 82, text: "Canvas / SWOT / KPIs…" },
{ at: 90, text: "Section financière (Y1–Y5)…" },
{ at: 95, text: "Finalisation & export…" },          ];

    let i = 0;
    setStatusText(steps[0].text);

    const startedAt = Date.now();

    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / DURATION_MS, 1);

      // smooth ease-out curve
      const eased = 1 - Math.pow(1 - ratio, 3);
      const target = Math.floor(eased * CAP);

      setProgress((p) => {
        const next = Math.min(CAP, Math.max(p, target));
        // advance status text when crossing thresholds
        while (i < steps.length - 1 && next >= steps[i + 1].at) i += 1;
        setStatusText(steps[i].text);
        return next;
      });
    }, 200);
  }

  function stopFakeProgress(finalText) {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
    setProgress(100);
    setStatusText(finalText || "Terminé.");
    setTimeout(() => setProgress(0), 900);
  }


  function onCancel() {
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setProgress(0);
    setStatusText("");
  }

  function getCompanyTypeValue() {
    if (form.companyTypeMode === "free") return String(form.companyTypeFree || "").trim();
    const p = String(form.companyTypePreset || "").trim();
    if (p === "Autre") return String(form.companyTypeFree || "").trim() || "Autre";
    return p;
  }

  // On “mappe” les champs détaillés vers les champs attendus par ton backend (sans casser).
  function buildPayloadForGenerate() {
    const companyType = getCompanyTypeValue();

    // Produit / service => mélange simple & clair
    const productBlock =
      `${buildMultiline("Mission", form.mission)}` +
      `${buildMultiline("Problème que tu résous", form.problem)}` +
      `${buildMultiline("Solution", form.solution)}` +
      `${buildMultiline("Produit/Service (description)", form.product)}\n` +
      `${buildMultiline("Prix / tarification", form.pricing)}` +
      `${buildMultiline("Canaux de vente", form.channels)}` +
      `${buildMultiline("Opérations (production, livraison, etc.)", form.operations)}` +
      `${buildMultiline("Équipe", form.team)}`;

    const customersBlock =
      `${buildMultiline("Clients principaux", form.customers)}` +
      `${buildMultiline("Marché / zone", form.market)}`;

    const businessModelBlock =
      `${buildMultiline("Modèle économique", form.pricing ? "Revenus via tarification ci-dessus + ventes." : "")}` +
      `${buildMultiline("Canaux", form.channels)}` +
      `${buildMultiline("Partenariats stratégiques", form.strategicPartnerships)}` +
      `${buildMultiline("Opérations", form.operations)}`;

    const tractionBlock =
      `${buildMultiline("Traction / preuves", form.traction)}` +
      `${buildMultiline("Équipe", form.team)}`;

    const competitionBlock =
      `${buildMultiline("Concurrents", form.competition)}` +
      `${buildMultiline("Différenciation / avantage", form.differentiation)}`;

    const risksBlock = `${form.risks || ""}`.trim();

    return {
      lang: form.lang,
      docType: form.docType,
      audience: form.audience,
      companyName: form.companyName,
      country: form.country,
      city: form.city,
      sector: form.sector,
      stage: STAGES.find((s) => s.value === form.stage)?.label || form.stage,

      // On injecte “type d’entreprise” dans finAssumptions (ou traction) de manière non cassante
      product: clampText(productBlock, 6500),
      customers: clampText(customersBlock, 4500),
      businessModel: clampText(businessModelBlock, 4500),
      traction: clampText(
        `${buildMultiline("Type d’entreprise", companyType)}${tractionBlock}`.trim(),
        4500
      ),
      competition: clampText(competitionBlock, 4500),
      risks: clampText(risksBlock, 4500),
      finAssumptions: clampText(form.finAssumptions, 4500),
      fundingAsk: clampText(form.fundingAsk, 4500),

      output: "pdf", // PDF only (stable). Si tu réactives DOCX côté backend, change ici.
      lite: form.lite,
    };
  }

  async function downloadBlob(blob, suggestedName) {
    // Immediate download (keeps previous behavior)
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // NOTE: caller may keep a persistent URL for re-download; this one is for immediate use only.
    window.URL.revokeObjectURL(url);
  }

  function setPersistentDownload(kind, blob, suggestedName) {
    const url = window.URL.createObjectURL(blob);

    if (kind === "rewrite") {
      if (lastRewriteUrlRef.current) URL.revokeObjectURL(lastRewriteUrlRef.current);
      lastRewriteUrlRef.current = url;
      setLastRewriteFile({ url, name: suggestedName });
    } else {
      if (lastGenerateUrlRef.current) URL.revokeObjectURL(lastGenerateUrlRef.current);
      lastGenerateUrlRef.current = url;
      setLastGenerateFile({ url, name: suggestedName });
    }

    // keep current auto-download behavior
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }


  async function onSubmitGenerate(e) {
    e.preventDefault();
    setError("");
    setSuccessHint("");

    if (!String(form.companyName).trim()) return setError("Le nom de l’entreprise est requis.");
    if (!String(form.sector).trim()) return setError("Le secteur est requis.");
    if (!String(form.solution).trim() && !String(form.product).trim())
      return setError("Décris au moins la solution OU le produit/service.");

    setLoading(true);
    startFakeProgress("generate");

    const controller = new AbortController();
    abortRef.current = controller;

    // ✅ Mode JOB (anti-timeout / anti-veille). On garde un timeout large côté client.
    const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 min

    try {
      const payload = buildPayloadForGenerate();

      // 1) Start JOB
      const startRes = await fetch(`${endpointGenerate}?async=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!startRes.ok) {
        let details = "";
        try {
          const j = await startRes.json();
          details = j?.details || j?.error || JSON.stringify(j);
        } catch {
          details = await startRes.text();
        }
        throw new Error(details || `HTTP ${startRes.status}`);
      }

      const started = await startRes.json();
      const jobId = started?.jobId;
      if (!jobId) throw new Error("JOB_ID manquant (backend ?async=1 non actif)." );

      setStatusText("Génération en cours… (mode job)");

      const statusUrl = `${API_BASE.replace(/\/$/, "")}/generate-business-plan/premium/jobs/${jobId}`;
      const resultUrl = `${API_BASE.replace(/\/$/, "")}/generate-business-plan/premium/jobs/${jobId}/result`;

      // 2) Poll status (léger, 4s)
      while (true) {
        const stRes = await fetch(statusUrl, { signal: controller.signal });
        if (!stRes.ok) {
          const t = await stRes.text();
          throw new Error(t || `HTTP ${stRes.status}`);
        }
        const st = await stRes.json();
        if (st.status === "error") throw new Error(st.error || "Erreur job inconnue.");
        if (st.status === "done") break;
        await new Promise((r) => setTimeout(r, 4000));
      }

      // 3) Download PDF
      const pdfRes = await fetch(resultUrl, { signal: controller.signal });
      if (!pdfRes.ok) {
        let details = "";
        try {
          const j = await pdfRes.json();
          details = j?.details || j?.error || JSON.stringify(j);
        } catch {
          details = await pdfRes.text();
        }
        throw new Error(details || `HTTP ${pdfRes.status}`);
      }

      const blob = await pdfRes.blob();
      const fname = `${safeFilename(form.companyName)}_BusinessPlan_Premium_${prettyDate()}.pdf`;
      setPersistentDownload("generate", blob, fname);

      stopFakeProgress("Téléchargement prêt ✅");
      setSuccessHint("Ton business plan a été généré et téléchargé.");
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

  async function onSubmitRewrite(e) {
    e.preventDefault();
    setError("");
    setSuccessHint("");

    if (!draftFile && !String(form.rewriteTextFallback || "").trim()) {
      setError("Importe un fichier (PDF/DOCX) OU colle le texte de ton brouillon.");
      return;
    }

    // mini infos utiles
    if (!String(form.companyName).trim()) {
      setError("Indique au moins le nom de l’entreprise (même si tu as un brouillon).");
      return;
    }

    setLoading(true);
    startFakeProgress("rewrite");

    const controller = new AbortController();
    abortRef.current = controller;

    // Timeout 15 min
    const timeoutId = setTimeout(() => controller.abort(), 900000);

    try {
      const fd = new FormData();
      fd.append("lang", form.lang);
      fd.append("audience", form.audience);
      fd.append("docType", form.docType);
      fd.append("companyName", form.companyName);
      fd.append("country", form.country);
      fd.append("city", form.city);
      fd.append("sector", form.sector || "");
      fd.append("stage", STAGES.find((s) => s.value === form.stage)?.label || form.stage);
      fd.append("notes", form.rewriteNotes || "");
      fd.append("output", "pdf"); // stable

      if (draftFile) fd.append("file", draftFile);
      if (!draftFile) fd.append("text", form.rewriteTextFallback || "");

      // IMPORTANT : cet endpoint est “optionnel”.
      // Si tu ne l’as pas encore côté backend, tu auras un message clair.
      const res = await fetch(endpointRewrite, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });

      if (!res.ok) {
        let details = "";
        try {
          const j = await res.json();
          details = j?.details || j?.error || JSON.stringify(j);
        } catch {
          details = await res.text();
        }

        // Cas fréquent : endpoint pas encore créé
        if (res.status === 404) {
          throw new Error(
            "Le mode 'Corriger un brouillon' n’est pas encore activé côté backend (endpoint /premium/rewrite). " +
              "Dis-moi et je te fournis le handler Express prêt-à-coller (upload + extraction + génération PDF)."
          );
        }

        throw new Error(details || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const fname = `${safeFilename(form.companyName)}_BusinessPlan_CORRIGE_${prettyDate()}.pdf`;
      setPersistentDownload("rewrite", blob, fname);

      stopFakeProgress("Téléchargement prêt ✅");
      setSuccessHint("Ton brouillon a été corrigé et converti en version professionnelle.");
    } catch (err) {
      const msg =
        err?.name === "AbortError"
          ? "La correction a dépassé le délai (15 min). Réessaie ou colle uniquement le résumé (mode Lite)."
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

  function fillExample() {
    setForm((prev) => ({
      ...prev,
      companyName: prev.companyName || "KINSHASA MODERN FITNESS",
      country: prev.country || "RDC",
      city: prev.city || "Kinshasa",
      sector: prev.sector || "Fitness & bien-être",
      mission: prev.mission || "Rendre le sport accessible et moderne à Kinshasa.",
      problem: prev.problem || "Manque de salles équipées, coaching fiable, hygiène et suivi.",
      solution:
        prev.solution ||
        "Salle de gym moderne avec coaching, abonnements flexibles, programmes santé, suivi digital.",
      product:
        prev.product ||
        "Salle équipée (musculation/cardio), coaching personnalisé, cours collectifs, nutrition, douches, boutique.",
      customers:
        prev.customers ||
        "Jeunes actifs, cadres, étudiants, femmes (programmes bien-être), entreprises (abonnements B2B).",
      market:
        prev.market ||
        "Kinshasa (Gombe, Ngaliema, Limete…), extension possible vers Matete/Kasa-Vubu selon traction.",
      competition:
        prev.competition ||
        "Salles existantes (souvent peu équipées) + coachings informels. Différenciation : qualité, sécurité, suivi.",
      differentiation:
        prev.differentiation ||
        "Hygiène, équipements modernes, coachs certifiés, suivi, application/WhatsApp de coaching, offres B2B.",
strategicPartnerships:
  prev.strategicPartnerships ||
  "Partenaires : fournisseurs d’équipements, nutritionnistes, entreprises (abonnements), influenceurs fitness, assurances santé, banques/IMF (financement).",
      pricing:
        prev.pricing ||
        "Abonnements mensuels + packs 3/6/12 mois, séances coaching premium, cours collectifs inclus ou add-on.",
      channels:
        prev.channels ||
        "Réseaux sociaux, partenariats entreprises, influenceurs fitness, affichage local, parrainage clients.",
      operations:
        prev.operations ||
        "Local sécurisé, équipements importés, maintenance mensuelle, staff (coach, accueil, ménage), horaires étendus.",
      team:
        prev.team ||
        "Fondateur + manager, 2 coachs, 1 accueil, 1 ménage, partenariats nutritionnistes.",
      traction:
        prev.traction ||
        "Pré-inscriptions via WhatsApp, partenariats entreprises en négociation, test gratuit 7 jours.",
      risks:
        prev.risks ||
        "Coûts d’équipements, instabilité énergie, sécurité. Mitigation : groupe électrogène/solaire, gardiennage, contrats maintenance.",
      finAssumptions:
        prev.finAssumptions ||
        "Hypothèses : croissance abonnés progressive, panier moyen stable, coûts fixes maîtrisés, marge améliorée via coaching premium.",
      fundingAsk:
        prev.fundingAsk ||
        "Financement pour équipements, aménagement, marketing lancement, fonds de roulement (3–6 mois).",
    }));
  }

  function resetForm() {
    if (!confirm("Réinitialiser le formulaire ?")) return;
    localStorage.removeItem("bp_premium_form_v3");
    window.location.reload();
  }

  const audienceHint = AUDIENCES.find((a) => a.value === form.audience)?.hint;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">
              Rédaction Business Plan (Professionnel)
            </h1>
            <p className="text-slate-300 mt-2">
              Remplis simplement — le système génère un document premium (niveau banque / investisseur).
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fillExample}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-slate-200 hover:bg-slate-900"
              disabled={loading}
              title="Pré-remplir avec un exemple"
            >
              Remplir un exemple
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-slate-200 hover:bg-slate-900"
              disabled={loading}
              title="Réinitialiser"
            >
              Réinitialiser
            </button>
          </div>
        </div>

        {/* Mode switch */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode("generate")}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === "generate"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-slate-800 bg-slate-900/40 hover:bg-slate-900/60"
            }`}
            disabled={loading}
          >
            <div className="font-semibold">1) Générer un Business Plan complet</div>
            <div className="text-sm text-slate-300 mt-1">
              Recommandé si tu n’as pas encore de document.
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode("rewrite")}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === "rewrite"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-slate-800 bg-slate-900/40 hover:bg-slate-900/60"
            }`}
            disabled={loading}
          >
            <div className="font-semibold">2) Corriger un brouillon existant</div>
            <div className="text-sm text-slate-300 mt-1">
              Importer ton fichier (PDF/DOCX) et obtenir une version premium.
            </div>
          </button>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            <div className="font-semibold">Erreur</div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{error}</div>
          </div>
        ) : null}

        {successHint ? (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100">
            <div className="font-semibold">Succès</div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{successHint}</div>
          </div>
        ) : null}

        {/* Controls top (common) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 md:p-6 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Select
              label="Langue"
              value={form.lang}
              onChange={(v) => updateField("lang", v)}
              disabled={loading}
              options={[
                { value: "fr", label: "Français" },
                { value: "en", label: "English" },
              ]}
            />

            <Select
              label="Audience (pour qui ?)"
              value={form.audience}
              onChange={(v) => updateField("audience", v)}
              disabled={loading}
              options={AUDIENCES.map((a) => ({ value: a.value, label: a.label }))}
              hint={audienceHint}
            />

            <Select
              label="Type de dossier"
              value={form.docType}
              onChange={(v) => updateField("docType", v)}
              disabled={loading}
              options={DOCTYPES}
            />

            <div>
              <label className="text-sm text-slate-300">Sortie</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    true
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                      : "border-slate-800 bg-slate-950 text-slate-300"
                  }`}
                  disabled
                  title="PDF est la sortie stable (production)."
                >
                  PDF (stable)
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-500"
                  disabled
                  title="DOCX désactivé pour stabilité (réactivation plus tard)."
                >
                  DOCX (bientôt)
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Sortie actuelle : <b>PDF</b>.
              </p>
            </div>
          </div>

          {/* Lite + progress */}
          <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.lite}
                onChange={(e) => updateField("lite", e.target.checked)}
                disabled={loading}
              />
              Mode Lite (plus rapide)
              <span className="text-slate-400 text-xs">(réduit certaines sections)</span>
            </label>

            {loading ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-slate-200 hover:bg-slate-900"
              >
                Annuler
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>{statusText || "Traitement en cours…"}</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-slate-800">
                <div
                  className="h-2 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* MODE 1: GENERATE */}
        {mode === "generate" ? (
          <form onSubmit={onSubmitGenerate} className="mt-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 md:p-6 shadow-xl">
              <SectionTitle
                title="A) Informations simples"
                subtitle="Commence ici. Même si tu ne sais pas tout, remplis le maximum."
              />

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  label="Nom de l’entreprise *"
                  value={form.companyName}
                  onChange={(v) => updateField("companyName", v)}
                  disabled={loading}
                  placeholder="Ex: GOMA LUXURY GEMS"
                />

                <Field
                  label="Secteur (activité) *"
                  value={form.sector}
                  onChange={(v) => updateField("sector", v)}
                  disabled={loading}
                  placeholder="Ex: Joaillerie & objets de luxe"
                />

                <Field
                  label="Pays"
                  value={form.country}
                  onChange={(v) => updateField("country", v)}
                  disabled={loading}
                  placeholder="RDC"
                />

                <Field
                  label="Ville(s) d’activité"
                  value={form.city}
                  onChange={(v) => updateField("city", v)}
                  disabled={loading}
                  placeholder="Ex: Kinshasa, Matadi, Goma..."
                />

                <div>
                  <label className="text-sm text-slate-300">Stade de l’entreprise</label>
                  <select
                    className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100"
                    value={form.stage}
                    onChange={(e) => updateField("stage", e.target.value)}
                    disabled={loading}
                  >
                    {STAGES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">
                    {STAGES.find((s) => s.value === form.stage)?.hint || ""}
                  </p>
                </div>

                <div>
                  <label className="text-sm text-slate-300">Type d’entreprise (optionnel)</label>
                  <div className="mt-1 flex flex-col gap-2">
                    <div className="flex gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                        <input
                          type="radio"
                          name="companyTypeMode"
                          checked={form.companyTypeMode === "preset"}
                          onChange={() => updateField("companyTypeMode", "preset")}
                          disabled={loading}
                        />
                        Choisir dans la liste
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                        <input
                          type="radio"
                          name="companyTypeMode"
                          checked={form.companyTypeMode === "free"}
                          onChange={() => updateField("companyTypeMode", "free")}
                          disabled={loading}
                        />
                        Saisir moi-même
                      </label>
                    </div>

                    {form.companyTypeMode === "preset" ? (
                      <select
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100"
                        value={form.companyTypePreset}
                        onChange={(e) => updateField("companyTypePreset", e.target.value)}
                        disabled={loading}
                      >
                        {COMPANY_TYPE_PRESETS.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-600"
                        value={form.companyTypeFree}
                        onChange={(e) => updateField("companyTypeFree", e.target.value)}
                        disabled={loading}
                        placeholder="Ex: SARL (en création) / Auto-entrepreneur / Coop..."
                      />
                    )}

                    {form.companyTypeMode === "preset" && form.companyTypePreset === "Autre" ? (
                      <input
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-600"
                        value={form.companyTypeFree}
                        onChange={(e) => updateField("companyTypeFree", e.target.value)}
                        disabled={loading}
                        placeholder="Précise ici (ex: SARL en cours d’immatriculation)"
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <SectionTitle
                  title="B) Ton projet expliqué simplement"
                  subtitle="Ces champs sont formulés pour être faciles à comprendre."
                />
                <div className="mt-4 grid grid-cols-1 gap-4">
                  <Area
                    label="Mission (en 1 phrase)"
                    value={form.mission}
                    onChange={(v) => updateField("mission", v)}
                    disabled={loading}
                    placeholder="Ex: Offrir des bijoux artisanaux haut de gamme à base de pierres du Kivu."
                  />
                  <Area
                    label="Problème que tu veux résoudre"
                    value={form.problem}
                    onChange={(v) => updateField("problem", v)}
                    disabled={loading}
                    placeholder="Ex: Les produits de luxe locaux manquent de standard qualité/export."
                  />
                  <Area
                    label="Solution (ce que tu apportes)"
                    value={form.solution}
                    onChange={(v) => updateField("solution", v)}
                    disabled={loading}
                    placeholder="Ex: Production locale + design moderne + traçabilité + finitions premium."
                  />
                  <Area
                    label="Produit / service (détails) *"
                    value={form.product}
                    onChange={(v) => updateField("product", v)}
                    disabled={loading}
                    placeholder="Décris ce que tu vends, comment c’est fabriqué, et ce qui le rend unique."
                  />
                </div>
              </div>

              <div className="mt-8">
                <SectionTitle title="C) Clients, marché, concurrence" subtitle="Même approximatif, c’est utile." />
                <div className="mt-4 grid grid-cols-1 gap-4">
                  <Area
                    label="Clients (qui achète ?)"
                    value={form.customers}
                    onChange={(v) => updateField("customers", v)}
                    disabled={loading}
                    placeholder="Ex: cadres, diaspora, hôtels, boutiques premium, exportateurs…"
                  />
                  <Area
                    label="Marché / zone"
                    value={form.market}
                    onChange={(v) => updateField("market", v)}
                    disabled={loading}
                    placeholder="Ex: Goma puis Kinshasa, puis export via partenaires."
                  />
                  <Area
                    label="Concurrents"
                    value={form.competition}
                    onChange={(v) => updateField("competition", v)}
                    disabled={loading}
                    placeholder="Qui fait déjà quelque chose de similaire ?"
                  />
                  <Area
                    label="Ton avantage / différenciation"
                    value={form.differentiation}
                    onChange={(v) => updateField("differentiation", v)}
                    disabled={loading}
                    placeholder="Pourquoi toi plutôt qu’un autre ? (qualité, prix, vitesse, réseau, traçabilité, etc.)"
                  />
                </div>
              </div>

              <div className="mt-8">
                <SectionTitle
                  title="D) Comment tu vas gagner de l’argent"
                  subtitle="Le système a besoin de comprendre tes prix, ventes et canaux."
                />
                <div className="mt-4 grid grid-cols-1 gap-4">
                  <Area
                    label="Prix / tarification"
                    value={form.pricing}
                    onChange={(v) => updateField("pricing", v)}
                    disabled={loading}
                    placeholder="Ex: ventes à l’unité + commandes B2B + commissions export."
                  />
                  <Area
                    label="Canaux de vente"
                    value={form.channels}
                    onChange={(v) => updateField("channels", v)}
                    disabled={loading}
                    placeholder="Ex: boutique, partenaires, réseaux sociaux, entreprises, export, etc."
                  />
<Area
  label="Partenariats stratégiques (optionnel)"
  value={form.strategicPartnerships}
  onChange={(v) => updateField("strategicPartnerships", v)}
  disabled={loading}
  placeholder="Ex: fournisseurs clés, distributeurs, supermarchés, institutions, banques/IMF, incubateurs, partenaires techniques…"
/>

                  <Area
                    label="Opérations (production, livraison, équipe…)"
                    value={form.operations}
                    onChange={(v) => updateField("operations", v)}
                    disabled={loading}
                    placeholder="Ex: atelier, fournisseurs, machines, logistique, qualité, sécurité, énergie…"
                  />
                  <Area
                    label="Équipe (qui fait quoi ?)"
                    value={form.team}
                    onChange={(v) => updateField("team", v)}
                    disabled={loading}
                    placeholder="Ex: fondateur + manager atelier + artisan + commercial + comptable…"
                  />
                  <Area
                    label="Traction (preuves / avancées)"
                    value={form.traction}
                    onChange={(v) => updateField("traction", v)}
                    disabled={loading}
                    placeholder="Ex: ventes actuelles, clients pilotes, partenariats, précommandes…"
                  />
                </div>
              </div>

              <div className="mt-8">
                <SectionTitle title="E) Risques & finances" subtitle="Tu peux rester simple, le système complète." />
                <div className="mt-4 grid grid-cols-1 gap-4">
                  <Area
                    label="Risques (et comment tu les réduis)"
                    value={form.risks}
                    onChange={(v) => updateField("risks", v)}
                    disabled={loading}
                    placeholder="Ex: énergie, taux de change, sécurité, import, concurrence… + solutions."
                  />
                  <Area
                    label="Hypothèses financières"
                    value={form.finAssumptions}
                    onChange={(v) => updateField("finAssumptions", v)}
                    disabled={loading}
                    placeholder="Volumes, prix, marge, coûts, croissance… (même estimé)."
                  />
                  <Area
                    label="Besoin de financement"
                    value={form.fundingAsk}
                    onChange={(v) => updateField("fundingAsk", v)}
                    disabled={loading}
                    placeholder="Montant, utilisation des fonds, calendrier, garanties (si banque)."
                  />
                </div>
              </div>

              <details className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <summary className="cursor-pointer text-slate-200 font-semibold">
                  Conseils pour bien remplir (clique)
                </summary>
                <div className="mt-3 text-sm text-slate-300 space-y-2">
                  <p>• Ne cherche pas la perfection : écris simple, le système professionnalise.</p>
                  <p>• Si tu ne sais pas un chiffre, donne une estimation + explique ton raisonnement.</p>
                  <p>• Pour une banque, insiste sur : cashflow, garanties, risques, capacité de remboursement.</p>
                  <p>• Si ça timeout : active Mode Lite et raccourcis les textes.</p>
                </div>
              </details>

              <div className="mt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div className="text-xs text-slate-400">
                  Sortie actuelle : <b>PDF</b> (stable production).
                </div>

                <div className="flex flex-col items-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-xl bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {loading ? "Génération…" : "Générer & Télécharger"}
                  </button>

                  {/* Progress bar (14 minutes fake progress) */}
                  {loading ? (
                    <div className="mt-3 w-[260px] max-w-full">
                      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-2 text-xs text-slate-300">
                        {statusText ? `${statusText} ` : ""}{progress ? `${progress}%` : ""}
                      </div>
                    </div>
                  ) : null}

                  {/* Re-download last generated PDF (no regeneration) */}
                  {lastGenerateFile?.url && !loading ? (
                    <button
                      type="button"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = lastGenerateFile.url;
                        a.download = lastGenerateFile.name || "business-plan-premium.pdf";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }}
                      className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
                    >
                      Télécharger
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
        ) : null}

        {/* MODE 2: REWRITE */}
        {mode === "rewrite" ? (
          <form onSubmit={onSubmitRewrite} className="mt-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 md:p-6 shadow-xl">
              <SectionTitle
                title="Corriger un brouillon existant"
                subtitle="Importe ton PDF/DOCX. Le système corrige, complète et te renvoie une version premium."
              />

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  label="Nom de l’entreprise *"
                  value={form.companyName}
                  onChange={(v) => updateField("companyName", v)}
                  disabled={loading}
                  placeholder="Ex: KINSHASA MODERN SHOES"
                />
                <Field
                  label="Secteur (optionnel mais utile)"
                  value={form.sector}
                  onChange={(v) => updateField("sector", v)}
                  disabled={loading}
                  placeholder="Ex: Cordonnerie moderne"
                />
                <Field
                  label="Ville(s)"
                  value={form.city}
                  onChange={(v) => updateField("city", v)}
                  disabled={loading}
                  placeholder="Kinshasa"
                />
                <div>
                  <label className="text-sm text-slate-300">Stade</label>
                  <select
                    className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100"
                    value={form.stage}
                    onChange={(e) => updateField("stage", e.target.value)}
                    disabled={loading}
                  >
                    {STAGES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">
                    {STAGES.find((s) => s.value === form.stage)?.hint || ""}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="font-semibold text-slate-200">1) Importer un fichier</div>
                <p className="mt-1 text-sm text-slate-400">
                  Formats acceptés : PDF ou DOCX. (Si l’endpoint backend n’est pas activé, tu verras un message clair.)
                </p>

                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) => setDraftFile(e.target.files?.[0] || null)}
                    disabled={loading}
                    className="block w-full text-sm text-slate-200 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-slate-100 hover:file:bg-slate-700"
                  />
                  {draftFile ? (
                    <div className="text-xs text-slate-300">
                      Fichier sélectionné : <span className="font-mono">{draftFile.name}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Aucun fichier sélectionné.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="font-semibold text-slate-200">2) Ou coller le texte du brouillon</div>
                <p className="mt-1 text-sm text-slate-400">
                  Si tu n’arrives pas à uploader, copie/colle le contenu ici (même partiel).
                </p>
                <textarea
                  className="mt-2 min-h-[160px] w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-600"
                  value={form.rewriteTextFallback}
                  onChange={(e) => updateField("rewriteTextFallback", e.target.value)}
                  disabled={loading}
                  placeholder="Colle ici le texte de ton business plan (même incomplet)."
                />
                <div className="mt-1 text-xs text-slate-500">
                  {String(form.rewriteTextFallback || "").length} caractères
                </div>
              </div>

              <div className="mt-4">
                <Area
                  label="Notes (ce que tu veux améliorer)"
                  value={form.rewriteNotes}
                  onChange={(v) => updateField("rewriteNotes", v)}
                  disabled={loading}
                  placeholder="Ex: adapter pour banque, corriger finances, ajouter SWOT, rendre plus professionnel, etc."
                />
              </div>

              <div className="mt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div className="text-xs text-slate-400">
                  Sortie : <b>PDF</b> (stable production).
                </div>

                <div className="flex flex-col items-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-xl bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {loading ? "Correction…" : "Corriger & Télécharger"}
                  </button>

                  {/* Progress bar (14 minutes fake progress) */}
                  {loading ? (
                    <div className="mt-3 w-[260px] max-w-full">
                      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-2 text-xs text-slate-300">
                        {statusText ? `${statusText} ` : ""}{progress ? `${progress}%` : ""}
                      </div>
                    </div>
                  ) : null}

                  {/* Re-download last corrected PDF (no regeneration) */}
                  {lastRewriteFile?.url && !loading ? (
                    <button
                      type="button"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = lastRewriteFile.url;
                        a.download = lastRewriteFile.name || "business-plan-corrige.pdf";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }}
                      className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
                    >
                      Télécharger
                    </button>
                  ) : null}
                </div>
              </div>

              <details className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <summary className="cursor-pointer text-slate-200 font-semibold">
                  Important (clique) — comment ça marche
                </summary>
                <div className="mt-3 text-sm text-slate-300 space-y-2">
                  <p>• Le système réécrit ton document en format premium (banque/investisseur/incubateur).</p>
                  <p>• Il corrige la structure, comble les sections manquantes, et harmonise le style.</p>
                  <p>• Si le backend /premium/rewrite n’est pas encore installé : je te donne le handler Express + extraction PDF/DOCX prêt à coller.</p>
                </div>
              </details>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/* -----------------------
   UI helpers
----------------------- */

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <div className="text-lg font-semibold text-slate-100">{title}</div>
      {subtitle ? <div className="text-sm text-slate-400 mt-1">{subtitle}</div> : null}
    </div>
  );
}

function Select({ label, value, onChange, disabled, options, hint }) {
  return (
    <div>
      <label className="text-sm text-slate-300">{label}</label>
      <select
        className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <div>
      <label className="text-sm text-slate-300">{label}</label>
      <input
        className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-600"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  );
}

function Area({ label, value, onChange, disabled, placeholder }) {
  return (
    <div>
      <label className="text-sm text-slate-300">{label}</label>
      <textarea
        className="mt-1 min-h-[110px] w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-600"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  );
}
