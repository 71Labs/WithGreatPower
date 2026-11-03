/**
 * The Mempool Market's default rules and curves: what `set_market_params` gets on chain
 * (scripts/near/market-args.ts prints it), what the simulated market starts from and
 * what /lab/economy runs. Prices follow rarity: commons start at 12 Bits, uncommons at
 * 40, rares at 150. Half of each curve's Bits is real (the vendor's till), half virtual.
 */
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId, Rarity } from "@wgp/game-core/types";

import type { Pool } from "./math";

export interface MarketParams {
  /** Off: no trades or new listings (open listings can still be cancelled). */
  open: boolean;
  /** The gas fee, burned: 200 = 2%. */
  feeBps: number;
  /** A listing asks at least this share of the vendor's spot price (5000 = 50%)… */
  floorBps: number;
  /** …and at most this share (40000 = 400%). */
  ceilingBps: number;
  /** Items per vendor trade or listing. */
  maxAmount: number;
  maxOpenListings: number;
  /** Open listings across everyone. */
  maxListings: number;
  /** Per account, per UTC day. */
  dailyTrades: number;
  dailyListings: number;
  dailyFills: number;
  dailyFillBits: number;
  /** Bits burned per crafted suit with a recipe; 0 is off. */
  craftBits: number;
}

/** contracts/wgp/src/market.rs `MarketParams::default()`. */
export const DEFAULT_PARAMS: MarketParams = {
  open: true,
  feeBps: 200,
  floorBps: 5_000,
  ceilingBps: 40_000,
  maxAmount: 20,
  maxOpenListings: 3,
  maxListings: 300,
  dailyTrades: 40,
  dailyListings: 10,
  dailyFills: 10,
  dailyFillBits: 3_000,
  craftBits: 0,
};

/** Starting spot price, curve depth and stock by rarity. */
export const CURVES: Record<Rarity, { price: number; virtualItems: number; stock: number }> = {
  common: { price: 12, virtualItems: 40, stock: 40 },
  uncommon: { price: 40, virtualItems: 20, stock: 20 },
  rare: { price: 150, virtualItems: 8, stock: 8 },
};

export interface PoolConfig {
  item: ItemId;
  virtualBits: number;
  virtualItems: number;
  seedBits: number;
  seedStock: number;
}

/** One pool per game item, in ITEMS order. */
export function defaultPoolConfigs(): PoolConfig[] {
  return (Object.values(ITEMS) as { id: ItemId; rarity: Rarity }[]).map(({ id, rarity }) => {
    const c = CURVES[rarity];
    // y = price · x; half the Bits sit in the till.
    const y = c.price * (c.virtualItems + c.stock);
    const seedBits = Math.floor(y / 2);
    return { item: id, virtualBits: y - seedBits, virtualItems: c.virtualItems, seedBits, seedStock: c.stock };
  });
}

/** The pools as they stand right after seeding. */
export function seededPools(configs: PoolConfig[] = defaultPoolConfigs()): Pool[] {
  return configs.map((c) => ({
    item: c.item,
    virtualBits: c.virtualBits,
    virtualItems: c.virtualItems,
    bits: c.seedBits,
    stock: c.seedStock,
    escrow: 0,
  }));
}

/** The contract's `set_market_params` arguments (U128 amounts as strings). */
export function setMarketParamsArgs(params: MarketParams = DEFAULT_PARAMS, pools: PoolConfig[] = defaultPoolConfigs()) {
  return {
    params: {
      open: params.open,
      fee_bps: params.feeBps,
      floor_bps: params.floorBps,
      ceiling_bps: params.ceilingBps,
      max_amount: params.maxAmount,
      max_open_listings: params.maxOpenListings,
      max_listings: params.maxListings,
      daily_trades: params.dailyTrades,
      daily_listings: params.dailyListings,
      daily_fills: params.dailyFills,
      daily_fill_bits: String(params.dailyFillBits),
      craft_bits: String(params.craftBits),
    },
    pools: pools.map((p) => ({
      item: p.item,
      virtual_bits: String(p.virtualBits),
      virtual_items: String(p.virtualItems),
      seed_bits: String(p.seedBits),
      seed_stock: String(p.seedStock),
    })),
  };
}

export const BITS_TOKEN = "item:bits";
export const itemToken = (item: string) => `item:${item}`;
