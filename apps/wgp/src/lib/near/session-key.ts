/**
 * The browser's session key: an Ed25519 key that may only call the game contract (no
 * deposit, so no transfers), kept in IndexedDB. Where the browser supports WebCrypto
 * Ed25519 the private key is non-extractable: page script can use it but never read
 * it out. Older browsers fall back to a near-api-js key stored as a string.
 *
 * Game calls are NEP-366 delegate actions signed here and posted to /api/relay/meta;
 * the relayer pays the gas. Browser only.
 */
import {
  actions,
  base64Encode,
  baseEncode,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  KeyType,
  PublicKey,
  Signature,
  type DelegateAction,
  type KeyPairString,
  type Provider,
} from "near-api-js";

import { NETWORK, GAME_CONTRACT_ID, RPC_URLS } from "./config";
import { DEFAULT_RELAY_GAS, DELEGATE_TTL_BLOCKS, type RelayMethod } from "./policy";
import { accessKeyNonce, finalBlockHeight, makeProvider } from "./rpc";

export interface SessionKey {
  /** "ed25519:<base58>". */
  publicKey: string;
  /** The account the key was added to, once known. */
  accountId: string | null;
  /** "webcrypto" (non-extractable) or "stored" (fallback). */
  storage: "webcrypto" | "stored";
  /** Ed25519 signature of `message`. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

interface StoredKey {
  id: string;
  publicKey: string;
  privateKey?: CryptoKey;
  secretKey?: KeyPairString;
  accountId: string | null;
  /** Last delegate nonce used, as a decimal string. */
  lastNonce?: string;
  createdAt: number;
}

