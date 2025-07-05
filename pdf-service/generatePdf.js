// ✅ generatePdf.js – Génération de documents PDF pour DroitGPT

import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', async (req, res) => {
  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Type ou données manquantes.' });
  }

  // Prompt personnalisé selon le type de document
  let prompt = '';
  switch (type) {
    case 'contratTravail':
      prompt = `Rédige un contrat de travail en français entre ${data.employeur} et ${data.employe}, pour le poste de ${data.poste} avec un salaire de ${data.salaire} par mois.`;
      break;
    case 'procuration':
      prompt = `Rédige une procuration en français où ${data.mandant} donne plein pouvoir à ${data.mandataire} pour ${data.objet}.`;
      break;
    case 'statuts':
      prompt = `Rédige les statuts d'une société nommée ${data.nomSociete}, fondée par ${data.fondateur}, avec un capital de ${data.capital}.`;
      break;
    case 'bail':
      prompt = `Rédige un contrat de bail simple entre un bailleur et un locataire en français.`;
      break;
    case 'note':
      prompt = `Rédige une note juridique en français sur le sujet suivant : ${data.sujet}.`;
      break;
    default:
      return res.status(400).json({ error: 'Type de document non pris en charge.' });
  }

  try {
    // Génération du texte via OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Tu es un juriste congolais professionnel. Génère des documents juridiques clairs, formels et bien structurés.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 1200,
    });

    const content = completion.choices[0].message.content;

    // Création du PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=document_${type}.pdf`);
    doc.pipe(res);
    doc.fontSize(12).text(content, { align: 'left' });
    doc.end();
  } catch (err) {
    console.error('Erreur OpenAI ou PDF:', err.message);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

export default router;
