/**
 * What the relayer pays for, shared by the browser (to build delegates it will accept)
 * and the server (to refuse everything else). Change both sides together by changing
 * this file.
 */

export const TGAS = 1_000_000_000_000n;

/**
 * Mempool Market methods (contracts/wgp/src/market.rs). None takes a deposit; the
 * contract's daily caps, listing floor and ceiling bound what a leaked key could do.
 */
export const MARKET_METHODS = ["market_buy", "market_sell", "list_item", "buy_listing", "cancel_listing"] as const;
export type MarketMethod = (typeof MARKET_METHODS)[number];

/**
 * Investing in a merchant (contracts/wgp/src/invest.rs on contract v3; mainnet runs v2, which
 * has none of these). Allow-listed so the relayer can carry them once v3 is live; the relayer
 * also asks the contract its version first and refuses them on anything older
 * (src/server/market/relay.ts `beforeInvestRelay`), so none is ever sent to a v2 contract.
 * None takes a deposit; per-call and daily caps and a lock bound what a leaked key could do,
 * and all it could do is park the player's Bits in a stake the player still owns.
 */
export const INVEST_METHODS = ["market_invest", "market_withdraw", "market_claim"] as const;
export type InvestMethod = (typeof INVEST_METHODS)[number];

/** Game methods a session key may call through `/api/relay/meta`. */
export const RELAY_METHODS = ["register_hero", "craft_suit", "equip_suit", ...MARKET_METHODS, ...INVEST_METHODS] as const;
export type RelayMethod = (typeof RELAY_METHODS)[number];

/** Gas a relayed game call may attach. Game and market calls burn about 2.5 to 3.5 Tgas. */
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

/** An implicit account id: the 32 bytes of an ed25519 public key, in lowercase hex. */
export const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;

export function isImplicitAccountId(value: string): boolean {
  return IMPLICIT_ACCOUNT_RE.test(value);
}

/**
 * A Google player (through Privy) who signed up before the account factory was live, so
 * they play on their key's implicit account id, which doesn't exist on NEAR. They claim
 * `<handle>.<parent>` later (POST /api/auth/privy/claim). Until then nothing is sent on
 * chain for them: their reward mints wait in the outbox and quick play is off.
 */
export function isUnclaimed(player: { authKind: string; nearAccountId: string }): boolean {
  return player.authKind === "privy" && isImplicitAccountId(player.nearAccountId);
}
