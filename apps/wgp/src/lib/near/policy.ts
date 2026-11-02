/**
 * What the relayer pays for, shared by the browser (to build delegates it will accept)
 * and the server (to refuse everything else). Change both sides together by changing
 * this file.
 */

export const TGAS = 1_000_000_000_000n;

/** Game methods a session key may call through `/api/relay/meta`. */
export const RELAY_METHODS = ["register_hero", "craft_suit", "equip_suit"] as const;
export type RelayMethod = (typeof RELAY_METHODS)[number];

/** Gas a relayed game call may attach. register_hero/craft/equip burn about 2.5 Tgas. */
export const MAX_RELAY_GAS = 30n * TGAS;
/** What clients attach by default. */
export const DEFAULT_RELAY_GAS = 30n * TGAS;

/** A delegate may live at most this many blocks past the current height (~5 minutes). */
export const MAX_DELEGATE_TTL_BLOCKS = 300n;
/** What clients ask for. */
export const DELEGATE_TTL_BLOCKS = 120n;

/** Function-call args larger than this are refused. */
export const MAX_RELAY_ARGS_BYTES = 1024;

/** The session key's own gas allowance, if it ever signs directly: 0.05 NEAR. */
export const SESSION_KEY_ALLOWANCE = 50_000_000_000_000_000_000_000n;

/** Session keys may call any method on the game contract (empty list = all). */
export const SESSION_KEY_METHODS: string[] = [];

/** Handles that would collide with our own service accounts. */
export const RESERVED_HANDLES = new Set(["game", "relayer", "operator", "admin", "wgp", "factory", "treasury", "dev", "test", "near", "auth"]);

/** `<handle>.<parent>`: 2–32 of a–z, 0–9, `-` and `_`, starting and ending alphanumeric. */
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])$/;

/** NEAR account id rules (2–64 characters). */
export const ACCOUNT_ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value);
}
