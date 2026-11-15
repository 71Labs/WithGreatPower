/**
 * GWEI'S NEW STOCK: four items and two suits added after launch, so the Mempool Market has
 * new things to earn, buy, sell and burn.
 *
 * None of them drops on patrol: Season 1's ruleset 4 (the ranked night's loot) is frozen, so
 * these are awarded by the server from verified results that don't touch any simulation, and
 * minted through the same operator path (`mint_rewards`) as a night's loot:
 *
 * - Gas receipt (common): any verified Daily Run, once a UTC day.
 * - Finality flag (uncommon): a verified Daily Run finished clean (no fight lost, not knocked out), once a UTC day.
 * - Evidence bag (common): a verified case clear, once a UTC day.
 * - Torn seed phrase (rare): a top-three finish on a settled Daily, once per day placed.
 *
 * Each is burned by a suit recipe the contract checks in `craft_suit`: Notary (3 evidence
 * bags, 2 gas receipts, level 2) and Finality (2 finality flags, 1 torn seed phrase, level 3).
 *
 * ON CHAIN THEY NEED TWO OWNER CALLS: `set_rules` registers the items and suits, and
 * `set_market_params` opens a pool for each item (its seed stock and till are minted to the
 * vendor once). Until a pool exists the app treats the item as not open: the server awards
 * nothing (a mint of an unregistered item would fail the whole batch), the market lists only
 * the pools the contract has, the practice market labels it a preview, and the Suit lab
 * shows the two suits as coming soon. `scripts/near/new-stock-args.ts` prints both calls' arguments.
 */
import { ITEMS, SUITS } from "@wgp/game-core/data";
import type { ItemId, SuitId } from "@wgp/game-core/types";

import type { PoolConfig } from "./config";

export type NewStockSource = "daily" | "daily-clean" | "daily-podium" | "case";

export interface NewStockItem {
  id: ItemId;
  source: NewStockSource;
  /** How it's earned, in words, for the market and the Suit lab. */
  howToEarn: string;
}

export const NEW_STOCK: readonly NewStockItem[] = [
  {
    id: "gas-receipt",
    source: "daily",
    howToEarn: "Play the Daily Run. One a day.",
  },
  {
    id: "finality-flag",
    source: "daily-clean",
    howToEarn: "Finish the Daily Run without losing a fight. One a day.",
  },
  { id: "evidence-bag", source: "case", howToEarn: "Close a case. One a day." },
  {
    id: "seed-phrase",
    source: "daily-podium",
    howToEarn: "Finish a Daily Run in the top three.",
  },
];

export const NEW_STOCK_IDS: readonly ItemId[] = NEW_STOCK.map((i) => i.id);
export const NEW_SUIT_IDS: readonly SuitId[] = ["notary", "finality"];

/** The eight items the market opened with (Season 1's patrol drops), in ITEMS order. */
export const LAUNCH_ITEM_IDS: readonly ItemId[] = (
  Object.keys(ITEMS) as ItemId[]
).filter((id) => !NEW_STOCK_IDS.includes(id));
/** The eight suits registered at launch, in SUITS order. */
export const LAUNCH_SUIT_IDS: readonly SuitId[] = (
  Object.keys(SUITS) as SuitId[]
).filter((id) => !NEW_SUIT_IDS.includes(id));

export const isNewStock = (item: string): boolean =>
  (NEW_STOCK_IDS as readonly string[]).includes(item);
export const isNewSuit = (suit: string): boolean =>
  (NEW_SUIT_IDS as readonly string[]).includes(suit);
export const newStockItem = (item: string): NewStockItem | undefined =>
  NEW_STOCK.find((i) => i.id === item);

/**
 * The new pools. The virtual reserves are the live pools' for the same rarity (commons
 * 480/40, uncommons 800/20, rares 1200/8), so each opens at its tier's price (12, 40 and 150
 * Bits) with the same depth; the seeds are small: a few items to sell and a till that buys
 * back about as many.
 */
export const NEW_STOCK_POOLS: readonly PoolConfig[] = [
  {
    item: "gas-receipt",
    virtualBits: 480,
    virtualItems: 40,
    seedBits: 120,
    seedStock: 10,
  },
  {
    item: "finality-flag",
    virtualBits: 800,
    virtualItems: 20,
    seedBits: 240,
    seedStock: 6,
  },
  {
    item: "evidence-bag",
    virtualBits: 480,
    virtualItems: 40,
    seedBits: 120,
    seedStock: 10,
  },
  {
    item: "seed-phrase",
    virtualBits: 1200,
    virtualItems: 8,
    seedBits: 300,
    seedStock: 2,
  },
];

