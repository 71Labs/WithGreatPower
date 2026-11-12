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
 *
 * Sandwich Man trades among them (unless `npc: false`): the same `decide` the server runs
 * for him (./npc-rules.ts), one action a turn, a few turns a day, from his one-off seed.
 */
import { ITEMS, SUITS, VILLAINS } from "@wgp/game-core/data";
import type { ItemId, SuitId } from "@wgp/game-core/types";

import { BITS_TOKEN, DEFAULT_PARAMS, itemToken, seededPools, type MarketParams } from "./config";
import { buyListing, cancelListing, listItem, marketBuy, marketSell, MarketError, memoryLedger, newBook, type MarketBook } from "./engine";
import { buyQuote, spotMilli } from "./math";
import { newBooks, type NpcBooks, type NpcEvent } from "./npc-book";
import { NPC_RULES, npcStatus, type NpcStatus } from "./npc-rules";
import { npcTurn, walletOnBook } from "./npc-turn";
import { nightBits } from "./rewards";

export type BotKind = "crafter" | "dumper" | "flipper" | "hoarder";

export interface EconomyConfig {
  days: number;
  bots: number;
  seed: number;
  params?: Partial<MarketParams>;
  /** Sandwich Man trades too (default true). */
  npc?: boolean;
}

/** Sandwich Man's account in the fast-forward. */
export const LAB_NPC_ACCOUNT = "sandwich-man.lab";
/**
 * A seed in which he runs out of Bits, clears stock and reopens within the lab's default
 * run (21 days, 60 heroes, crafting burns 25 Bits); `bots.test.ts` checks it still does.
 */
export const LAB_BROKE_SEED = 211;
/** How many times a day he looks at the market: after each of this many slices of the bots. */
const NPC_TURNS_PER_DAY = 8;

/** Sandwich Man at the end of a day. */
export interface NpcDay {
  bits: number;
  /** Items he owns, his own listings included. */
  units: number;
  status: NpcStatus;
  /** He closed shop at some point that day (he may have reopened by the end of it). */
  closed: boolean;
  /** What he did that day, oldest first. */
  events: NpcEvent[];
  /** Actions the market refused (his rules check first, so this stays 0). */
  refused: number;
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
  /** Bits earned on patrol so far, plus Sandwich Man's one-off seed. */
  minted: number;
  crafted: number;
  trades: number;
  fills: number;
  listings: number;
  /** Null when the run has no NPC. */
  npc: NpcDay | null;
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
}

export class Economy {
  readonly book: MarketBook;
  readonly ledger = memoryLedger();
  readonly history: DaySnapshot[] = [];
  private readonly rand: () => number;
  private readonly bots: Bot[];
  private minted = 0;
  private craftBurned = 0;
  private crafted = 0;
  private averages = new Map<string, number>();
  private npcBooks: NpcBooks | null = null;
  private npcEvents: NpcEvent[] = [];
  private npcRefused = 0;
  private npcClosed = false;

  constructor(readonly config: EconomyConfig) {
    this.rand = rng(config.seed);
    this.book = newBook({ ...DEFAULT_PARAMS, ...config.params }, seededPools());
    const kinds: BotKind[] = ["crafter", "crafter", "dumper", "flipper", "crafter", "dumper", "hoarder", "flipper"];
    this.bots = Array.from({ length: config.bots }, (_, i) => ({ id: `bot-${i}`, kind: kinds[i % kinds.length]!, target: null }));
    if (config.npc !== false) {
      this.npcBooks = newBooks();
      this.ledger.credit(LAB_NPC_ACCOUNT, BITS_TOKEN, NPC_RULES.seedBits);
      this.minted += NPC_RULES.seedBits;
    }
    this.history.push(this.snapshot(0, 0, 0, (EPOCH_DAY + 0) * DAY_MS));
  }

