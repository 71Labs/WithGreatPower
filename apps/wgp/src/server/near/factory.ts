/**
 * Creates `<handle>.wgp.*` for a new player in one transaction from the factory (the
 * parent account), with two keys:
 *   1. the user's own full-access key (their NEAR Auth MPC key, or a wallet key), so the
 *      account belongs to them and only they can move assets;
 *   2. the browser's session key: function-call only, game contract only, 0.05 NEAR
 *      allowance. It can play, never transfer (transfers need 1 yoctoNEAR).
 * The account starts with FACTORY_INITIAL_BALANCE (default 0): with two keys and no
 * contract it fits NEAR's zero-balance allowance, and the relayer pays its gas.
 */
import { actions, PublicKey, type Action } from "near-api-js";
import { AccountAlreadyExistsActionError } from "near-api-js/rpc-errors";

import { HANDLE_RE, RESERVED_HANDLES, SESSION_KEY_ALLOWANCE, SESSION_KEY_METHODS } from "../../lib/near/policy";
import { accountExists } from "../../lib/near/rpc";
import { chainEnv, factoryEnv } from "./env";
import { summarizeOutcome } from "./relay";
import { keyedAccount, provider } from "./rpc";

export class HandleError extends Error {
  constructor(
    readonly code: "invalid_handle" | "reserved_handle" | "handle_taken",
    message: string,
  ) {
    super(message);
    this.name = "HandleError";
  }
}

/** Lowercases and checks a handle. Throws HandleError. */
export function normalizeHandle(raw: string): string {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new HandleError("invalid_handle", "Handles are 2–32 of a–z, 0–9, - and _, starting and ending with a letter or digit");
  if (RESERVED_HANDLES.has(handle)) throw new HandleError("reserved_handle", "That handle is reserved");
  return handle;
}

export function playerAccountId(handle: string, parentId: string): string {
  const id = `${handle}.${parentId}`;
  if (id.length > 64) throw new HandleError("invalid_handle", "That handle is too long");
  return id;
}

/** A handle to offer a new player, from their email's local part ("peter.parker@…" → "peterparker"). Pure. */
export function suggestHandle(email: string | undefined): string | undefined {
  const local = email?.split("@")[0]?.toLowerCase() ?? "";
  const cleaned = local.replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+|[-_]+$/g, "").slice(0, 24).replace(/[-_]+$/, "");
  if (!HANDLE_RE.test(cleaned) || RESERVED_HANDLES.has(cleaned)) return undefined;
  return cleaned;
}

/**
 * Checks, read-only, that `<handle>.<factory>` is free. Run it before anything single-use
 * (a sign-in nonce) is spent, so a taken handle costs the player a retype, not a new login.
 */
export async function assertHandleAvailable(raw: string): Promise<string> {
  const accountId = playerAccountId(normalizeHandle(raw), factoryEnv().accountId);
  if (await accountExists(provider(), accountId)) throw new HandleError("handle_taken", "That handle is taken");
  return accountId;
}

/** The four actions of the create-account transaction. Pure. */
export function createAccountActions(input: {
  userPublicKey: string;
  sessionPublicKey: string;
  contractId: string;
  initialBalance: bigint;
}): Action[] {
  if (input.userPublicKey === input.sessionPublicKey) throw new Error("The session key must differ from the user's key");
  return [
    actions.createAccount(),
    actions.transfer(input.initialBalance),
    actions.addFullAccessKey(PublicKey.fromString(input.userPublicKey)),
    actions.addFunctionCallAccessKey(PublicKey.fromString(input.sessionPublicKey), input.contractId, SESSION_KEY_METHODS, SESSION_KEY_ALLOWANCE),
  ];
}

export interface CreatedAccount {
  accountId: string;
  txHash: string;
}

/* ------------------------------------------------------------------ is the factory open? */

/**
 * Whether new player accounts can be made right now: the factory's keys are configured
 * AND its account exists on chain (the owner funds and creates it with
 * scripts/near/setup-mainnet.sh). Until then, Google players through Privy sign up on
 * their key's implicit account id and claim a name later.
 */
