// server.cjs - service vocal DroitGPT (CommonJS)

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

const upload = multer({ storage: multer.memoryStorage() });

// ⚙️ OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ⚙️ URL vers ton /ask EXISTANT (local ou Render)
const ASK_URL = process.env.ASK_URL || "http://localhost:3000/ask";

// 🧹 Enlever les balises HTML pour un texte lisible à l’oral
function stripHtmlToText(html) {
  if (!html) return "";

  return (
    html
      // puces
      .replace(/<li>/gi, "• ")
      // retours à la ligne après certains blocs
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|br)>/gi, "\n")
      // supprimer le reste des balises
      .replace(/<[^>]+>/g, "")
      // nettoyer les espaces
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
            "Réponds UNIQUEMENT par un code très court de langue (par exemple: fr, en, sw, ln, es, ar, pt...). " +
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
    console.warn("Impossible de détecter la langue, on met fr par défaut :", e.message);
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

    // 6) Nettoyage HTML
    const cleanedText = stripHtmlToText(rawAnswer);

    // 7) Réécriture ORALE AVEC TON MESSAGE SYSTÈME AMÉLIORÉ
    let spokenText = cleanedText || rawAnswer;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu es un avocat congolais professionnel. " +
              "Tu t’exprimes avec calme, clarté, respect, et pédagogie. " +
              "Tu parles avec une tonalité chaleureuse et posée, mais sans accent particulier. " +
              "Quand c’est utile, fais référence aux lois congolaises, aux codes, aux articles, " +
              "et explique ce qu’ils impliquent pour la personne, en termes simples. " +
              "Réécris le texte pour qu'il soit parfaitement adapté à l’oral : phrases courtes, " +
              "explications simples, ton bienveillant. " +
              "IMPORTANT : réponds dans la MÊME langue que la question ('" +
              userLang +
              "'). " +
              "Si le texte d’origine n’est pas dans cette langue, traduis-le d’abord, puis reformule-le. " +
              "Ne génère aucun HTML.",
          },
          {
            role: "user",
            content: cleanedText || rawAnswer,
          },
        ],
        temperature: 0.4,
      });

      const choice = completion.choices?.[0]?.message?.content;
      if (choice && choice.trim().length > 0) {
        spokenText = choice.trim();
      }
    } catch (e) {
      console.warn("Impossible de réécrire pour l'oral, on garde le texte nettoyé :", e.message);
    }

    console.log("🗣️ Texte final pour l'oral :", spokenText);

    // 8) Génération audio TTS
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "amber", // voix masculine plus naturelle
      input: spokenText,
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    const audioBase64 = audioBuffer.toString("base64");

    // 9) Réponse au frontend
    res.json({
      userText,
      answerText: spokenText,
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
