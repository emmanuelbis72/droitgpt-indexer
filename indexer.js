
import fs from 'fs';
import path from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const directoryPath = './docs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Les variables SUPABASE_URL ou SUPABASE_ANON_KEY sont manquantes dans le .env");
  process.exit(1);
}

const client = createClient(supabaseUrl, supabaseKey);

async function main() {
  try {
    const documents = [];

    const walkSync = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        if (stat.isDirectory()) {
          walkSync(filepath);
        } else if (filepath.endsWith('.txt')) {
          const content = fs.readFileSync(filepath, 'utf-8');
          documents.push({ content, name: file });
        }
      });
    };

    walkSync(directoryPath);

    console.log(`📄 ${documents.length} fichiers trouvés. Traitement en cours...`);

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 3000,
      chunkOverlap: 300,
    });

    const texts = [];
    for (const doc of documents) {
      const splits = await splitter.createDocuments([doc.content], [{ source: doc.name }]);
      texts.push(...splits);
    }

    console.log(`🧩 ${texts.length} segments générés. Indexation en cours...`);

    await SupabaseVectorStore.fromDocuments(texts, new OpenAIEmbeddings(), {
      client,
      tableName: 'documents',
      queryName: 'match_documents',
    });

    console.log("✅ Indexation terminée avec succès !");
  } catch (error) {
    console.error("❌ Erreur pendant l'indexation :", error);
  }
}

main();
