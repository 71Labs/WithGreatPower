/**
 * Measuring the Bits economy: runs the bot fast-forward (./bots.ts) under a set of rules
 * and counts where every Bit came from and went. `scripts/economy-balance.ts` prints the
 * tables in docs/ECONOMY.md from this; /lab/economy uses the same settings for its
 * "Recommended settings" switch.
 *
 * A setting is only things that can change without touching the contract's code or a
 * ranked score: `set_market_params` values (the fee, `craft_bits`, each pool's virtual
 * reserves) and the server's Bits-per-night rule.
 */
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId, Rarity } from "@wgp/game-core/types";

import { Economy, LAB_INVESTORS, type BotKind, type DaySnapshot, type EconomyConfig } from "./bots";
import { BITS_TOKEN, CURVES, DEFAULT_PARAMS, defaultPoolConfigs, type MarketParams, type PoolConfig } from "./config";
import { sellQuote, type Pool } from "./math";
import { BITS_FOR_LEVEL_UP, BITS_FOR_SHOWING_UP, taperedNightBits, type Taper } from "./rewards";

export interface Setting {
  id: string;
  label: string;
  /** Bits burned per crafted suit (`craft_bits`). */
  craftBits: number;
  /** The gas fee, burned (`fee_bps`; the contract allows up to 1000). */
  feeBps: number;
  /** Multiplies every item's price by moving the pools' virtual Bits. */
  priceScale: number;
  /** Multiplies every pool's virtual items: a deeper curve moves less per trade. */
  depthScale: number;
  /** The faucet's wallet taper (server side), or null for today's flat rule. */
  taper: Taper | null;
}

/** What game.wgpnear.near holds today: 2% fee, free crafting, the seeded curves. */
export const MAINNET: Setting = { id: "mainnet", label: "Mainnet today", craftBits: 0, feeBps: 200, priceScale: 1, depthScale: 1, taper: null };

const rarityOf = (item: string) => (ITEMS[item as ItemId] as { rarity: Rarity }).rarity;

/**
 * The pools for a setting. Gwei keeps what she really holds (`set_market_params` leaves an
 * existing pool's till and stock alone); only the virtual reserves move. With her seeded
 * stock s and till t:
 *   virtualItems = depth · seeded virtualItems,   y = price · (virtualItems + s),
 *   virtualBits = y − t.
 * `holdings` (mainnet's pools today) only replaces what she starts the run holding.
 */
export function poolConfigsFor(setting: Pick<Setting, "priceScale" | "depthScale">, holdings: Pool[] | null = null): PoolConfig[] {
  return defaultPoolConfigs().map((seeded) => {
    const held = holdings?.find((p) => p.item === seeded.item);
    const curve = CURVES[rarityOf(seeded.item)];
    const virtualItems = Math.max(1, Math.round(curve.virtualItems * setting.depthScale));
    const y = Math.round(curve.price * setting.priceScale * (virtualItems + curve.stock));
    return {
      item: seeded.item,
      virtualBits: Math.max(1, y - seeded.seedBits),
      virtualItems,
      seedBits: held?.bits ?? seeded.seedBits,
      seedStock: held?.stock ?? seeded.seedStock,
    };
  });
}

export const paramsFor = (setting: Pick<Setting, "feeBps" | "craftBits">): MarketParams => ({ ...DEFAULT_PARAMS, feeBps: setting.feeBps, craftBits: setting.craftBits });

export interface RunSpec {
  days: number;
  bots: number;
  seed: number;
  /** Nights a hero plays before a new one takes the place (default: nobody quits). */
  lifespan?: number;
  /**
   * Sandwich Man, the NPC trader, trades among the heroes. Off by default here: he is off on
   * mainnet until funded, and docs/ECONOMY.md's tables are measured without him (its
   * "with Sandwich Man" row turns this on).
   */
  npc?: boolean;
  /**
   * Investor bots fund Gwei's tills when they run dry (contract v3's investing, ./invest.ts).
   * Off by default: mainnet runs v2, which has no investing, and every table in
   * docs/ECONOMY.md is measured without them.
   */
  invest?: boolean;
}

/** The fast-forward's config for a setting, with the contract's one-suit rule on. */
export function economyConfig(setting: Setting, run: RunSpec & { mix?: BotKind[] }, holdings: Pool[] | null = null): EconomyConfig {
  const taper = setting.taper;
  const { invest, ...rest } = run;
  return {
    ...rest,
    ...(invest ? { investors: LAB_INVESTORS } : {}),
    npc: run.npc ?? false,
    params: paramsFor(setting),
    pools: poolConfigsFor(setting, holdings),
    oneSuitEach: true,
    reward: taper ? (night) => taperedNightBits(night, night.held, taper) : undefined,
  };
}

