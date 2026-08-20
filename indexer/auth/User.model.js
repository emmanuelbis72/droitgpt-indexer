// indexer/auth/User.model.js
import mongoose from "mongoose";

/**
 * Modèle utilisateur DroitGPT
 * Utilisé pour l’authentification (register / login)
 * Identifiants = phone et email (format E.164 recommande: +243816307451)
 */

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      index: true,
      maxlength: 180,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    passwordResetRequestedAt: {
      type: Date,
      default: null,
      select: false,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
    },

    role: {
      type: String,
      enum: ["user", "admin", "premium"],
      default: "user",
    },

    // Extensions futures possibles
    // isActive: { type: Boolean, default: true },
    // lastLoginAt: { type: Date },
    // subscriptionEndsAt: { type: Date },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

// Sécurité : ne jamais exposer le hash du mot de passe
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.passwordResetTokenHash;
  return obj;
};

const User = mongoose.model("User", UserSchema);

export default User;
