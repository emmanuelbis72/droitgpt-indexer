// indexer/auth/auth.routes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "./User.model.js";

const router = express.Router();

/**
 * ENV requis:
 * JWT_ACCESS_SECRET=change_me
 * ACCESS_TOKEN_TTL=7d (ou 15m, 1d, etc.)
 */

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

/* =======================
   Utils
======================= */

function normalizePhone(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[()\s-]/g, "");
  return /^\+\d{8,15}$/.test(cleaned) ? cleaned : "";
}

function signAccessToken(user) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET manquant");

  return jwt.sign(
    {
      sub: user._id.toString(),
      phone: user.phone,
      fullName: user.fullName,
      role: user.role || "user",
    },
    secret,
    { expiresIn: process.env.ACCESS_TOKEN_TTL || "7d" }
  );
}

function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    phone: user.phone,
    role: user.role || "user",
    createdAt: user.createdAt,
  };
}

/* =======================
   REGISTER
   POST /auth/register
   { fullName, phone, password }
======================= */
router.post("/register", async (req, res) => {
  try {
    const { fullName, phone, password } = req.body || {};

    const cleanName = String(fullName || "").trim();
    const cleanPhone = normalizePhone(phone);

    if (!cleanName || !cleanPhone || !password) {
      return res.status(400).json({
        error: "Champs requis : fullName, phone, password.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit avoir au moins 6 caractères.",
      });
    }

    const exists = await User.findOne({ phone: cleanPhone });
    if (exists) {
      return res.status(409).json({
        error: "Ce numéro WhatsApp est déjà utilisé.",
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await User.create({
      fullName: cleanName,
      phone: cleanPhone,
      passwordHash,
      role: "user",
    });

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

/* =======================
   LOGIN
   POST /auth/login
   { phone, password }
======================= */
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone || !password) {
      return res.status(400).json({
        error: "Numéro WhatsApp et mot de passe requis.",
      });
    }

    const user = await User.findOne({ phone: cleanPhone });
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

/* =======================
   ME
   GET /auth/me (Bearer)
======================= */
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error("JWT_ACCESS_SECRET manquant");

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

/* =======================
   LOGOUT
======================= */
router.post("/logout", async (_req, res) => {
  return res.json({ ok: true });
});

/* =======================
   ADMIN – STATS
   GET /auth/admin/stats
======================= */
router.get("/admin/stats", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const totalUsers = await User.countDocuments({});
    return res.json({ totalUsers });
  } catch (err) {
    console.error("❌ /auth/admin/stats error:", err);
    return res.status(500).json({ error: "Erreur serveur (admin stats)." });
  }
});

/* =======================
   ADMIN – LIST USERS
   GET /auth/admin/users
======================= */
router.get("/admin/users", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const users = await User.find({})
      .sort({ createdAt: -1 })
      .select("fullName phone role createdAt");

    return res.json({ users });
  } catch (err) {
    console.error("❌ /auth/admin/users error:", err);
    return res.status(500).json({ error: "Erreur serveur (admin users)." });
  }
});

export default router;
