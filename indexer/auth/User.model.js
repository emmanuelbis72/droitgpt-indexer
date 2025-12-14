// indexer/auth/User.model.js
import mongoose from "mongoose";

/**
 * Modèle utilisateur DroitGPT
 * Utilisé pour l’authentification (register / login)
 */

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    passwordHash: {
      type: String,
      required: true,
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
  return obj;
};

const User = mongoose.model("User", UserSchema);

export default User;
