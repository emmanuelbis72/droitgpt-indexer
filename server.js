// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import generatePdfRoute from './generatePdf.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Route PDF
app.use('/generate-pdf', generatePdfRoute);

app.get('/', (req, res) => {
  res.send('✅ Serveur DroitGPT PDF en ligne');
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur PDF actif sur http://localhost:${PORT}`);
});
