/**
 * NEAR Auth in the browser: Google sign-in through Auth0, and MPC signatures for
 * delegate actions. Wraps @fast-auth-near/browser-sdk + javascript-provider.
 *
 * Every signature is an Auth0 popup (or a full-page redirect) that mints a JWT whose
 * `fatxn` claim is the exact payload; our relayer then calls `sign` on the NEAR Auth
 * contract with it (/api/relay/fast-auth) and returns the MPC signature. Because
 * `fatxn` is the NEP-461-prefixed delegate itself, the signed delegate can be rebuilt
 * from the signature request alone, so the redirect flow needs no saved state.
 *
 * The SDKs load lazily, only in the browser. Their bundled near-api-js 5 encodes
 * delegates byte-for-byte like our near-api-js 7 (checked on Nov 2).
 */
import type { FastAuthClient, FastAuthSigner } from "@fast-auth-near/browser-sdk";
import type { JavascriptProvider } from "@fast-auth-near/javascript-provider";
import { actions, base64Decode, buildDelegateAction, encodeDelegateAction, PublicKey, type DelegateAction } from "near-api-js";

import { DELEGATE_ACTION_PREFIX } from "./delegate-codec";
import { GAME_CONTRACT_ID, NEAR_AUTH, NETWORK, RPC_URLS, nearAuthPath } from "./config";
import { DELEGATE_TTL_BLOCKS, SESSION_KEY_ALLOWANCE, SESSION_KEY_METHODS } from "./policy";
import { accessKeyNonce, finalBlockHeight, makeProvider } from "./rpc";
import { bindSessionKey, deviceId, ensureSessionKey, postToRelay } from "./session-key";

export interface SignatureRequest {
  guardId: string;
  /** The Auth0 JWT; its `fatxn` claim equals `signPayload`. */
  verifyPayload: string;
  signPayload: number[];
  algorithm: string;
}

export interface IdClaims {
  sub: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
}

interface Auth0Like {
  getIdTokenClaims(): Promise<(Record<string, unknown> & { __raw?: string; sub?: string }) | undefined>;
}

export class NearAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "NearAuthError";
  }
}

export class NearAuth {
  #signer: FastAuthSigner<JavascriptProvider> | null = null;

  constructor(
    readonly provider: JavascriptProvider,
    readonly client: FastAuthClient<JavascriptProvider>,
  ) {}

