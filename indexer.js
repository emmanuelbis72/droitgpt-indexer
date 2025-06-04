import fs from "fs";
import path from "path";
import { OpenAIEmbeddings } from "@langchain/openai";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const directoryPath = "./docs";

console.log("📂 Indexation de tous les fichiers dans './docs'...");

const loadFiles = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(loadFiles(file));
    } else {
      results.push(file);
    }
  });
  return results;
};

const run = async () => {
  const files = loadFiles(directoryPath);
  const docs = [];

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    const fileDocs = await splitter.createDocuments([content], [{ filePath }]);
    docs.push(...fileDocs);
  }

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  await SupabaseVectorStore.fromDocuments(docs, new OpenAIEmbeddings(), {
    client,
    tableName: "documents",
  });

  console.log("✅ Indexation terminée.");
};

run().catch((error) => {
  console.error("❌ Erreur d'indexation :", error);
});
