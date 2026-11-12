/**
 * The contract's market, read over RPC: `market_state`, `market_listings` (paged),
 * `market_account` and balances. Shapes are checked with zod and converted to the app's
 * (src/lib/market). `readChainMarket` answers null when there is no live market to read:
 * NEAR isn't configured, the contract isn't deployed, it predates the market, or its
 * market has no pools yet. Then the simulated market stands in. Any other failure (the
 * RPC is down) throws, so a live market is never silently swapped for the simulation.
 *
 * WHICH CONTRACT IS LIVE. Investing in a merchant exists only in contract v3
 * (`market_invest`, `market_withdraw`, `market_claim`, the views `market_shops` and
 * `market_investor`). Mainnet runs v2, which has none of them. `contractVersion` asks the
 * contract (`get_version`; v2 has no such method, and "method not found" is the answer
 * "v2") and remembers it for a few minutes. Only for v3 does the market the app shows
 * carry investing rules (`params.invest`), and only then does anything here read a v3
 * view. The relayer asks the same question before it relays an investing call
 * (./relay.ts), so nothing is ever sent to a contract that can't take it.
 *
 * Every read goes through a `ChainReader` so tests can stand in a fake contract speaking
 * v2 or v3 (./chain.test.ts).
 */
import { AccountDoesNotExistError, ContractCodeDoesNotExistError, ContractMethodNotFoundError } from "near-api-js/rpc-errors";
import { z } from "zod";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { itemToken, type InvestRules, type MarketParams } from "@/lib/market/config";
import type { Listing, StakeReceipt } from "@/lib/market/engine";
import type { ClosedReason, InvestorView, Shop } from "@/lib/market/invest";
import type { Pool } from "@/lib/market/math";
import { viewFunction } from "@/lib/near/rpc";

import { chainEnv, NearConfigError } from "../near/env";
import { provider } from "../near/rpc";

