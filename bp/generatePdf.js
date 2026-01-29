/**
 * generatePdf.js (shim de compatibilité)
 * Objectif: éviter l'erreur Render "Cannot find module .../bp/generatePdf.js"
 *
 * ✅ Non cassant: si ton serveur n'utilise plus cette route, ce fichier ne change rien.
 * ✅ Si ton server.js fait encore un app.use(..., generatePdf), on expose un Router Express minimal.
 *
 * Tu peux ensuite remplacer ce shim par ta vraie logique si besoin.
 */

import express from "express";

const router = express.Router();

// Health endpoint léger (optionnel)
router.get("/generate-pdf", (_req, res) => {
  res.status(200).json({
    ok: true,
    message:
      "generatePdf.js présent (shim). Cette route est un placeholder. Utilise /generate-business-plan/* pour le service BP.",
  });
});

// Exports compatibles avec plusieurs styles d'import
export default router;
export const generatePdf = router;
