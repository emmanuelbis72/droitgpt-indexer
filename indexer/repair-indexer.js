// ✅ Fichier fusionné : indexer.js + réparation auto des payloads manquants
// Ce script indexe les documents ET répare les vecteurs mal formés (sans champ "content")

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import { normalizeQdrantUrl } from './qdrantUrl.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const directoryPath = path.join(__dirname, './docs');

const client = new QdrantClient({
  url: normalizeQdrantUrl(),
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
});

async function indexDocuments() {
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
    chunkSize: 1000,
    chunkOverlap: 100,
  });

  const texts = [];
  const now = new Date().toISOString();

  for (const doc of documents) {
    const splits = await splitter.createDocuments([doc.content], [{
      source: doc.name,
      date_indexed: now,
      tag: 'jurisprudence',
    }]);
    texts.push(...splits);
  }

  console.log(`🧩 ${texts.length} segments générés. Indexation en cours...`);

  await QdrantVectorStore.fromDocuments(texts, embeddings, {
    client,
    collectionName: 'documents',
  });

  console.log('✅ Indexation terminée avec succès dans Qdrant.');
}

async function repairMissingContent() {
  console.log('\n🔧 Vérification et réparation des vecteurs sans "content"...');

  let offset = 0;
  let totalUpdated = 0;

  while (true) {
    const response = await client.scroll('documents', {
      limit: 100,
      offset,
      with_payload: true,
    });

    const updates = [];
    for (const point of response.points) {
      const payload = point.payload || {};
      if (payload.content) continue;

      const recovered = payload.text || payload.source || null;
      if (recovered) {
        updates.push({
          id: point.id,
          payload: { content: recovered },
        });
      }
    }

    if (updates.length > 0) {
      await client.setPayload('documents', { points: updates });
      totalUpdated += updates.length;
      console.log(`✅ ${updates.length} vecteurs réparés.`);
    }

    if (!response.next_page_offset || response.points.length === 0) break;
    offset = response.next_page_offset;
  }

  console.log(`🎉 Réparation terminée. Total corrigé : ${totalUpdated}`);
}

// Lancement
(async () => {
  await indexDocuments();
  await repairMissingContent();
})();