export type FactoryState = { open: true; parentId: string } | { open: false; reason: "not_configured" | "not_on_chain" | "unreachable" };

/** How long each answer is trusted. An open factory stays open; a missing one is looked for again soon. */
const FACTORY_STATE_TTL_MS = { open: 10 * 60_000, not_on_chain: 30_000, unreachable: 10_000 } as const;

let factoryCache: { key: string; until: number; state: FactoryState } | null = null;

/** Read-only (one view_account, cached). Never throws. */
export async function factoryState(opts: { now?: number; exists?: (accountId: string) => Promise<boolean>; env?: Record<string, string | undefined> } = {}): Promise<FactoryState> {
  let parentId: string;
  try {
    parentId = factoryEnv(opts.env).accountId;
    chainEnv(opts.env);
  } catch {
    return { open: false, reason: "not_configured" };
  }
  const now = opts.now ?? Date.now();
  if (factoryCache && factoryCache.key === parentId && factoryCache.until > now) return factoryCache.state;
  let state: FactoryState;
  try {
    const exists = await (opts.exists ?? ((id: string) => accountExists(provider(), id)))(parentId);
    state = exists ? { open: true, parentId } : { open: false, reason: "not_on_chain" };
  } catch {
    state = { open: false, reason: "unreachable" };
  }
  const ttl = state.open ? FACTORY_STATE_TTL_MS.open : state.reason === "not_on_chain" ? FACTORY_STATE_TTL_MS.not_on_chain : FACTORY_STATE_TTL_MS.unreachable;
  factoryCache = { key: parentId, until: now + ttl, state };
  return state;
}

/** Tests: forget the cached answer. */
export function clearFactoryState(): void {
  factoryCache = null;
}

/** Which of a player's keys an existing account holds. Read-only. */
export interface AccountKeys {
  /** The player's own key is a full-access key of the account. */
  userKey: boolean;
  /** This browser's session key is on the account. */
  sessionKey: boolean;
}

async function hasKey(accountId: string, publicKey: string, fullAccess: boolean): Promise<boolean> {
  const key = await provider()
    .viewAccessKey({ accountId, publicKey, finalityQuery: { finality: "optimistic" } })
    .catch(() => null);
  if (!key) return false;
  return fullAccess ? key.permission === "FullAccess" : true;
}

/** null when the account doesn't exist; else which of the keys it holds. */
export async function inspectAccount(accountId: string, keys: { userPublicKey: string; sessionPublicKey?: string }): Promise<AccountKeys | null> {
  if (!(await accountExists(provider(), accountId))) return null;
  const [userKey, sessionKey] = await Promise.all([
    hasKey(accountId, keys.userPublicKey, true),
    keys.sessionPublicKey ? hasKey(accountId, keys.sessionPublicKey, false) : Promise.resolve(false),
  ]);
  return { userKey, sessionKey };
}

/** Creates the player's account. Throws HandleError("handle_taken") if it exists. */
export async function createPlayerAccount(input: {
  handle: string;
  userPublicKey: string;
  sessionPublicKey: string;
}): Promise<CreatedAccount> {
  const factory = factoryEnv();
  const { contractId } = chainEnv();
  const handle = normalizeHandle(input.handle);
  const accountId = playerAccountId(handle, factory.accountId);
  if (await accountExists(provider(), accountId)) throw new HandleError("handle_taken", "That handle is taken");

  const account = keyedAccount(factory.accountId, factory.privateKey);
  try {
    const outcome = await account.signAndSendTransaction({
      receiverId: accountId,
      actions: createAccountActions({
        userPublicKey: input.userPublicKey,
        sessionPublicKey: input.sessionPublicKey,
        contractId,
        initialBalance: factory.initialBalance,
      }),
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: true,
    });
    const summary = summarizeOutcome(outcome as unknown as Parameters<typeof summarizeOutcome>[0]);
    if (!summary.ok) throw new Error(`Account creation failed: ${summary.error}`);
    return { accountId, txHash: summary.txHash };
  } catch (error) {
    if (error instanceof AccountAlreadyExistsActionError) throw new HandleError("handle_taken", "That handle is taken");
    throw error;
  }
}