const DB_NAME = "wgp-near";
const STORE = "keys";
const recordId = (network = NETWORK) => `session:${network}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const getRecord = (id: string) => tx<StoredKey | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredKey | undefined>);
const putRecord = (rec: StoredKey) => tx("readwrite", (s) => s.put(rec));

function toSessionKey(rec: StoredKey): SessionKey {
  if (rec.privateKey) {
    const key = rec.privateKey;
    return {
      publicKey: rec.publicKey,
      accountId: rec.accountId,
      storage: "webcrypto",
      sign: async (message) => new Uint8Array(await crypto.subtle.sign("Ed25519", key, message as BufferSource)),
    };
  }
  if (!rec.secretKey) throw new Error("Stored session key is incomplete");
  const pair = KeyPair.fromString(rec.secretKey);
  return { publicKey: rec.publicKey, accountId: rec.accountId, storage: "stored", sign: async (message) => pair.sign(message).signature };
}

/** Whether WebCrypto can make non-extractable Ed25519 keys here. */
async function webCryptoEd25519(): Promise<CryptoKeyPair | null> {
  try {
    return (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  } catch {
    return null;
  }
}

/** The session key for this network, or null if there isn't one yet. */
export async function loadSessionKey(network = NETWORK): Promise<SessionKey | null> {
  const rec = await getRecord(recordId(network));
  return rec ? toSessionKey(rec) : null;
}

/** Makes a new session key (replacing any old one) and stores it. */
export async function createSessionKey(network = NETWORK): Promise<SessionKey> {
  const pair = await webCryptoEd25519();
  let rec: StoredKey;
  if (pair) {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    rec = { id: recordId(network), publicKey: `ed25519:${baseEncode(raw)}`, privateKey: pair.privateKey, accountId: null, createdAt: Date.now() };
  } else {
    const kp = KeyPair.fromRandom("ed25519");
    rec = { id: recordId(network), publicKey: kp.getPublicKey().toString(), secretKey: kp.toString(), accountId: null, createdAt: Date.now() };
  }
  await putRecord(rec);
  return toSessionKey(rec);
}

/** The existing key, or a new one. */
export async function ensureSessionKey(network = NETWORK): Promise<SessionKey> {
  return (await loadSessionKey(network)) ?? createSessionKey(network);
}

/** Remembers which account the key now lives on. */
export async function bindSessionKey(accountId: string, network = NETWORK): Promise<void> {
  const rec = await getRecord(recordId(network));
  if (!rec) throw new Error("No session key to bind");
  await putRecord({ ...rec, accountId });
}

export async function clearSessionKey(network = NETWORK): Promise<void> {
  await tx("readwrite", (s) => s.delete(recordId(network)));
}

/** A random id for per-device rate limits, kept in localStorage. */
export function deviceId(): string {
  const KEY = "wgp-device";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = baseEncode(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return "anonymous-device";
  }
}

let rpc: Provider | null = null;
const provider = () => (rpc ??= makeProvider(RPC_URLS));

/** Reserves the next delegate nonce: above the chain's and above the last one we used. */
async function nextNonce(accountId: string, key: SessionKey, network = NETWORK): Promise<bigint> {
  const chain = await accessKeyNonce(provider(), accountId, key.publicKey);
  if (chain === null) throw new Error("This session key isn't on the account yet");
  const rec = await getRecord(recordId(network));
  const last = rec?.lastNonce ? BigInt(rec.lastNonce) : 0n;
  const next = (chain > last ? chain : last) + 1n;
  if (rec) await putRecord({ ...rec, lastNonce: next.toString() });
  return next;
}

export interface GameCallOptions {
  accountId?: string;
  gas?: bigint;
  key?: SessionKey;
}

/** Builds the delegate for one game call, valid for DELEGATE_TTL_BLOCKS blocks. */
export async function buildGameDelegate(method: RelayMethod, args: Record<string, unknown>, opts: GameCallOptions = {}): Promise<{ delegate: DelegateAction; key: SessionKey }> {
  const key = opts.key ?? (await loadSessionKey());
  if (!key) throw new Error("No session key on this device");
  const accountId = opts.accountId ?? key.accountId;
  if (!accountId) throw new Error("The session key isn't linked to an account");
  const [nonce, height] = await Promise.all([nextNonce(accountId, key), finalBlockHeight(provider())]);
  const delegate = buildDelegateAction({
    senderId: accountId,
    receiverId: GAME_CONTRACT_ID,
    actions: [actions.functionCall(method, args, opts.gas ?? DEFAULT_RELAY_GAS, 0n)],
    nonce,
    maxBlockHeight: height + DELEGATE_TTL_BLOCKS,
    publicKey: PublicKey.fromString(key.publicKey),
  });
  return { delegate, key };
}

/** sha256 of the NEP-461-prefixed delegate: what the sender signs. */
export async function delegateHash(delegate: DelegateAction): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encodeDelegateAction(delegate)));
}

/** Assembles borsh(SignedDelegateAction) from a delegate and its 64-byte signature (ours or NEAR Auth's MPC). */
export function assembleSignedDelegate(delegate: DelegateAction, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error("Ed25519 signatures are 64 bytes");
  // near-api-js exports SignedDelegate only as a type; the action builder makes one.
  const { signedDelegate } = actions.signedDelegate({ delegateAction: delegate, signature: new Signature({ keyType: KeyType.ED25519, data: signature }) });
  if (!signedDelegate) throw new Error("Could not build the signed delegate");
  return encodeSignedDelegate(signedDelegate);
}

/** Signs a delegate with the session key; returns borsh(SignedDelegateAction). */
export async function signDelegate(delegate: DelegateAction, key: SessionKey): Promise<Uint8Array> {
  return assembleSignedDelegate(delegate, await key.sign(await delegateHash(delegate)));
}

export interface RelayResponse {
  ok: boolean;
  /** The HTTP status (422: the contract refused; 503: the relayer can't take it). */
  status: number;
  txHash?: string;
  result?: unknown;
  error?: string;
  message?: string;
  /** Craft and equip: the save the server mirrored from the chain, and its revision. */
  save?: unknown;
  rev?: number;
}

/**
 * Posts a signed delegate to the relayer. A dropped connection answers status 0 ("network")
 * rather than throwing: the delegate may have landed, so callers must not sign a fresh one
 * and send it again blind.
 */
export async function postToRelay(signedDelegate: Uint8Array, extra: { kind?: "game" | "add-key"; newKey?: string } = {}): Promise<RelayResponse> {
  let res: Response;
  try {
    res = await fetch("/api/relay/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wgp-device": deviceId() },
      credentials: "same-origin",
      body: JSON.stringify({ kind: extra.kind ?? "game", signedDelegate: base64Encode(signedDelegate), newKey: extra.newKey }),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  const body = (await res.json().catch(() => ({}))) as Omit<RelayResponse, "status">;
  return { ...body, ok: res.ok && body.ok !== false, status: res.status };
}

/**
 * One game action, signed by the session key and relayed: no popup, no gas. Retries once
 * with a fresh nonce and height if the first delegate went stale.
 */
export async function callGame(method: RelayMethod, args: Record<string, unknown>, opts: GameCallOptions = {}): Promise<RelayResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { delegate, key } = await buildGameDelegate(method, args, opts);
    const res = await postToRelay(await signDelegate(delegate, key));
    if (res.ok || attempt === 1 || (res.error !== "expired" && !/nonce/i.test(res.message ?? ""))) return res;
  }
  throw new Error("unreachable");
}
