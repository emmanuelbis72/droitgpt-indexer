// indexer/auth/requireAuth.js
import jwt from "jsonwebtoken";

/**
 * Middleware d'authentification JWT
 * Vérifie: Authorization: Bearer <token>
 *
 * ENV requis:
 * JWT_ACCESS_SECRET=change_me
 */
export default function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized – token manquant",
      });
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      console.error("❌ JWT_ACCESS_SECRET manquant dans .env");
      return res.status(500).json({
        error: "Configuration serveur invalide",
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (err) {
      return res.status(401).json({
        error: "Unauthorized – token invalide ou expiré",
      });
    }

    // 🔐 Infos utilisateur disponibles dans les routes protégées
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || "user",
    };

    return next();
  } catch (err) {
    console.error("❌ requireAuth error:", err);
    return res.status(500).json({
      error: "Erreur interne d'authentification",
    });
  }
}