export function play(config: EconomyConfig): Economy {
  const e = new Economy(config);
  while (!e.done) e.step();
  return e;
}

export interface Measure {
  setting: string;
  days: number;
  bots: number;
  seed: number;
  /** Bits minted, by cause. `withheld` is what the taper didn't pay (never minted). */
  minted: { total: number; score: number; showingUp: number; levelUp: number; withheld: number };
  burned: { total: number; fee: number; craft: number };
  /** Burned ÷ minted over the whole run, and over its last third (the late window). */
  burnShare: number;
  lateBurnShare: number;
  /** Net new Bits per hero per day over the last third. */
  lateNetPerHeroDay: number;
  /** Bits in the till at day 0, for the identity below. */
  seededTill: number;
  /** Heroes' Bits plus the till at the end; always seededTill + minted − burned. */
  supply: number;
  till: number;
  tillLow: number;
  heldMean: number;
  heldMedian: number;
  /** Gini of heroes' Bits at the end: 0 is equal, 1 is one hero holding everything. */
  gini: number;
  /** Share of item-days that ended with Gwei sold out, and with a till that can't buy one. */
  soldOut: number;
  broke: number;
  suits: number;
  /** Crafter bots holding at least one suit, and the median night of play it came on (null: none). */
  crafterShare: number;
  firstSuitNight: number | null;
  /** Average price by rarity as a multiple of day 0: at the end, and the lowest and highest day. */
  price: Record<Rarity, { end: number; low: number; high: number }>;
  trades: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function gini(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const total = sum(s);
  if (!s.length || total === 0) return 0;
  const weighted = s.reduce((acc, x, i) => acc + (i + 1) * x, 0);
  return (2 * weighted) / (s.length * total) - (s.length + 1) / s.length;
}

const RARITIES: Rarity[] = ["common", "uncommon", "rare"];

/** Whether the pool as it stood at the end of `day` could still buy one item from a player. */
function brokeOn(e: Economy, day: DaySnapshot, item: string): boolean {
  const base = e.book.pools.find((p) => p.item === item)!;
  // Investors' Bits stand in for virtual ones: the curve that day had what was invested that day off its virtual reserve.
  const virtualBits = base.virtualBits + (base.invested ?? 0) - (day.invested[item] ?? 0);
  return sellQuote({ ...base, virtualBits, stock: day.stock[item]!, bits: day.tills[item]! }, 1, e.book.params.feeBps) === null;
}

export function measure(setting: Setting, run: RunSpec): Measure {
  return measureEconomy(setting.id, play(economyConfig(setting, run)));
}

export function measureEconomy(setting: string, e: Economy): Measure {
  const h = e.history;
  const first = h[0]!;
  const last = h[h.length - 1]!;
  const days = last.day;
  const from = h[Math.max(0, days - Math.max(1, Math.round(days / 3)))]!;
  const fee = e.book.burned;
  const held = e.bots.map((b) => e.ledger.balance(b.id, BITS_TOKEN));
  const items = Object.keys(first.prices);
  const played = h.slice(1);
  const itemDays = Math.max(1, played.length * items.length);
  const crafters = [...e.bots, ...e.retired].filter((b) => b.kind === "crafter");
  const suited = crafters.filter((b) => b.firstSuitNight !== null);
  const index = (d: DaySnapshot, rarity: Rarity) => {
    const of = items.filter((i) => rarityOf(i) === rarity);
    return sum(of.map((i) => d.prices[i]! / first.prices[i]!)) / of.length;
  };
  const round = (n: number, places = 3) => Number(n.toFixed(places));
  const lateMint = last.minted - from.minted;
  const lateBurn = last.burned - from.burned;
  const showingUp = Math.min(e.tally.minted, e.tally.nights * BITS_FOR_SHOWING_UP);
  const levelUp = Math.min(e.tally.minted - showingUp, e.tally.levelUps * BITS_FOR_LEVEL_UP);
  return {
    setting,
    days,
    bots: e.bots.length,
    seed: e.config.seed,
    minted: { total: e.tally.minted, score: e.tally.minted - showingUp - levelUp, showingUp, levelUp, withheld: e.tally.untapered - e.tally.minted },
    burned: { total: last.burned, fee, craft: last.burned - fee },
    burnShare: round(last.minted ? last.burned / last.minted : 0),
    lateBurnShare: round(lateMint ? lateBurn / lateMint : 0),
    lateNetPerHeroDay: round((lateMint - lateBurn) / (e.bots.length * Math.max(1, last.day - from.day)), 2),
    seededTill: first.till,
    supply: last.supply,
    till: last.till,
    tillLow: Math.min(...h.map((d) => d.till)),
    heldMean: round(sum(held) / held.length, 1),
    heldMedian: median(held) ?? 0,
    gini: round(gini(held)),
    soldOut: round(sum(played.map((d) => items.filter((i) => d.stock[i] === 0).length)) / itemDays),
    broke: round(sum(played.map((d) => items.filter((i) => brokeOn(e, d, i)).length)) / itemDays),
    suits: last.crafted,
    crafterShare: round(crafters.length ? suited.length / crafters.length : 0),
    firstSuitNight: median(suited.map((b) => b.firstSuitNight!)),
    price: Object.fromEntries(
      RARITIES.map((r) => {
        const path = played.map((d) => index(d, r));
        return [r, { end: round(index(last, r), 2), low: round(Math.min(...path), 2), high: round(Math.max(...path), 2) }];
      }),
    ) as Measure["price"],
    trades: sum(h.map((d) => d.trades + d.fills)),
  };
}

/** The same numbers averaged over seeds (the median for the night of the first suit). */
export function average(runs: Measure[]): Measure {
  const mean = (f: (m: Measure) => number, places = 3) => Number((sum(runs.map(f)) / runs.length).toFixed(places));
  const firsts = runs.map((m) => m.firstSuitNight).filter((d): d is number => d !== null);
  return {
    ...runs[0]!,
    seed: -1,
    minted: {
      total: mean((m) => m.minted.total, 0),
      score: mean((m) => m.minted.score, 0),
      showingUp: mean((m) => m.minted.showingUp, 0),
      levelUp: mean((m) => m.minted.levelUp, 0),
      withheld: mean((m) => m.minted.withheld, 0),
    },
    burned: { total: mean((m) => m.burned.total, 0), fee: mean((m) => m.burned.fee, 0), craft: mean((m) => m.burned.craft, 0) },
    burnShare: mean((m) => m.burnShare),
    lateBurnShare: mean((m) => m.lateBurnShare),
    lateNetPerHeroDay: mean((m) => m.lateNetPerHeroDay, 2),
    supply: mean((m) => m.supply, 0),
    till: mean((m) => m.till, 0),
    tillLow: mean((m) => m.tillLow, 0),
    heldMean: mean((m) => m.heldMean, 1),
    heldMedian: mean((m) => m.heldMedian, 0),
    gini: mean((m) => m.gini),
    soldOut: mean((m) => m.soldOut),
    broke: mean((m) => m.broke),
    suits: mean((m) => m.suits, 1),
    crafterShare: mean((m) => m.crafterShare),
    firstSuitNight: median(firsts),
    price: Object.fromEntries(RARITIES.map((r) => [r, { end: mean((m) => m.price[r].end, 2), low: mean((m) => m.price[r].low, 2), high: mean((m) => m.price[r].high, 2) }])) as Measure["price"],
    trades: mean((m) => m.trades, 0),
  };
}

export const measured = (setting: Setting, run: Omit<RunSpec, "seed">, seeds: number[]): Measure => average(seeds.map((seed) => measure(setting, { ...run, seed })));

/* ------------------------------------------------------------------ the target */

/**
 * What a setting has to do (docs/ECONOMY.md says why each number):
 * - burn between 25% and 100% of the Bits earned over a 21-day season of 60 heroes;
 * - the median crafter's first suit comes within 5 nights of play;
 * - over 60 days, Gwei ends at most 10% of item-days sold out or unable to buy.
 */
export const BAND = { burnShare: [0.25, 1] as const, firstSuitNight: 5, vendorDown: 0.1 };
export const SEASON = { days: 21, bots: 60 };
export const SIXTY = { days: 60, bots: 60 };

export interface Verdict {
  burnShare: boolean;
  firstSuit: boolean;
  vendor: boolean;
  ok: boolean;
}

/** Checks a setting's season run and 60-day run (each averaged over seeds) against the band. */
export function verdict(season: Measure, sixty: Measure): Verdict {
  const burnShare = season.burnShare >= BAND.burnShare[0] && season.burnShare <= BAND.burnShare[1];
  const firstSuit = season.firstSuitNight !== null && season.firstSuitNight <= BAND.firstSuitNight;
  const vendor = sixty.soldOut + sixty.broke <= BAND.vendorDown;
  return { burnShare, firstSuit, vendor, ok: burnShare && firstSuit && vendor };
}

/* ------------------------------------------------------------------ the settings */

/** Step 1, one owner transaction: crafting burns Bits and the gas fee goes to 5%. Curves stay. */
export const RECOMMENDED: Setting = { id: "recommended", label: "Recommended", craftBits: 250, feeBps: 500, priceScale: 1, depthScale: 1, taper: null };

/** Step 2, a server rule: the faucet slows above a suit's price and stops at twice it. */
export const RECOMMENDED_TAPER: Taper = { fullBelow: RECOMMENDED.craftBits, floorAt: 2 * RECOMMENDED.craftBits };
export const RECOMMENDED_WITH_TAPER: Setting = { ...RECOMMENDED, id: "recommended-taper", label: "Recommended + faucet taper", taper: RECOMMENDED_TAPER };

/**
 * A stress run that shows Gwei's two limits on mainnet's own rules and curves: three
 * hoarders buying rares for every dumper selling loot, so she sells out of rares and her
 * tills for the rest run dry. Both happen for every seed tried (balance.test.ts).
 */
export const DRAIN: { days: number; bots: number; mix: BotKind[] } = { days: 30, bots: 60, mix: ["hoarder", "hoarder", "hoarder", "dumper"] };

/**
 * "Gwei goes broke, an investor reopens her": the Drain Gwei run with investor bots
 * (bots.ts `LAB_INVESTORS`) on contract v3's investing rules. Dumpers sell her tills dry;
 * the next morning an investor funds the broke till and she buys again at the same price;
 * the investors earn half the gas fee on those pools; and their stakes wait in tills that
 * sellers keep emptying, which is the risk the market's invest sheet states. Deterministic
 * for a seed; balance.test.ts checks the closed days, the reopenings and the books.
 */
export const INVEST_SHOWCASE: { days: number; bots: number; seed: number; mix: BotKind[]; invest: true } = { ...DRAIN, seed: 2026, invest: true };

/** A day-by-day reading of the showcase: which shops ended each day closed, and what the investors did. */
export interface InvestStory {
  /** Item-days that ended with a broke till. */
  brokeDays: number;
  /** Times an investment landed in a till that had ended the day before broke. */
  reopenings: number;
  invested: number;
  withdrawn: number;
  /** Fee earnings paid to investors. */
  earned: number;
  /** Bits still staked at the end: waiting in Gwei's tills. */
  staked: number;
}

/**
 * Gwei's limits over a run, counted in one place for every panel and document: the item-days
 * (an item at a day's close) that ended sold out, and those that ended with a till that
 * couldn't buy one. "Couldn't buy" is the engine's own flag on the day's snapshot (`tillShort`
 * on the pool as it stood), so Bits an investor put in are already counted. Day 0 is the
 * opening state and isn't a day's close.
 */
export function vendorLimits(history: DaySnapshot[]): { soldOut: number; broke: number; itemDays: number } {
  const days = history.slice(1);
  let soldOut = 0;
  let broke = 0;
  let itemDays = 0;
  for (const d of days) {
    for (const item of Object.keys(d.broke)) {
      itemDays += 1;
      if (d.stock[item] === 0) soldOut += 1;
      if (d.broke[item]) broke += 1;
    }
  }
  return { soldOut, broke, itemDays };
}

export function investStory(e: Economy): InvestStory {
  const h = e.history;
  const events = h.flatMap((d) => d.investors?.events ?? []);
  let reopenings = 0;
  h.forEach((d, i) => {
    for (const ev of d.investors?.events ?? []) if (ev.kind === "invest" && i > 0 && h[i - 1]!.broke[ev.item]) reopenings += 1;
  });
  const last = h[h.length - 1]!;
  return {
    brokeDays: vendorLimits(h).broke,
    reopenings,
    invested: sum(events.filter((x) => x.kind === "invest").map((x) => x.bits)),
    withdrawn: sum(events.filter((x) => x.kind === "withdraw").map((x) => x.bits)),
    earned: last.investors?.earned ?? 0,
    staked: last.investors?.staked ?? 0,
  };
}

/** The two runners-up: a gentler step that keeps the 2% fee, and a steeper one. */
export const ALTERNATIVES: Setting[] = [
  { id: "gentle", label: "Alternative A: gentle", craftBits: 150, feeBps: 200, priceScale: 1, depthScale: 1, taper: null },
  { id: "steep", label: "Alternative B: steep", craftBits: 300, feeBps: 1000, priceScale: 1, depthScale: 1, taper: null },
];
