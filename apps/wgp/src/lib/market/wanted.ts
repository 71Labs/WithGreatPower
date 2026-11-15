/**
 * GWEI'S WANTED LIST: the market decides what you hunt.
 *
 * Each UTC day Gwei Stacy posts up to WANTED_MAX items she is short on, worked out from her
 * pools alone (`deriveWanted`; pure, no clock, no randomness). A verified night that brings
 * in a wanted item gets a multiplier on THAT item's drop, minted with the night's loot
 * (`wantedBonus`, applied by src/server/db/runs.ts through src/server/market/wanted.ts). The
 * replay, the score and the ruleset never see it: the bonus is computed from the verified
 * night's loot and the day's list only. Players then sell the extra to her, her stock comes
 * back and the price falls: the loop closes.
 *
 * WHO MAKES THE LIST (every rule is a comparison with how the pool opened, `openingOf`)
 *
 *   sold out      stock 0                                      ×3
 *   low stock     stock at or under 75% of her opening stock   ×2
 *   price up      spot price at least 125% of her opening one  ×2
 *
 *   Not listed: a pool whose till can't pay for one (she's "broke" for it: more of that item
 *   would only pile up where she can't buy it), a pool for an item the game doesn't drop,
 *   a pool on a curve she didn't open with (nothing honest to compare with; only "sold out"
 *   still counts there), and every pool while the market is switched off.
 *   Ranked: sold out first, then by how far short (the larger of the stock shortfall and the
 *   price rise), then by item id, so the same pools always give the same list.
 *
 * THE CAP (extra items, on top of what the night dropped)
 *
 *   rarity      a night   a day (per player, per item)
 *   common      4         8
 *   uncommon    2         4
 *   rare        1         2
 *
 * The list is frozen per day: the first request of the day snapshots the pools and stores
 * the snapshot and the list together (src/server/market/wanted.ts), so the list a player saw
 * when they swung out is the one their night is paid against.
 */
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId, Rarity } from "@wgp/game-core/types";

import { defaultPoolConfigs, type PoolConfig } from "./config";
import { sellQuote, spotMilli, type Pool } from "./math";
import { openingOf } from "./reasoning";

/** Items on one day's list, at most. */
export const WANTED_MAX = 3;
/** Stock at or under this share of her opening stock (basis points) makes the list. */
export const LOW_STOCK_BPS = 7_500;
/** A spot price at or over this share of her opening price (basis points) makes the list. */
export const PRICE_UP_BPS = 12_500;
export const WANTED_MULTIPLIER = 2;
export const SOLD_OUT_MULTIPLIER = 3;

/** Extra items a wanted drop may add, per night and per player per UTC day. */
export const WANTED_CAPS: Record<Rarity, { night: number; day: number }> = {
  common: { night: 4, day: 8 },
  uncommon: { night: 2, day: 4 },
  rare: { night: 1, day: 2 },
};

export type WantedReason = "sold-out" | "low-stock" | "price-up";

export interface WantedItem {
  item: string;
  name: string;
  rarity: Rarity;
  reason: WantedReason;
  multiplier: number;
  /** Her stock at the snapshot, and what she opened with (null on a curve she didn't open with). */
  stock: number;
  openedStock: number | null;
  /** Spot price × 1000 at the snapshot, and her opening price (null when unknown). */
  priceMilli: number;
  openedMilli: number | null;
  /** Extra items allowed per night and per player per day. */
  cap: { night: number; day: number };
}

/** What the list is worked out from: the market as it stood. */
export interface WantedInput {
  pools: Pool[];
  /** `params.open`: false while the market is switched off. */
  open: boolean;
  feeBps: number;
}

const isItem = (item: string): item is ItemId => item in ITEMS;

/** The cap for an item's rarity; an unknown rarity gets the rare one, the tightest. */
export const capFor = (rarity: string): { night: number; day: number } => WANTED_CAPS[rarity as Rarity] ?? WANTED_CAPS.rare;

interface Ranked {
  w: WantedItem;
  short: number;
}

/** One pool's entry on the list, or null when she isn't short of it. */
function wantedOf(pool: Pool, feeBps: number, configs: PoolConfig[]): Ranked | null {
  if (!isItem(pool.item)) return null;
  // Broke for this item: she couldn't pay for one more, so more of it helps nobody.
  if (sellQuote(pool, 1, feeBps) === null) return null;
  const meta = ITEMS[pool.item];
  const opening = openingOf(pool, configs);
  const priceMilli = spotMilli(pool);
  const base = {
    item: pool.item,
    name: meta.name,
    rarity: meta.rarity,
    stock: pool.stock,
    openedStock: opening?.stock ?? null,
    priceMilli,
    openedMilli: opening?.priceMilli ?? null,
    cap: capFor(meta.rarity),
  };
  if (pool.stock <= 0) return { w: { ...base, reason: "sold-out", multiplier: SOLD_OUT_MULTIPLIER }, short: 10_000 };
  if (!opening || opening.stock <= 0 || opening.priceMilli <= 0) return null;
  const shortBps = Math.max(0, Math.floor(((opening.stock - pool.stock) * 10_000) / opening.stock));
  const upBps = Math.max(0, Math.floor(((priceMilli - opening.priceMilli) * 10_000) / opening.priceMilli));
  const low = pool.stock * 10_000 <= opening.stock * LOW_STOCK_BPS;
  const up = priceMilli * 10_000 >= opening.priceMilli * PRICE_UP_BPS;
  if (!low && !up) return null;
  return { w: { ...base, reason: low ? "low-stock" : "price-up", multiplier: WANTED_MULTIPLIER }, short: Math.max(shortBps, upBps) };
}

