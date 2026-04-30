import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import jsPDF from "jspdf";

const ANALYSE_API = "https://droitgpt-analysepdf.onrender.com";

// ✅ clé partagée avec ChatInterface.jsx
const ACTIVE_DOC_KEY = "droitgpt_active_document_context";

// ✅ on laisse très large pour ne pas tronquer côté UI;
// le backend /ask tronquera proprement si nécessaire.
const MAX_CHAT_CONTEXT_CHARS = 300000;

export default function Analyse() {
  const navigate = useNavigate();

  const [mode, setMode] = useState("doc"); // doc | images
  const [file, setFile] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [error, setError] = useState("");

  // résultats finaux
  const [analysis, setAnalysis] = useState(""); // HTML final
  const [docContext, setDocContext] = useState(""); // texte complet OCR/extrait
  const [docTitle, setDocTitle] = useState("");

  // par page/pièce (pour afficher confiance)
  const [pieces, setPieces] = useState([]);

  // historique simple
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem("analyseHistory");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const canAnalyse = useMemo(() => {
    if (mode === "doc") return !!file;
    return imageFiles?.length > 0;
  }, [mode, file, imageFiles]);

  const resetOutputs = () => {
    setAnalysis("");
    setDocContext("");
    setDocTitle("");
    setPieces([]);
    setError("");
  };

  // ---------- Progress “plus lent”
  const simulateProgress = () => {
    setProgress(0);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const target = Math.min(92, Math.floor((elapsed / 52000) * 92));
      setProgress((p) => (p < target ? p + 1 : p));
    }, 420);
    return interval;
  };

  // ---------- Helpers HTML / PDF
  const escapeHtml = (s) =>
    String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const safePlainFromHtml = (html) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = String(html || "");
    return (tmp.textContent || tmp.innerText || "").trim();
  };

  const cleanTextForChat = (t) => {
    let s = String(t || "");
    // nettoyages basiques
    s = s.replace(/\uFFFD/g, ""); // replacement char
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""); // contrôle
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    s = s.trim();

    if (s.length <= MAX_CHAT_CONTEXT_CHARS) return s;

    const head = s.slice(0, Math.floor(MAX_CHAT_CONTEXT_CHARS * 0.75));
    const tail = s.slice(-Math.floor(MAX_CHAT_CONTEXT_CHARS * 0.25));
    return `${head}\n\n[...DOCUMENT TROP LONG: PARTIE INTERMÉDIAIRE MASQUÉE POUR L’INTERFACE...]\n\n${tail}`;
  };

  // ---------- PDF -> images (si pdf scanné)
  async function pdfToImageFiles(pdfFile, { scale = 2.2, maxPages = 25 } = {}) {
    const pdfjsLib = await import("pdfjs-dist/build/pdf");
    const pdfjsWorker = await import("pdfjs-dist/build/pdf.worker?url");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;

    const buf = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    const totalPages = pdf.numPages;
    const pagesToRender = Math.min(totalPages, maxPages);

    const imageFilesOut = [];
    for (let p = 1; p <= pagesToRender; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1.0));
      const f = new File([blob], `page_${p}.png`, { type: "image/png" });
      imageFilesOut.push(f);
    }

    return { imageFiles: imageFilesOut, totalPages, renderedPages: pagesToRender };
  }

  // ---------- API calls
  async function postAnalyseSingle(uploadFile, { skipAnalysis = false } = {}) {
    const formData = new FormData();
    formData.append("file", uploadFile);

    // OCR activé
    formData.append("useOcr", "1");
    formData.append("ocrLang", "fra+eng");
    formData.append("useOcrPreprocess", "1");
    formData.append("useOcrCleanup", "1");

    if (skipAnalysis) formData.append("skipAnalysis", "1");

    const res = await fetch(`${ANALYSE_API}/analyse`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 422 && data?.scannedPdf) {
        const e = new Error(data?.details || "PDF scanné détecté");
        e.code = "SCANNED_PDF";
        throw e;
      }
      throw new Error(data?.details || data?.error || "Erreur analyse");
    }

    return data;
  }

  async function postAnalyseText(fullText) {
    const res = await fetch(`${ANALYSE_API}/analyse/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: fullText }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.details || data?.error || "Erreur analyse texte");
    return data;
  }

  // ---------- Pool (frontend)
  async function runPool(items, concurrency, worker, onEachDone) {
    let idx = 0;
    const results = new Array(items.length);

    async function next() {
      const current = idx++;
      if (current >= items.length) return;
      const val = await worker(items[current], current);
      results[current] = val;
      try {
        onEachDone?.(val, current);
      } catch {}
      return next();
    }

    const starters = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
    await Promise.all(starters);
    return results;
  }

  // ---------- Rapport final
  const buildFinalReportHtml = ({ title, pages, fullText, analysisHtml }) => {
    const low = pages.filter((p) => Number.isFinite(p.confidence) && p.confidence < 35).length;

    return `
      <h2>${escapeHtml(title || "Rapport OCR + Analyse")}</h2>

      ${
        low > 0
          ? `<p><strong>⚠️ Qualité faible détectée :</strong> ${low} page(s) ont une confiance OCR &lt; 35%.</p>`
          : ""
      }

      <h2>Texte OCR complet (corrigé)</h2>
      <p style="white-space:pre-wrap">${escapeHtml(fullText || "")}</p>

      <h2>Analyse juridique globale</h2>
      ${analysisHtml || "<p>Analyse indisponible.</p>"}
    `.trim();
  };

  // ---------- OCR multi-pages -> analyse globale
  async function runImagesFlow(filesArr, titleForDoc) {
    if (!filesArr?.length) throw new Error("Aucune page à analyser.");

    setMode("images");
    setFile(null);
    setImageFiles(filesArr);

    const init = filesArr.map((f, idx) => ({
      id: `p_${Date.now()}_${idx}`,
      name: f.name,
      status: "en attente",
      confidence: null,
      extractedText: "",
      error: "",
    }));
    setPieces(init);

    const results = [...init];
    const concurrency = filesArr.length <= 6 ? 3 : 2;
    let done = 0;

    await runPool(
      filesArr,
      concurrency,
      async (f, i) => {
        results[i] = { ...results[i], status: "en cours", error: "" };
        setPieces([...results]);

        try {
          const data = await postAnalyseSingle(f, { skipAnalysis: true });

          results[i] = {
            ...results[i],
            status: "terminé",
            extractedText: data.documentText || "",
            confidence: Number.isFinite(data.ocrConfidence) ? data.ocrConfidence : null,
          };
        } catch (e) {
          results[i] = { ...results[i], status: "erreur", error: e?.message || "Erreur OCR" };
        } finally {
          done++;
          setProgress((p) => Math.min(96, Math.max(p, Math.round((done / filesArr.length) * 92))));
          setPieces([...results]);
        }

        return results[i];
      }
    );

    const fullText = results
      .map((p, idx) => {
        const t = (p.extractedText || "").trim();
        if (!t) return "";
        return `--- PAGE ${idx + 1}: ${p.name} ---\n${t}\n`;
      })
      .filter(Boolean)
      .join("\n");

    if (!fullText.trim()) {
      throw new Error("OCR vide. Essaie un scan plus net (lumière, page à plat, zoom).");
    }

    const global = await postAnalyseText(fullText);

    const finalHtml = buildFinalReportHtml({
      title: titleForDoc || `Dossier OCR (${filesArr.length} pages)`,
      pages: results,
      fullText,
      analysisHtml: global.analysis || "<p>Analyse vide.</p>",
    });

    setDocTitle(titleForDoc || `Dossier OCR (${filesArr.length} pages)`);
    setDocContext(fullText);
    setAnalysis(finalHtml);

    const record = {
      filename: titleForDoc || `Dossier OCR (${filesArr.length} pages)`,
      timestamp: new Date().toLocaleString(),
      content: finalHtml,
    };
    const updatedHistory = [record, ...history.slice(0, 9)];
    setHistory(updatedHistory);
    localStorage.setItem("analyseHistory", JSON.stringify(updatedHistory));
  }

  // ---------- Analyse button
  const handleAnalyse = async () => {
    setError("");
    if (!canAnalyse) {
      setError(mode === "doc" ? "Veuillez sélectionner un fichier PDF/DOCX." : "Veuillez sélectionner des images.");
      return;
    }

    setLoading(true);
    resetOutputs();
    const interval = simulateProgress();

    try {
      if (mode === "doc") {
        if (!file) throw new Error("Veuillez sélectionner un fichier.");

        try {
          const data = await postAnalyseSingle(file, { skipAnalysis: false });

          setDocTitle(file.name);
          setDocContext(data.documentText || "");

          const finalHtml = buildFinalReportHtml({
            title: file.name,
            pages: [],
            fullText: data.documentText || "",
            analysisHtml: data.analysis || "<p>Analyse vide.</p>",
          });

          setAnalysis(finalHtml);

          const record = {
            filename: file.name,
            timestamp: new Date().toLocaleString(),
            content: finalHtml,
          };
          const updatedHistory = [record, ...history.slice(0, 9)];
          setHistory(updatedHistory);
          localStorage.setItem("analyseHistory", JSON.stringify(updatedHistory));
        } catch (e) {
          if (e?.code === "SCANNED_PDF" && file.name.toLowerCase().endsWith(".pdf")) {
            const scaleAuto = file.size > 6 * 1024 * 1024 ? 2.05 : 2.25;

            const { imageFiles: imgs, totalPages, renderedPages } = await pdfToImageFiles(file, {
              scale: scaleAuto,
              maxPages: 25,
            });

            if (!imgs.length) throw new Error("Impossible de convertir ce PDF en images.");

            await runImagesFlow(imgs, `PDF scanné (${renderedPages}/${totalPages} pages)`);
          } else {
            throw e;
          }
        }
      } else {
        await runImagesFlow(imageFiles, `Dossier OCR (${imageFiles.length} pages)`);
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || "Erreur lors de l'analyse.");
    } finally {
      clearInterval(interval);
      setProgress(100);
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 900);
    }
  };

  // ---------- Download PDF
  const handleDownloadPDF = () => {
    if (!analysis) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("DroitGPT — Rapport OCR + Analyse", 40, 45);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const plain = safePlainFromHtml(analysis);
    const lines = doc.splitTextToSize(plain, 515);
    let y = 70;

    for (const line of lines) {
      if (y > 780) {
        doc.addPage();
        y = 50;
      }
      doc.text(line, 40, y);
      y += 12;
    }

    doc.save("rapport_ocr_analyse.pdf");
  };

  // ✅ CATAPULTE vers chat : TEXTE COMPLET OCR -> Chat (localStorage + state)
  const handleChatWithDocument = () => {
    if (!docContext) return;

    const full = String(docContext || "").trim();
    const cleaned = cleanTextForChat(full);

    const payload = {
      filename: docTitle || "Texte OCR extrait",
      documentText: cleaned,          // ✅ ce que le chat peut envoyer directement
      documentTextFull: full,         // ✅ sauvegarde complète (si votre ChatInterface veut l’utiliser)
      ts: Date.now(),
      source: "analyse",
    };

    localStorage.setItem(ACTIVE_DOC_KEY, JSON.stringify(payload));

    navigate("/chat", {
      state: {
        fromAnalyse: true,
        filename: payload.filename,
        documentText: payload.documentText,
        documentTextFull: payload.documentTextFull,
        openDocPanel: true,
        focusInput: true,
        forceDocumentMode: true, // ✅ important: le chat doit activer “mode document”
      },
    });
  };

  // ---------- UI handlers
  const onPickDoc = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setMode("doc");
    setImageFiles([]);
    resetOutputs();
  };

  const onPickImages = (e) => {
    const files = Array.from(e.target.files || []);
    setImageFiles(files);
    setMode("images");
    setFile(null);
    resetOutputs();
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b border-white/10 bg-slate-950/70 flex items-center justify-between gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">DroitGPT • Analyse</span>
            <h1 className="text-lg md:text-xl font-semibold mt-1">Analyse PDF/DOCX + OCR (pages scannées)</h1>
          </div>

          <div className="flex flex-col items-end gap-2 text-[11px]">
            <div className="flex gap-2">
              <Link
                to="/chat"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-emerald-500/80 bg-slate-900/80 text-emerald-200 hover:bg-emerald-500/10 transition"
              >
                💬 Chat
              </Link>
              <Link
                to="/assistant-vocal"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-blue-500/80 bg-slate-900/80 text-blue-200 hover:bg-blue-500/10 transition"
              >
                🎤 Vocal
              </Link>
            </div>
            <Link
              to="/"
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1 rounded-full border border-slate-600/70 bg-slate-900/80 text-slate-200 hover:bg-slate-800 transition"
            >
              ⬅️ Accueil
            </Link>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 px-4 md:px-6 py-4 bg-slate-950/70">
          {/* LEFT */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Choisir un fichier</div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("doc");
                    setImageFiles([]);
                    setPieces([]);
                    resetOutputs();
                  }}
                  className={`px-3 py-2 rounded-xl text-xs border transition ${
                    mode === "doc"
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                      : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  PDF / DOCX
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("images");
                    setFile(null);
                    setPieces([]);
                    resetOutputs();
                  }}
                  className={`px-3 py-2 rounded-xl text-xs border transition ${
                    mode === "images"
                      ? "border-amber-500/60 bg-amber-500/15 text-amber-100"
                      : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  Images (pages)
                </button>
              </div>

              <div className="mt-3">
                {mode === "doc" ? (
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    onChange={onPickDoc}
                    className="block w-full text-xs text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-slate-50 hover:file:bg-white/20"
                  />
                ) : (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onPickImages}
                    className="block w-full text-xs text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-slate-50 hover:file:bg-white/20"
                  />
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleAnalyse}
                  disabled={!canAnalyse || loading}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? "Analyse en cours…" : "Lancer l’analyse"}
                </button>

                <button
                  onClick={handleDownloadPDF}
                  disabled={!analysis}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Télécharger PDF
                </button>

                <button
                  onClick={handleChatWithDocument}
                  disabled={!docContext}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-blue-500/30 hover:bg-blue-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Chatter avec le document
                </button>
              </div>

              {loading && (
                <div className="mt-3">
                  <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-2 bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">{progress}%</div>
                </div>
              )}

              {error && <div className="mt-3 text-sm text-rose-300">❌ {error}</div>}
            </div>

            {/* Confiance par page */}
            {pieces.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Pages & confiance OCR</div>
                <div className="mt-3 space-y-2 max-h-[240px] overflow-auto pr-1">
                  {pieces.map((p, i) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="text-xs text-slate-200">
                        {i + 1}. {p.name}{" "}
                        <span className="text-slate-400">
                          • {p.status}
                          {p.error ? ` • ❌ ${p.error}` : ""}
                        </span>
                      </div>
                      <div className="text-xs font-semibold">
                        {Number.isFinite(p.confidence) ? `${p.confidence}%` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historique */}
            {history.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Historique</div>
                <div className="mt-3 space-y-2 max-h-[220px] overflow-auto pr-1">
                  {history.map((h, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setAnalysis(h.content || "");
                        setDocTitle(h.filename || "");
                      }}
                      className="w-full text-left rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10 transition"
                    >
                      <div className="text-xs text-slate-200 font-semibold">{h.filename}</div>
                      <div className="text-[11px] text-slate-400">{h.timestamp}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Rapport */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 overflow-auto">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Rapport</div>
            {!analysis ? (
              <div className="mt-3 text-sm text-slate-300">Sélectionne un fichier puis lance l’analyse.</div>
            ) : (
              <div className="mt-3 prose prose-invert max-w-none">
                <div dangerouslySetInnerHTML={{ __html: analysis }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
