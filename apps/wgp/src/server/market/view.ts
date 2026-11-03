/**
 * What the market screens read: prices, stock, sparklines and listings, from the
 * contract when its market is live and from the simulation otherwise. Shared by every
 * viewer, so it sits in `"use cache"` functions tagged "market" and fresh for about 10
 * seconds; a trade the server sees expires the tag at once (`refreshMarket`).
 */
import { cacheLife, cacheTag, revalidateTag } from "next/cache";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import type { ListingView, MarketItemView, MarketView } from "@/lib/market/api";
import type { MarketParams } from "@/lib/market/config";
import type { Listing } from "@/lib/market/engine";
import { buyQuote, sellQuote, spotMilli, type Pool } from "@/lib/market/math";

import { getDb } from "../db/client";
import { readChainListings, readChainMarket, type ChainMarket } from "./chain";
import { loadHistory, priceStats } from "./history";
import { readSim, type SimState } from "./sim";

export const MARKET_TAG = "market";

export type MarketSource = { onChain: true; chain: ChainMarket } | { onChain: false; sim: SimState };

/** The contract's market if it's live, else the simulated one. */
export async function marketSource(): Promise<MarketSource> {
  const chain = await readChainMarket();
  if (chain) return { onChain: true, chain };
  return { onChain: false, sim: await readSim(await getDb()) };
}

export function poolsOf(source: MarketSource): { params: MarketParams; pools: Pool[] } {
  return source.onChain ? source.chain : source.sim.book;
}

const known = (item: string): item is ItemId => item in ITEMS;

export function itemViews(params: MarketParams, pools: Pool[], stats: ReturnType<typeof priceStats>): MarketItemView[] {
  return pools.filter((p) => known(p.item)).map((pool) => {
    const meta = ITEMS[pool.item as ItemId];
    const s = stats.get(pool.item);
    return {
      item: meta.id,
      name: meta.name,
      rarity: meta.rarity,
      priceMilli: spotMilli(pool),
      buyOne: buyQuote(pool, 1, params.feeBps)?.total ?? null,
      sellOne: sellQuote(pool, 1, params.feeBps)?.net ?? null,
      spark: s?.spark ?? [spotMilli(pool), spotMilli(pool)],
      change24h: s?.change24h ?? null,
      trades24h: s?.trades24h ?? 0,
      pool,
    };
  });
}

export async function marketView(): Promise<MarketView> {
  "use cache";
  cacheTag(MARKET_TAG);
  cacheLife({ stale: 10, revalidate: 10, expire: 120 });
  const source = await marketSource();
  const { params, pools } = poolsOf(source);
  const history = await loadHistory(await getDb(), source.onChain);
  const items = itemViews(params, pools, priceStats(pools, history.rows, history.opening));
  return {
    onChain: source.onChain,
    network: source.onChain ? source.chain.network : null,
    contractId: source.onChain ? source.chain.contractId : null,
    vendor: source.onChain ? source.chain.vendor : null,
    params,
    items,
    listings: source.onChain ? source.chain.listings : source.sim.book.listings.length,
    till: pools.reduce((sum, p) => sum + p.bits, 0),
    updatedAt: new Date().toISOString(),
  };
}

export function listingViews(listings: Listing[], pools: Pool[]): ListingView[] {
  return listings
    .filter((l) => known(l.item))
    .map((l) => {
      const pool = pools.find((p) => p.item === l.item);
      const unitMilli = Math.floor((l.price * 1000) / Math.max(1, l.amount));
      const spot = pool ? spotMilli(pool) : 0;
      return { ...l, name: ITEMS[l.item as ItemId].name, unitMilli, vsSpot: spot > 0 ? unitMilli / spot : 1 };
    })
    .sort((a, b) => b.id - a.id);
}

export async function marketListings(): Promise<{ onChain: boolean; listings: ListingView[] }> {
  "use cache";
  cacheTag(MARKET_TAG);
  cacheLife({ stale: 10, revalidate: 10, expire: 120 });
  const source = await marketSource();
  const listings = source.onChain ? await readChainListings() : source.sim.book.listings;
  return { onChain: source.onChain, listings: listingViews(listings, poolsOf(source).pools) };
}

/** Expires the cached market now. Call from a Route Handler after a trade commits. */
export function refreshMarket(): void {
  revalidateTag(MARKET_TAG, { expire: 0 });
}
