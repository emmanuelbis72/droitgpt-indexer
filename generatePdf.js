// generatePdf.js
import express from 'express';
import PDFDocument from 'pdfkit';
import OpenAI from 'openai';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/', async (req, res) => {
  const { type, data } = req.body;
  let prompt = '';

  switch (type) {
    case 'contratTravail':
      prompt = `Rédige un contrat de travail simple en français entre ${data.employeur} et ${data.employe} pour le poste de ${data.poste}, avec un salaire mensuel de ${data.salaire}.`;
      break;
    case 'procuration':
      prompt = `Rédige une procuration où ${data.mandant} donne pouvoir à ${data.mandataire} pour ${data.objet}.`;
      break;
    case 'statuts':
      prompt = `Rédige les statuts simplifiés d'une société nommée ${data.nomSociete}, fondée par ${data.fondateur}, avec un capital de ${data.capital}.`;
      break;
    case 'bail':
      prompt = `Rédige un contrat de bail locatif entre le bailleur ${data.bailleur} et le locataire ${data.locataire} pour la maison située à ${data.adresse}, avec un loyer mensuel de ${data.loyer}.`;
      break;
    case 'note':
      prompt = `Rédige une note juridique sur : ${data.sujet}`;
      break;
    default:
      return res.status(400).json({ error: 'Type de document non reconnu.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Tu es un assistant juridique congolais.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 1000,
    });

    const content = completion.choices[0].message.content;

    const doc = new PDFDocument();
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=document.pdf');
      res.send(pdfBuffer);
    });

    doc.fontSize(12).text(content, { align: 'left' });
    doc.end();

  } catch (err) {
    console.error('Erreur génération PDF:', err);
    res.status(500).json({ error: 'Erreur serveur PDF', details: err.message });
  }
});

export default router;
