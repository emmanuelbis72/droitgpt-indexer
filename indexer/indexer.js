// indexer.js – DroitGPT (version stable anti-429)
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";

import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const directoryPath = path.join(__dirname, "docs");

// -------------------- CONFIG --------------------
const COLLECTION = process.env.QDRANT_COLLECTION || "documents";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

// lots embeddings + upsert
const BATCH_SIZE = Number(process.env.INDEX_BATCH_SIZE || 32);

// pause légère entre lots (ms)
const BATCH_PAUSE_MS = Number(process.env.INDEX_BATCH_PAUSE_MS || 350);

// max retries 429
const MAX_RETRIES = Number(process.env.INDEX_MAX_RETRIES || 8);

// chunking
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 1000);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 100);

// -------------------- HELPERS --------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

// Retry exponentiel sur 429 / rate limit
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const is429 =
        msg.includes("429") ||
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("model_rate_limit") ||
        msg.toLowerCase().includes("exceeded your current quota");

      // si ce n'est pas 429 -> on remonte l'erreur
      if (!is429 || attempt >= maxRetries) throw e;

      const waitMs = Math.min(30000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s... max 30s
      console.log(`⏳ Rate limit (429). Retry dans ${waitMs} ms (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(waitMs);
      attempt++;
    }
  }
}

// -------------------- MAIN --------------------
async function main() {
  try {
    if (!process.env.QDRANT_URL) throw new Error("QDRANT_URL manquant dans .env");
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY manquant dans .env");

    const client = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: EMBEDDING_MODEL,
    });

    // 1) Lire tous les .txt (récursif)
    const documents = [];
    const walkSync = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        if (stat.isDirectory()) return walkSync(filepath);

        if (filepath.endsWith(".txt")) {
          const content = fs.readFileSync(filepath, "utf-8");
          const relativePath = path.relative(directoryPath, filepath);
          const tag = relativePath.split(path.sep)[0]; // sous-dossier
          documents.push({ content, name: file, tag });
        }
      });
    };

    walkSync(directoryPath);
    console.log(`📄 ${documents.length} fichiers trouvés. Début du traitement...`);

    // 2) Split en chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });

    const now = new Date().toISOString();
    const chunks = [];

    for (const doc of documents) {
      const docs = await splitter.createDocuments(
        [doc.content],
        [
          {
            source: doc.name,
            date_indexed: now,
            tag: doc.tag || "inconnu",
            length: doc.content.length,
          },
        ]
      );
      chunks.push(...docs);
    }

    console.log(`🧩 ${chunks.length} segments générés.`);

    if (chunks.length === 0) {
      console.log("ℹ️ Aucun chunk à indexer.");
      return;
    }

    // 3) Déterminer la dimension du vecteur (1 petit appel test)
    const testVec = await withRetry(() => embeddings.embedQuery("test"));
    const vectorSize = testVec.length;

    // 4) Créer la collection si elle n'existe pas
    const existing = await client.getCollections();
    const exists = existing.collections?.some((c) => c.name === COLLECTION);

    if (!exists) {
      console.log(`🧱 Collection "${COLLECTION}" absente → création (size=${vectorSize})`);
      await client.createCollection(COLLECTION, {
        vectors: { size: vectorSize, distance: "Cosine" },
      });
    }

    // 5) Indexation par lots
    console.log(`🚀 Indexation vers Qdrant (batch=${BATCH_SIZE}, model=${EMBEDDING_MODEL})...`);

    let indexed = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchDocs = chunks.slice(i, i + BATCH_SIZE);

      const texts = batchDocs.map((d) => d.pageContent);
      const metadatas = batchDocs.map((d) => d.metadata || {});

      // embeddings du lot (avec retry)
      const vectors = await withRetry(() => embeddings.embedDocuments(texts));

      // upsert Qdrant
      const points = vectors.map((vec, idx) => {
        const payload = {
          ...metadatas[idx],
          text: texts[idx],
          // id stable par contenu (évite doublons si tu relances)
          hash: sha256(texts[idx]),
        };

        return {
          id: payload.hash, // id = hash (stable)
          vector: vec,
          payload,
        };
      });

      await client.upsert(COLLECTION, { wait: true, points });

      indexed += batchDocs.length;
      console.log(`✅ ${indexed}/${chunks.length} chunks indexés`);

      // petite pause pour éviter rafales
      if (BATCH_PAUSE_MS > 0) await sleep(BATCH_PAUSE_MS);
    }

    console.log("🎉 Indexation terminée avec succès.");
  } catch (error) {
    console.error("❌ Erreur pendant l'indexation :", error?.message || error);
  }
}

main();