  /** The Auth0 client inside the provider (private there; we need the raw ID token). */
  get #auth0(): Auth0Like {
    return (this.provider as unknown as { client: Auth0Like }).client;
  }

  /**
   * Finishes a redirect flow if the URL carries Auth0's `code` and `state`, then strips
   * them from the address bar. Call it once on pages that use `redirectUri`.
   */
  async handleRedirect(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const returning = params.has("code") && params.has("state");
    const loggedIn = await this.provider.isLoggedIn();
    if (returning) {
      params.delete("code");
      params.delete("state");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
    }
    return returning && loggedIn;
  }

  isLoggedIn(): Promise<boolean> {
    return this.provider.isLoggedIn();
  }

  /** Google sign-in. A popup by default; pass `redirectUri` for a full-page redirect. */
  async login(opts: { redirectUri?: string; forceSelectAccount?: boolean } = {}): Promise<{ userId: string }> {
    this.#signer = null;
    const r = await this.client.login(opts.redirectUri ? { redirectUri: opts.redirectUri } : {}, opts.forceSelectAccount);
    return r as { userId: string };
  }

  /** Clears the local Auth0 session (no redirect to Auth0's logout page). */
  async logout(): Promise<void> {
    this.#signer = null;
    await this.provider.logout({ openUrl: false });
  }

  async claims(): Promise<IdClaims> {
    const c = await this.#auth0.getIdTokenClaims();
    if (!c?.sub) throw new NearAuthError("Not signed in", "USER_NOT_LOGGED_IN");
    return { sub: c.sub, email: c.email as string | undefined, iss: c.iss as string | undefined, aud: c.aud as string | undefined, exp: c.exp as number | undefined };
  }

  /** The raw Auth0 ID token, for the server to verify (POST /api/auth/near-auth). */
  async idToken(): Promise<string> {
    const raw = (await this.#auth0.getIdTokenClaims())?.__raw;
    if (!raw) throw new NearAuthError("No ID token; sign in again", "NO_ID_TOKEN");
    return raw;
  }

  async signer(): Promise<FastAuthSigner<JavascriptProvider>> {
    return (this.#signer ??= await this.client.getSigner());
  }

  /** The MPC derivation path for the signed-in user. */
  async path(): Promise<string> {
    return nearAuthPath((await this.claims()).sub);
  }

  /** The user's NEAR Auth public key ("ed25519:…"), derived by the MPC contract. */
  async publicKey(): Promise<string> {
    const key = await (await this.signer()).getPublicKey("ed25519");
    return String(key);
  }

  /** Asks the user to approve a delegate action: a popup, or a redirect with `redirectUri`. */
  async requestDelegateSignature(delegate: DelegateAction, opts: { redirectUri?: string } = {}): Promise<void> {
    const signer = await this.signer();
    await signer.requestDelegateActionSignature({ delegateAction: delegate as never, ...(opts.redirectUri ? { redirectUri: opts.redirectUri } : {}) });
  }

  /** The approved request (after the popup closes, or on the redirect's return). */
  async signatureRequest(): Promise<SignatureRequest> {
    const { signatureRequest } = (await (await this.signer()).getSignatureRequest()) as unknown as {
      signatureRequest: { guardId: string; verifyPayload: string; signPayload: ArrayLike<number> };
    };
    return {
      guardId: signatureRequest.guardId,
      verifyPayload: signatureRequest.verifyPayload,
      signPayload: Array.from(signatureRequest.signPayload),
      algorithm: "eddsa",
    };
  }

  /** Has our relayer call NEAR Auth's `sign`. Returns the 64-byte MPC signature. */
  async relaySign(req: SignatureRequest): Promise<{ signature: Uint8Array; txHash: string }> {
    const res = await fetch("/api/relay/fast-auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wgp-device": deviceId() },
      credentials: "same-origin",
      body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => ({}))) as { signature?: string; txHash?: string; error?: string; message?: string };
    if (!res.ok || !body.signature) throw new NearAuthError(body.message ?? `Relay failed (${res.status})`, body.error);
    return { signature: base64Decode(body.signature), txHash: body.txHash ?? "" };
  }

  /**
   * Popup flow end to end: approve, relay `sign`, return borsh(SignedDelegateAction)
   * ready for /api/relay/meta.
   */
  async signDelegate(delegate: DelegateAction): Promise<{ signedDelegate: Uint8Array; signTxHash: string }> {
    await this.requestDelegateSignature(delegate);
    const req = await this.signatureRequest();
    const expected = encodeDelegateAction(delegate);
    if (req.signPayload.length !== expected.length || req.signPayload.some((b, i) => b !== expected[i])) {
      throw new NearAuthError("NEAR Auth approved a different payload", "PAYLOAD_MISMATCH");
    }
    const { signature, txHash } = await this.relaySign(req);
    return { signedDelegate: signedDelegateFromRequest(req.signPayload, signature), signTxHash: txHash };
  }
}

/** borsh(SignedDelegateAction) from a signature request's payload (prefix ‖ delegate) and its signature. */
export function signedDelegateFromRequest(signPayload: ArrayLike<number>, signature: Uint8Array): Uint8Array {
  const payload = Uint8Array.from(signPayload);
  const prefix = new DataView(payload.buffer).getUint32(0, true);
  if (prefix !== DELEGATE_ACTION_PREFIX) throw new NearAuthError("The approved payload is not a delegate action", "NOT_DELEGATE");
  if (signature.length !== 64) throw new NearAuthError("Ed25519 signatures are 64 bytes", "BAD_SIGNATURE");
  const out = new Uint8Array(payload.length - 4 + 1 + 64);
  out.set(payload.subarray(4), 0);
  out[payload.length - 4] = 0; // Signature::ED25519
  out.set(signature, payload.length - 3);
  return out;
}

export interface NearAuthSignIn {
  accountId: string;
  /** True when this sign-in created the account. */
  created: boolean;
  /** Whether this browser's session key can play now (false: call addSessionKeyWithNearAuth). */
  sessionKeyLive: boolean;
}

