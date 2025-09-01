import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  appId: process.env.GITHUB_APP_ID || "",
  privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || "",
  privateKey: "",
};

if (!CONFIG.mongoUri) throw new Error("MONGO_URI missing");
if (!CONFIG.webhookSecret) throw new Error("WEBHOOK_SECRET missing");
if (!CONFIG.appId) throw new Error("GITHUB_APP_ID missing");
if (!CONFIG.privateKeyPath) throw new Error("GITHUB_PRIVATE_KEY_PATH missing");

CONFIG.privateKey = fs.readFileSync(CONFIG.privateKeyPath, "utf8");
