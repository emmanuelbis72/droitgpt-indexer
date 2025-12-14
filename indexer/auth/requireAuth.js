// indexer/auth/requireAuth.js
import jwt from "jsonwebtoken";

/**
 * Middleware d'authentification JWT
 * Vérifie: Authorization: Bearer <token>
 * ENV requis: JWT_ACCESS_SECRET
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return res.status(401).json({ error: "Unauthorized – token manquant" });
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      console.error("❌ JWT_ACCESS_SECRET manquant");
      return res.status(500).json({ error: "Configuration serveur invalide" });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ error: "Unauthorized – token invalide ou expiré" });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || "user",
    };

    return next();
  } catch (err) {
    console.error("❌ requireAuth error:", err);
    return res.status(500).json({ error: "Erreur interne d'authentification" });
  }
}

// ✅ Export nommé + export default (compatibilité maximale)
export { requireAuth };
export default requireAuth;
