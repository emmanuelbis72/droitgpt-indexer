import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

const API_BASE = "https://droitgpt-indexer.onrender.com";
const ACTIVE_DOC_KEY = "droitgpt_active_document_context";

export default function ChatInterface() {
  const { accessToken, logout } = useAuth();
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  /* =======================
     Utils
  ======================= */
  const normalizeStoredMessages = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((m) => {
        if (m?.from && m?.text) return m;
        if (m?.content && typeof m.isUser === "boolean") {
          return { from: m.isUser ? "user" : "assistant", text: m.content };
        }
        return null;
      })
      .filter(Boolean);
  };

  const escapeHtml = (s) =>
    String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  /* =======================
     State
  ======================= */
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem("chatMessages");
      if (saved) {
        const norm = normalizeStoredMessages(JSON.parse(saved));
        if (norm.length) return norm;
      }
    } catch {}
    return [
      {
        from: "assistant",
        text:
          `👋 <strong>Bienvenue</strong><br/>` +
          `Je suis <strong>DroitGPT</strong>, votre assistant juridique congolais.<br/>` +
          `Décrivez votre situation juridique avec autant de détails que nécessaire 📚⚖️`,
      },
    ];
  });

  const [userInput, setUserInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dots, setDots] = useState("");

  // ✅ Document actif
  const [activeDoc, setActiveDoc] = useState(null);

  // ✅ mode document forcé quand doc chargé
  const [documentMode, setDocumentMode] = useState(false);

  // ✅ panneau “voir texte extrait”
  const [showDocText, setShowDocText] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const location = useLocation();

  /* =======================
     Effects
  ======================= */
  useEffect(() => {
    localStorage.setItem("chatMessages", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => setDots((d) => (d.length < 3 ? d + "." : "")), 500);
    } else {
      setDots("");
    }
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ✅ Catapulte: récupère le document depuis Analyse.jsx (state) + fallback localStorage
  useEffect(() => {
    const st = location?.state;

    if (st?.fromAnalyse && (st?.documentText || st?.documentTextFull)) {
      const payload = {
        filename: st.filename || st.documentTitle || "Texte OCR extrait",
        documentText: String(st.documentText || st.documentTextFull || ""),
        documentTextFull: String(st.documentTextFull || st.documentText || ""),
        ts: Date.now(),
      };

      setActiveDoc(payload);
      localStorage.setItem(ACTIVE_DOC_KEY, JSON.stringify(payload));

      // ✅ force mode document quand on arrive depuis analyse
      setDocumentMode(true);

      if (st?.openDocPanel) setShowDocText(true);
      if (st?.focusInput) setTimeout(() => inputRef.current?.focus(), 80);

      // petite info au user (sans spam)
      setMessages((prev) => {
        const already = prev.some((m) => m?.meta === "DOC_LOADED");
        if (already) return prev;
        return [
          ...prev,
          {
            from: "assistant",
            meta: "DOC_LOADED",
            text:
              `<p>📎 <strong>Document chargé.</strong><br/>` +
              `Je répondrai en me basant sur ce document. Pose ta question.</p>`,
          },
        ];
      });

      return;
    }

    try {
      const raw = localStorage.getItem(ACTIVE_DOC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.documentText) {
          setActiveDoc(parsed);
          setDocumentMode(true);
        }
      }
    } catch {}
  }, [location]);

  /* =======================
     Helpers
  ======================= */
  const redirectToLogin = () => {
    logout();
    window.location.href = "/login";
  };

  const updateLastAssistantMessage = (text) => {
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].from === "assistant") {
          copy[i] = { ...copy[i], text };
          return copy;
        }
      }
      return [...copy, { from: "assistant", text }];
    });
  };

  /* =======================
     Streaming simulé
  ======================= */
  const typeWriterEffect = async (html) => {
    if (!html) return;

    const MAX_DURATION = 2500;
    const PREVIEW = 160;

    const first = html.slice(0, PREVIEW);
    updateLastAssistantMessage(first);

    const remaining = html.slice(PREVIEW);
    if (!remaining) return;

    const MAX_UPDATES = 80;
    const step = Math.max(6, Math.ceil(remaining.length / MAX_UPDATES));
    const delay = Math.max(6, Math.floor(MAX_DURATION / MAX_UPDATES));

    let current = first;
    for (let i = 0; i < remaining.length; i += step) {
      current += remaining.slice(i, i + step);
      updateLastAssistantMessage(current);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  /* =======================
     Send
  ======================= */
  const handleSend = async () => {
    if (!userInput.trim() || loading) return;

    const visibleInput = userInput.trim();
    setUserInput("");
    setLoading(true);

    // UI: affiche la question
    setMessages((p) => [...p, { from: "user", text: escapeHtml(visibleInput) }, { from: "assistant", text: "" }]);

    try {
      // ✅ Important : on envoie la conversation "normale"
      const payloadMessages = [...messages, { from: "user", text: visibleInput }];

      // ✅ si documentMode actif, on envoie documentText
      const docTextToSend =
        documentMode && activeDoc?.documentText
          ? activeDoc.documentText
          : null;

      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          messages: payloadMessages,
          lang: "fr",
          documentText: docTextToSend,
          documentTitle: activeDoc?.filename || null,
        }),
      });

      // ✅ Ne plus déconnecter sur /ask (car /ask est public maintenant)
      if (res.status === 401) {
        updateLastAssistantMessage(
          "<p>⚠️ Session non autorisée pour cette action. Réessaie ou reconnecte-toi.</p>"
        );
        return;
      }

      const data = await res.json().catch(() => ({}));
      const answer = data?.answer || "<p>❌ Réponse vide.</p>";

      await typeWriterEffect(answer);
    } catch {
      updateLastAssistantMessage("<p>❌ Erreur serveur. Veuillez réessayer.</p>");
    } finally {
      setLoading(false);
    }
  };

  const clearActiveDoc = () => {
    setActiveDoc(null);
    setShowDocText(false);
    setDocumentMode(false);
    try {
      localStorage.removeItem(ACTIVE_DOC_KEY);
    } catch {}
  };

  /* =======================
     UI
  ======================= */
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* HEADER + MENU */}
        <div className="px-4 md:px-6 py-4 border-b border-white/10 bg-slate-950/60">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-[13px] uppercase tracking-[0.25em] text-emerald-300 font-semibold">DROITGPT</h1>
              <h2 className="text-lg md:text-xl font-bold mt-1">IA ASSISTANT JURIDIQUE CONGOLAIS</h2>
            </div>

            <nav className="flex flex-wrap items-center gap-2 text-[12px]">
              <Link to="/" className="px-3 py-1.5 rounded-full border border-slate-600 text-slate-200 hover:bg-slate-800">
                🏠 Accueil
              </Link>

              <Link to="/generate" className="px-3 py-1.5 rounded-full border border-indigo-500/80 text-indigo-200">
                📝 Générer document
              </Link>

              <Link to="/analyse" className="px-3 py-1.5 rounded-full border border-amber-500/80 text-amber-200">
                📂 Analyse document
              </Link>

              <Link to="/assistant-vocal" className="px-3 py-1.5 rounded-full border border-emerald-500/80 text-emerald-200">
                🎤 Assistant vocal
              </Link>

              <button onClick={redirectToLogin} className="px-3 py-1.5 rounded-full border border-rose-500/70 text-rose-200">
                🚪 Déconnexion
              </button>
            </nav>
          </div>

          {/* Bandeau doc chargé */}
          {activeDoc?.documentText && (
            <div className="mt-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate">
                  📎 <strong>Document chargé :</strong> {activeDoc.filename || "Texte OCR extrait"}
                  <span className="text-blue-200/80">
                    {" "}
                    • {String(activeDoc.documentText || "").length.toLocaleString()} caractères
                  </span>
                  <span className="ml-2 text-emerald-200/90">
                    • {documentMode ? "Mode document: ON" : "Mode document: OFF"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDocumentMode((v) => !v)}
                    className="px-3 py-1 rounded-xl border border-emerald-300/30 hover:bg-emerald-500/10"
                    title="Si ON: l’assistant répond en priorité sur le document"
                  >
                    {documentMode ? "Utiliser le document ✅" : "Ignorer le document"}
                  </button>

                  <button
                    onClick={() => setShowDocText((s) => !s)}
                    className="px-3 py-1 rounded-xl border border-blue-300/30 hover:bg-blue-500/10"
                  >
                    {showDocText ? "Masquer le texte" : "Voir le texte extrait"}
                  </button>

                  <button onClick={clearActiveDoc} className="px-3 py-1 rounded-xl border border-blue-300/30 hover:bg-blue-500/10">
                    Retirer
                  </button>
                </div>
              </div>

              {showDocText && (
                <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-2 max-h-[240px] overflow-auto">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-blue-200/80 mb-2">Texte OCR</div>
                  <pre className="whitespace-pre-wrap text-[12px] text-slate-100">{activeDoc.documentText}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* MESSAGES */}
        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4 space-y-3 bg-slate-950/70">
          {messages.map((msg, i) => {
            const isUser = msg.from === "user";
            return (
              <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isUser ? "bg-emerald-500 text-white" : "bg-slate-900/90 border border-white/10"
                  }`}
                  dangerouslySetInnerHTML={{ __html: msg.text }}
                />
              </div>
            );
          })}

          {loading && <div className="text-xs text-slate-300">Assistant rédige{dots}</div>}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT */}
        <div className="border-t border-white/10 bg-slate-950/90 px-3 md:px-5 py-3">
          <textarea
            ref={inputRef}
            className="w-full px-4 py-4 rounded-2xl bg-slate-900 text-sm min-h-[180px] max-h-[360px] resize-y"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder={
              activeDoc?.documentText && documentMode
                ? "Pose ta question sur le document (résumé, contradictions, risques, conclusions, recommandations)…"
                : "Décrivez votre situation juridique ici…"
            }
          />

          <button
            onClick={handleSend}
            disabled={loading}
            className="mt-2 px-4 py-2 rounded-xl bg-emerald-500 text-white disabled:opacity-40"
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
