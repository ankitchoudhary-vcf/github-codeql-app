import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import { CONFIG } from "./config";
import { installationsRouter } from "./routes/api/installations";
import { reportsRouter } from "./routes/api/reports";
import { reposRouter } from "./routes/api/repos";
import { webhookRouter } from "./routes/webhooks";
import { alertsRouter } from "./routes/api/alerts";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI || CONFIG.mongoUri, {
    dbName: "codeql_manager",
  } as any);
  console.log("✅ MongoDB connected");

  const app = express();

  app.use(
    cors({
      origin: "http://localhost:5173",
      credentials: true,
    })
  );

  // 👉 raw ONLY for GitHub webhook route
  app.use("/webhooks/github", express.raw({ type: "application/json" }));

  // 👉 json for everything else
  app.use(express.json());

  app.use("/webhooks/github", webhookRouter);
  app.use("/api/installations", installationsRouter);
  app.use("/api/repos", reposRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/alerts", alertsRouter);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.listen(CONFIG.port, () => {
    console.log(`🚀 Server running on :${CONFIG.port}`);
  });
}

main().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});
