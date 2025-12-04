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
  apiKey: process.env.OPENAI_API_KEY
});

// URL de ton API DroitGPT existante
const ASK_URL =
  process.env.ASK_URL ||
  "https://droitgpt-indexer.onrender.com/ask";

// ==== ENDPOINT VOCAL ====
app.post("/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Aucun audio fourni." });

    // TRANSCRIPTION
    const tmpDir = "./tmp";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const tmpPath = `${tmpDir}/${Date.now()}.webm`;
    fs.writeFileSync(tmpPath, req.file.buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "gpt-4o-mini-transcribe"
    });

    fs.unlinkSync(tmpPath);

    const userText = transcription.text.trim();
    console.log("🎧 Transcrit :", userText);

    // ENVOI VERS TON API TEXTE EXISTANTE
    const askResponse = await axios.post(ASK_URL, {
      question: userText,
      history: [],
      language: "fr"
    });

    const answerText = askResponse.data.answer || "Aucune réponse.";

    console.log("⚖️ Assistant :", answerText);

    // GENERATION AUDIO
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: answerText
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    const audioBase64 = audioBuffer.toString("base64");

    res.json({
      userText,
      answerText,
      audioBase64,
      mimeType: "audio/mpeg"
    });
  } catch (err) {
    console.error("🔥 Erreur vocal :", err);
    res.status(500).json({ error: err.message });
  }
});

// ==== SERVER START ====
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log("🎤 Voice-service opérationnel sur port", PORT);
});
