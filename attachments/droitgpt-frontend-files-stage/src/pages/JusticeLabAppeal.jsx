import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  ensureActiveRunValid,
  upsertAndSetActive,
  patchActiveRun,
} from "../justiceLab/storage.js";

const API_BASE =
  (import.meta?.env?.VITE_API_URL || "https://droitgpt-indexer.onrender.com").replace(/\/$/, "");

const CASE_CACHE_KEY_V2 = "justicelab_caseCache_v2";

function getAuthToken() {
  // ✅ Ajout de la clé réelle trouvée: droitgpt_access_token
  const candidates = [
    "droitgpt_access_token",
    "droitgpt_token",
    "accessToken",
    "authToken",
    "token",
    "jwt",
    "jwtToken",
    "idToken",
  ];

  // 1) Chercher dans localStorage + sessionStorage
  for (const store of [localStorage, sessionStorage]) {
    for (const k of candidates) {
      const v = store.getItem(k);
      if (v && v.trim().length > 10) return v.trim();
    }
  }

  // 2) fallback: token parfois stocké dans un objet JSON
  const objKeys = ["user", "auth", "profile"];
  for (const store of [localStorage, sessionStorage]) {
    for (const k of objKeys) {
      const raw = store.getItem(k);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        const v = obj?.token || obj?.accessToken || obj?.jwt || obj?.idToken;
        if (v && String(v).trim().length > 10) return String(v).trim();
      } catch {
        // ignore
      }
    }
  }

  return "";
}

function safeStr(v, max = 1200) {
  return String(v ?? "").slice(0, max);
}

function cls(...arr) {
  return arr.filter(Boolean).join(" ");
}

function loadCaseFromCache(caseId) {
  try {
    const raw = localStorage.getItem(CASE_CACHE_KEY_V2);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj[caseId] || null;
  } catch {
    return null;
  }
}

function buildBestCaseData({ navCase, run, caseMeta }) {
  // 1) le top: caseData complet passé via navigation
  if (navCase && typeof navCase === "object") return navCase;

  // 2) si tu stockes un caseData complet dans run.caseMeta.caseData (optionnel)
  const metaCase = run?.caseMeta?.caseData;
  if (metaCase && typeof metaCase === "object") return metaCase;

  const cid = caseMeta?.caseId || run?.caseId || run?.caseMeta?.caseId || run?.caseMeta?.id;
  if (!cid) return null;

  // 3) cache localStorage (dossiers IA générés)
  const cached = loadCaseFromCache(cid);
  if (cached) return cached;

  // 4) fallback minimal (au moins ne pas planter)
  return {
    caseId: cid,
    domaine: caseMeta?.domaine || run?.caseMeta?.domaine || "Autre",
    niveau: caseMeta?.niveau || run?.caseMeta?.niveau || "Intermédiaire",
    titre: caseMeta?.titre || run?.caseMeta?.titre || "Dossier",
    resume: run?.caseMeta?.resume || "",
    parties: run?.caseMeta?.parties || {},
    pieces: Array.isArray(run?.caseMeta?.pieces) ? run.caseMeta.pieces : [],
  };
}

