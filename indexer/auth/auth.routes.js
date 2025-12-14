// indexer/auth/auth.routes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "./User.model.js"; // ✅ à créer (mongoose model)

const router = express.Router();

/**
 * ENV requis:
 * JWT_ACCESS_SECRET=change_me
 * ACCESS_TOKEN_TTL=7d (ou 15m, 1d, etc.)
 */

function signAccessToken(user) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET manquant dans .env");

  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      role: user.role || "user",
    },
    secret,
    { expiresIn: process.env.ACCESS_TOKEN_TTL || "7d" }
  );
}

function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role || "user",
    createdAt: user.createdAt,
  };
}

// ✅ POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = (email || "").trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis." });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Le mot de passe doit avoir au moins 6 caractères." });
    }

    const exists = await User.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(409).json({ error: "Cet email est déjà utilisé." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: cleanEmail,
      passwordHash,
      role: "user",
    });

    // Option: auto-login après inscription
    const accessToken = signAccessToken(user);

    return res.status(201).json({
      accessToken,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("❌ /auth/register error:", err);
    return res.status(500).json({ error: "Erreur serveur (register)." });
  }
});

// ✅ POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = (email || "").trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis." });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({ error: "Identifiants invalides." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Identifiants invalides." });
    }

    const accessToken = signAccessToken(user);

    return res.json({
      accessToken,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("❌ /auth/login error:", err);
    return res.status(500).json({ error: "Erreur serveur (login)." });
  }
});

// ✅ GET /auth/me  (Bearer token)
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error("JWT_ACCESS_SECRET manquant dans .env");

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });

    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("❌ /auth/me error:", err);
    return res.status(500).json({ error: "Erreur serveur (me)." });
  }
});

// ✅ POST /auth/logout (facultatif avec accessToken only)
// Ici, rien à invalider côté serveur sans refresh token / blacklist.
// On répond juste OK. Le frontend supprime son token.
router.post("/logout", async (_req, res) => {
  return res.json({ ok: true });
});

export default router;
