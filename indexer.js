
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const rootDir = './docs';

async function processFile(filepath, source, category) {
  const content = fs.readFileSync(filepath, 'utf-8');
  if (!content) return;

  try {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: content.slice(0, 8000)
    });

    const embedding = embeddingResponse.data[0].embedding;

    await supabase.from('documents_indexes').insert({
      source,
      category,
      filename: path.basename(filepath),
      content: content.slice(0, 8000),
      embedding
    });

    console.log("✅ Indexé :", filepath);
  } catch (err) {
    console.error("❌ Erreur indexation:", filepath, err.message);
  }
}

async function walk(dir, source) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, source);
    } else if (entry.name.endsWith('.txt') || entry.name.endsWith('.html')) {
      const category = path.basename(path.dirname(fullPath));
      await processFile(fullPath, source, category);
    }
  }
}

(async () => {
  console.log("📁 Indexation de tous les fichiers dans 'docs/'...");
  await walk('./docs/leganet', 'leganet');
  await walk('./docs/droitcongolais', 'droitcongolais');
  console.log("✅ Indexation terminée.");
})();
