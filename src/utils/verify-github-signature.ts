import crypto from "crypto";
import { CONFIG } from "../config";

export function verifyGithubSignature(
  rawBody: Buffer,
  signature256?: string | string[]
): boolean {
  if (!signature256 || Array.isArray(signature256)) return false;

  const hmac = crypto.createHmac("sha256", CONFIG.webhookSecret);
  hmac.update(rawBody);
  const digest = `sha256=${hmac.digest("hex")}`;

  const a = Buffer.from(signature256);
  const b = Buffer.from(digest);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
