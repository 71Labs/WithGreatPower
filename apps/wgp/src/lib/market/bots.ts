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

import { BITS_TOKEN, DEFAULT_PARAMS, defaultPoolConfigs, itemToken, seededPools, type InvestRules, type MarketParams, type PoolConfig } from "./config";
import { buyListing, cancelListing, listItem, marketBuy, marketClaim, marketInvest, marketSell, marketWithdraw, MarketError, memoryLedger, newBook, type MarketBook } from "./engine";
import { DEFAULT_INVEST_RULES, earned, investRoom, tillShort } from "./invest";
import { buyQuote, sellPayout, spotMilli } from "./math";
import { newBooks, type NpcBooks, type NpcEvent } from "./npc-book";
import { NPC_RULES, npcStatus, type NpcStatus } from "./npc-rules";
import { npcTurn, walletOnBook } from "./npc-turn";
import { nightBits } from "./rewards";
import { caseAward, dailyAward, NEW_STOCK_POOLS, podiumAward } from "./new-stock";

export type BotKind = "crafter" | "dumper" | "flipper" | "hoarder";

export interface EconomyConfig {
  days: number;
  bots: number;
  seed: number;
  params?: Partial<MarketParams>;
  /** Sandwich Man trades too (default true). */
  npc?: boolean;
  /** The curves and holdings Gwei starts from (default: config.ts's, as seeded on chain). */
  pools?: PoolConfig[];
  /**
   * Gwei's new stock (./new-stock.ts): her four new pools open (added to `pools` where
   * missing, at their planned seeds), and each hero also plays the Daily every night (a gas receipt; a finality
   * flag every other night, for a clean run), closes a case every third night (an evidence
   * bag), and three heroes a day place on the Daily (a torn seed phrase). Crafters may then
   * chase the two new suits. Off (the default), the run is the launch market's, unchanged.
   */
  newStock?: boolean;
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
  /**
   * Investor bots (contract v3's "invest in a merchant", ./invest.ts). Off by default: with
   * none, the market takes no investors and the run is exactly what it was before investing
   * existed, which is what docs/ECONOMY.md's tables and balance.test.ts measure.
   */
  investors?: InvestorBots;
}

/** How many investor bots a run has, what each starts with and how they invest. */
export interface InvestorBots {
  count: number;
  /** Bits each starts with: their only Bits apart from fee earnings. */
  bits: number;
  /** Bits one puts into a broke till at a time (within the rules' per-call range, the pool's room and their wallet). */
  lot: number;
  /** The investing rules the run's market uses (default: contract v3's). */
  rules?: InvestRules;
}

/** The lab's investor bots: three of them, 600 Bits each, 150 Bits a time, on contract v3's default rules. */
export const LAB_INVESTORS: InvestorBots = { count: 3, bits: 600, lot: 150 };

/** An investor bot claims a stake's fee earnings once they reach this many Bits (a withdrawal pays them out anyway). */
const CLAIM_AT = 10;

/** One thing an investor bot did. */
export interface InvestEvent {
  account: string;
  kind: "invest" | "withdraw" | "claim";
  item: string;
  /** Bits invested or withdrawn (0 for a claim). */
  bits: number;
  /** Fee earnings paid out by it. */
  earned: number;
}

/** The investor bots at the end of a day. */
export interface InvestDay {
  /** What they did that morning, in order. */
  events: InvestEvent[];
  /** Bits they hold in their wallets, and in Gwei's tills. */
  wallet: number;
  staked: number;
  /** Fee earnings paid to them so far. */
  earned: number;
}

/** Sandwich Man's account in the fast-forward. */
export const LAB_NPC_ACCOUNT = "sandwich-man.lab";
/**
 * A seed in which he runs out of Bits three times, clears stock and reopens each time
 * within the lab's default run (21 days, 60 heroes, mainnet's settings: balance.ts's
 * `MAINNET` with him trading); `bots.test.ts` checks it still does.
 */
export const LAB_BROKE_SEED = 270;
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
  /** Bits earned on patrol so far, plus Sandwich Man's one-off seed. */
  minted: number;
  crafted: number;
  trades: number;
  fills: number;
  listings: number;
  /** Null when the run has no NPC. */
  npc: NpcDay | null;
  /** Per item: at the end of the day Gwei's till couldn't pay for one, so her shop was closed for buying it. */
  broke: Record<string, boolean>;
  /** Per item: investors' Bits in the till (0 everywhere in a run without investors). */
  invested: Record<string, number>;
  /** Null when the run has no investor bots. */
  investors: InvestDay | null;
}

