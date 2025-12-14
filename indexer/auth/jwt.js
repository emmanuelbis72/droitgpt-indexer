// indexer/auth/jwt.js
import jwt from "jsonwebtoken";

/**
 * Variables d'environnement requises :
 * JWT_ACCESS_SECRET=change_me
 * ACCESS_TOKEN_TTL=7d   (ex: 15m | 1h | 1d | 7d)
 */

/**
 * Génère un Access Token JWT
 * @param {Object} user - utilisateur Mongo ou SQL
 */
export function signAccessToken(user) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET manquant dans les variables d'environnement");
  }

  return jwt.sign(
    {
      sub: user._id?.toString?.() || user.id, // Mongo ou SQL
      email: user.email,
      role: user.role || "user",
    },
    secret,
    {
      expiresIn: process.env.ACCESS_TOKEN_TTL || "7d",
    }
  );
}

/**
 * Vérifie un Access Token JWT
 * @param {string} token
 * @returns payload décodé
 */
export function verifyAccessToken(token) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET manquant dans les variables d'environnement");
  }

  return jwt.verify(token, secret);
}

/**
 * Extrait le token depuis le header Authorization
 * @param {string} authHeader
 */
export function extractBearerToken(authHeader = "") {
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