  /** Sandwich Man looks at the market once: at most one action, by his own rules. */
  private npcLooks(now: number, count: { trades: number; fills: number }) {
    if (!this.npcBooks) return;
    const turn = npcTurn(this.book, this.ledger, LAB_NPC_ACCOUNT, this.npcBooks, now);
    this.npcBooks = turn.books;
    this.npcEvents.push(...turn.events);
    if (turn.books.closed) this.npcClosed = true;
    if (turn.refused) this.npcRefused += 1;
    else if (turn.action?.kind === "fill") count.fills += 1;
    else if (turn.action?.kind === "buy" || turn.action?.kind === "sell") count.trades += 1;
  }

  private npcDay(now: number): NpcDay | null {
    if (!this.npcBooks) return null;
    const wallet = walletOnBook(this.book, this.ledger, LAB_NPC_ACCOUNT, this.npcBooks, now);
    const day: NpcDay = {
      bits: wallet.bits,
      units: Object.values(wallet.items).reduce((n, v) => n + v, 0) + this.book.listings.filter((l) => l.seller === LAB_NPC_ACCOUNT).reduce((n, l) => n + l.amount, 0),
      status: npcStatus(this.book, wallet, now),
      closed: this.npcClosed || this.npcBooks.closed,
      events: this.npcEvents,
      refused: this.npcRefused,
    };
    this.npcEvents = [];
    this.npcRefused = 0;
    this.npcClosed = false;
    return day;
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
  private patrol(bot: Bot) {
    const score = 2_500 + Math.floor(this.rand() * 9_000);
    const bits = nightBits({ score, levelledUp: this.rand() < 0.12 });
    this.ledger.credit(bot.id, BITS_TOKEN, bits);
    this.minted += bits;
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

    switch (bot.kind) {
      case "dumper": {
        for (const item of ITEM_IDS) {
          const n = Math.min(this.has(bot, itemToken(item)), max);
          if (n > 0) trade(() => marketSell(b, this.ledger, bot.id, item, n, 0, now));
        }
        break;
      }
      case "crafter": {
        bot.target ??= this.pick(CRAFTABLE);
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

  private snapshot(day: number, trades: number, fills: number, now: number): DaySnapshot {
    const prices: Record<string, number> = {};
    const stock: Record<string, number> = {};
    const tills: Record<string, number> = {};
    for (const p of this.book.pools) {
      prices[p.item] = spotMilli(p);
      stock[p.item] = p.stock;
      tills[p.item] = p.bits;
    }
    const till = this.book.pools.reduce((s, p) => s + p.bits, 0);
    const held = this.bots.reduce((s, bot) => s + this.ledger.balance(bot.id, BITS_TOKEN), 0) + this.ledger.balance(LAB_NPC_ACCOUNT, BITS_TOKEN);
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
      npc: this.npcDay(now),
    };
  }

  /** Plays one day: every bot patrols, then trades in a shuffled order. */
  step(): DaySnapshot {
    if (this.done) return this.history[this.history.length - 1]!;
    const day = this.day + 1;
    const order = [...this.bots];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const bot of order) this.patrol(bot);
    const count = { trades: 0, fills: 0 };
    const every = Math.max(1, Math.ceil(order.length / NPC_TURNS_PER_DAY));
    order.forEach((bot, i) => {
      const now = (EPOCH_DAY + day) * DAY_MS + i * 1_000;
      this.act(bot, now, count);
      // Real activity just landed: Sandwich Man gets a look, as he does after a player's trade.
      if ((i + 1) % every === 0 || i === order.length - 1) this.npcLooks(now + 500, count);
    });
    for (const p of this.book.pools) {
      const prev = this.averages.get(p.item) ?? spotMilli(p);
      this.averages.set(p.item, prev * 0.6 + spotMilli(p) * 0.4);
    }
    const snap = this.snapshot(day, count.trades, count.fills, (EPOCH_DAY + day) * DAY_MS + order.length * 1_000);
    this.history.push(snap);
    return snap;
  }
}

