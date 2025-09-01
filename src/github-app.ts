import jwt from "jsonwebtoken";
import { CONFIG } from "./config";

export function generateAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - 60, exp: now + 600, iss: CONFIG.appId },
    CONFIG.privateKey,
    { algorithm: "RS256" }
  );
}

export async function getInstallationToken(
  installationId: number
): Promise<string> {
  const appJwt = generateAppJwt();
  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to get installation token: ${text}`);
  }
  const data = await resp.json();
  return data.token as string;
}
