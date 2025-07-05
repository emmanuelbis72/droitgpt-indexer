// ✅ Fichier amélioré : indexer.js – DroitGPT
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

    // 📁 Récupère tous les fichiers txt dans les sous-dossiers
    const walkSync = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);

        if (stat.isDirectory()) {
          walkSync(filepath);
        } else if (filepath.endsWith('.txt')) {
          const content = fs.readFileSync(filepath, 'utf-8');
          const relativePath = path.relative(directoryPath, filepath);
          const tag = relativePath.split(path.sep)[0]; // 📁 nom du sous-dossier
          documents.push({ content, name: file, tag });
        }
      });
    };

    walkSync(directoryPath);

    console.log(`📄 ${documents.length} fichiers trouvés. Début du traitement...`);

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 100,
    });

    const now = new Date().toISOString();
    const allChunks = [];

    for (const doc of documents) {
      const chunks = await splitter.createDocuments([doc.content], [{
        source: doc.name,
        date_indexed: now,
        tag: doc.tag || 'inconnu',
        length: doc.content.length,
      }]);
      allChunks.push(...chunks);
    }

    console.log(`🧩 ${allChunks.length} segments générés. Indexation vers Qdrant...`);

    await QdrantVectorStore.fromDocuments(allChunks, embeddings, {
      client,
      collectionName: 'documents',
    });

    console.log('✅ Indexation terminée avec succès.');
  } catch (error) {
    console.error('❌ Erreur pendant l\'indexation :', error.message);
  }
}

main();
