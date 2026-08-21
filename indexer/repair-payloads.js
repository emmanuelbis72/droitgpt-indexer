import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
import { normalizeQdrantUrl } from "./qdrantUrl.js";

dotenv.config();

/**
 * ✅ REPAIR SAFE
 * - Ne met PAS de contenu fictif
 * - Copie du texte réel si dispo dans d'autres champs
 * - Sinon: marque needs_reindex=true (par défaut)
 *
 * ENV optionnels:
 * QDRANT_COLLECTION=documents
 * REPAIR_MODE=mark | delete
 * LIMIT=100
 * MIN_CONTENT_LEN=10
 */

const client = new QdrantClient({
  url: normalizeQdrantUrl(),
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION = process.env.QDRANT_COLLECTION || "documents";
const LIMIT = Number(process.env.LIMIT || 100);
const MIN_CONTENT_LEN = Number(process.env.MIN_CONTENT_LEN || 10);
const REPAIR_MODE = (process.env.REPAIR_MODE || "mark").toLowerCase(); // mark | delete

function isValidContent(v) {
  return typeof v === "string" && v.trim().length >= MIN_CONTENT_LEN;
}

/**
 * Cherche un "vrai texte" existant dans le payload pour reconstruire content
 * sans inventer.
 */
function findExistingText(payload) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.content,
    payload.text,
    payload.pageContent,
    payload.documentText,
    payload.chunk,
    payload.body,
    payload.rawText,
  ];

  for (const c of candidates) {
    if (isValidContent(c)) return c;
  }
  return null;
}

async function repairPayloadsSafe() {
  if (!process.env.QDRANT_URL) {
    throw new Error("QDRANT_URL manquant dans .env");
  }

  console.log("🔍 Repair SAFE des payloads Qdrant...");
  console.log(`📌 Collection: ${COLLECTION}`);
  console.log(`⚙️ Mode: ${REPAIR_MODE} (mark=marquer | delete=supprimer)`);
  console.log(`⚙️ LIMIT: ${LIMIT}, MIN_CONTENT_LEN: ${MIN_CONTENT_LEN}`);

  let totalChecked = 0;
  let totalFixedByCopy = 0;
  let totalMarked = 0;
  let totalDeleted = 0;

  // Qdrant scroll utilise next_page_offset (pas forcément un nombre)
  let nextOffset = undefined;

  while (true) {
    const response = await client.scroll(COLLECTION, {
      limit: LIMIT,
      offset: nextOffset,
      with_payload: true,
      with_vector: false,
    });

    const points = response?.points || [];
    if (!points.length) break;

    for (const point of points) {
      const id = point.id;
      const payload = point.payload || {};
      const content = payload?.content;

      const needsRepair = !isValidContent(content);

      if (!needsRepair) {
        totalChecked++;
        continue;
      }

      // 1) Essayer de récupérer un vrai texte dans un autre champ
      const recovered = findExistingText(payload);

      if (recovered && recovered !== content) {
        await client.setPayload(COLLECTION, {
          points: [id],
          payload: {
            content: recovered,
            repaired_at: new Date().toISOString(),
            repair_strategy: "copy_existing_text_field",
            needs_reindex: false,
          },
        });

        totalFixedByCopy++;
        totalChecked++;
        console.log(`✅ [COPY] Point ${id} réparé: content reconstruit depuis un champ existant.`);
        continue;
      }

      // 2) Sinon: pas de texte fiable -> action SAFE
      if (REPAIR_MODE === "delete") {
        await client.delete(COLLECTION, {
          points: [id],
        });
        totalDeleted++;
        console.log(`🗑️ [DELETE] Point ${id} supprimé (content invalide + aucun texte récupérable).`);
      } else {
        // mark (par défaut)
        await client.setPayload(COLLECTION, {
          points: [id],
          payload: {
            needs_reindex: true,
            repaired_at: new Date().toISOString(),
            repair_strategy: "mark_for_reindex_only",
          },
        });
        totalMarked++;
        console.log(`⚠️ [MARK] Point ${id} marqué needs_reindex=true (aucun texte fiable à copier).`);
      }

      totalChecked++;
    }

    if (!response.next_page_offset) break;
    nextOffset = response.next_page_offset;
  }

  console.log("—");
  console.log(`🔎 Total points vérifiés: ${totalChecked}`);
  console.log(`✅ Réparés par copie (safe): ${totalFixedByCopy}`);
  console.log(`⚠️ Marqués needs_reindex: ${totalMarked}`);
  console.log(`🗑️ Supprimés: ${totalDeleted}`);
  console.log("✅ Repair SAFE terminé.");
}

repairPayloadsSafe().catch((err) => {
  console.error("❌ Erreur pendant la réparation SAFE :", err);
  process.exit(1);
});
