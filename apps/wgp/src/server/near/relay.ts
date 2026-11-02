/**
 * The meta-transaction relayer. Players sign NEP-366 delegate actions with their session
 * key; we wrap them in a transaction from relayer.wgp.* and pay the gas.
 *
 * `validateGameDelegate` and `validateAddKeyDelegate` are pure: the route decodes the
 * bytes, looks the sender and key up in the database, reads the block height, and hands
 * all of it in. Only what passes is submitted.
 *
 * A game call is accepted only when:
 *   - the signature verifies against the delegate's public key;
 *   - the sender is a known player (and the signed-in one, when there is a session);
 *   - the key is that player's live session key;
 *   - the receiver is the game contract;
 *   - there is exactly one action, a FunctionCall with zero deposit to an allowlisted
 *     method, with at most 30 Tgas and small JSON args;
 *   - max_block_height is ahead of the chain and at most 300 blocks ahead.
 */
import { createHash } from "node:crypto";

import {
  actions as nearActions,
  buildDelegateAction,
  encodeDelegateAction,
  KeyType,
  PublicKey,
  Signature,
  type Action,
  type Account,
} from "near-api-js";

import {
  signableBytes,
  type DecodedDelegate,
  type DecodedSignedDelegate,
  type DelegateActionItem,
} from "../../lib/near/delegate-codec";
import {
  MAX_DELEGATE_TTL_BLOCKS,
  MAX_RELAY_ARGS_BYTES,
  MAX_RELAY_GAS,
  RELAY_METHODS,
  SESSION_KEY_ALLOWANCE,
  TGAS,
} from "../../lib/near/policy";
import { relayerEnv } from "./env";
import { keyedAccount } from "./rpc";

/* ------------------------------------------------------------------ validation (pure) */

export type RelayRejectCode =
  | "bad_signature"
  | "unknown_sender"
  | "banned"
  | "wrong_account"
  | "unknown_key"
  | "revoked_key"
  | "wrong_receiver"
  | "action_count"
  | "wrong_action"
  | "deposit"
  | "method"
  | "gas"
  | "args"
  | "expired"
  | "too_far_ahead"
  | "wrong_key"
  | "allowance";

export interface RelayRejection {
  ok: false;
  status: 400 | 401 | 403;
  code: RelayRejectCode;
  message: string;
}

export interface GameCall {
  ok: true;
  senderId: string;
  methodName: string;
  gas: bigint;
}

export interface KnownSender {
  playerId: string;
  accountId: string;
  banned: boolean;
}

export interface KnownSessionKey {
  playerId: string;
  publicKey: string;
  revoked: boolean;
}

export interface RelayContext {
  contractId: string;
  /** The chain's current (final) block height. */
  blockHeight: bigint;
  /** The player whose NEAR account is the delegate's sender, or null if none is. */
  sender: KnownSender | null;
  /** The stored session key matching the delegate's public key, or null. */
  sessionKey: KnownSessionKey | null;
  /** The signed-in player's account, when the request carries a session. */
  sessionAccountId?: string | null;
}

const reject = (status: RelayRejection["status"], code: RelayRejectCode, message: string): RelayRejection => ({
  ok: false,
  status,
  code,
  message,
});

/** sha256(prefix ‖ delegate) verified with the delegate's own public key. */
export function verifyDelegateSignature(signed: DecodedSignedDelegate): boolean {
  try {
    const hash = createHash("sha256").update(signableBytes(signed.delegateBytes)).digest();
    return PublicKey.fromString(signed.delegate.publicKey).verify(new Uint8Array(hash), signed.signature);
  } catch {
    return false;
  }
}

function checkWindow(d: DecodedDelegate, blockHeight: bigint): RelayRejection | null {
  if (d.maxBlockHeight <= blockHeight) return reject(400, "expired", "The delegate has expired; sign it again");
  if (d.maxBlockHeight > blockHeight + MAX_DELEGATE_TTL_BLOCKS) {
    return reject(400, "too_far_ahead", `max_block_height may be at most ${MAX_DELEGATE_TTL_BLOCKS} blocks ahead`);
  }
  return null;
}

function checkSender(d: DecodedDelegate, ctx: Pick<RelayContext, "sender" | "sessionAccountId">): RelayRejection | null {
  if (!ctx.sender || ctx.sender.accountId !== d.senderId) return reject(403, "unknown_sender", "Unknown player account");
  if (ctx.sender.banned) return reject(403, "banned", "This account is suspended");
  if (ctx.sessionAccountId && ctx.sessionAccountId !== d.senderId) {
    return reject(403, "wrong_account", "The delegate is not from the signed-in account");
  }
  return null;
}

