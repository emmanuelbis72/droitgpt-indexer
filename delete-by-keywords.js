import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from 'dotenv';
config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = 'documents';

const KEYWORDS = [
  'Arrêt n°188',
  'KAPUTA LOKO Emmanuel',
  'Arrêt n°189',
  'MUYUMBU KANZA',
   'Arrêt n°190',
    'MWENZE Léonard',
     'Arrêt n°191/2000',
      'TSHIAMA LUMUMBA',
       'Arrêt n°192/2000',
        'KABILA KAMBA',
         'Arrêt n°193/2000',
          'LUKUSA KASHI',
            'Arrêt n°194/2000',
            'NTUMBA KABILA',
            'Arrêt n°195/2000',
            'MUKONZI Jean-Claude',
            'Arrêt n°196',
  'BALOJI Pierre',
   'Arrêt n°197',
   'MUZITO Jacques',
     'Arrêt n°198/2000',
      'KAMWINA TSHIMANGA',
       'Arrêt n°199/2000',
       'MUTOMBO NGOYI Alexis',
        'MUKALAY NSHIMBI',
  'Arrêt n°200/2000'
];

async function findAndDeleteByKeywords() {
  const idsToDelete = [];

  let offset = 0;
  const limit = 100;

  console.log(`🔍 Recherche de vecteurs contenant un des mots-clés suivants :`);
  console.log(KEYWORDS.map((k) => `- ${k}`).join('\n'));

  while (true) {
    const response = await qdrant.scroll(COLLECTION_NAME, {
      limit,
      offset,
      with_payload: true,
    });

    const found = response.points.filter((point) => {
      const content = point.payload?.content || '';
      return KEYWORDS.some((keyword) => content.includes(keyword));
    });

    if (found.length > 0) {
      found.forEach((point) => {
        console.log(`🔴 Mot-clé détecté dans ID : ${point.id}`);
        idsToDelete.push(point.id);
      });
    }

    if (!response.next_page_offset || response.points.length === 0) {
      break;
    }

    offset = response.next_page_offset;
  }

  if (idsToDelete.length === 0) {
    console.log('✅ Aucun vecteur problématique détecté.');
    return;
  }

  console.log(`🧹 Suppression de ${idsToDelete.length} vecteurs...`);

  await qdrant.delete(COLLECTION_NAME, {
    points: idsToDelete,
  });

  console.log('✅ Suppression terminée avec succès.');
}

findAndDeleteByKeywords();
