// src/pages/JusticeLab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CASES,
  generateCase, // (laissé pour compat si utilisé ailleurs / futur)
  generateCaseAIByDomain,
  importCaseFromDocumentText,
  listGeneratedCases,
} from "../justiceLab/cases";

const MAX_DYNAMIC_VISIBLE = 24;

// ✅ Base Render analyse par défaut (si VITE_ANALYSE_BASE absent)
const DEFAULT_ANALYSE_BASE = "https://droitgpt-analysepdf.onrender.com";

function formatDomainLabel(d) {
  const map = {
    "": "Auto (selon le contenu)",
    penal: "Pénal",
    foncier: "Foncier",
    travail: "Travail",
    ohada: "OHADA (Commercial / Sociétés)",
    constitutionnel: "Constitutionnel",
    administratif: "Administratif",
    civil: "Civil",
    famille: "Famille",
    fiscal: "Fiscal",
    douanier: "Douanier",
    minier: "Minier",
    militaire: "Pénal militaire",
    environnement: "Environnement",
    routier: "Routier / Circulation",
    immobilier: "Immobilier",
    bancaire: "Bancaire / Finance",
    "droit-des-affaires": "Droit des affaires",
    "propriete-intellectuelle": "Propriété intellectuelle",
  };
  return map[d] || d || "—";
}

function badgeForLevel(level) {
  if (level === "avancé") return "bg-rose-500/15 text-rose-200 border-rose-500/40";
  if (level === "intermédiaire") return "bg-amber-500/15 text-amber-200 border-amber-500/40";
  return "bg-emerald-500/15 text-emerald-200 border-emerald-500/40";
}

function safeUpper(v) {
  return String(v || "").toUpperCase();
}

function getApiBase() {
  const base =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
    "https://droitgpt-indexer.onrender.com";
  return String(base).replace(/\/$/, "");
}

function getAnalyseBase() {
  /**
   * ✅ FIX CRITIQUE:
   * - si VITE_ANALYSE_BASE est défini => on l’utilise
   * - sinon => on force le service Render officiel (DEFAULT_ANALYSE_BASE)
   * (évite les 404 si Vercel ne charge pas les envs)
   */
  const base =
    (typeof import.meta !== "undefined" &&
      (import.meta.env?.VITE_ANALYSE_BASE || import.meta.env?.VITE_ANALYSE_URL)) ||
    "";

  const resolved = base && String(base).trim() !== "" ? base : DEFAULT_ANALYSE_BASE;
  return String(resolved).replace(/\/$/, "");
}

