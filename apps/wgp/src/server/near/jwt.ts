/**
 * RS256 JWT verification with WebCrypto and a cached JWKS: enough to check a NEAR Auth
 * (Auth0) ID token on the server without another dependency.
 */
import { webcrypto } from "node:crypto";

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

export interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

export type JwtClaims = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
};

const b64urlBytes = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** Header and claims without checking anything. For display and pre-checks only. */
export function decodeJwt(token: string): { header: Record<string, unknown>; claims: JwtClaims } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("Not a JWT");
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")),
      claims: JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
    };
  } catch {
    throw new JwtError("Malformed JWT");
  }
}

export type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const defaultFetcher: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new JwtError(`JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys: Jwk[] };
};

const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 10 * 60_000;

async function jwks(url: string, fetcher: JwksFetcher, refresh = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (!refresh && hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  const { keys } = await fetcher(url);
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}

export interface VerifyOptions {
  jwksUrl: string;
  issuer: string;
  audience: string;
  /** Seconds of clock skew allowed. */
  leewaySeconds?: number;
  /** Reject tokens issued longer ago than this (seconds). */
  maxAgeSeconds?: number;
  now?: number;
  fetcher?: JwksFetcher;
}

/** Verifies signature (RS256 only), issuer, audience, exp, nbf and age. Returns the claims. */
export async function verifyRs256(token: string, opts: VerifyOptions): Promise<JwtClaims> {
  if (token.length > 8 * 1024) throw new JwtError("JWT is too large");
  const { header, claims } = decodeJwt(token);
  if (header.alg !== "RS256") throw new JwtError("Only RS256 tokens are accepted");
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const fetcher = opts.fetcher ?? defaultFetcher;
  let keys = await jwks(opts.jwksUrl, fetcher);
  let jwk = keys.find((k) => k.kty === "RSA" && (!kid || k.kid === kid));
  if (!jwk) {
    keys = await jwks(opts.jwksUrl, fetcher, true);
    jwk = keys.find((k) => k.kty === "RSA" && (!kid || k.kid === kid));
  }
  if (!jwk?.n || !jwk.e) throw new JwtError("No matching signing key");

  const key = await webcrypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const [h, p, s] = token.split(".") as [string, string, string];
  const valid = await webcrypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new JwtError("Bad signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const leeway = opts.leewaySeconds ?? 60;
  if (claims.iss !== opts.issuer) throw new JwtError("Wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.audience)) throw new JwtError("Wrong audience");
  if (typeof claims.exp !== "number" || claims.exp + leeway < now) throw new JwtError("Token expired");
  if (typeof claims.nbf === "number" && claims.nbf - leeway > now) throw new JwtError("Token not valid yet");
  if (opts.maxAgeSeconds !== undefined) {
    if (typeof claims.iat !== "number" || now - claims.iat > opts.maxAgeSeconds + leeway) throw new JwtError("Token is too old");
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new JwtError("Token has no subject");
  return claims;
}

/** Test hook. */
export function clearJwksCache(): void {
  jwksCache.clear();
}
