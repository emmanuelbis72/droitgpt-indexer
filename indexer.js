import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SupabaseVectorStore } from "langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "langchain/community/embeddings/openai";
import { createClient } from "@supabase/supabase-js";
import { DirectoryLoader, TextLoader } from "langchain/document_loaders/fs/directory";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const directoryPath = path.join(__dirname, 'docs');

console.log("📁 Indexation de tous les fichiers dans './docs'...");

const loader = new DirectoryLoader(directoryPath, {
  ".txt": (path) => new TextLoader(path),
  ".md": (path) => new TextLoader(path)
});

const docs = await loader.load();
console.log(`✅ ${docs.length} documents chargés`);

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

try {
  await SupabaseVectorStore.fromDocuments(docs, new OpenAIEmbeddings(), {
    client,
    tableName: "documents"
  });
  console.log("✅ Indexation terminée avec succès !");
} catch (error) {
  console.error("❌ Erreur d'indexation :", error.message);
  process.exit(1);
}