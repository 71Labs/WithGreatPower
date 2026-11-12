/**
 * Bot players for the /lab/economy fast-forward: N days of a city full of heroes who
 * patrol (earning Bits and loot), then buy, sell, list and craft on the Mempool Market.
 * Every trade goes through the market engine (./engine.ts), the same rules and curve
 * math the server simulates with and the contract is tested against, so the charts show
 * how the real market would move. Deterministic for a seed.
 *
 * Four kinds of bot:
 * - crafters chase a suit recipe, buying what they lack (a listing if it's cheaper than
 *   Gwei, else Gwei), then craft it, burning the items (and `craftBits`);
 * - dumpers sell every drop to Gwei the morning after;
 * - flippers buy dips and sell rips against their own moving average, list at a markup
 *   and snap up listings under Gwei's price;
 * - hoarders buy rares when they're flush and list them high.
 */
import { ITEMS, SUITS, VILLAINS } from "@wgp/game-core/data";
import type { ItemId, SuitId } from "@wgp/game-core/types";

import { BITS_TOKEN, DEFAULT_PARAMS, itemToken, seededPools, type MarketParams, type PoolConfig } from "./config";
import { buyListing, cancelListing, listItem, marketBuy, marketSell, MarketError, memoryLedger, newBook, type MarketBook } from "./engine";
import { buyQuote, spotMilli } from "./math";
import { nightBits } from "./rewards";

export type BotKind = "crafter" | "dumper" | "flipper" | "hoarder";

export interface EconomyConfig {
  days: number;
  bots: number;
  seed: number;
  params?: Partial<MarketParams>;
  /** The curves and holdings Gwei starts from (default: config.ts's, as seeded on chain). */
  pools?: PoolConfig[];
  /**
   * The contract's rule: a hero crafts each suit once ("You already own this suit"). A
   * crafter who owns all of them sells drops like a dumper. Off (the default), crafters
   * re-craft forever, which overstates the crafting sink.
   */
  oneSuitEach?: boolean;
  /**
   * Nights a hero plays before quitting, when set: a new hero of the same kind takes the
   * place with nothing, and the quitter keeps what they hold (it stays in the supply).
   * The first heroes start at staggered ages so they don't all quit on one day.
   */
  lifespan?: number;
  /** The kinds of hero, dealt in turn (default: 3 crafters, 2 dumpers, 2 flippers and a hoarder in 8). */
  mix?: BotKind[];
  /**
   * Bits for a night (default: `nightBits`), given the hero's own Bits (`held`) and the
   * Bits all heroes held that morning (`circulating`, across `heroes`).
   */
  reward?: (night: { score: number; levelledUp: boolean; held: number; circulating: number; heroes: number }) => number;
}

/** What the patrols paid, for splitting the Bits earned by cause. */
export interface MintTally {
  nights: number;
  levelUps: number;
  /** What `nightBits` would have paid; more than `minted` when a `reward` rule pays less. */
  untapered: number;
  minted: number;
}

export interface DaySnapshot {
  day: number;
  /** Spot × 1000 per item. */
  prices: Record<string, number>;
  stock: Record<string, number>;
  /** Bits in the till per item. */
  tills: Record<string, number>;
  /** Bits in the vendor's till across every pool. */
  till: number;
  /** Bits held by players plus the till. */
  supply: number;
  /** All Bits burned so far: the gas fee and crafting. */
  burned: number;
  minted: number;
  crafted: number;
  trades: number;
  fills: number;
  listings: number;
}

const DAY_MS = 86_400_000;
/** Day 20,000 since the epoch (2024-10-04) is as good a Monday as any. */
const EPOCH_DAY = 20_000;
const CRAFTABLE = (Object.values(SUITS) as { id: SuitId; starter: boolean }[]).filter((s) => !s.starter).map((s) => s.id);
const VILLAIN_LIST = Object.values(VILLAINS);
const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** mulberry32: a small, fast, seeded generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bot {
  id: string;
  kind: BotKind;
  target: SuitId | null;
  /** Nights patrolled so far, and the night count at which the hero quits (see `lifespan`). */
  nights: number;
  quitAfter: number;
  /** Suits crafted so far, and how many nights in the first one came. */
  suits: SuitId[];
  firstSuitNight: number | null;
}

export class Economy {
  readonly book: MarketBook;
  readonly ledger = memoryLedger();
  readonly history: DaySnapshot[] = [];
  private readonly rand: () => number;
  /** The bot heroes, for reading balances and suits; the run owns them. */
  readonly bots: Bot[];
  /** Heroes who quit (see `lifespan`); what they hold still counts in the supply. */
  readonly retired: Bot[] = [];
  readonly tally: MintTally = { nights: 0, levelUps: 0, untapered: 0, minted: 0 };
  private minted = 0;
  private craftBurned = 0;
  private crafted = 0;
  private averages = new Map<string, number>();