/** The day's wanted list from the market as it stands. Pure and deterministic. */
export function deriveWanted(input: WantedInput, configs: PoolConfig[] = defaultPoolConfigs()): WantedItem[] {
  if (!input.open) return [];
  const ranked: Ranked[] = [];
  for (const pool of input.pools) {
    const r = wantedOf(pool, input.feeBps, configs);
    if (r) ranked.push(r);
  }
  ranked.sort((a, b) => {
    const soldOut = Number(b.w.reason === "sold-out") - Number(a.w.reason === "sold-out");
    if (soldOut !== 0) return soldOut;
    if (b.short !== a.short) return b.short - a.short;
    return a.w.item < b.w.item ? -1 : a.w.item > b.w.item ? 1 : 0;
  });
  return ranked.slice(0, WANTED_MAX).map((r) => r.w);
}

/** One day's list, as stored and served. */
export interface WantedDay {
  /** The UTC day, "2026-11-15". */
  day: string;
  /** When the snapshot was taken, ISO. */
  at: string;
  onChain: boolean;
  items: WantedItem[];
}

/* ------------------------------------------------------------------ the bonus */

export interface WantedBonus {
  item: string;
  name: string;
  multiplier: number;
  /** What the verified night dropped of it. */
  brought: number;
  /** Extra minted on top, after the caps. */
  bonus: number;
  /** Which cap cut the bonus short, if one did: a night's, or what was left of today's. */
  capped: "night" | "day" | null;
}

const whole = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * What a verified night earns from the list: for each wanted item it brought, (multiplier − 1)
 * × the drop as extra, at most the night's cap and what is left of today's (`usedToday`, the
 * extra this player already got of that item today). Pure.
 */
export function wantedBonus(list: WantedItem[], loot: Partial<Record<string, number>>, usedToday: Partial<Record<string, number>> = {}): WantedBonus[] {
  const out: WantedBonus[] = [];
  for (const w of list) {
    const brought = whole(loot[w.item]);
    if (brought <= 0) continue;
    const want = brought * Math.max(0, Math.floor(w.multiplier) - 1);
    const left = Math.max(0, w.cap.day - whole(usedToday[w.item]));
    const bonus = Math.min(want, w.cap.night, left);
    const capped = bonus >= want ? null : left < Math.min(want, w.cap.night) ? "day" : "night";
    out.push({ item: w.item, name: w.name, multiplier: w.multiplier, brought, bonus, capped });
  }
  return out;
}

/* ------------------------------------------------------------------ words */

/** Why she wants it, with the snapshot's numbers. */
export function wantedWhy(w: WantedItem): string {
  if (w.reason === "sold-out") return w.openedStock ? `Sold out: 0 of the ${w.openedStock} she opened with` : "Sold out";
  if (w.reason === "low-stock") return `Running low: ${w.stock} of the ${w.openedStock ?? w.stock} she opened with`;
  const up = w.openedMilli ? Math.round(((w.priceMilli - w.openedMilli) * 100) / w.openedMilli) : 0;
  return `Price up ${up}% on her opening price`;
}

/**
 * An item's name as a plural in running text: "fee bombs", "press passes", "crumbs",
 * "Doc’s spare arms" (a name that opens with someone's name keeps its capital).
 */
export function pluralName(name: string): string {
  const lower = /^\S+’s\s/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
  if (/goo$/i.test(lower) || (/s$/i.test(lower) && !/ss$/i.test(lower))) return lower;
  if (/(ss|sh|ch|x)$/i.test(lower)) return `${lower}es`;
  return `${lower}s`;
}

/** The results line for one wanted item: "Gwei wanted crumbs: ×2 → you brought 6". */
export function wantedLine(b: WantedBonus): string {
  return `Gwei wanted ${pluralName(b.name)}: ×${b.multiplier} → you brought ${b.brought + b.bonus}`;
}

/** The small print under it: what dropped, what she added, and whether the cap cut in. */
export function wantedDetail(b: WantedBonus): string {
  if (b.bonus <= 0) return `${b.brought} dropped. You’ve had today’s bonus on these.`;
  const cap = b.capped === "night" ? ", the most one night pays" : b.capped === "day" ? ", the rest of today’s bonus" : "";
  return `${b.brought} dropped, +${b.bonus} from her list${cap}.`;
}

/** The chip on Tonight's list: "Crumbs ×2". */
export const wantedChip = (w: Pick<WantedItem, "name" | "multiplier">) => `${w.name} ×${w.multiplier}`;

/** Today's list from the server; null when it can't be read (the tile then stays away). */
export async function getWanted(signal?: AbortSignal): Promise<WantedDay | null> {
  try {
    const res = await fetch("/api/market/wanted", { credentials: "same-origin", cache: "no-store", signal });
    if (!res.ok) return null;
    return (await res.json()) as WantedDay;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}
