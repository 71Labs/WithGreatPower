/**
 * A strict Borsh decoder for NEP-366 delegate actions. near-api-js can encode them but
 * not decode them, and the relayer must read every byte of what it is asked to pay
 * for: this accepts only the action kinds we ever relay, bounds every length, and
 * refuses trailing bytes. Pure and browser-safe (the lab page uses it to read `fatxn`).
 *
 * Layout (nearcore):
 *   SignedDelegateAction { delegate_action: DelegateAction, signature: Signature }
 *   DelegateAction { sender_id: String, receiver_id: String, actions: Vec<Action>,
 *                    nonce: u64, max_block_height: u64, public_key: PublicKey }
 * The signature covers sha256(u32 LE 2^30+366 ‖ borsh(DelegateAction)) (NEP-461).
 */
import { baseEncode } from "near-api-js";

/** NEP-461 prefix for delegate actions: 2^30 + 366. */
export const DELEGATE_ACTION_PREFIX = 1_073_742_190;

export class DelegateDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegateDecodeError";
  }
}

export type AccessPermission =
  | { kind: "FullAccess" }
  | { kind: "FunctionCall"; allowance: bigint | null; receiverId: string; methodNames: string[] };

export type DelegateActionItem =
  | { kind: "CreateAccount" }
  | { kind: "FunctionCall"; methodName: string; args: Uint8Array; gas: bigint; deposit: bigint }
  | { kind: "Transfer"; deposit: bigint }
  | { kind: "AddKey"; publicKey: string; nonce: bigint; permission: AccessPermission }
  | { kind: "DeleteKey"; publicKey: string };

export interface DecodedDelegate {
  senderId: string;
  receiverId: string;
  actions: DelegateActionItem[];
  nonce: bigint;
  maxBlockHeight: bigint;
  /** "ed25519:<base58>". */
  publicKey: string;
}

export interface DecodedSignedDelegate {
  delegate: DecodedDelegate;
  /** borsh(DelegateAction), without the NEP-461 prefix. */
  delegateBytes: Uint8Array;
  /** 64-byte Ed25519 signature. */
  signature: Uint8Array;
}

const LIMITS = {
  totalBytes: 8 * 1024,
  accountId: 64,
  methodName: 256,
  args: 4 * 1024,
  actions: 16,
  methodNames: 32,
};

const ACTION_NAMES = [
  "CreateAccount",
  "DeployContract",
  "FunctionCall",
  "Transfer",
  "Stake",
  "AddKey",
  "DeleteKey",
  "DeleteAccount",
  "Delegate",
  "DeployGlobalContract",
  "UseGlobalContract",
];

class Reader {
  #offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  get offset(): number {
    return this.#offset;
  }

  take(n: number): Uint8Array {
    if (n < 0 || this.#offset + n > this.bytes.length) throw new DelegateDecodeError("Unexpected end of input");
    const out = this.bytes.subarray(this.#offset, this.#offset + n);
    this.#offset += n;
    return out;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  u32(): number {
    const b = this.take(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16)) + b[3]! * 0x1000000;
  }

  u64(): bigint {
    return this.uint(8);
  }

  u128(): bigint {
    return this.uint(16);
  }

  uint(n: number): bigint {
    const b = this.take(n);
    let v = 0n;
    for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
    return v;
  }

  string(max: number, what: string): string {
    const len = this.u32();
    if (len > max) throw new DelegateDecodeError(`${what} is longer than ${max} bytes`);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.take(len));
    } catch (e) {
      if (e instanceof DelegateDecodeError) throw e;
      throw new DelegateDecodeError(`${what} is not valid UTF-8`);
    }
  }

  bytesVec(max: number, what: string): Uint8Array {
    const len = this.u32();
    if (len > max) throw new DelegateDecodeError(`${what} is longer than ${max} bytes`);
    return this.take(len).slice();
  }

  publicKey(): string {
    const kind = this.u8();
    if (kind !== 0) throw new DelegateDecodeError("Only ed25519 public keys are accepted");
    return `ed25519:${baseEncode(this.take(32))}`;
  }
}

