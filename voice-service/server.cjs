// server.cjs - service vocal DroitGPT (optimisé, sans double appel chat)

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Healthcheck (fast, no auth)
app.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, service: "droitgpt-voice-service", ts: new Date().toISOString() });
});


const upload = multer({ storage: multer.memoryStorage() });

// ⚙️ OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ⚙️ URL vers ton /ask EXISTANT (local ou Render)
const ASK_URL = process.env.ASK_URL || "https://droitgpt-indexer.onrender.com/ask";

// 🧹 Enlever les balises HTML pour un texte lisible à l’oral
function stripHtmlToText(html) {
  if (!html) return "";

  return (
    html
      .replace(/<li>/gi, "• ")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|br)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

// 🧪 Détection simple de la langue de la question
async function detectLanguage(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Tu es un détecteur de langue. " +
            "Réponds UNIQUEMENT par un code très court de langue (par exemple: fr, en, sw, ln, es, pt...). " +
            "Pas d'autre texte, pas de phrases.",
        },
        {
          role: "user",
          content: text,
        },
      ],
      max_tokens: 5,
      temperature: 0,
    });

    let code = completion.choices?.[0]?.message?.content || "fr";
    code = code.trim().toLowerCase().slice(0, 2);

    const allowed = ["fr", "en", "sw", "ln", "es", "pt"];
    if (!allowed.includes(code)) {
      code = "fr";
    }

    return code;
  } catch (e) {
    console.warn(
      "Impossible de détecter la langue, on met fr par défaut :",
      e.message
    );
    return "fr";
  }
}

// 🎙️ Endpoint vocal
app.post("/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun audio fourni." });
    }

    // 1) Sauvegarde temporaire de l'audio
    const tmpDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const tmpPath = path.join(tmpDir, `${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    // 2) Transcription STT avec OpenAI
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "gpt-4o-mini-transcribe",
      // language: "fr", // on peut laisser auto
    });

    fs.unlink(tmpPath, () => {});

    const userText = (transcription.text || "").trim();
    if (!userText) {
      return res.status(400).json({ error: "Transcription vide." });
    }

    console.log("🎧 Question vocale :", userText);

    // 3) Détection de la langue de la question
    const userLang = await detectLanguage(userText);
    console.log("🌍 Langue détectée :", userLang);

    // 4) Récupérer l'historique envoyé par le frontend (champ "history")
    let history = [];
    try {
      if (req.body && req.body.history) {
        history = JSON.parse(req.body.history);
        if (!Array.isArray(history)) history = [];
      }
    } catch (e) {
      console.warn("Impossible de parser history, on ignore :", e.message);
      history = [];
    }

    const MAX_MESSAGES = 8;
    if (history.length > MAX_MESSAGES) {
      history = history.slice(history.length - MAX_MESSAGES);
    }

    // 5) Construction des messages pour /ask : historique + nouvelle question
    const messages = [...history, { from: "user", text: userText }];

    const askResponse = await axios.post(
      ASK_URL,
      { messages, lang: userLang },
      { timeout: 60000 }
    );

    const rawAnswer =
      (askResponse.data && askResponse.data.answer) ||
      "Je n'ai pas pu générer une réponse pour le moment.";

    console.log("⚖️ Réponse DroitGPT (brute) :", rawAnswer);

    // 6) Nettoyage HTML -> texte simple
    const cleanedText = stripHtmlToText(rawAnswer) || rawAnswer;

    console.log("🗣️ Texte final pour l'oral :", cleanedText);

    // 7) Génération audio TTS (voix masculine → onyx)
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "onyx", // ✅ masculine, pro
      input: cleanedText,
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    const audioBase64 = audioBuffer.toString("base64");

    // 8) Réponse au frontend
    res.json({
      userText,
      answerText: cleanedText,
      audioBase64,
      mimeType: "audio/mpeg",
    });
  } catch (err) {
    console.error(
      "🔥 Erreur /voice-chat :",
      err.response ? err.response.data : err
    );
    res.status(500).json({
      error: "Erreur serveur vocal",
      details: err.message || "Erreur inconnue",
    });
  }
});

// 🚀 Lancement serveur
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log("🎤 Voice-service opérationnel sur port", PORT);
});
