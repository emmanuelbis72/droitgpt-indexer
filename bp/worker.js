import dotenv from "dotenv";
import { startPersistentGenerationWorker } from "./core/generationQueue.js";

dotenv.config();

const ok = await startPersistentGenerationWorker();
if (!ok) {
  console.error("[QUEUE] Worker cannot start without REDIS_URL.");
  process.exitCode = 1;
} else {
  console.log("[QUEUE] Standalone generation worker started.");
}

process.on("SIGTERM", () => {
  console.log("[QUEUE] Worker received SIGTERM.");
  process.exit(0);
});

process.stdin.resume();