const DAY_MS = 86_400_000;
/** Day 20,000 since the epoch (2024-10-04) is as good a Monday as any. */
const EPOCH_DAY = 20_000;
const CRAFTABLE = (Object.values(SUITS) as { id: SuitId; starter: boolean }[]).filter((s) => !s.starter).map((s) => s.id);
const VILLAIN_LIST = Object.values(VILLAINS);
const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** `pools` with Gwei's new stock added where it's missing. */
const withNewStock = (pools: PoolConfig[]): PoolConfig[] => [...pools, ...NEW_STOCK_POOLS.filter((n) => !pools.some((p) => p.item === n.item))];

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
  /** The items Gwei has pools for, and the suits whose recipes she can supply. */
  private readonly items: ItemId[];
  private readonly craftable: SuitId[];
  private minted = 0;
  private craftBurned = 0;
  private crafted = 0;
  private averages = new Map<string, number>();
  private npcBooks: NpcBooks | null = null;
  private npcEvents: NpcEvent[] = [];
  private npcRefused = 0;
  private npcClosed = false;
  /** Investor bots' accounts (empty without `config.investors`), what they did this morning and their earnings so far. */
  readonly investorIds: string[] = [];
  private investEvents: InvestEvent[] = [];
  private investEarned = 0;

  constructor(readonly config: EconomyConfig) {
    this.rand = rng(config.seed);
    const inv = config.investors;
    this.book = newBook({ ...DEFAULT_PARAMS, ...config.params, ...(inv ? { invest: inv.rules ?? DEFAULT_INVEST_RULES } : {}) }, seededPools(config.newStock ? withNewStock(config.pools ?? defaultPoolConfigs()) : config.pools));
    // Only what Gwei has a pool for is traded or crafted toward (the launch market: the eight items and four suits).
    const pooled = new Set(this.book.pools.map((p) => p.item));
    this.items = ITEM_IDS.filter((i) => pooled.has(i));
    this.craftable = CRAFTABLE.filter((s) => Object.keys(SUITS[s].recipe).every((i) => pooled.has(i)));
    if (inv) {
      for (let i = 0; i < inv.count; i++) {
        const id = `investor-${i}`;
        this.investorIds.push(id);
        this.ledger.credit(id, BITS_TOKEN, inv.bits);
        this.minted += inv.bits;
      }
    }
    const kinds: BotKind[] = config.mix?.length ? config.mix : ["crafter", "crafter", "dumper", "flipper", "crafter", "dumper", "hoarder", "flipper"];
    const span = config.lifespan ?? 0;
    this.bots = Array.from({ length: config.bots }, (_, i) => ({ id: `bot-${i}`, kind: kinds[i % kinds.length]!, target: null, suits: [], firstSuitNight: null, nights: 0, quitAfter: span ? span - (i % span) : Infinity }));
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

  /**
   * The investor bots' morning, before the heroes trade. Each, in turn:
   * 1. takes home a stake that has unlocked from a till that can spare it (after the
   *    withdrawal she could still pay for a full lot of the item), and otherwise claims
   *    whatever fees it has earned;
   * 2. puts `lot` Bits into the first till that is broke (it can't pay for one item), within
   *    the rules' per-call range and daily caps, the pool's room and its own wallet.
   * No randomness: the same market gives the same moves. Refusals are part of the rules.
   */
  private investorsAct(now: number) {
    const inv = this.config.investors;
    const rules = this.book.params.invest;
    if (!inv || !rules) return;
    const b = this.book;
    for (const id of this.investorIds) {
      for (const stake of [...(b.investors?.[id]?.stakes ?? [])]) {
        const pool = b.pools.find((p) => p.item === stake.item)!;
        // Withdrawing moves no price, so a full lot costs her the same before and after.
        const spare = pool.bits - stake.bits >= sellPayout(pool, b.params.maxAmount);
        if (now >= stake.sinceMs + rules.lockMs && spare) {
          this.try(() => {
            const r = marketWithdraw(b, this.ledger, id, stake.item, stake.bits, now);
            this.investEarned += r.earned;
            this.investEvents.push({ account: id, kind: "withdraw", item: stake.item, bits: r.bits, earned: r.earned });
          });
        } else if (earned(stake, pool) >= CLAIM_AT) {
          this.try(() => {
            const r = marketClaim(b, this.ledger, id, stake.item, now);
            this.investEarned += r.earned;
            this.investEvents.push({ account: id, kind: "claim", item: stake.item, bits: 0, earned: r.earned });
          });
        }
      }
      const broke = b.pools.find((p) => tillShort(p) > 0 && investRoom(p) >= rules.min);
      if (!broke) continue;
      const amount = Math.min(rules.max, investRoom(broke), this.ledger.balance(id, BITS_TOKEN), Math.max(rules.min, inv.lot));
      if (amount < rules.min) continue;
      this.try(() => {
        const r = marketInvest(b, this.ledger, id, broke.item, amount, now);
        this.investEarned += r.earned;
        this.investEvents.push({ account: id, kind: "invest", item: broke.item, bits: r.bits, earned: r.earned });
      });
    }
  }

  private investDay(): InvestDay | null {
    if (!this.config.investors) return null;
    const day: InvestDay = {
      events: this.investEvents,
      wallet: this.investorIds.reduce((s, id) => s + this.ledger.balance(id, BITS_TOKEN), 0),
      staked: this.book.pools.reduce((s, p) => s + (p.invested ?? 0), 0),
      earned: this.investEarned,
    };
    this.investEvents = [];
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
    if (this.config.newStock) this.newStock(bot);
  }

  /** Gwei's new stock, by its own rules (./new-stock.ts) on a fixed schedule: no draws, so the patrol's luck is the same. */
  private newStock(bot: Bot) {
    const i = this.bots.indexOf(bot);
    const awards = [
      ...dailyAward(bot.nights % 2 === 0 ? { fightsWon: 4 } : { fightsWon: 3, fightsLost: 1 }),
      ...(bot.nights % 3 === 0 ? caseAward({ cleared: 1 }) : []),
      ...(i >= 0 && (i + this.day) % this.bots.length < 3 ? podiumAward(1 + ((i + this.day) % this.bots.length)) : []),
    ];
    for (const a of awards) {
      if (this.items.includes(a.item)) this.ledger.credit(bot.id, itemToken(a.item), a.amount);
    }
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
    const kind = bot.kind === "crafter" && this.config.oneSuitEach && bot.suits.length >= this.craftable.length ? "dumper" : bot.kind;
    switch (kind) {
      case "dumper": {
        for (const item of this.items) {
          const n = Math.min(this.has(bot, itemToken(item)), max);
          if (n > 0) trade(() => marketSell(b, this.ledger, bot.id, item, n, 0, now));
        }
        break;
      }
      case "crafter": {
        bot.target ??= this.pick(this.config.oneSuitEach ? this.craftable.filter((s) => !bot.suits.includes(s)) : this.craftable);
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
        for (const item of this.items) {
          const spare = this.has(bot, itemToken(item)) - 6;
          if (spare > 0 && ITEMS[item].rarity === "common") trade(() => marketSell(b, this.ledger, bot.id, item, Math.min(spare, max), 0, now));
        }
        break;
      }
      case "flipper": {
        for (const item of this.items) {
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
        const rares = this.items.filter((i) => ITEMS[i].rarity === "rare");
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
    const broke: Record<string, boolean> = {};
    const invested: Record<string, number> = {};
    for (const p of this.book.pools) {
      prices[p.item] = spotMilli(p);
      stock[p.item] = p.stock;
      tills[p.item] = p.bits;
      broke[p.item] = tillShort(p) > 0;
      invested[p.item] = p.invested ?? 0;
    }
    const till = this.book.pools.reduce((s, p) => s + p.bits, 0);
    // Fee earnings held for investors are Bits too (0 in a run without investors).
    const owed = this.book.pools.reduce((s, p) => s + (p.rewards ?? 0), 0);
    const held =
      [...this.bots, ...this.retired].reduce((s, bot) => s + this.ledger.balance(bot.id, BITS_TOKEN), 0) +
      this.ledger.balance(LAB_NPC_ACCOUNT, BITS_TOKEN) +
      this.investorIds.reduce((s, id) => s + this.ledger.balance(id, BITS_TOKEN), 0);
    return {
      day,
      prices,
      stock,
      tills,
      broke,
      invested,
      investors: this.investDay(),
      till,
      supply: held + till + owed,
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
    // Investors look at the stalls first thing: a till that ended yesterday broke is funded before the heroes arrive.
    this.investorsAct((EPOCH_DAY + day) * DAY_MS - 1_000);
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