function readPermission(r: Reader): AccessPermission {
  const tag = r.u8();
  if (tag === 1) return { kind: "FullAccess" };
  if (tag !== 0) throw new DelegateDecodeError("Unsupported access key permission");
  const hasAllowance = r.u8();
  if (hasAllowance > 1) throw new DelegateDecodeError("Bad option tag");
  const allowance = hasAllowance ? r.u128() : null;
  const receiverId = r.string(LIMITS.accountId, "receiver_id");
  const count = r.u32();
  if (count > LIMITS.methodNames) throw new DelegateDecodeError("Too many method names");
  const methodNames: string[] = [];
  for (let i = 0; i < count; i++) methodNames.push(r.string(LIMITS.methodName, "method name"));
  return { kind: "FunctionCall", allowance, receiverId, methodNames };
}

function readAction(r: Reader): DelegateActionItem {
  const tag = r.u8();
  switch (tag) {
    case 0:
      return { kind: "CreateAccount" };
    case 2: {
      const methodName = r.string(LIMITS.methodName, "method_name");
      const args = r.bytesVec(LIMITS.args, "args");
      const gas = r.u64();
      const deposit = r.u128();
      return { kind: "FunctionCall", methodName, args, gas, deposit };
    }
    case 3:
      return { kind: "Transfer", deposit: r.u128() };
    case 5: {
      const publicKey = r.publicKey();
      const nonce = r.u64();
      return { kind: "AddKey", publicKey, nonce, permission: readPermission(r) };
    }
    case 6:
      return { kind: "DeleteKey", publicKey: r.publicKey() };
    default:
      throw new DelegateDecodeError(`Unsupported action: ${ACTION_NAMES[tag] ?? `#${tag}`}`);
  }
}

function readDelegate(r: Reader): DecodedDelegate {
  const senderId = r.string(LIMITS.accountId, "sender_id");
  const receiverId = r.string(LIMITS.accountId, "receiver_id");
  const count = r.u32();
  if (count > LIMITS.actions) throw new DelegateDecodeError("Too many actions");
  const actions: DelegateActionItem[] = [];
  for (let i = 0; i < count; i++) actions.push(readAction(r));
  const nonce = r.u64();
  const maxBlockHeight = r.u64();
  const publicKey = r.publicKey();
  return { senderId, receiverId, actions, nonce, maxBlockHeight, publicKey };
}

function guardSize(bytes: Uint8Array): void {
  if (bytes.length > LIMITS.totalBytes) throw new DelegateDecodeError(`Input is larger than ${LIMITS.totalBytes} bytes`);
}

/** Decodes a borsh SignedDelegateAction, as `encodeSignedDelegate` produces it. */
export function decodeSignedDelegate(bytes: Uint8Array): DecodedSignedDelegate {
  guardSize(bytes);
  const r = new Reader(bytes);
  const delegate = readDelegate(r);
  const delegateBytes = bytes.slice(0, r.offset);
  const sigKind = r.u8();
  if (sigKind !== 0) throw new DelegateDecodeError("Only ed25519 signatures are accepted");
  const signature = r.take(64).slice();
  if (r.offset !== bytes.length) throw new DelegateDecodeError("Trailing bytes after the signature");
  return { delegate, delegateBytes, signature };
}

/**
 * Decodes the bytes a delegate signature covers: the NEP-461 prefix followed by the
 * DelegateAction (what `encodeDelegateAction` returns, and what NEAR Auth puts in `fatxn`).
 */
export function decodeSignableDelegate(bytes: Uint8Array): DecodedDelegate {
  guardSize(bytes);
  const r = new Reader(bytes);
  if (r.u32() !== DELEGATE_ACTION_PREFIX) throw new DelegateDecodeError("Not a delegate action (missing NEP-461 prefix)");
  const delegate = readDelegate(r);
  if (r.offset !== bytes.length) throw new DelegateDecodeError("Trailing bytes after the delegate action");
  return delegate;
}

/** prefix ‖ borsh(DelegateAction): the message whose sha256 the sender signs. */
export function signableBytes(delegateBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + delegateBytes.length);
  new DataView(out.buffer).setUint32(0, DELEGATE_ACTION_PREFIX, true);
  out.set(delegateBytes, 4);
  return out;
}
