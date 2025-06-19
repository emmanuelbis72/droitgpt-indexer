import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';

dotenv.config();

// Résolution correcte du chemin (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const directoryPath = path.join(__dirname, '../docs');

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
});

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

    await QdrantVectorStore.fromDocuments(texts, embeddings, {
      client,
      collectionName: 'documents',
    });

    console.log('✅ Indexation terminée avec succès dans Qdrant.');
  } catch (error) {
    console.error('❌ Erreur pendant l\'indexation :', error);
  }
}

main();
