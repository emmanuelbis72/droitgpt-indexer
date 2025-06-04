import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { SupabaseVectorStore } from 'langchain/vectorstores/supabase';
import * as dotenv from 'dotenv';
dotenv.config();

const ROOT_DIR = './docs'; // Le dossier racine à indexer
const CATEGORIES = fs.readdirSync(ROOT_DIR);

const supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });

async function indexFile(filePath, category) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const metadata = {
            source: filePath,
            category: category
        };
        await SupabaseVectorStore.fromTexts([content], [metadata], embeddings, {
            client: supabaseClient,
            tableName: 'documents'
        });
        console.log(`✅ Indexé: ${filePath}`);
    } catch (err) {
        console.error(`❌ Erreur lors de l'indexation de ${filePath}:`, err.message);
    }
}

function walkDir(currentPath, category) {
    let entries = [];
    try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
        console.warn(`⛔ Dossier introuvable ou inaccessible : ${currentPath}, on l'ignore...`);
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, category);
        } else if (entry.isFile() && entry.name.endsWith('.txt')) {
            indexFile(fullPath, category);
        }
    }
}

(async () => {
    console.log('🚀 Début de l’indexation des fichiers dans:', ROOT_DIR);
    for (const category of CATEGORIES) {
        const fullPath = path.join(ROOT_DIR, category);
        walkDir(fullPath, category);
    }
    console.log('✅ Indexation terminée.');
})();