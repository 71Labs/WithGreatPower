/**
 * Google sign-in through Privy, in the browser. The account sheet loads this module when
 * it needs it (it pulls in near-api-js for the session key); Privy itself is reached
 * through the bridge (./bridge.ts), never imported here.
 *
 * 1. `startPrivyGoogle()`: Privy is ready and the user is already logged in to Privy →
 *    "authenticated", go straight to step 2. Otherwise the page leaves for Google.
 * 2. `finishPrivySignIn()`, back on our page: make sure the user has a Privy NEAR wallet,
 *    then POST /api/auth/privy with Privy's access token and this browser's session key.
 *    A new player may get `needs-handle`: call it again with `handle`.
 *
 * Also here: claiming a name (unclaimed players) and adding this browser's session key
 * with the Privy key (quick play on a new device). Signing out of Privy is in the bridge.
 */
import { actions, buildDelegateAction, PublicKey } from "near-api-js";

import { GAME_CONTRACT_ID, RPC_URLS } from "../near/config";
import { DELEGATE_TTL_BLOCKS, SESSION_KEY_ALLOWANCE, SESSION_KEY_METHODS, isImplicitAccountId } from "../near/policy";
import { accessKeyNonce, finalBlockHeight, makeProvider } from "../near/rpc";
import { assembleSignedDelegate, bindSessionKey, createSessionKey, delegateHash, deviceId, ensureSessionKey, loadSessionKey, postToRelay, type SessionKey } from "../near/session-key";

import { whenPrivy } from "./bridge";
import { implicitToPublicKey } from "./near-key";

export class PrivySignInError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PrivySignInError";
  }
}

export interface PrivySignIn {
  accountId: string;
  /** This sign-in made the player. */
  created: boolean;
  /** This browser's session key can play now. */
  sessionKeyLive: boolean;
  /** The player is on their key's implicit account and can claim a name later. */
  unclaimed: boolean;
  /** Found by verified email: they first signed up with NEAR Auth. */
  linked: boolean;
}

export type PrivyOutcome = ({ status: "signed-in" } & PrivySignIn) | { status: "needs-handle"; suggestedHandle?: string; parentId?: string };

/** POSTs JSON with the device header; throws PrivySignInError with the server's code. */
async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wgp-device": deviceId() },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    throw new PrivySignInError("Couldn’t reach the server", "network");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new PrivySignInError(json.message ?? `Request failed (${res.status})`, json.error ?? `http_${res.status}`);
  return json;
}

/**
 * The session key for a brand-new account: this browser's key, unless it already lives
 * on another account (one browser, two players), in which case a fresh one.
 */
async function keyForNewAccount(): Promise<SessionKey> {
  const key = await loadSessionKey();
  return key && key.accountId === null ? key : createSessionKey();
}

/** Step 1, from the "Continue with Google" tap. */
export async function startPrivyGoogle(): Promise<"authenticated" | "redirecting"> {
  const api = await whenPrivy();
  if (api.authenticated) return "authenticated";
  try {
    await api.loginWithGoogle();
  } catch (error) {
    // Privy's own errors name its endpoints; the player only needs to know it didn't start.
    console.warn("[privy] Google login didn't start:", error);
    throw new PrivySignInError("Google sign-in couldn’t start", "oauth_start_failed");
  }
  return "redirecting";
}

/** Step 2: the NEAR wallet, then our server. See the module comment. */
export async function finishPrivySignIn(opts: { handle?: string } = {}): Promise<PrivyOutcome> {
  const api = await whenPrivy({ authenticated: true, timeoutMs: 30_000 });
  await api.ensureNearWallet();
  const key = opts.handle ? await keyForNewAccount() : await ensureSessionKey();
  const body = await post<Partial<PrivySignIn> & { needsHandle?: boolean; suggestedHandle?: string; parentId?: string }>("/api/auth/privy", {
    accessToken: await api.accessToken(),
    handle: opts.handle,
    sessionPublicKey: key.publicKey,
  });
  if (body.needsHandle) return { status: "needs-handle", suggestedHandle: body.suggestedHandle, parentId: body.parentId };
  if (!body.accountId) throw new PrivySignInError("The server didn’t say which account you’re on", "bad_response");
  if (body.sessionKeyLive) await bindSessionKey(body.accountId);
  return {
    status: "signed-in",
    accountId: body.accountId,
    created: Boolean(body.created),
    sessionKeyLive: Boolean(body.sessionKeyLive),
    unclaimed: Boolean(body.unclaimed),
    linked: Boolean(body.linked),
  };
}

/** "Claim your name": moves an unclaimed player onto `<handle>.<parent>`. */
export async function claimPrivyName(handle: string): Promise<{ accountId: string; txHash: string | null; sessionKeyLive: boolean }> {
  const key = await keyForNewAccount();
  const body = await post<{ accountId?: string; txHash?: string | null; sessionKeyLive?: boolean }>("/api/auth/privy/claim", { handle, sessionPublicKey: key.publicKey });
  if (!body.accountId) throw new PrivySignInError("The server didn’t say which account you’re on", "bad_response");
  if (body.sessionKeyLive) await bindSessionKey(body.accountId);
  return { accountId: body.accountId, txHash: body.txHash ?? null, sessionKeyLive: Boolean(body.sessionKeyLive) };
}

/**
 * A returning Privy player on a new device: the Privy NEAR key signs AddKey(this
 * browser's session key, game contract only) as a delegate, and our relayer submits it.
 * Privy signs raw hashes without a popup.
 */
export async function addSessionKeyWithPrivy(accountId: string): Promise<{ txHash?: string }> {
  const api = await whenPrivy({ authenticated: true, timeoutMs: 15_000 }).catch(() => {
    throw new PrivySignInError("Sign in with Google again to turn on quick play here", "privy_not_signed_in");
  });
  const wallet = await api.ensureNearWallet();
  if (!isImplicitAccountId(wallet.address)) throw new PrivySignInError("Privy’s NEAR wallet has an unexpected address", "bad_wallet");
  const userKey = implicitToPublicKey(wallet.address);
  const key = await ensureSessionKey();
  const rpc = makeProvider(RPC_URLS);
  const [nonce, height] = await Promise.all([accessKeyNonce(rpc, accountId, userKey), finalBlockHeight(rpc)]);
  if (nonce === null) throw new PrivySignInError("Your Google key isn’t on this account", "privy_wrong_account");
  const delegate = buildDelegateAction({
    senderId: accountId,
    receiverId: accountId,
    actions: [actions.addFunctionCallAccessKey(PublicKey.fromString(key.publicKey), GAME_CONTRACT_ID, SESSION_KEY_METHODS, SESSION_KEY_ALLOWANCE)],
    nonce: nonce + 1n,
    maxBlockHeight: height + DELEGATE_TTL_BLOCKS,
    publicKey: PublicKey.fromString(userKey),
  });
  const signature = await api.signRawHash(wallet.address, await delegateHash(delegate));
  const res = await postToRelay(assembleSignedDelegate(delegate, signature), { kind: "add-key", newKey: key.publicKey });
  if (!res.ok) throw new PrivySignInError(res.message ?? "Couldn’t add the session key", res.error ?? "relay_failed");
  await bindSessionKey(accountId);
  return { txHash: res.txHash };
}
