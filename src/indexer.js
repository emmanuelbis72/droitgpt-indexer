import { createClient } from '@supabase/supabase-js';
import { SupabaseVectorStore } from "langchain/vectorstores/supabase";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { TextLoader } from "langchain/document_loaders/fs/text";
import dotenv from "dotenv";

dotenv.config();

const loader = new DirectoryLoader("./docs", {
  ".txt": (path) => new TextLoader(path),
});

async function main() {
  console.log("📂 Indexation de tous les fichiers dans './docs'...");
  const docs = await loader.load();

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const store = await SupabaseVectorStore.fromDocuments(docs, embeddings, {
    client,
    tableName: "documents",
    queryName: "match_documents",
  });

  console.log("✅ Indexation terminée avec succès !");
}

main().catch((err) => {
  console.error("❌ Erreur d'indexation :", err);
});
