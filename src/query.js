const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { config } = require('dotenv');
const { OpenAIEmbeddings, ChatOpenAI } = require('@langchain/openai');
const { SupabaseVectorStore } = require('@langchain/community/vectorstores/supabase');

config(); // charge .env

const app = express();
app.use(cors());
app.use(express.json());

// Initialisation Supabase
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });

const vectorStore = new SupabaseVectorStore(embeddings, {
    client,
    tableName: 'documents',
    queryName: 'match_documents',
});

const model = new ChatOpenAI({ temperature: 0, openAIApiKey: process.env.OPENAI_API_KEY });

app.post('/ask', async (req, res) => {
    const { question } = req.body;

    try {
        const results = await vectorStore.similaritySearch(question, 3);
        const context = results.map(doc => doc.pageContent).join('\n');

        const response = await model.call([
            {
                role: 'user',
                content: `Réponds à la question suivante en te basant sur les documents :\n${context}\n\nQuestion : ${question}`,
            },
        ]);

        res.json({ answer: response.text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur de traitement' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur API lancé sur le port ${PORT}`));
