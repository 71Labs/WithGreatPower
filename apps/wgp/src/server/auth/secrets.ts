/**
 * Server secrets from the environment. Production refuses to run without them; local
 * dev and tests fall back to fixed, obviously-not-secret values so `pnpm dev` works
 * with an empty .env.local.
 */
import { createHmac } from "node:crypto";

export type SecretName = "SEED_SECRET" | "AUTH_SECRET";

const DEV_FALLBACK: Record<SecretName, string> = {
  SEED_SECRET: "wgp-dev-seed-secret-not-for-production",
  AUTH_SECRET: "wgp-dev-auth-secret-not-for-production",
};

export function secret(name: SecretName, env: Record<string, string | undefined> = process.env): string {
  const value = env[name];
  if (value && value.length >= 16) return value;
  if (env.NODE_ENV === "production") throw new Error(`${name} is not set (at least 16 characters)`);
  return DEV_FALLBACK[name];
}

/** HMAC-SHA256 as hex, with a purpose label so one key never signs two kinds of thing alike. */
export function hmacHex(key: string, purpose: string, value: string): string {
  return createHmac("sha256", key).update(`${purpose}\0${value}`).digest("hex");
}
