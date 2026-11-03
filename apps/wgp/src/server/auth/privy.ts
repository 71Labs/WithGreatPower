/**
 * Google sign-in through Privy, on the server.
 *
 * The browser logs in with Google through Privy, makes sure the user has a Privy NEAR
 * embedded wallet (ed25519), and sends us its Privy access token. We trust nothing else
 * it says:
 *   1. the access token is checked with Privy's server SDK: ES256 against the app's JWKS,
 *      issuer "privy.io", audience our app id, not expired; we check the claims again;
 *   2. the user (their Google email and NEAR wallet) is then read from Privy's API with
 *      our app secret, by the user id the token names.
 *
 * Variables (Vercel env; see .env.example):
 *   PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID   the Privy app id (also the token audience)
 *   PRIVY_APP_SECRET                           server only; never shipped to the browser
 *   PRIVY_VERIFICATION_KEY                     optional: the dashboard's verification key,
 *                                              to skip fetching the JWKS
 */
import { normalizeEmail } from "@/server/db/players";
import { HttpError } from "@/server/http";

import { NearKeyError, nearKeyFromWallet, type NearWalletKey } from "../../lib/privy/near-key";

type Env = Record<string, string | undefined>;

export class PrivyConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Privy is not configured: set ${missing.join(", ")}`);
    this.name = "PrivyConfigError";
  }
}

/** The token or the user Privy returned didn't pass a check. */
export class PrivyAuthError extends Error {
  constructor(
    readonly code: "bad_token" | "privy_user" | "near_wallet_missing",
    message: string,
  ) {
    super(message);
    this.name = "PrivyAuthError";
  }
}

export interface PrivyEnv {
  appId: string;
  appSecret: string;
  verificationKey?: string;
}

export function privyEnv(env: Env = process.env): PrivyEnv {
  const appId = (env.PRIVY_APP_ID ?? env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
  const appSecret = (env.PRIVY_APP_SECRET ?? "").trim();
  const missing = [...(appId ? [] : ["NEXT_PUBLIC_PRIVY_APP_ID"]), ...(appSecret ? [] : ["PRIVY_APP_SECRET"])];
  if (missing.length) throw new PrivyConfigError(missing);
  const verificationKey = env.PRIVY_VERIFICATION_KEY?.trim().replace(/\\n/g, "\n");
  return { appId, appSecret, ...(verificationKey ? { verificationKey } : {}) };
}

/* ------------------------------------------------------------------ what we need from Privy */

/** The access token's verified claims, as @privy-io/node returns them. */
export interface PrivyTokenClaims {
  app_id: string;
  issuer: string;
  issued_at: number;
  expiration: number;
  session_id: string;
  user_id: string;
}

/** The parts of Privy's user object we read (`linked_accounts`, snake case, from the REST API). */
export interface PrivyUserRecord {
  id: string;
  linked_accounts: ReadonlyArray<Record<string, unknown>>;
}

/** Privy, as far as sign-in goes. The real one wraps @privy-io/node; tests pass a fake. */
export interface PrivyPort {
  verifyAccessToken(accessToken: string): Promise<PrivyTokenClaims>;
  getUser(userId: string): Promise<PrivyUserRecord>;
}

let port: { key: string; value: Promise<PrivyPort> } | null = null;

/** The Privy client for this server (created once per app id; the SDK caches the JWKS). */
export function privyPort(env: PrivyEnv = privyEnv()): Promise<PrivyPort> {
  const key = `${env.appId}\0${env.appSecret}`;
  if (port?.key === key) return port.value;
  const value = (async (): Promise<PrivyPort> => {
    const { PrivyClient } = await import("@privy-io/node");
    const client = new PrivyClient({ appId: env.appId, appSecret: env.appSecret, ...(env.verificationKey ? { jwtVerificationKey: env.verificationKey } : {}) });
    return {
      verifyAccessToken: (token) => client.utils().auth().verifyAccessToken(token),
      getUser: async (userId) => (await client.users()._get(userId)) as unknown as PrivyUserRecord,
    };
  })();
  value.catch(() => {
    if (port?.value === value) port = null;
  });
  port = { key, value };
  return value;
}

/* ------------------------------------------------------------------ the identity we trust */

export interface PrivyIdentity {
  /** The Privy user id ("did:privy:…"): the player's `authSub`. */
  userId: string;
  /** The verified Google email, lowercased; null if the user has none. */
  email: string | null;
  /** The user's Privy NEAR embedded wallet, or null before they have one. */
  near: NearWalletKey | null;
}

const verified = (a: Record<string, unknown>) => typeof a.verified_at === "number" && a.verified_at > 0;

/**
 * The user's verified email: their Google account's (Google checked it), else an email
 * Privy verified with a one-time code. Pure.
 */
export function verifiedEmail(accounts: ReadonlyArray<Record<string, unknown>>): string | null {
  const google = accounts.find((a) => a.type === "google_oauth" && verified(a));
  const fromGoogle = google ? normalizeEmail(google.email) : null;
  if (fromGoogle) return fromGoogle;
  const otp = accounts.find((a) => a.type === "email" && verified(a));
  return otp ? normalizeEmail(otp.address) : null;
}

/**
 * The user's Privy NEAR embedded wallet (the first one, by wallet index). External NEAR
 * wallets a user may have linked don't count: only Privy's own key signs for us. Pure.
 */
export function nearWallet(accounts: ReadonlyArray<Record<string, unknown>>): NearWalletKey | null {
  const wallets = accounts
    .filter((a) => a.type === "wallet" && a.chain_type === "near" && (a.connector_type === "embedded" || a.wallet_client_type === "privy"))
    .sort((a, b) => Number(a.wallet_index ?? 0) - Number(b.wallet_index ?? 0));
  const w = wallets[0];
  if (!w) return null;
  try {
    return nearKeyFromWallet({ address: typeof w.address === "string" ? w.address : null, publicKey: typeof w.public_key === "string" ? w.public_key : null });
  } catch (error) {
    if (error instanceof NearKeyError) throw new PrivyAuthError("privy_user", `Privy's NEAR wallet is unusable: ${error.message}`);
    throw error;
  }
}

