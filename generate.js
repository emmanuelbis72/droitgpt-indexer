// ✅ Backend : generate.js (mise à jour avec PDFKit)
import express from 'express';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import { config } from 'dotenv';

config();
const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔧 Nouvelle route PDF
router.post('/generate-pdf', async (req, res) => {
  const { type, data } = req.body;
  if (!type || !data) return res.status(400).json({ error: 'Type ou données manquantes.' });

  let prompt = '';
  switch (type) {
    case 'contratTravail':
      prompt = `Rédige un contrat de travail professionnel entre ${data.employeur} et ${data.employe} pour le poste de ${data.poste}, avec un salaire mensuel de ${data.salaire}.`;
      break;
    case 'procuration':
      prompt = `Rédige une procuration où ${data.mandant} donne pouvoir à ${data.mandataire} pour ${data.objet}.`;
      break;
    case 'statuts':
      prompt = `Rédige les statuts de la société ${data.nomSociete} fondée par ${data.fondateur}, avec un capital social de ${data.capital}.`;
      break;
    case 'bail':
      prompt = `Rédige un contrat de bail entre ${data.bailleur} et ${data.locataire} pour le bien situé à ${data.adresse}, pour un loyer mensuel de ${data.loyer}.`;
      break;
    case 'note':
      prompt = `Rédige une note juridique structurée sur le sujet suivant : ${data.sujet}`;
      break;
    default:
      return res.status(400).json({ error: 'Type de document non pris en charge.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Tu es un assistant juridique congolais. Rédige des documents juridiques professionnels, clairs, bien structurés.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const text = completion.choices[0].message.content.trim();
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=document.pdf' });
      res.send(pdfBuffer);
    });

    doc.font('Times-Roman').fontSize(12).text(text, { align: 'left' });
    doc.end();
  } catch (err) {
    console.error('Erreur OpenAI :', err);
    res.status(500).json({ error: 'Erreur lors de la génération.' });
  }
});

export default router;
