// business-plan-service/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import generateBusinessPlanRoute from "./routes/generateBusinessPlan.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "4mb" }));

app.use("/generate-business-plan", generateBusinessPlanRoute);

app.get("/", (_req, res) => {
  res.send("✅ Business Plan Service opérationnel.");
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Business Plan Service en ligne sur http://localhost:${PORT}`);
});

server.keepAliveTimeout = 1000 * 60 * 10;
server.headersTimeout = 1000 * 60 * 11;
