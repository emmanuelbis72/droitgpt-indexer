// 📄 pdf-service/server.js – Service indépendant de génération PDF
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import generatePdfRoute from './generatePdf.js';
import generateLicenceMemoireRoute from './routes/generateLicenceMemoire.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/generate-pdf', generatePdfRoute);
app.use('/generate-academic', generateLicenceMemoireRoute);

app.get('/', (req, res) => {
  res.send('✅ Serveur de génération PDF opérationnel.');
});

app.listen(PORT, () => {
  console.log(`🚀 PDF Service en ligne sur http://localhost:${PORT}`);
});