  constructor(readonly config: EconomyConfig) {
    this.rand = rng(config.seed);
    this.book = newBook({ ...DEFAULT_PARAMS, ...config.params }, seededPools(config.pools));
    const kinds: BotKind[] = config.mix?.length ? config.mix : ["crafter", "crafter", "dumper", "flipper", "crafter", "dumper", "hoarder", "flipper"];
    const span = config.lifespan ?? 0;
    this.bots = Array.from({ length: config.bots }, (_, i) => ({ id: `bot-${i}`, kind: kinds[i % kinds.length]!, target: null, suits: [], firstSuitNight: null, nights: 0, quitAfter: span ? span - (i % span) : Infinity }));
    this.history.push(this.snapshot(0, 0, 0));
  }

  get day(): number {
    return this.history.length - 1;
  }

  get done(): boolean {
    return this.day >= this.config.days;
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)]!;
  }

  private has(bot: Bot, token: string) {
    return this.ledger.balance(bot.id, token);
  }

  private price(item: string) {
    return spotMilli(this.book.pools.find((p) => p.item === item)!);
  }

  /** One patrol's rewards: Bits from a score, and a few drops. */
  private patrol(bot: Bot, circulating: number) {
    const score = 2_500 + Math.floor(this.rand() * 9_000);
    const levelledUp = this.rand() < 0.12;
    const bits = this.config.reward ? this.config.reward({ score, levelledUp, held: this.has(bot, BITS_TOKEN), circulating, heroes: this.bots.length }) : nightBits({ score, levelledUp });
    this.ledger.credit(bot.id, BITS_TOKEN, bits);
    this.minted += bits;
    bot.nights += 1;
    this.tally.nights += 1;
    this.tally.levelUps += levelledUp ? 1 : 0;
    this.tally.untapered += nightBits({ score, levelledUp });
    this.tally.minted += bits;
    const drops = 1 + Math.floor(this.rand() * 3);
    for (let i = 0; i < drops; i++) {
      const v = this.pick(VILLAIN_LIST);
      const item = this.rand() < 0.22 ? v.loot.rare : v.loot.common;
      this.ledger.credit(bot.id, itemToken(item), 1);
    }
    if (this.rand() < 0.08) this.ledger.credit(bot.id, itemToken("press-pass"), 1);
  }

  /** Runs one market action, counting what happened; refusals are part of the game. */
  private try(fn: () => unknown): boolean {
    try {
      fn();
      return true;
    } catch (error) {
      if (error instanceof MarketError) return false;
      throw error;
    }
  }

  private act(bot: Bot, now: number, count: { trades: number; fills: number }) {
    const b = this.book;
    const max = b.params.maxAmount;
    const trade = (fn: () => unknown) => this.try(fn) && (count.trades += 1);
    const fill = (fn: () => unknown) => this.try(fn) && (count.fills += 1);

    // Stale listings come down after three days.
    for (const l of b.listings.filter((l) => l.seller === bot.id && now - l.listedAtMs > 3 * DAY_MS)) this.try(() => cancelListing(b, this.ledger, bot.id, l.id));

    // Under the one-suit rule a crafter with every suit has nothing left to build.
    const kind = bot.kind === "crafter" && this.config.oneSuitEach && bot.suits.length >= CRAFTABLE.length ? "dumper" : bot.kind;
    switch (kind) {
      case "dumper": {
        for (const item of ITEM_IDS) {
          const n = Math.min(this.has(bot, itemToken(item)), max);
          if (n > 0) trade(() => marketSell(b, this.ledger, bot.id, item, n, 0, now));
        }
        break;
      }
      case "crafter": {
        bot.target ??= this.pick(this.config.oneSuitEach ? CRAFTABLE.filter((s) => !bot.suits.includes(s)) : CRAFTABLE);
        const recipe = Object.entries(SUITS[bot.target].recipe) as [ItemId, number][];
        let ready = true;
        for (const [item, need] of recipe) {
          const lack = need - this.has(bot, itemToken(item));
          if (lack <= 0) continue;
          ready = false;
          const vendor = buyQuote(b.pools.find((p) => p.item === item)!, lack, b.params.feeBps);
          const cheap = b.listings.find((l) => l.item === item && l.seller !== bot.id && l.amount <= lack && (!vendor || l.price <= vendor.total));
          if (cheap) fill(() => buyListing(b, this.ledger, bot.id, cheap.id, now));
          else if (vendor && vendor.total <= this.has(bot, BITS_TOKEN)) trade(() => marketBuy(b, this.ledger, bot.id, item, lack, vendor.total, now));
        }
        if (ready || recipe.every(([item, need]) => this.has(bot, itemToken(item)) >= need)) {
          const cost = b.params.craftBits;
          if (this.has(bot, BITS_TOKEN) >= cost) {
            for (const [item, need] of recipe) this.ledger.debit(bot.id, itemToken(item), need);
            if (cost > 0) {
              this.ledger.debit(bot.id, BITS_TOKEN, cost);
              this.craftBurned += cost;
            }
            this.crafted += 1;
            bot.suits.push(bot.target);
            bot.firstSuitNight ??= bot.nights;
            bot.target = null;
          }
        }
        // Surplus commons go back to Gwei.
        for (const item of ITEM_IDS) {
          const spare = this.has(bot, itemToken(item)) - 6;
          if (spare > 0 && ITEMS[item].rarity === "common") trade(() => marketSell(b, this.ledger, bot.id, item, Math.min(spare, max), 0, now));
        }
        break;
      }
      case "flipper": {
        for (const item of ITEM_IDS) {
          const spot = this.price(item);
          const avg = this.averages.get(item) ?? spot;
          const held = this.has(bot, itemToken(item));
          if (spot < avg * 0.93) {
            const q = buyQuote(b.pools.find((p) => p.item === item)!, 3, b.params.feeBps);
            if (q && q.total < this.has(bot, BITS_TOKEN) * 0.5) trade(() => marketBuy(b, this.ledger, bot.id, item, 3, q.total, now));
          } else if (spot > avg * 1.07 && held > 0) {
            if (this.rand() < 0.5) trade(() => marketSell(b, this.ledger, bot.id, item, Math.min(held, max), 0, now));
            else this.try(() => listItem(b, this.ledger, bot.id, item, 1, Math.round((spot * 1.3) / 1000), now));
          }
        }
        for (const l of b.listings.filter((l) => l.seller !== bot.id && l.price * 1000 < this.price(l.item) * l.amount * 0.95).slice(0, 2)) {
          fill(() => buyListing(b, this.ledger, bot.id, l.id, now));
        }
        break;
      }
      case "hoarder": {
        const rares = ITEM_IDS.filter((i) => ITEMS[i].rarity === "rare");
        const item = this.pick(rares);
        const q = buyQuote(b.pools.find((p) => p.item === item)!, 1, b.params.feeBps);
        if (q && this.has(bot, BITS_TOKEN) > q.total * 2.5) trade(() => marketBuy(b, this.ledger, bot.id, item, 1, q.total, now));
        if (this.has(bot, itemToken(item)) > 2 && this.rand() < 0.3) {
          this.try(() => listItem(b, this.ledger, bot.id, item, 1, Math.round((this.price(item) * 2) / 1000), now));
        }
        break;
      }
    }
  }

  private snapshot(day: number, trades: number, fills: number): DaySnapshot {
    const prices: Record<string, number> = {};
    const stock: Record<string, number> = {};
    const tills: Record<string, number> = {};
    for (const p of this.book.pools) {
      prices[p.item] = spotMilli(p);
      stock[p.item] = p.stock;
      tills[p.item] = p.bits;
    }
    const till = this.book.pools.reduce((s, p) => s + p.bits, 0);
    const held = [...this.bots, ...this.retired].reduce((s, bot) => s + this.ledger.balance(bot.id, BITS_TOKEN), 0);
    return {
      day,
      prices,
      stock,
      tills,
      till,
      supply: held + till,
      burned: this.book.burned + this.craftBurned,
      minted: this.minted,
      crafted: this.crafted,
      trades,
      fills,
      listings: this.book.listings.length,
    };
  }

  /** Plays one day: every bot patrols, then trades in a shuffled order. */
  step(): DaySnapshot {
    if (this.done) return this.history[this.history.length - 1]!;
    const day = this.day + 1;
    const span = this.config.lifespan ?? 0;
    if (span) {
      this.bots.forEach((bot, i) => {
        if (bot.nights < bot.quitAfter) return;
        this.retired.push(bot);
        this.bots[i] = { id: `bot-${this.bots.length + this.retired.length - 1}`, kind: bot.kind, target: null, suits: [], firstSuitNight: null, nights: 0, quitAfter: span };
      });
    }
    const order = [...this.bots];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const circulating = this.config.reward ? this.bots.reduce((n, bot) => n + this.has(bot, BITS_TOKEN), 0) : 0;
    for (const bot of order) this.patrol(bot, circulating);
    const count = { trades: 0, fills: 0 };
    order.forEach((bot, i) => this.act(bot, (EPOCH_DAY + day) * DAY_MS + i * 1_000, count));
    for (const p of this.book.pools) {
      const prev = this.averages.get(p.item) ?? spotMilli(p);
      this.averages.set(p.item, prev * 0.6 + spotMilli(p) * 0.4);
    }
    const snap = this.snapshot(day, count.trades, count.fills);
    this.history.push(snap);
    return snap;
  }
}