/** The identity in a Privy user record. Pure. */
export function identityFromUser(user: PrivyUserRecord): PrivyIdentity {
  if (typeof user.id !== "string" || !user.id.startsWith("did:privy:") || user.id.length > 128) {
    throw new PrivyAuthError("privy_user", "Privy returned an unexpected user id");
  }
  const accounts = Array.isArray(user.linked_accounts) ? user.linked_accounts : [];
  return { userId: user.id, email: verifiedEmail(accounts), near: nearWallet(accounts) };
}

/**
 * Checks a Privy access token and reads the user it names from Privy. Throws
 * PrivyAuthError("bad_token") for a token that is forged, for another app, or expired.
 */
export async function verifyPrivyLogin(accessToken: string, opts: { port: PrivyPort; appId: string; now?: number }): Promise<PrivyIdentity> {
  let claims: PrivyTokenClaims;
  try {
    claims = await opts.port.verifyAccessToken(accessToken);
  } catch (error) {
    throw new PrivyAuthError("bad_token", error instanceof Error ? error.message : "The access token didn't verify");
  }
  // The SDK checks these too; checking again keeps a misconfigured SDK from letting one through.
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.issuer !== "privy.io") throw new PrivyAuthError("bad_token", "The token is from another issuer");
  if (claims.app_id !== opts.appId) throw new PrivyAuthError("bad_token", "The token is for another app");
  if (!Number.isFinite(claims.expiration) || claims.expiration <= nowSeconds) throw new PrivyAuthError("bad_token", "The token has expired");
  if (typeof claims.user_id !== "string" || !claims.user_id) throw new PrivyAuthError("bad_token", "The token names no user");

  let user: PrivyUserRecord;
  try {
    user = await opts.port.getUser(claims.user_id);
  } catch (error) {
    throw new PrivyAuthError("privy_user", `Couldn't read the user from Privy: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (user?.id !== claims.user_id) throw new PrivyAuthError("privy_user", "Privy returned a different user");
  return identityFromUser(user);
}

/** Reads a known user from Privy again (claiming a name re-checks their wallet). */
export async function readPrivyIdentity(userId: string, opts: { port: PrivyPort }): Promise<PrivyIdentity> {
  let user: PrivyUserRecord;
  try {
    user = await opts.port.getUser(userId);
  } catch (error) {
    throw new PrivyAuthError("privy_user", `Couldn't read the user from Privy: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (user?.id !== userId) throw new PrivyAuthError("privy_user", "Privy returned a different user");
  return identityFromUser(user);
}

/** Privy errors as HTTP errors with messages fit for callers. Anything else passes through. */
export function toPrivyHttpError(error: unknown): unknown {
  if (error instanceof PrivyConfigError) return new HttpError(503, "privy_not_configured", "Google sign-in isn't set up on this server");
  if (error instanceof PrivyAuthError) {
    if (error.code === "bad_token") return new HttpError(401, "bad_token", `Privy token rejected: ${error.message}`);
    if (error.code === "near_wallet_missing") return new HttpError(409, "near_wallet_missing", error.message);
    return new HttpError(502, "privy_user", error.message);
  }
  return error;
}
