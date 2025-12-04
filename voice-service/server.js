// server.js – Voice-service DroitGPT (ESM, mémoire + langue)

import express from "express";
import multer from "multer";
import cors from "cors";
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// URL de ton API DroitGPT existante (/ask)
const ASK_URL =
  process.env.ASK_URL || "https://droitgpt-indexer.onrender.com/ask";

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
    console.warn("Impossible de détecter la langue, on met fr par défaut :", e.message);
    return "fr";
  }
}

// ==== ENDPOINT VOCAL ====
app.post("/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun audio fourni." });
    }

    // 1) Sauvegarde temporaire de l'audio
    const tmpDir = "./tmp";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const tmpPath = `${tmpDir}/${Date.now()}.webm`;
    fs.writeFileSync(tmpPath, req.file.buffer);

    // 2) Transcription
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "gpt-4o-mini-transcribe",
    });

    fs.unlinkSync(tmpPath);

    const userText = (transcription.text || "").trim();
    if (!userText) {
      return res.status(400).json({ error: "Transcription vide." });
    }

    console.log("🎧 Transcrit :", userText);

    // 3) Détection de langue
    const userLang = await detectLanguage(userText);
    console.log("🌍 Langue détectée :", userLang);

    // 4) Récupération de l'historique envoyé par le front
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

    // Limiter l'historique
    const MAX_HISTORY = 6;
    if (history.length > MAX_HISTORY) {
      history = history.slice(history.length - MAX_HISTORY);
    }

    // 5) Construction des messages pour /ask (mini-mémoire + nouvelle question)
    const messagesForAsk = [
      ...history,
      { from: "user", text: userText },
    ];

    const askResponse = await axios.post(
      ASK_URL,
      { messages: messagesForAsk, lang: userLang },
      { timeout: 60000 }
    );

    const rawAnswer =
      (askResponse.data && askResponse.data.answer) ||
      "Je n'ai pas pu générer une réponse pour le moment.";

    console.log("⚖️ Réponse DroitGPT (brute) :", rawAnswer);

    // 6) Nettoyage HTML
    const cleanedText = stripHtmlToText(rawAnswer);

    // 7) Réécriture ORALE dans la langue de l'utilisateur (style avocat congolais)
    let spokenText = cleanedText || rawAnswer;
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu es DroitGPT, un avocat congolais expérimenté. " +
              "Tu expliques le droit de la République Démocratique du Congo (et, si pertinent, le droit OHADA) " +
              "de manière claire, concrète et adaptée à la vie quotidienne (famille, travail, bail, entreprise, pénal, etc.). " +
              "IMPORTANT : ta réponse doit être entièrement dans la langue dont le code est '" +
              userLang +
              "'. " +
              "Si le texte fourni n'est pas dans cette langue, commence par le traduire, puis reformule-le pour l'oral : " +
              "style conversationnel mais professionnel, phrases plutôt courtes, ton bienveillant, sans balises HTML. " +
              "Tu peux mentionner les textes (Constitution, Codes, actes OHADA) de manière générale, mais sans inventer de numéros d’articles. " +
              "Termine en donnant des conseils pratiques (à qui s’adresser, quelles démarches faire, prudence, etc.).",
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
      console.warn(
        "Impossible de réécrire pour l'oral, on garde le texte nettoyé :",
        e.message
      );
    }

    console.log("🗣️ Texte final pour l'oral :", spokenText);

    // 8) Génération audio
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: spokenText,
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    const audioBase64 = audioBuffer.toString("base64");

    res.json({
      userText,
      answerText: spokenText,
      audioBase64,
      mimeType: "audio/mpeg",
    });
  } catch (err) {
    console.error("🔥 Erreur vocal :", err);
    res.status(500).json({ error: "Erreur serveur vocal", details: err.message });
  }
});

// ==== SERVER START ====
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log("🎤 Voice-service opérationnel sur port", PORT);
});