export default function JusticeLab() {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  // ✅ AbortController import (évite "signal is aborted without reason")
  const importAbortRef = useRef(null);

  const baseCases = Array.isArray(CASES) ? CASES : [];

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // ✅ Progress bar (Générer dossier) — 12s minimum + remplissage vert
  const [createProgress, setCreateProgress] = useState(0);
  const createProgressTimerRef = useRef(null);

  // ✅ Progress bar (Importer dossier réel) — 12s minimum + remplissage vert
  const [importProgress, setImportProgress] = useState(0);
  const importProgressTimerRef = useRef(null);

  // Générateur
  const [selectedDomain, setSelectedDomain] = useState(""); // "" = auto
  const [selectedLevel, setSelectedLevel] = useState("débutant");
  const [casePrompt, setCasePrompt] = useState("");

  // Import PDF
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  // Mode Examen
  const [examMode, setExamMode] = useState(() => {
    try {
      return localStorage.getItem("justicelab_exam_mode") === "1";
    } catch {
      return false;
    }
  });

  // Dossiers IA (cache)
  const [dynamicCases, setDynamicCases] = useState([]);

  // Recherche / filtres
  const [q, setQ] = useState("");
  const [filterDomain, setFilterDomain] = useState("all");
  const [filterLevel, setFilterLevel] = useState("all");

  useEffect(() => {
    const gen = listGeneratedCases?.({ limit: MAX_DYNAMIC_VISIBLE }) || [];
    setDynamicCases(Array.isArray(gen) ? gen.slice(0, MAX_DYNAMIC_VISIBLE) : []);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("justicelab_exam_mode", examMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [examMode]);

  const counts = useMemo(() => {
    const localCount = baseCases.length || 0; // attendu: 24
    const aiCount = (dynamicCases || []).length || 0;
    return { localCount, aiCount };
  }, [baseCases, dynamicCases]);

  const allCases = useMemo(() => {
    // IA d’abord (plus récent), puis locaux
    return [...(dynamicCases || []), ...(baseCases || [])];
  }, [dynamicCases, baseCases]);

  // ✅ FIX: enlever doublon -> plus de warning keys React
  const domains = useMemo(() => {
    return [
      "",
      "penal",
      "foncier",
      "travail",
      "ohada",
      "constitutionnel",
      "administratif",
      "civil",
      "famille",
      "fiscal",
      "douanier",
      "minier",
      "militaire",
      "environnement",
      "routier",
      "immobilier",
      "bancaire",
      "droit-des-affaires",
      "propriete-intellectuelle",
    ];
  }, []);

  const filteredCases = useMemo(() => {
    const query = q.trim().toLowerCase();

    return allCases
      .filter((c) => {
        const domOk = filterDomain === "all" ? true : c?.domain === filterDomain;
        const lvlOk =
          filterLevel === "all" ? true : (c?.level || "débutant") === filterLevel;

        const text = [
          c?.title,
          c?.summary,
          c?.domain,
          c?.city,
          c?.jurisdiction,
          c?.caseNumber,
          c?.id,
          c?.caseId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const qOk = !query ? true : text.includes(query);
        return domOk && lvlOk && qOk;
      })
      .slice(0, 60);
  }, [allCases, q, filterDomain, filterLevel]);

  function openCase(caseId) {
    const id = encodeURIComponent(caseId);
    const qs = examMode ? "?mode=exam" : "";
    navigate(`/justice-lab/play/${id}${qs}`);
  }

  async function handleGenerate() {
    setCreateError("");
    setCreating(true);

    // ✅ progress bar : démarre immédiatement (12s minimum)
    const MIN_MS = 20000;
    const startAt = Date.now();
    setCreateProgress(0);
    if (createProgressTimerRef.current) {
      clearInterval(createProgressTimerRef.current);
      createProgressTimerRef.current = null;
    }
    createProgressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startAt;
      const pct = Math.min(95, Math.round((elapsed / MIN_MS) * 100));
      setCreateProgress((prev) => (pct > prev ? pct : prev));
    }, 120);

    try {
      const prompt = casePrompt.trim();

      // Domaine: si "Auto", on infère grossièrement depuis le texte (fallback sûr)
      const inferDomainFromPrompt = (text) => {
        const t = String(text || "").toLowerCase();
        if (
          t.includes("parcelle") ||
          t.includes("terrain") ||
          t.includes("concession") ||
          t.includes("titre foncier")
        )
          return "foncier";
        if (
          t.includes("licenci") ||
          t.includes("salaire") ||
          t.includes("contrat de travail") ||
          t.includes("employ")
        )
          return "travail";
        if (
          t.includes("societ") ||
          t.includes("ohada") ||
          t.includes("commerce") ||
          t.includes("registre") ||
          t.includes("rc")
        )
          return "ohada";
        if (t.includes("impot") || t.includes("tax") || t.includes("dgi") || t.includes("fiscal"))
          return "fiscal";
        if (
          t.includes("douane") ||
          t.includes("dgda") ||
          t.includes("déclaration") ||
          t.includes("import")
        )
          return "douanier";
        if (t.includes("minier") || t.includes("cobalt") || t.includes("cuivre") || t.includes("permis"))
          return "minier";
        if (t.includes("divorce") || t.includes("succession") || t.includes("mariage") || t.includes("pension"))
          return "famille";
        if (t.includes("accident") || t.includes("dommages") || t.includes("responsabilit"))
          return "civil";
        return "penal";
      };

      const domainSlug = selectedDomain || inferDomainFromPrompt(prompt);
      const domaineLabel = formatDomainLabel(domainSlug);

      // ✅ génération via backend (dossier unique + difficulté choisie)
      const newCase = await generateCaseAIByDomain({
        domaine: domaineLabel,
        level:
          selectedLevel === "débutant"
            ? "Débutant"
            : selectedLevel === "avancé"
            ? "Avancé"
            : "Intermédiaire",
        apiBase: getApiBase(),
        timeoutMs: 25000,
        lang: "fr",
        prompt,
      });

      if (!newCase?.caseId)
        throw new Error("Le backend a renvoyé un dossier invalide (caseId manquant).");

      // Rafraîchit le cache IA visible
      const gen = listGeneratedCases?.({ limit: MAX_DYNAMIC_VISIBLE }) || [];
      setDynamicCases(Array.isArray(gen) ? gen.slice(0, MAX_DYNAMIC_VISIBLE) : []);

      // ✅ garantit 12s minimum (UX)
      const elapsed = Date.now() - startAt;
      const remain = Math.max(0, MIN_MS - elapsed);
      if (remain) await new Promise((r) => setTimeout(r, remain));

      // stop timer + force 100%
      if (createProgressTimerRef.current) {
        clearInterval(createProgressTimerRef.current);
        createProgressTimerRef.current = null;
      }
      setCreateProgress(100);

      openCase(newCase.caseId);
    } catch (e) {
      setCreateError(e?.message || "Erreur lors de la génération du dossier (backend).");
      setCreateProgress(0);
    } finally {
      if (createProgressTimerRef.current) {
        clearInterval(createProgressTimerRef.current);
        createProgressTimerRef.current = null;
      }
      setCreating(false);
    }
  }

  // ✅ Import dossier réel (PDF/DOCX)
  async function handleImportPdf(file) {
    setImportError("");
    if (!file) return;

    // Annule l’import précédent si l’utilisateur relance (évite abort “sans raison”)
    try {
      if (importAbortRef.current) importAbortRef.current.abort();
    } catch {}
    importAbortRef.current = new AbortController();
    const { signal } = importAbortRef.current;

    const ext = String(file.name || "").toLowerCase();
    const isPdf = ext.endsWith(".pdf");
    const isDocx = ext.endsWith(".docx");
    if (!isPdf && !isDocx) {
      setImportError("Format non supporté. Importer un PDF ou un DOCX.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setImporting(true);

    // ✅ progress bar : démarre immédiatement (12s minimum)
    const MIN_MS = 20000;
    const startAt = Date.now();
    setImportProgress(0);
    if (importProgressTimerRef.current) {
      clearInterval(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    importProgressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startAt;
      const pct = Math.min(95, Math.round((elapsed / MIN_MS) * 100));
      setImportProgress((prev) => (pct > prev ? pct : prev));
    }, 120);

    try {
      // 1) Extraction (analyse-service)
      const analyseBase = getAnalyseBase();

      const candidates = [
        `${analyseBase}/analyse/extract`,
        `${analyseBase}/extract`,
        `${analyseBase}/analyse-document/extract`,
      ];

      async function tryExtract(url) {
  // ✅ nouveau FormData pour chaque tentative (body consommable)
  const fd = new FormData();
  fd.append("file", file);

  // ✅ timeout dur (sinon progress reste bloqué si service ne répond pas)
  const TIMEOUT_MS = 45000;
  const fetchPromise = fetch(url, { method: "POST", body: fd, signal });

  const r = await Promise.race([
    fetchPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`EXTRACT_TIMEOUT_${TIMEOUT_MS}`)), TIMEOUT_MS)
    ),
  ]);

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    const err = new Error(`EXTRACT_HTTP_${r.status}: ${txt.slice(0, 200)}`);
    err.status = r.status;
    err.body = txt;
    throw err;
  }
  return r.json();
}

      let extracted = null;
      let lastErr = null;
      for (const url of candidates) {
        try {
          extracted = await tryExtract(url);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!extracted) throw lastErr || new Error("EXTRACT_FAILED");

      const documentText = extracted?.documentText || extracted?.text || extracted?.content || extracted?.data?.documentText || "";
      if (!documentText || String(documentText).trim().length < 20) {
        throw new Error("Texte extrait trop court ou vide.");
      }

      // 2) Génération du dossier jouable (backend JusticeLab)
let imported = null;

// 2) Génération du dossier jouable (backend JusticeLab) + fallback local si indisponible
try {
  imported = await importCaseFromDocumentText({
        documentText,
        filename: file.name,
        domain: selectedDomain || "",
        level:
          selectedLevel === "débutant"
            ? "Débutant"
            : selectedLevel === "avancé"
            ? "Avancé"
            : "Intermédiaire",
        apiBase: getApiBase(),
        lang: "fr",
      });
} catch (err) {
  // fallback local: construit un dossier jouable uniquement depuis le texte extrait
  imported = await importCaseFromDocumentText({
    documentText,
    filename: file.name,
    domain: selectedDomain || "",
    level:
      selectedLevel === "débutant"
        ? "Débutant"
        : selectedLevel === "avancé"
        ? "Avancé"
        : "Intermédiaire",
    ai: false,
    apiBase: getApiBase(),
    lang: "fr",
  });
}


      const elapsed = Date.now() - startAt;
      const remain = Math.max(0, MIN_MS - elapsed);
      if (remain) await new Promise((res) => setTimeout(res, remain));

      // stop timer + force 100%
      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportProgress(100);

      // Rafraîchit le cache IA visible
      const gen = listGeneratedCases?.({ limit: MAX_DYNAMIC_VISIBLE }) || [];
      setDynamicCases(Array.isArray(gen) ? gen.slice(0, MAX_DYNAMIC_VISIBLE) : []);

      const caseId = imported?.caseId || imported?.id;
      if (!caseId) throw new Error("Dossier importé invalide (caseId manquant).");
      openCase(caseId);
    } catch (e) {
      // ✅ Si abort: on ignore (nouveau fichier / navigation / relance)
      if (e?.name === "AbortError") return;
      setImportError(e?.message || "Impossible d’importer le dossier.");
      setImportProgress(0);
    } finally {
      importAbortRef.current = null;

      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800/70 bg-slate-950/70 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] tracking-[0.25em] uppercase text-slate-400">
              DROITGPT • JUSTICE LAB
            </div>
            <div className="text-lg md:text-xl font-semibold">Simulateur judiciaire intelligent</div>
            <div className="text-xs text-slate-400 mt-1">Gameplay • Réalisme • Pédagogie • Évaluation</div>

            {/* ✅ Badges Local vs IA */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] px-2 py-1 rounded-full border border-slate-700 bg-slate-900/40 text-slate-200">
                🔹 Dossiers locaux ({counts.localCount})
              </span>
              <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                🤖 Dossiers IA ({counts.aiCount})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link className="text-xs text-slate-300 hover:text-white" to="/">
              Accueil
            </Link>
            <Link className="text-xs text-slate-300 hover:text-white" to="/chat">
              Chat juridique
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 md:px-8 py-6">
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Left: Générateur + Import + Examen */}
          <div className="lg:col-span-1 space-y-4">
            {/* Générateur */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">✨ Générateur de dossier</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Domaine optionnel. Si “Auto”, le contenu guide le type de dossier.
                  </div>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                  IA / Hybrid
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Domaine (optionnel)</div>
                  <select
                    value={selectedDomain}
                    onChange={(e) => setSelectedDomain(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
                  >
                    {domains.map((d) => (
                      <option key={d || "auto"} value={d}>
                        {formatDomainLabel(d)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-1">Niveau</div>
                  <select
                    value={selectedLevel}
                    onChange={(e) => setSelectedLevel(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
                  >
                    <option value="débutant">Débutant</option>
                    <option value="intermédiaire">Intermédiaire</option>
                    <option value="avancé">Avancé</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-1">Contenu du dossier (texte libre)</div>
                  <textarea
                    value={casePrompt}
                    onChange={(e) => setCasePrompt(e.target.value)}
                    placeholder="Décris les faits, parties, pièces, lieu, dates, enjeux…"
                    rows={6}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none resize-none"
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    Astuce : plus tu donnes de détails, plus le dossier sera réaliste.
                  </div>
                </div>

                {createError ? (
                  <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                    {createError}
                  </div>
                ) : null}

                <button
                  onClick={handleGenerate}
                  disabled={creating}
                  className="w-full rounded-xl bg-emerald-500 text-white py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-60"
                >
                  {creating ? "Génération..." : "Générer un dossier"}
                </button>

                {/* ✅ Progress bar pendant la génération backend */}
                {creating ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span>Génération du dossier (backend)...</span>
                      <span>{Math.min(100, Math.max(0, createProgress || 0))}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-900/70 border border-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-150"
                        style={{ width: `${Math.min(100, Math.max(0, createProgress || 0))}%` }}
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">Attente backend (minimum 12s)...</div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* ✅ Import PDF */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="text-sm font-semibold">📎 Importer un dossier réel (PDF / Word)</div>
              <div className="text-xs text-slate-400 mt-1">
                Ajoute un PDF ou un Word (.docx) : on extrait le texte puis on génère un dossier jouable basé sur ce contenu.
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => handleImportPdf(e.target.files?.[0])}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                  className="rounded-xl border border-slate-700 bg-slate-900/40 hover:bg-white/5 px-3 py-2 text-xs"
                >
                  {importing ? "Import..." : "Choisir un fichier"}
                </button>

                <span className="text-[11px] text-slate-500">
                  Extraction + génération via backend (≈12s)
                </span>
              </div>

              {importError ? (
                <div className="mt-3 text-xs text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                  {importError}
                </div>
              ) : null}

              {/* ✅ Progress bar (12s minimum) pendant l'import + génération */}
              {importing ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span>Import + génération du dossier...</span>
                    <span>{Math.min(100, Math.max(0, importProgress || 0))}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-slate-900/70 border border-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-150"
                      style={{ width: `${Math.min(100, Math.max(0, importProgress || 0))}%` }}
                    />
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">Attente backend (minimum 12s)...</div>
                </div>
              ) : null}
            </div>

            {/* ✅ Mode Examen */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">🎓 Mode Examen ENM / Magistrature</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Notation “officielle” (plus stricte). Ouvre les audiences avec{" "}
                    <code className="text-slate-200">?mode=exam</code>.
                  </div>
                </div>

                <button
                  onClick={() => setExamMode((v) => !v)}
                  className={`shrink-0 px-3 py-2 rounded-xl text-xs border ${
                    examMode
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {examMode ? "ACTIVÉ" : "DÉSACTIVÉ"}
                </button>
              </div>

              <div className="mt-3 text-[11px] text-slate-500">
                (Le scoring détaillé sera lu dans ton engine / results. Ici on active le mode côté navigation.)
              </div>
            </div>
          </div>

          {/* Right: Liste des dossiers */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">📚 Dossiers disponibles</div>
                <div className="text-xs text-slate-400 mt-1">
                  Clique sur un dossier pour lancer la simulation (audience / incidents / notation).
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher..."
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none"
                />

                <select
                  value={filterDomain}
                  onChange={(e) => setFilterDomain(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none"
                >
                  <option value="all">Tous domaines</option>
                  {domains.map((d) => (
                    <option key={`fd-${d || "auto"}`} value={d}>
                      {formatDomainLabel(d)}
                    </option>
                  ))}
                </select>

                <select
                  value={filterLevel}
                  onChange={(e) => setFilterLevel(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none"
                >
                  <option value="all">Tous niveaux</option>
                  <option value="débutant">Débutant</option>
                  <option value="intermédiaire">Intermédiaire</option>
                  <option value="avancé">Avancé</option>
                </select>
              </div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-3">
              {filteredCases.map((c, idx) => {
                const id = c?.id || c?.caseId || `case-${idx}`;
                const isAI = Boolean(c?.isDynamic);
                return (
                  <button
                    key={id}
                    onClick={() => openCase(id)}
                    className="text-left rounded-2xl border border-white/10 bg-slate-950/40 hover:bg-white/5 transition p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-400">
                          {formatDomainLabel(c?.domain)} • {c?.city || "—"} •{" "}
                          {c?.jurisdiction || "—"}
                        </div>
                        <div className="mt-1 font-semibold">{c?.title || "Dossier"}</div>
                        <div className="mt-2 text-xs text-slate-300 line-clamp-2">
                          {c?.summary || ""}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full border ${badgeForLevel(
                            c?.level || "débutant"
                          )}`}
                        >
                          {safeUpper(c?.level || "débutant")}
                        </span>

                        <span
                          className={`text-[11px] px-2 py-1 rounded-full border ${
                            isAI
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                              : "border-slate-700 bg-slate-900/40 text-slate-200"
                          }`}
                        >
                          {isAI ? "IA" : "LOCAL"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 text-[11px] text-slate-400">
                      N° {c?.caseNumber || id}
                    </div>
                  </button>
                );
              })}
            </div>

            {!filteredCases.length ? (
              <div className="mt-6 text-sm text-slate-400">
                Aucun dossier ne correspond aux filtres.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
