import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
dotenv.config();

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION = 'documents';
const LIMIT = 100;

async function repairPayloads() {
  let offset = 0;
  let totalChecked = 0;
  let totalRepaired = 0;

  console.log('🔍 Vérification des vecteurs existants dans Qdrant...');

  while (true) {
    const response = await client.scroll(COLLECTION, {
      limit: LIMIT,
      offset,
      with_payload: true,
    });

    if (!response.points.length) break;

    for (const point of response.points) {
      const id = point.id;
      const payload = point.payload;

      const content = payload?.content || '';
      const needsRepair = typeof content !== 'string' || content.trim().length < 10;

      if (needsRepair) {
        console.log(`⚠️ Vecteur ${id} a un contenu invalide : "${content}"`);

        // Exemple : on met un contenu de remplacement (à adapter à ton cas)
        const newContent = '[Contenu réparé automatiquement]';

        await client.setPayload(COLLECTION, {
          points: [id],
          payload: { content: newContent },
        });

        console.log(`✅ Payload du vecteur ${id} réparé.`);
        totalRepaired++;
      }

      totalChecked++;
    }

    if (!response.next_page_offset) break;
    offset = response.next_page_offset;
  }

  console.log(`🔍 ${totalChecked} vecteurs vérifiés.`);
  console.log(`🛠️ ${totalRepaired} payloads réparés.`);
}

repairPayloads().catch((err) => {
  console.error('❌ Erreur pendant la réparation :', err);
});