const u128 = z.union([z.string().regex(/^\d{1,30}$/), z.number().int().nonnegative()]).transform((v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${v} is too large`);
  return n;
});
/** A u128 that may outgrow a JS number (`fee_acc`): kept as its decimal string. */
const bigU128 = z.union([z.string().regex(/^\d{1,39}$/), z.number().int().nonnegative()]).transform(String);

const rawParams = z.object({
  open: z.boolean(),
  fee_bps: z.number().int(),
  floor_bps: z.number().int(),
  ceiling_bps: z.number().int(),
  max_amount: z.number().int(),
  max_open_listings: z.number().int(),
  max_listings: z.number().int(),
  daily_trades: z.number().int(),
  daily_listings: z.number().int(),
  daily_fills: z.number().int(),
  daily_fill_bits: u128,
  craft_bits: u128,
  // v3: the investing rules. v2 has none of these.
  invest_open: z.boolean().optional(),
  invest_fee_bps: z.number().int().optional(),
  min_invest: u128.optional(),
  max_invest: u128.optional(),
  daily_invests: z.number().int().optional(),
  daily_invest_bits: u128.optional(),
  invest_lock_ms: z.number().int().nonnegative().optional(),
});

export const rawPool = z.object({
  item: z.string(),
  virtual_bits: u128,
  virtual_items: u128,
  bits: u128,
  stock: u128,
  escrow: u128,
  // v3: what investors hold in this pool.
  invested: u128.optional(),
  rewards: u128.optional(),
  fee_acc: bigU128.optional(),
  fee_carry: z.number().int().nonnegative().optional(),
});

export const rawListing = z.object({ id: z.number().int(), seller: z.string(), item: z.string(), amount: z.number().int(), price: u128, listed_at_ms: z.number() });

const rawState = z.object({ vendor: z.string(), params: rawParams, pools: z.array(rawPool), listings: z.number().int(), day: z.number().int() });

const rawAccount = z.object({
  bits: u128,
  trades_left: z.number().int(),
  listings_left: z.number().int(),
  fills_left: z.number().int(),
  fill_bits_left: u128,
  open: z.array(z.number().int()),
});

/* ---- v3 views and receipts (contracts/wgp/src/invest.rs on review/contract-v3) ---- */

/** `get_version`: `{state: 3, contract: "0.3.0", standards: [...]}`. */
export const rawVersion = z.object({ state: z.number().int().nonnegative(), contract: z.string().max(40), standards: z.array(z.string()).optional() });

const closedReason = z.enum(["paused", "market-closed", "broke", "sold-out"]);

/** One entry of `market_shops`. */
export const rawShop = z.object({
  item: z.string(),
  price_milli: u128,
  closed: z.array(closedReason),
  buying: z.boolean(),
  selling: z.boolean(),
  till: u128,
  needs: u128,
  invested: u128,
  invest_room: u128,
  rewards: u128,
});

/** `market_investor`. */
export const rawInvestor = z.object({
  stakes: z.array(z.object({ item: z.string(), bits: u128, earned: u128, unlocks_at_ms: z.number().int().nonnegative(), withdrawable: u128 })),
  invests_left: z.number().int().nonnegative(),
  invest_bits_left: u128,
});

/** What `market_invest`, `market_withdraw` and `market_claim` return. */
export const rawStakeReceipt = z.object({ item: z.string(), bits: u128, earned: u128, stake: u128, unlocks_at_ms: z.number().int().nonnegative(), pool: rawPool });

/** The investing rules in a v3 `market_state`, or null when any is missing (a v2 state). */
export function toInvestRules(p: z.infer<typeof rawParams>): InvestRules | null {
  if (
    p.invest_open === undefined ||
    p.invest_fee_bps === undefined ||
    p.min_invest === undefined ||
    p.max_invest === undefined ||
    p.daily_invests === undefined ||
    p.daily_invest_bits === undefined ||
    p.invest_lock_ms === undefined
  ) {
    return null;
  }
  return { open: p.invest_open, feeBps: p.invest_fee_bps, min: p.min_invest, max: p.max_invest, dailyInvests: p.daily_invests, dailyBits: p.daily_invest_bits, lockMs: p.invest_lock_ms };
}

/** The app's params. `investing` says the contract is v3: only then are its investing rules carried. */
export function toParams(p: z.infer<typeof rawParams>, investing = false): MarketParams {
  const invest = investing ? toInvestRules(p) : null;
  return {
    open: p.open,
    feeBps: p.fee_bps,
    floorBps: p.floor_bps,
    ceilingBps: p.ceiling_bps,
    maxAmount: p.max_amount,
    maxOpenListings: p.max_open_listings,
    maxListings: p.max_listings,
    dailyTrades: p.daily_trades,
    dailyListings: p.daily_listings,
    dailyFills: p.daily_fills,
    dailyFillBits: p.daily_fill_bits,
    craftBits: p.craft_bits,
    ...(invest ? { invest } : {}),
  };
}

export const toPool = (p: z.infer<typeof rawPool>): Pool => ({
  item: p.item,
  virtualBits: p.virtual_bits,
  virtualItems: p.virtual_items,
  bits: p.bits,
  stock: p.stock,
  escrow: p.escrow,
  ...(p.invested !== undefined ? { invested: p.invested, rewards: p.rewards ?? 0, feeAcc: p.fee_acc ?? "0", feeCarry: p.fee_carry ?? 0 } : {}),
});

export const toListing = (l: z.infer<typeof rawListing>): Listing => ({
  id: l.id,
  seller: l.seller,
  item: l.item,
  amount: l.amount,
  price: l.price,
  listedAtMs: l.listed_at_ms,
});

export const toShop = (s: z.infer<typeof rawShop>): Shop => ({
  item: s.item,
  priceMilli: s.price_milli,
  closed: s.closed as ClosedReason[],
  buying: s.buying,
  selling: s.selling,
  till: s.till,
  needs: s.needs,
  invested: s.invested,
  investRoom: s.invest_room,
  rewards: s.rewards,
});

export const toInvestor = (i: z.infer<typeof rawInvestor>): InvestorView => ({
  stakes: i.stakes.map((s) => ({ item: s.item, bits: s.bits, earned: s.earned, unlocksAtMs: s.unlocks_at_ms, withdrawable: s.withdrawable })),
  investsLeft: i.invests_left,
  investBitsLeft: i.invest_bits_left,
});

export const toStakeReceipt = (r: z.infer<typeof rawStakeReceipt>): StakeReceipt => ({ item: r.item, bits: r.bits, earned: r.earned, stake: r.stake, unlocksAtMs: r.unlocks_at_ms, pool: toPool(r.pool) });

/* ------------------------------------------------------------------ the reader */

/** Read-only calls to one game contract. The live one is `liveReader()`; tests pass a fake. */
export interface ChainReader {
  contractId: string;
  network: "testnet" | "mainnet";
  view(method: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** The configured contract over RPC. Throws NearConfigError when NEAR isn't configured. */
export function liveReader(): ChainReader {
  const env = chainEnv();
  return { contractId: env.contractId, network: env.network, view: (method, args = {}) => viewFunction<unknown>(provider(), env.contractId, method, args) };
}

export interface ChainMarket {
  contractId: string;
  network: "testnet" | "mainnet";
  vendor: string;
  params: MarketParams;
  pools: Pool[];
  listings: number;
  /** What `get_version` said (v2 has no such method: then `state` is 2 and `version` null). */
  contract?: ContractVersion;
  /** v3 only: `market_shops`, each stall open or closed and why. */
  shops?: Shop[];
}

/** True for errors that mean "no market there", as opposed to "couldn't ask". */
export function isNoMarket(error: unknown): boolean {
  if (
    error instanceof NearConfigError ||
    error instanceof AccountDoesNotExistError ||
    error instanceof ContractCodeDoesNotExistError ||
    error instanceof ContractMethodNotFoundError
  ) {
    return true;
  }
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /does not exist|doesn't exist|MethodNotFound|CodeDoesNotExist|method .* not found/i.test(text);
}

/** True when the contract answered "I have no such method": how v2 answers a v3 question. */
export function isMethodNotFound(error: unknown): boolean {
  if (error instanceof ContractMethodNotFoundError) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /MethodNotFound|method .* not found/i.test(text);
}

/* ------------------------------------------------------------------ which contract is live */

export interface ContractVersion {
  /** The state layout: 2 is mainnet today, 3 has investing. */
  state: number;
  /** The contract's own version string ("0.3.0"), or null on v2, which doesn't say. */
  version: string | null;
}

/** What a contract without `get_version` is: v2 (v1 had no market at all, and never reaches here). */
export const V2: ContractVersion = { state: 2, version: null };

/** How long an answer is trusted: an upgrade to v3 shows within this long, without a redeploy. */
export const VERSION_TTL_MS = 5 * 60_000;

const versions = new Map<string, { at: number; value: ContractVersion }>();

/** Forgets what was learned (tests; and nothing else needs it). */
export function forgetContractVersion(): void {
  versions.clear();
}

/**
 * The live contract's version, asked at most once per `VERSION_TTL_MS` per contract.
 * "Method not found" is v2 and is remembered like any answer. Any other failure (the RPC
 * is down, a shape we don't know) is NOT remembered and counts as v2 for this one read:
 * unsure means no investing.
 */
export async function contractVersion(reader: ChainReader, now = Date.now()): Promise<ContractVersion> {
  const key = `${reader.network}:${reader.contractId}`;
  const hit = versions.get(key);
  if (hit && now - hit.at < VERSION_TTL_MS) return hit.value;
  let value: ContractVersion;
  try {
    const v = rawVersion.parse(await reader.view("get_version"));
    value = { state: v.state, version: v.contract };
  } catch (error) {
    if (!isMethodNotFound(error)) {
      console.error(`[market] couldn't read ${reader.contractId}'s version, treating it as v2 for now: ${(error as Error).message}`);
      return V2;
    }
    value = V2;
  }
  versions.set(key, { at: now, value });
  return value;
}

/** Whether a version has contract v3's investing methods. */
export const hasInvesting = (v: ContractVersion): boolean => v.state >= 3;

/** Whether the live contract can take an investing call right now. False when NEAR isn't configured. */
export async function investingLive(reader?: ChainReader): Promise<boolean> {
  let r = reader;
  if (!r) {
    try {
      r = liveReader();
    } catch (error) {
      if (error instanceof NearConfigError) return false;
      throw error;
    }
  }
  return hasInvesting(await contractVersion(r));
}

/* ------------------------------------------------------------------ reads */

/** The live on-chain market, or null when there isn't one (see the file comment). */
export async function readChainMarket(reader?: ChainReader): Promise<ChainMarket | null> {
  let r = reader;
  if (!r) {
    try {
      r = liveReader();
    } catch (error) {
      if (error instanceof NearConfigError) return null;
      throw error;
    }
  }
  let raw: unknown;
  try {
    raw = await r.view("market_state");
  } catch (error) {
    if (isNoMarket(error)) return null;
    throw error;
  }
  const state = rawState.parse(raw);
  if (state.pools.length === 0) return null;
  const contract = await contractVersion(r);
  const investing = hasInvesting(contract) && toInvestRules(state.params) !== null;
  let shops: Shop[] | undefined;
  if (investing) {
    // The contract's own word on each stall (it knows "paused"); the pools give the same if this read fails.
    shops = await r
      .view("market_shops")
      .then((s) => z.array(rawShop).parse(s).map(toShop))
      .catch((error: unknown) => {
        console.error(`[market] market_shops: ${(error as Error).message}`);
        return undefined;
      });
  }
  return {
    contractId: r.contractId,
    network: r.network,
    vendor: state.vendor,
    params: toParams(state.params, investing),
    pools: state.pools.map(toPool),
    listings: state.listings,
    contract,
    ...(shops ? { shops } : {}),
  };
}

/** Every open listing (at most 6 pages of 50; the contract caps open listings anyway). */
export async function readChainListings(reader: ChainReader = liveReader()): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let page = 0; page < 6; page++) {
    const raw = await reader.view("market_listings", { from_index: page * 50, limit: 50 });
    const rows = z.array(rawListing).parse(raw);
    out.push(...rows.map(toListing));
    if (rows.length < 50) break;
  }
  return out;
}

export interface ChainWallet {
  bits: number;
  items: Partial<Record<ItemId, number>>;
  tradesLeft: number;
  listingsLeft: number;
  fillsLeft: number;
  fillBitsLeft: number;
  open: number[];
  /** v3 only: the account's stakes (`market_investor`). */
  investor?: InvestorView;
}

/** A player's Bits, items and what they may still do today, from the contract; on v3, their stakes too. */
export async function readChainWallet(accountId: string, reader: ChainReader = liveReader()): Promise<ChainWallet> {
  const ids = Object.keys(ITEMS) as ItemId[];
  const [account, balances, version] = await Promise.all([
    reader.view("market_account", { account_id: accountId }),
    reader.view("mt_batch_balance_of", { account_id: accountId, token_ids: ids.map(itemToken) }),
    contractVersion(reader),
  ]);
  const a = rawAccount.parse(account);
  const amounts = z.array(u128).parse(balances);
  const items: Partial<Record<ItemId, number>> = {};
  ids.forEach((id, i) => {
    if (amounts[i]) items[id] = amounts[i];
  });
  // Never asked of a v2 contract. A failed read leaves the stakes out rather than the wallet unread.
  const investor = hasInvesting(version)
    ? await reader
        .view("market_investor", { account_id: accountId })
        .then((raw) => toInvestor(rawInvestor.parse(raw)))
        .catch((error: unknown) => {
          console.error(`[market] market_investor: ${(error as Error).message}`);
          return undefined;
        })
    : undefined;
  return { bits: a.bits, items, tradesLeft: a.trades_left, listingsLeft: a.listings_left, fillsLeft: a.fills_left, fillBitsLeft: a.fill_bits_left, open: a.open, ...(investor ? { investor } : {}) };
}