async function postJSON(url, body) {
  const token = getAuthToken();
  if (!token) throw new Error("AUTH_TOKEN_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`HTTP_${resp.status}:${txt.slice(0, 500)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

export default function JusticeLabAppeal() {
  const navigate = useNavigate();
  const location = useLocation();

  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [appealDecision, setAppealDecision] = useState(null);

  const [navCaseData, setNavCaseData] = useState(null);

  useEffect(() => {
    const nav = location?.state || {};
    const navRun = nav.runData || nav.run || null;
    const navCase = nav.caseData || null;
    const navScored = nav.scored || null;

    setNavCaseData(navCase || null);

    if (navRun?.runId) {
      if (navCase && !navRun.caseMeta) {
        navRun.caseMeta = {
          caseId: navCase.caseId || navCase.id,
          domaine: navCase.domaine,
          niveau: navCase.niveau,
          titre: navCase.titre || navCase.title,
        };
      }
      if (navScored) navRun.scored = navScored;

      upsertAndSetActive(navRun);
      setRun(navRun);
      return;
    }

    const active = ensureActiveRunValid();
    if (active) setRun(active);
  }, [location?.state]);

  const caseMeta = run?.caseMeta || null;
  const scored = run?.scored || run?.ai || null;

  const scoreGlobal = useMemo(() => {
    const v = Number(scored?.scoreGlobal);
    return Number.isFinite(v) ? v : null;
  }, [scored]);

  async function loadAppeal() {
    if (!run || !caseMeta?.caseId) return;

    setLoading(true);
    setApiError("");
    setAppealDecision(null);

    try {
      const caseData = buildBestCaseData({ navCase: navCaseData, run, caseMeta });
      const runData = run;

      const data = await postJSON(`${API_BASE}/justice-lab/appeal`, {
        caseData,
        runData,
        scored,
      });

      setAppealDecision(data);

      const updated = patchActiveRun({ appeal: data });
      if (updated) setRun(updated);
    } catch (e) {
      console.warn(e);

      if (String(e?.message || "").includes("AUTH_TOKEN_MISSING")) {
        setApiError("Token manquant : reconnecte-toi puis relance la Cour d’appel.");
      } else {
        setApiError(
          `Impossible de générer la décision d’appel. Détail: ${safeStr(e?.message || "Erreur inconnue", 280)}`
        );
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!run) return;

    if (run?.appeal?.decision || run?.appeal?.dispositif) {
      setAppealDecision(run.appeal);
      return;
    }

    loadAppeal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  function finish() {
    navigate("/justice-lab");
  }

  if (!run || !caseMeta?.caseId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h1 className="text-2xl font-semibold">⚖️ Cour d’appel</h1>
            <p className="text-slate-300 mt-2">Aucune session Justice Lab active trouvée.</p>
            <div className="mt-4 flex gap-3 flex-wrap">
              <Link
                to="/justice-lab"
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Retour Justice Lab
              </Link>
              <Link
                to="/"
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Accueil
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const role = safeStr(run?.answers?.role || "Juge", 24);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-slate-300 font-bold">
                Justice Lab • Phase Appel
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold mt-1">⚖️ Cour d’appel simulée</h1>
              <p className="text-slate-300 mt-2 text-sm">
                Rôle joueur : <strong>{role}</strong> • contrôle de régularité et motivation.
              </p>
              <p className="text-slate-400 mt-1 text-xs">
                Cas : <strong>{caseMeta?.titre}</strong>
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={loadAppeal}
                disabled={loading}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                ↻ Régénérer
              </button>
              <button
                onClick={finish}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Terminer
              </button>
              <Link
                to="/justice-lab"
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Justice Lab
              </Link>
              <Link
                to="/"
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Accueil
              </Link>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <span className={cls("h-2 w-2 rounded-full", loading ? "bg-amber-400 animate-pulse" : "bg-emerald-400")} />
            {loading ? "Analyse de la Cour d’appel..." : "Décision prête"}
          </div>

          {typeof scoreGlobal === "number" ? (
            <div className="mt-3 text-xs text-slate-400">
              Score global (1ère instance) :{" "}
              <span className="font-semibold text-slate-200">{scoreGlobal}/100</span>
              {" • "}
              Risque d’appel :{" "}
              <span className="font-semibold text-slate-200">{scored?.appealRisk || "—"}</span>
            </div>
          ) : null}

          {apiError ? (
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-200 text-sm">
              {apiError}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold">Décision d’appel</h2>

            {appealDecision ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-semibold">Issue</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {appealDecision.decision === "CONFIRMATION" && "✅ CONFIRMATION"}
                    {appealDecision.decision === "ANNULATION" && "⛔ ANNULATION"}
                    {appealDecision.decision === "RENVOI" && "🔁 RENVOI"}
                    {!appealDecision.decision && "—"}
                  </div>

                  <div className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">
                    <strong className="text-slate-100">Dispositif :</strong>{" "}
                    {safeStr(appealDecision.dispositif, 1200)}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-semibold">
                    Motifs (grounds)
                  </div>
                  <ul className="mt-2 list-disc ml-5 text-sm text-slate-200 space-y-1">
                    {(appealDecision.grounds || []).slice(0, 8).map((g, i) => (
                      <li key={i}>{safeStr(g, 320)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-400">Aucune décision disponible.</div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold">Recommandations</h2>
            <p className="text-xs text-slate-400 mt-1">Points d’amélioration à fort impact.</p>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <ul className="list-disc ml-5 text-sm text-slate-200 space-y-1">
                {(appealDecision?.recommendations || []).slice(0, 8).map((r, i) => (
                  <li key={i}>{safeStr(r, 320)}</li>
                ))}
              </ul>
              {!appealDecision?.recommendations?.length ? (
                <div className="text-sm text-slate-400">—</div>
              ) : null}
            </div>

            <div className="mt-4 text-xs text-slate-500">
              Astuce : si la Cour “renvoie”, c’est souvent un manque de pièces, de motivation,
              ou une instruction incomplète.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
