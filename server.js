// ✅ server.js – Serveur pour la génération de documents PDF

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import generatePdfRoute from './generatePdf.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Route PDF
app.use('/generate-pdf', generatePdfRoute);

// Test route
app.get('/', (req, res) => {
  res.send('✅ Serveur PDF DroitGPT opérationnel');
});

// Lancement du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur PDF actif sur http://localhost:${PORT}`);
});