/**
 * Which new items are open: their pool exists in the market being read. A pool can only
 * exist once `set_rules` has registered the item (`set_market_params` refuses an unknown
 * item), so an open item is also one `mint_rewards` and `craft_suit` accept.
 */
export function openNewStock(poolItems: Iterable<string>): Set<ItemId> {
  const have = new Set(poolItems);
  return new Set(NEW_STOCK_IDS.filter((id) => have.has(id)));
}

/** A new suit is open when every item its recipe burns is open (one `set_rules` registers both). */
export function suitOpen(suit: SuitId, open: ReadonlySet<string>): boolean {
  if (!isNewSuit(suit)) return true;
  return Object.keys(SUITS[suit].recipe).every((item) => open.has(item));
}

/* ------------------------------------------------------------------ awards */

/** A verified Daily Run's stats, as the server stores them (game-core replay.ts runStats). */
export interface DailyStats {
  fightsLost?: number;
  knockedOut?: number;
  fightsWon?: number;
}

export interface NewStockAward {
  item: ItemId;
  amount: number;
  source: NewStockSource;
}

/** What a verified Daily Run earns: a gas receipt, and a finality flag when it was clean. Pure, from the verified stats. */
export function dailyAward(stats: DailyStats): NewStockAward[] {
  const out: NewStockAward[] = [
    { item: "gas-receipt", amount: 1, source: "daily" },
  ];
  const clean =
    (stats.fightsLost ?? 0) === 0 &&
    (stats.knockedOut ?? 0) === 0 &&
    (stats.fightsWon ?? 0) > 0;
  if (clean)
    out.push({ item: "finality-flag", amount: 1, source: "daily-clean" });
  return out;
}

/** What a verified case run earns: an evidence bag when it closed the case. */
export function caseAward(stats: { cleared?: number }): NewStockAward[] {
  return stats.cleared === 1
    ? [{ item: "evidence-bag", amount: 1, source: "case" }]
    : [];
}

/** What a settled Daily's top three earn: one torn seed phrase each. */
export function podiumAward(rank: number): NewStockAward[] {
  return rank >= 1 && rank <= 3
    ? [{ item: "seed-phrase", amount: 1, source: "daily-podium" }]
    : [];
}

/** Each award's outbox key: one per item, per player, per UTC day (a podium: per day placed). */
export const newStockKey = (
  award: Pick<NewStockAward, "item">,
  playerId: string,
  day: string,
) => `new-stock:${award.item}:${playerId}:${day}`;

/* ------------------------------------------------------------------ the owner's calls */

/** The contract's `get_config` as far as `set_rules` needs it. */
export interface LiveRules {
  items: string[];
  suits: {
    id: string;
    starter: boolean;
    min_level: number;
    recipe: { item: string; amount: number }[];
  }[];
  starter_unlock_level: number;
}

const ruleOf = (id: SuitId) => {
  const s = SUITS[id];
  return {
    id,
    starter: s.starter,
    min_level: s.minLevel,
    recipe: Object.entries(s.recipe).map(([item, amount]) => ({
      item,
      amount: amount!,
    })),
  };
};

/**
 * `set_rules` arguments that keep every live item, suit, starter flag, level and recipe
 * exactly as the contract has them (in their order) and append the new items and suits
 * that aren't there yet. Running it twice changes nothing.
 */
export function setRulesArgs(live: LiveRules): LiveRules {
  const items = [
    ...live.items,
    ...NEW_STOCK_IDS.filter((id) => !live.items.includes(id)),
  ];
  const suits = [
    ...live.suits,
    ...NEW_SUIT_IDS.filter((id) => !live.suits.some((s) => s.id === id)).map(
      ruleOf,
    ),
  ];
  return { items, suits, starter_unlock_level: live.starter_unlock_level };
}

/** The new pools as `set_market_params` takes them (U128 amounts as strings), skipping pools that already exist. */
export function newPoolArgs(livePools: Iterable<string> = []) {
  const have = new Set(livePools);
  return NEW_STOCK_POOLS.filter((p) => !have.has(p.item)).map((p) => ({
    item: p.item,
    virtual_bits: String(p.virtualBits),
    virtual_items: String(p.virtualItems),
    seed_bits: String(p.seedBits),
    seed_stock: String(p.seedStock),
  }));
}
