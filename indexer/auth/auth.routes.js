// indexer/auth/auth.routes.js
import crypto from "node:crypto";
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "./User.model.js";

const router = express.Router();

/**
 * ENV requis:
 * JWT_ACCESS_SECRET=change_me
 * ACCESS_TOKEN_TTL=7d
 *
 * Pour "mot de passe oublie" en production:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, FRONTEND_URL
 */

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const RESET_TOKEN_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.PASSWORD_RESET_TTL_MS || 60 * 60 * 1000));

/* =======================
   Utils
======================= */

function normalizePhone(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[()\s-]/g, "");
  return /^\+\d{8,15}$/.test(cleaned) ? cleaned : "";
}

function normalizeEmail(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : "";
}

function resetTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function getFrontendUrl() {
  return String(process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || "https://droitgpt-ui.vercel.app").replace(/\/$/, "");
}

function signAccessToken(user) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET manquant");

  return jwt.sign(
    {
      sub: user._id.toString(),
      phone: user.phone,
      email: user.email || null,
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
    email: user.email || "",
    role: user.role || "user",
    createdAt: user.createdAt,
  };
}

async function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass || !from) {
    console.warn("[AUTH] SMTP not configured. Password reset link:", resetUrl);
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to,
    subject: "Reinitialisation de votre mot de passe DroitGPT",
    text: `Bonjour ${fullName || ""},\n\nCliquez sur ce lien pour reinitialiser votre mot de passe DroitGPT :\n${resetUrl}\n\nCe lien expire dans 1 heure. Si vous n'avez pas demande cette action, ignorez cet email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2>Reinitialisation de votre mot de passe DroitGPT</h2>
        <p>Bonjour ${fullName || ""},</p>
        <p>Vous avez demande la reinitialisation de votre mot de passe.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#059669;color:#fff;padding:12px 16px;border-radius:10px;text-decoration:none">Reinitialiser mon mot de passe</a></p>
        <p>Ce lien expire dans 1 heure. Si vous n'avez pas demande cette action, ignorez cet email.</p>
      </div>
    `,
  });

  return { sent: true };
}

/* =======================
   REGISTER
   POST /auth/register
   { fullName, phone, email?, password }
======================= */
router.post("/register", async (req, res) => {
  try {
    const { fullName, phone, email, password } = req.body || {};

    const cleanName = String(fullName || "").trim();
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = normalizeEmail(email);

    if (!cleanName || !cleanPhone || !password) {
      return res.status(400).json({
        error: "Champs requis : fullName, phone, password.",
      });
    }

    if (email && !cleanEmail) {
      return res.status(400).json({ error: "Adresse email invalide." });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit avoir au moins 6 caracteres.",
      });
    }

    const duplicateQuery = cleanEmail ? { $or: [{ phone: cleanPhone }, { email: cleanEmail }] } : { phone: cleanPhone };
    const exists = await User.findOne(duplicateQuery);
    if (exists?.phone === cleanPhone) {
      return res.status(409).json({
        error: "Ce numero WhatsApp est deja utilise.",
      });
    }
    if (cleanEmail && exists?.email === cleanEmail) {
      return res.status(409).json({
        error: "Cette adresse email est deja utilisee.",
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await User.create({
      fullName: cleanName,
      phone: cleanPhone,
      email: cleanEmail || undefined,
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
   { identifier|phone|email, password }
======================= */
router.post("/login", async (req, res) => {
  try {
    const { identifier, phone, email, password } = req.body || {};
    const rawIdentifier = String(identifier || email || phone || "").trim();
    const cleanEmail = normalizeEmail(email || (rawIdentifier.includes("@") ? rawIdentifier : ""));
    const cleanPhone = normalizePhone(phone || (!rawIdentifier.includes("@") ? rawIdentifier : ""));

    if ((!cleanEmail && !cleanPhone) || !password) {
      return res.status(400).json({
        error: "Email ou numero WhatsApp et mot de passe requis.",
      });
    }

    const user = await User.findOne(cleanEmail ? { email: cleanEmail } : { phone: cleanPhone });
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
   FORGOT PASSWORD
   POST /auth/forgot-password
   { email }
======================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);

    // Reponse volontairement generique pour eviter l'enumeration d'emails.
    const generic = {
      ok: true,
      message: "Si cette adresse existe, un email de reinitialisation sera envoye.",
    };

    if (!cleanEmail) return res.json(generic);

    const user = await User.findOne({ email: cleanEmail }).select("+passwordResetTokenHash +passwordResetExpiresAt +passwordResetRequestedAt");
    if (!user) return res.json(generic);

    const token = crypto.randomBytes(32).toString("hex");
    const resetUrl = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    user.passwordResetTokenHash = resetTokenHash(token);
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    user.passwordResetRequestedAt = new Date();
    await user.save();

    const delivery = await sendPasswordResetEmail({
      to: user.email,
      fullName: user.fullName,
      resetUrl,
    });

    return res.json({
      ...generic,
      emailSent: Boolean(delivery.sent),
      devResetUrl: process.env.NODE_ENV === "production" ? undefined : resetUrl,
    });
  } catch (err) {
    console.error("❌ /auth/forgot-password error:", err);
    return res.status(500).json({ error: "Erreur serveur (forgot password)." });
  }
});

/* =======================
   RESET PASSWORD
   POST /auth/reset-password
   { token, password }
======================= */
router.post("/reset-password", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || password.length < 6) {
      return res.status(400).json({ error: "Token et nouveau mot de passe valide requis." });
    }

    const user = await User.findOne({
      passwordResetTokenHash: resetTokenHash(token),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select("+passwordResetTokenHash +passwordResetExpiresAt +passwordResetRequestedAt");

    if (!user) {
      return res.status(400).json({ error: "Lien de reinitialisation invalide ou expire." });
    }

    user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.passwordResetRequestedAt = null;
    user.passwordChangedAt = new Date();
    await user.save();

    const accessToken = signAccessToken(user);
    return res.json({
      ok: true,
      accessToken,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("❌ /auth/reset-password error:", err);
    return res.status(500).json({ error: "Erreur serveur (reset password)." });
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
   ADMIN - STATS
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
   ADMIN - LIST USERS
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
      .select("fullName phone email role createdAt");

    return res.json({ users });
  } catch (err) {
    console.error("❌ /auth/admin/users error:", err);
    return res.status(500).json({ error: "Erreur serveur (admin users)." });
  }
});

export default router;