/**
 * Plan A in one call: Google login (popup), then POST /api/auth/near-auth with the ID
 * token and this browser's session key. New players need `handle`; the server creates
 * `<handle>.wgp.*` holding their NEAR Auth key and the session key, and sets the session
 * cookie. Returning players on a new device get `sessionKeyLive: false`.
 */
export async function nearAuthSignIn(opts: { handle?: string } = {}): Promise<NearAuthSignIn> {
  const auth = await getNearAuth();
  if (!(await auth.isLoggedIn())) await auth.login();
  const key = await ensureSessionKey();
  const res = await fetch("/api/auth/near-auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-wgp-device": deviceId() },
    credentials: "same-origin",
    body: JSON.stringify({ mode: "sign-in", idToken: await auth.idToken(), handle: opts.handle, sessionPublicKey: key.publicKey }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<NearAuthSignIn> & { error?: string; message?: string };
  if (!res.ok || !body.accountId) throw new NearAuthError(body.message ?? `Sign-in failed (${res.status})`, body.error);
  if (body.created || body.sessionKeyLive) await bindSessionKey(body.accountId);
  return { accountId: body.accountId, created: Boolean(body.created), sessionKeyLive: Boolean(body.sessionKeyLive) };
}

/**
 * A returning player on a new device: NEAR Auth signs AddKey(this browser's session key,
 * game contract only) as a delegate (one popup), and our relayer submits it. Call it
 * from a click so the popup isn't blocked.
 */
export async function addSessionKeyWithNearAuth(accountId: string): Promise<{ txHash?: string }> {
  const auth = await getNearAuth();
  const key = await ensureSessionKey();
  const userKey = await auth.publicKey();
  const rpc = makeProvider(RPC_URLS);
  const [nonce, height] = await Promise.all([accessKeyNonce(rpc, accountId, userKey), finalBlockHeight(rpc)]);
  if (nonce === null) throw new NearAuthError("Your Google key isn't on this account", "WRONG_ACCOUNT");
  const delegate = buildDelegateAction({
    senderId: accountId,
    receiverId: accountId,
    actions: [actions.addFunctionCallAccessKey(PublicKey.fromString(key.publicKey), GAME_CONTRACT_ID, SESSION_KEY_METHODS, SESSION_KEY_ALLOWANCE)],
    nonce: nonce + 1n,
    maxBlockHeight: height + DELEGATE_TTL_BLOCKS,
    publicKey: PublicKey.fromString(userKey),
  });
  const { signedDelegate } = await auth.signDelegate(delegate);
  const res = await postToRelay(signedDelegate, { kind: "add-key", newKey: key.publicKey });
  if (!res.ok) throw new NearAuthError(res.message ?? "Couldn't add the session key", res.error);
  await bindSessionKey(accountId);
  return { txHash: res.txHash };
}

let instance: Promise<NearAuth> | null = null;

/** The NEAR Auth client for this page (created once). Browser only. */
export function getNearAuth(): Promise<NearAuth> {
  if (typeof window === "undefined") return Promise.reject(new NearAuthError("NEAR Auth runs in the browser"));
  instance ??= (async () => {
    if (!NEAR_AUTH.clientId) throw new NearAuthError("NEAR Auth has no client id for this network", "NO_CLIENT_ID");
    const [{ JavascriptProvider }, { FastAuthClient }] = await Promise.all([
      import("@fast-auth-near/javascript-provider"),
      import("@fast-auth-near/browser-sdk"),
    ]);
    const provider = new JavascriptProvider({ network: NETWORK, clientId: NEAR_AUTH.clientId, domain: NEAR_AUTH.domain });
    // The SDK only needs `connection.provider.query` (for derived_public_key).
    const rpc = makeProvider(RPC_URLS);
    const connection = { provider: { query: (params: unknown) => rpc.query(params as never) } };
    const client = new FastAuthClient(provider, connection as never, {
      fastAuthContractId: NEAR_AUTH.fastAuthContractId,
      mpcContractId: NEAR_AUTH.mpcContractId,
    });
    return new NearAuth(provider, client);
  })().catch((error: unknown) => {
    instance = null;
    throw error;
  });
  return instance;
}
