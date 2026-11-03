/**
 * The contract's market, read over RPC: `market_state`, `market_listings` (paged),
 * `market_account` and balances. Shapes are checked with zod and converted to the app's
 * (src/lib/market). `readChainMarket` answers null when there is no live market to read:
 * NEAR isn't configured, the contract isn't deployed, it predates the market, or its
 * market has no pools yet. Then the simulated market stands in. Any other failure (the
 * RPC is down) throws, so a live market is never silently swapped for the simulation.
 */
import { AccountDoesNotExistError, ContractCodeDoesNotExistError, ContractMethodNotFoundError } from "near-api-js/rpc-errors";
import { z } from "zod";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { itemToken, type MarketParams } from "@/lib/market/config";
import type { Listing } from "@/lib/market/engine";
import type { Pool } from "@/lib/market/math";
import { viewFunction } from "@/lib/near/rpc";

import { chainEnv, NearConfigError } from "../near/env";
import { provider } from "../near/rpc";

const u128 = z.union([z.string().regex(/^\d{1,30}$/), z.number().int().nonnegative()]).transform((v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${v} is too large`);
  return n;
});

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
});

const rawPool = z.object({ item: z.string(), virtual_bits: u128, virtual_items: u128, bits: u128, stock: u128, escrow: u128 });

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

export function toParams(p: z.infer<typeof rawParams>): MarketParams {
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
  };
}

export const toPool = (p: z.infer<typeof rawPool>): Pool => ({
  item: p.item,
  virtualBits: p.virtual_bits,
  virtualItems: p.virtual_items,
  bits: p.bits,
  stock: p.stock,
  escrow: p.escrow,
});

export const toListing = (l: z.infer<typeof rawListing>): Listing => ({
  id: l.id,
  seller: l.seller,
  item: l.item,
  amount: l.amount,
  price: l.price,
  listedAtMs: l.listed_at_ms,
});

export interface ChainMarket {
  contractId: string;
  network: "testnet" | "mainnet";
  vendor: string;
  params: MarketParams;
  pools: Pool[];
  listings: number;
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

/** The live on-chain market, or null when there isn't one (see the file comment). */
export async function readChainMarket(): Promise<ChainMarket | null> {
  let env;
  try {
    env = chainEnv();
  } catch (error) {
    if (error instanceof NearConfigError) return null;
    throw error;
  }
  let raw: unknown;
  try {
    raw = await viewFunction(provider(), env.contractId, "market_state");
  } catch (error) {
    if (isNoMarket(error)) return null;
    throw error;
  }
  const state = rawState.parse(raw);
  if (state.pools.length === 0) return null;
  return {
    contractId: env.contractId,
    network: env.network,
    vendor: state.vendor,
    params: toParams(state.params),
    pools: state.pools.map(toPool),
    listings: state.listings,
  };
}

/** Every open listing (at most 6 pages of 50; the contract caps open listings anyway). */
export async function readChainListings(): Promise<Listing[]> {
  const { contractId } = chainEnv();
  const out: Listing[] = [];
  for (let page = 0; page < 6; page++) {
    const raw = await viewFunction<unknown>(provider(), contractId, "market_listings", { from_index: page * 50, limit: 50 });
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
}

/** A player's Bits, items and what they may still do today, from the contract. */
export async function readChainWallet(accountId: string): Promise<ChainWallet> {
  const { contractId } = chainEnv();
  const ids = Object.keys(ITEMS) as ItemId[];
  const [account, balances] = await Promise.all([
    viewFunction<unknown>(provider(), contractId, "market_account", { account_id: accountId }),
    viewFunction<unknown>(provider(), contractId, "mt_batch_balance_of", { account_id: accountId, token_ids: ids.map(itemToken) }),
  ]);
  const a = rawAccount.parse(account);
  const amounts = z.array(u128).parse(balances);
  const items: Partial<Record<ItemId, number>> = {};
  ids.forEach((id, i) => {
    if (amounts[i]) items[id] = amounts[i];
  });
  return { bits: a.bits, items, tradesLeft: a.trades_left, listingsLeft: a.listings_left, fillsLeft: a.fills_left, fillBitsLeft: a.fill_bits_left, open: a.open };
}