/** Whether `args` is a JSON object (what every game method takes). */
function isJsonObject(args: Uint8Array): boolean {
  try {
    const v: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(args));
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** Decides whether a session-key game call may be relayed. Pure. */
export function validateGameDelegate(signed: DecodedSignedDelegate, ctx: RelayContext): GameCall | RelayRejection {
  const d = signed.delegate;
  if (!verifyDelegateSignature(signed)) return reject(401, "bad_signature", "The signature does not match the delegate");
  const senderProblem = checkSender(d, ctx);
  if (senderProblem) return senderProblem;
  const key = ctx.sessionKey;
  if (!key || key.publicKey !== d.publicKey || key.playerId !== ctx.sender!.playerId) {
    return reject(403, "unknown_key", "Unknown session key");
  }
  if (key.revoked) return reject(403, "revoked_key", "This session key was revoked");
  if (d.receiverId !== ctx.contractId) return reject(400, "wrong_receiver", `Only ${ctx.contractId} can be called`);
  if (d.actions.length !== 1) return reject(400, "action_count", "Exactly one action is relayed");
  const action = d.actions[0]!;
  if (action.kind !== "FunctionCall") return reject(400, "wrong_action", "Only function calls are relayed");
  if (action.deposit !== 0n) return reject(400, "deposit", "Relayed calls carry no deposit");
  if (!(RELAY_METHODS as readonly string[]).includes(action.methodName)) {
    return reject(400, "method", `${action.methodName} is not relayed`);
  }
  if (action.gas <= 0n || action.gas > MAX_RELAY_GAS) return reject(400, "gas", `Gas must be between 1 and ${MAX_RELAY_GAS / TGAS} Tgas`);
  if (action.args.length > MAX_RELAY_ARGS_BYTES || !isJsonObject(action.args)) {
    return reject(400, "args", "Arguments must be a small JSON object");
  }
  const windowProblem = checkWindow(d, ctx.blockHeight);
  if (windowProblem) return windowProblem;
  return { ok: true, senderId: d.senderId, methodName: action.methodName, gas: action.gas };
}

export interface AddKeyContext {
  contractId: string;
  blockHeight: bigint;
  sender: KnownSender | null;
  sessionAccountId?: string | null;
  /** Whether the delegate's public key is a full-access key of the sender (checked on chain). */
  signerIsFullAccess: boolean;
  /** The session key this browser registered and wants added. */
  expectedNewKey: string;
}

export interface AddKeyCall {
  ok: true;
  senderId: string;
  newKey: string;
}

/**
 * Decides whether a NEAR Auth-signed "add my new session key" delegate may be relayed
 * (a returning player on a new device). Pure. Accepts exactly one AddKey, on the
 * player's own account, of the expected key, limited to the game contract with at most
 * the standard allowance, signed by one of the account's full-access keys.
 */
export function validateAddKeyDelegate(signed: DecodedSignedDelegate, ctx: AddKeyContext): AddKeyCall | RelayRejection {
  const d = signed.delegate;
  if (!verifyDelegateSignature(signed)) return reject(401, "bad_signature", "The signature does not match the delegate");
  const senderProblem = checkSender(d, ctx);
  if (senderProblem) return senderProblem;
  if (!ctx.signerIsFullAccess) return reject(403, "wrong_key", "The delegate must be signed by the account's own key");
  if (d.receiverId !== d.senderId) return reject(400, "wrong_receiver", "Keys can only be added to the signer's own account");
  if (d.actions.length !== 1) return reject(400, "action_count", "Exactly one action is relayed");
  const action = d.actions[0]!;
  if (action.kind !== "AddKey" || action.permission.kind !== "FunctionCall") {
    return reject(400, "wrong_action", "Only adding a function-call key is relayed");
  }
  if (action.publicKey !== ctx.expectedNewKey) return reject(400, "wrong_key", "That is not this device's session key");
  if (action.nonce !== 0n) return reject(400, "wrong_action", "New keys start at nonce 0");
  const p = action.permission;
  if (p.receiverId !== ctx.contractId) return reject(400, "wrong_receiver", `Session keys may only call ${ctx.contractId}`);
  if (p.allowance === null || p.allowance > SESSION_KEY_ALLOWANCE) {
    return reject(400, "allowance", "Session keys carry at most a 0.05 NEAR allowance");
  }
  if (p.methodNames.some((m) => !(RELAY_METHODS as readonly string[]).includes(m))) {
    return reject(400, "method", "Session keys may only name game methods");
  }
  const windowProblem = checkWindow(d, ctx.blockHeight);
  if (windowProblem) return windowProblem;
  return { ok: true, senderId: d.senderId, newKey: action.publicKey };
}

/* ------------------------------------------------------------------ submission */

/** Rebuilds a near-api-js Action from a decoded one (only the kinds we relay). */
function toAction(a: DelegateActionItem): Action {
  switch (a.kind) {
    case "FunctionCall":
      return nearActions.functionCall(a.methodName, a.args, a.gas, a.deposit);
    case "AddKey":
      if (a.permission.kind !== "FunctionCall") throw new Error("Full-access keys are never relayed");
      return nearActions.addFunctionCallAccessKey(
        PublicKey.fromString(a.publicKey),
        a.permission.receiverId,
        a.permission.methodNames,
        a.permission.allowance ?? undefined,
      );
    default:
      throw new Error(`Not relayable: ${a.kind}`);
  }
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The SignedDelegate action, re-encoded and checked byte for byte against what was signed. */
export function toSignedDelegateAction(signed: DecodedSignedDelegate): Action {
  const d = signed.delegate;
  const delegateAction = buildDelegateAction({
    senderId: d.senderId,
    receiverId: d.receiverId,
    actions: d.actions.map(toAction),
    nonce: d.nonce,
    maxBlockHeight: d.maxBlockHeight,
    publicKey: PublicKey.fromString(d.publicKey),
  });
  if (!equalBytes(encodeDelegateAction(delegateAction), signableBytes(signed.delegateBytes))) {
    throw new Error("Re-encoded delegate differs from the signed bytes");
  }
  return nearActions.signedDelegate({
    delegateAction,
    signature: new Signature({ keyType: KeyType.ED25519, data: signed.signature }),
  });
}

/** Which relayer key signs for a sender: stable per sender, spread across keys. */
export function relayerKeyIndex(senderId: string, keyCount: number): number {
  if (keyCount < 1) throw new Error("No relayer keys");
  return createHash("sha256").update(senderId).digest().readUInt32BE(0) % keyCount;
}

export function relayerAccountFor(senderId: string): Account {
  const env = relayerEnv();
  return keyedAccount(env.accountId, env.privateKeys[relayerKeyIndex(senderId, env.privateKeys.length)]!);
}

interface Outcome {
  transaction_outcome: { id: string; outcome: { gas_burnt: number | string; status: unknown } };
  receipts_outcome: { id: string; outcome: { gas_burnt: number | string; status: unknown; logs?: string[] } }[];
  status: unknown;
}

export interface RelayResult {
  txHash: string;
  ok: boolean;
  /** The first failure, when an inner receipt failed (e.g. the contract panicked). */
  error?: string;
  /** The function call's JSON return value, when there is one. */
  result?: unknown;
  gasBurnt: bigint;
}

/** Reads a meta-transaction outcome: total gas, the inner call's result or its first failure. */
export function summarizeOutcome(outcome: Outcome): RelayResult {
  const all = [outcome.transaction_outcome, ...outcome.receipts_outcome];
  const gasBurnt = all.reduce((sum, o) => sum + BigInt(o.outcome.gas_burnt), 0n);
  const failure = all
    .map((o) => o.outcome.status)
    .find((s): s is { Failure: unknown } => typeof s === "object" && s !== null && "Failure" in s);
  let result: unknown;
  for (const r of outcome.receipts_outcome) {
    const s = r.outcome.status as { SuccessValue?: string } | null;
    if (s && typeof s === "object" && typeof s.SuccessValue === "string" && s.SuccessValue.length > 0) {
      try {
        result = JSON.parse(Buffer.from(s.SuccessValue, "base64").toString("utf8"));
      } catch {
        result = s.SuccessValue;
      }
    }
  }
  return {
    txHash: outcome.transaction_outcome.id,
    ok: !failure,
    error: failure ? JSON.stringify(failure.Failure).slice(0, 500) : undefined,
    result,
    gasBurnt,
  };
}

/**
 * Wraps the signed delegate in a relayer transaction and waits for every receipt.
 * near-api-js retries InvalidNonce on its own (the relayer key's nonce raced another
 * instance), up to `retries` times.
 */
export async function submitSignedDelegate(signed: DecodedSignedDelegate, retries = 3): Promise<RelayResult> {
  const action = toSignedDelegateAction(signed);
  const account = relayerAccountFor(signed.delegate.senderId);
  const outcome = await account.signAndSendTransaction({
    receiverId: signed.delegate.senderId,
    actions: [action],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
    retries,
  });
  return summarizeOutcome(outcome as unknown as Outcome);
}

let balanceCheck: { at: number; ok: boolean } | null = null;

/** Circuit breaker: false when the relayer's balance is under RELAYER_MIN_BALANCE_NEAR. Cached for a minute. */
export async function relayerHasFunds(now = Date.now()): Promise<boolean> {
  if (balanceCheck && now - balanceCheck.at < 60_000) return balanceCheck.ok;
  const env = relayerEnv();
  const state = await keyedAccount(env.accountId, env.privateKeys[0]!).getState();
  const ok = BigInt(state.balance.available) >= env.minBalanceYocto;
  balanceCheck = { at: now, ok };
  return ok;
}

/** Gas to reserve from the daily budget before relaying: the inner call's gas plus overhead, in Tgas. */
export function reserveTgasFor(innerGas: bigint): number {
  return Number((innerGas + TGAS - 1n) / TGAS) + 5;
}
