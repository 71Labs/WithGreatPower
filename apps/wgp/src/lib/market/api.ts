/**
 * The market API's shapes and the browser's fetchers for them (src/app/api/market).
 * Like src/lib/api/client.ts, nothing here throws on an HTTP error: every call resolves
 * to `{ ok: true, data }` or `{ ok: false, status, error, message }`.
 */
import type { ItemId, Rarity, Save } from "@wgp/game-core/types";

import type { MarketParams } from "./config";
import type { Fill, Listing, StakeReceipt, Trade } from "./engine";
import type { InvestorView, Shop } from "./invest";
import type { Pool } from "./math";

export interface MarketItemView {
  item: ItemId;
  name: string;
  rarity: Rarity;
  /** The vendor's spot price × 1000. */
  priceMilli: number;
  /** Buying one, fee included; null when out of stock. */
  buyOne: number | null;
  /** Selling one, after the fee; null when the till can't pay. */
  sellOne: number | null;
  /** Spot × 1000 over the last day, oldest first. */
  spark: number[];
  /** Fractional change over 24 hours, or null with no history yet. */
  change24h: number | null;
  trades24h: number;
  /** The raw curve, for quotes in the browser (src/lib/market/math.ts). */
  pool: Pool;
}

export interface MarketView {
  /** False while the simulated market stands in for the contract's. */
  onChain: boolean;
  network: "testnet" | "mainnet" | null;
  contractId: string | null;
  /** The account that holds the vendor's stock and till (the contract), or null when simulated. */
  vendor: string | null;
  params: MarketParams;
  items: MarketItemView[];
  listings: number;
  /**
   * Each stall, open or closed and why (contract v3's `market_shops`, or the same worked out
   * from the pools). Absent from an older server; `shopOf` on an item's pool gives the same.
   */
  shops?: Shop[];
  /**
   * On chain: the contract's version (`get_version`). `state` 2 is today's mainnet, which has
   * no investing; 3 has it. Null when simulated. Investing is offered only when
   * `params.invest` is set, which the server does for the simulated market and for v3.
   */
  contract?: { state: number; version: string | null } | null;
  /** Bits in the vendor's till across every item. */
  till: number;
  updatedAt: string;
}

export interface ListingView extends Listing {
  name: string;
  /** Price per item × 1000. */
  unitMilli: number;
  /** The unit price over the vendor's spot price (1 = at spot). */
  vsSpot: number;
}

export interface MarketMe {
  onChain: boolean;
  accountId: string;
  bits: number;
  items: Partial<Record<ItemId, number>>;
  tradesLeft: number;
  listingsLeft: number;
  fillsLeft: number;
  fillBitsLeft: number;
  /** Ids of this player's open listings. */
  open: number[];
  /** On chain: Bits from verified nights that the operator hasn't landed yet. */
  pendingBits: number;
  /** The player's stakes in Gwei's tills and what they may still invest today; absent where the market takes no investors. */
  investor?: InvestorView;
}

/** The market and the trader's wallet right after a trade, read past the cache. */
export interface MarketSnapshot {
  view: MarketView;
  listings: ListingView[];
  me: MarketMe;
}

export type SimTradeRequest =
  | { action: "buy"; item: ItemId; amount: number; maxBits: number }
  | { action: "sell"; item: ItemId; amount: number; minBits: number }
  | { action: "list"; item: ItemId; amount: number; price: number }
  | { action: "fill"; listingId: number }
  | { action: "cancel"; listingId: number };

export type SimReceipt = { kind: "trade"; trade: Trade } | { kind: "listing"; listing: Listing } | { kind: "fill"; fill: Fill } | { kind: "cancel"; listing: Listing };

export interface SimTradeResponse {
  receipt: SimReceipt;
  save: Save;
  rev: number;
  bits: number;
  /** The market after the trade; absent if it couldn't be read. */
  market?: MarketSnapshot;
}

/** Investing in one of Gwei's tills (contract v3's `market_invest`, `market_withdraw`, `market_claim`). */
export type StakeRequest = { action: "invest"; item: ItemId; bits: number } | { action: "withdraw"; item: ItemId; bits: number } | { action: "claim"; item: ItemId };

export interface StakeResponse {
  action: StakeRequest["action"];
  receipt: StakeReceipt;
  /** The player's Bits after it. */
  bits: number;
  /** The market after it; absent if it couldn't be read. */
  market?: MarketSnapshot;
}

export type MarketResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message?: string };

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<MarketResult<T>> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: "network" };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, data: body as T };
  return {
    ok: false,
    status: res.status,
    error: typeof body?.error === "string" ? body.error : `http_${res.status}`,
    message: typeof body?.message === "string" ? body.message : undefined,
  };
}

export const getMarket = (signal?: AbortSignal) => call<MarketView>("/api/market", { signal });

export const getListings = (signal?: AbortSignal) => call<{ onChain: boolean; listings: ListingView[] }>("/api/market/listings", { signal });

/** 401 when signed out. */
export const getMarketMe = (signal?: AbortSignal) => call<MarketMe>("/api/market/me", { signal });

/** The simulated market only; 409 on_chain once the contract's market is live. */
export const postSimTrade = (body: SimTradeRequest) => call<SimTradeResponse>("/api/market/trade", { method: "POST", json: body });

/** The simulated market only; 409 on_chain once the contract's market is live (then it's a session-key call, on v3). */
export const postSimStake = (body: StakeRequest) => call<StakeResponse>("/api/market/invest", { method: "POST", json: body });
