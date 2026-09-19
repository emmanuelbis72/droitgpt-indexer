import { resolveGenerationUserKey } from "./generationQueue.js";

export function ensureJobAccess(req, res, job) {
  const owner = String(job?.userKey || "").trim();
  if (!owner) return true;

  const requester = String(resolveGenerationUserKey(req) || "").trim();
  if (requester && requester === owner) return true;

  res.status(403).json({
    error: "JOB_FORBIDDEN",
    details: "Ce document appartient a un autre utilisateur.",
  });
  return false;
}
