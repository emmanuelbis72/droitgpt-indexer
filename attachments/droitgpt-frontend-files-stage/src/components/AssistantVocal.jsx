import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

// Convertit base64 en Blob audio
function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

// Détermine le meilleur type audio supporté par ce navigateur
function getSupportedMimeType() {
  if (typeof window === "undefined" || !window.MediaRecorder) {
    return "audio/webm";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}

export default function AssistantVocal() {
  const [isRecording, setIsRecording] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 🔢 progression 0 → 100

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const progressTimerRef = useRef(null); // ⏱️ timer progression
  const mimeTypeRef = useRef("audio/webm"); // type audio réellement utilisé

  // ✅ Auth
  const { accessToken, logout } = useAuth();
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  // API Render (env var si dispo, sinon fallback)
  const VOICE_API_URL =
    import.meta.env.VITE_VOICE_API_URL ||
    "https://droitgpt-voice.onrender.com/voice-chat";

  // Nettoyage du timer si le composant est démonté
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, []);

  // Démarre la progression simulée (~30 s jusqu'à 95 %)
  function startProgress() {
    setProgress(0);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    progressTimerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev; // on laisse 95 % max avant la réponse
        return prev + 1;
      });
    }, 300); // 100 * 300 ms = 30 s théoriques
  }

  // Arrête la progression et la remet à 0 après un petit délai
  function stopProgress(resetDelay = 800) {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setTimeout(() => setProgress(0), resetDelay);
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const chosenType = getSupportedMimeType();
      mimeTypeRef.current = chosenType;

      const options =
        chosenType && chosenType !== ""
          ? { mimeType: chosenType }
          : undefined;

      const recorder = new MediaRecorder(stream, options);

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // on coupe le micro
        stream.getTracks().forEach((t) => t.stop());

        if (!chunksRef.current.length) {
          alert(
            "Aucun son capturé. Veuillez réessayer en parlant un peu plus longtemps."
          );
          setIsRecording(false);
          return;
        }

        const finalType =
          mimeTypeRef.current || recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: finalType });
        chunksRef.current = [];

        // Protection contre les enregistrements vides ou très courts
        if (audioBlob.size < 500) {
          alert(
            "L'enregistrement est trop court ou vide. Veuillez réessayer en parlant plus fort ou plus longtemps."
          );
          setIsRecording(false);
          return;
        }

        await sendAudio(audioBlob);
        setIsRecording(false);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      alert("Micro non autorisé ou indisponible.");
      console.error("Erreur getUserMedia :", err);
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendAudio = async (audioBlob) => {
    setIsLoading(true);
    startProgress(); // 🔁 on lance la progression

    const formData = new FormData();

    // extension cohérente avec le type (important pour iOS)
    const type = audioBlob.type || "";
    let ext = "webm";
    if (type.includes("mp4") || type.includes("m4a")) ext = "m4a";
    else if (type.includes("mpeg") || type.includes("mp3")) ext = "mp3";

    formData.append("audio", audioBlob, `speech.${ext}`);

    // Mini-mémoire de conversation
    const MAX_MESSAGES = 8;
    const trimmedHistory =
      conversation.length > MAX_MESSAGES
        ? conversation.slice(conversation.length - MAX_MESSAGES)
        : conversation;

    const historyForBackend = trimmedHistory.map((m) => ({
      from: m.from,
      text: m.text,
    }));

    formData.append("history", JSON.stringify(historyForBackend));

    try {
      const res = await fetch(VOICE_API_URL, {
        method: "POST",
        headers: {
          ...authHeaders, // ✅ Bearer token
        },
        body: formData,
      });

      // ✅ Si backend protégé et user non authentifié
      if (res.status === 401) {
        logout();
        const next = encodeURIComponent("/assistant-vocal");
        window.location.href = `/login?next=${next}`;
        stopProgress();
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        console.error("Réponse serveur vocal non OK :", res.status, text);
        alert(`Erreur serveur vocal : ${res.status}\n${text || ""}`);
        stopProgress();
        return;
      }

      const data = await res.json();

      if (!data || (!data.userText && !data.answerText)) {
        alert("Réponse vocale vide ou invalide.");
        stopProgress();
        return;
      }

      setConversation((prev) => [
        ...prev,
        { from: "user", text: data.userText },
        { from: "assistant", text: data.answerText },
      ]);

      // Lecture audio
      if (data.audioBase64) {
        const audioBlobResponse = base64ToBlob(
          data.audioBase64,
          data.mimeType || "audio/mpeg"
        );
        const audioUrl = URL.createObjectURL(audioBlobResponse);

        if (audioRef.current) {
          // 💯 on passe à 100 % au moment où la réponse audio commence
          setProgress(100);

          audioRef.current.src = audioUrl;
          audioRef.current
            .play()
            .then(() => {
              // on laisse 100 % s'afficher puis on reset
              stopProgress(1200);
            })
            .catch((e) => {
              console.warn("Lecture audio bloquée :", e);
              stopProgress();
            });
        } else {
          stopProgress();
        }
      } else {
        stopProgress();
      }
    } catch (err) {
      console.error("Erreur fetch vocal :", err);
      alert("Erreur lors de la communication vocale : " + err.message);
      stopProgress();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-5 flex flex-col gap-5">
        {/* Barre top : retour + état */}
        <div className="flex justify-between items-start">
          <Link
            to="/"
            className="px-3 py-1.5 text-xs rounded-full bg-slate-900/70 border border-white/20 text-slate-200 hover:bg-slate-800 transition"
          >
            ⬅️ Retour à l’accueil
          </Link>

          <div className="flex flex-col items-end gap-1">
            <div className="h-8 px-3 rounded-full bg-slate-900/60 border border-white/10 flex items-center text-[11px] text-slate-200 gap-1">
              <span
                className={`h-2 w-2 rounded-full ${
                  isRecording
                    ? "bg-rose-500 animate-pulse"
                    : isLoading
                    ? "bg-amber-400 animate-pulse"
                    : "bg-emerald-400"
                }`}
              />
              <span>
                {isRecording
                  ? "Enregistrement en cours"
                  : isLoading
                  ? "L’assistant raisonne…"
                  : "Prêt à vous écouter"}
              </span>
            </div>
          </div>
        </div>

        {/* En-tête texte */}
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
            DroitGPT • Assistant vocal
          </span>
          <h1 className="text-xl font-semibold mt-1">
            Parlez avec votre avocat
          </h1>
        </div>

        {/* Zone de conversation */}
        <div className="relative flex-1 min-h-[220px] max-h-[320px] overflow-y-auto rounded-2xl bg-slate-950/60 border border-white/5 px-3 py-3 space-y-3">
          {conversation.length === 0 && !isLoading && !isRecording && (
            <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-400">
              <p>Discutez librement de vos questions juridiques.</p>
              <p className="mt-1">Appuyez sur le micro pour commencer.</p>
            </div>
          )}

          {conversation.map((msg, index) => (
            <div
              key={index}
              className={`flex ${
                msg.from === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  msg.from === "user"
                    ? "bg-emerald-500 text-white rounded-br-sm"
                    : "bg-slate-800 text-slate-50 rounded-bl-sm"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide mb-1 opacity-70">
                  {msg.from === "user" ? "Vous" : "DroitGPT Avocat"}
                </div>
                <div>{msg.text}</div>
              </div>
            </div>
          ))}

          {/* Indicateur de traitement + barre de progression */}
          {isLoading && (
            <div className="mt-3 flex flex-col gap-2 text-xs text-slate-200">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-emerald-400/40">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <span>DroitGPT prépare votre réponse vocale…</span>
              </div>

              {/* Barre de progression */}
              <div className="w-full max-w-xs h-2 rounded-full bg-slate-800 border border-slate-600 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400">
                Raisonnement en cours ({progress}%).
                <br />
                ⏱️ Cette étape prend généralement{" "}
                <strong>30 à 40 secondes</strong> : transcription de votre voix,
                analyse du droit congolais, puis génération de la réponse audio.
              </div>
            </div>
          )}
        </div>

        {/* Zone micro + info d'état */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            {isRecording && (
              <div className="absolute inset-0 -z-10 animate-ping rounded-full bg-rose-500/40" />
            )}

            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading}
              className={`h-16 w-16 rounded-full flex items-center justify-center shadow-2xl border border-white/20 transition-all duration-200 ${
                isLoading
                  ? "bg-slate-700 cursor-not-allowed opacity-80"
                  : isRecording
                  ? "bg-rose-500 hover:bg-rose-600 scale-105"
                  : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              <span className="text-2xl">{isRecording ? "⏹️" : "🎤"}</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-400 text-center px-4">
            {isRecording
              ? "Parlez librement, puis touchez le bouton pour arrêter l’enregistrement."
              : isLoading
              ? "Merci de patienter : DroitGPT raisonne sur votre question. Le traitement prend en général 30 à 40 secondes avant que la réponse audio ne commence."
              : "Touchez le micro, posez votre question juridique à voix haute, puis laissez DroitGPT vous répondre."}
          </p>
        </div>

        <audio ref={audioRef} hidden />
      </div>
    </div>
  );
}
