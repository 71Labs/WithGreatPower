/**
 * THE PRACTICE MARKET: a guest's own copy of the Mempool Market, run in their browser.
 *
 * A guest has no account, so they can't trade on NEAR. Here they can do everything the
 * market does anyway (buy, sell, list, watch Gwei go broke, invest in her, withdraw) on the
 * same rules: ./engine.ts and ./invest.ts, the code the simulated market and the contract's
 * vectors are tested against. It starts from the live market's pools (the prices a player
 * sees on NEAR at that moment), and Sandwich Man trades in it by his own rules
 * (./npc-rules.ts), labelled as the NPC he is.
 *
 * NOTHING HERE IS REAL, IN EITHER DIRECTION. This file is pure: state in, state out. It
 * never reads or writes the game's save, never calls the server and never touches NEAR.
 *
 * - Practice Bits are a number in this state: `PRACTICE_START_BITS` to start, plus what
 *   the guest's nights would have paid (a tally the browser keeps for display).
 * - Practice items are the guest's saved loot PLUS a per-item delta kept here. A practice
 *   buy raises the delta; a practice sale lowers it. The save's inventory is never changed,
 *   so a practice purchase can't be crafted with, imported on sign-in or minted, and a
 *   practice sale costs the guest none of their real loot.
 * - It is stored under its own key (`PRACTICE_KEY`), apart from the save (src/game/store.ts).
 *   The import on first sign-in (src/server/db/migrate-save.ts) reads the save only, and
 *   rebuilds even that field by field under its caps (level 3, 10 items, no Bits).
 *
 * `practice.test.ts` checks each of those, including that this file and its hook have no
 * way to write the save or reach the server.
 */
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import type { ListingView, MarketItemView, MarketMe, MarketView, SimReceipt, SimTradeRequest, StakeRequest } from "./api";
import { BITS_TOKEN, DEFAULT_PARAMS, itemToken, seededPools, type InvestRules, type MarketParams } from "./config";
import {
  accountToday,
  buyListing,
  cancelListing,
  listItem,
  marketBuy,
  marketClaim,
  marketInvest,
  marketSell,
  marketWithdraw,
  newBook,
  type Ledger,
  type MarketBook,
  type StakeReceipt,
} from "./engine";
import { DEFAULT_INVEST_RULES, investorView, shopsOf } from "./invest";
import { buyQuote, sellPayout, sellQuote, spotMilli, type Pool } from "./math";
import type { NpcTraderView } from "./npc-api";
import { sparkSteps, type SparkRow } from "./spark";
import { booksToday, itemName, newBooks, type NpcBooks, type NpcEvent } from "./npc-book";
import { budgetLeft, NPC_ID, NPC_NAME, NPC_RULE_LINES, NPC_RULES, NPC_RULES_URL, npcStatus, statusLine } from "./npc-rules";
import { npcTurn, walletOnBook } from "./npc-turn";

/** Where the practice market is kept in the browser. Never the save's key. */
export const PRACTICE_KEY = "wgp:practice:v1";
/** The label every practice screen carries, word for word. */
export const PRACTICE_LABEL = "Practice market: not on NEAR. Sign in to trade for real.";
export const PRACTICE_ACCOUNT = "you.practice";
export const PRACTICE_NPC_ACCOUNT = "sandwich-man.practice";
/** Practice Bits every visitor starts with, so there is something to trade and invest with. */
export const PRACTICE_START_BITS = 300;
/**
 * Contract v3's investing rules with one change: a stake unlocks 30 seconds after a
 * top-up instead of an hour, so a visitor can invest, see a fee come in and withdraw in
 * one sitting. The screen says so.
 */
export const PRACTICE_INVEST_RULES: InvestRules = { ...DEFAULT_INVEST_RULES, lockMs: 30_000 };

const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
const isItem = (id: string): id is ItemId => Object.hasOwn(ITEMS, id);
const SPARK_POINTS = 24;
const LOG_LINES = 6;
/** Price rows kept per item: a busy practice day and the day before it. */
const MARKS_KEPT = 240;
const DAY_MS = 86_400_000;

export interface PracticeState {
  v: 1;
  seededAt: number;
  /** Where the opening prices came from: the live market on NEAR, the simulated one, or the defaults. */
  seededFrom: "near" | "simulated" | "defaults";
  book: MarketBook;
  /** Practice Bits gained or spent so far, on top of what the visitor starts with. */
  bits: number;
  /** Practice items gained (+) or sold (−) per item, on top of the saved loot. */
  items: Record<string, number>;
  /** Sandwich Man's practice wallet and books. */
  npc: { bits: number; items: Record<string, number>; books: NpcBooks; log: NpcEvent[] };
  /** Spot × 1000 per item, oldest first, for the sparklines. */
  spark: Record<string, number[]>;
  /** When each item was last traded with Gwei here (Unix ms), newest last. */
  traded: Record<string, number[]>;
  /**
   * Each item's price history here, as [Unix ms, spot × 1000] rows, oldest first: where it
   * opened, then every trade that moved it. The card's step line is drawn from these alone
   * (./spark.ts), at their real times. Absent from a market stored before it was kept.
   */
  marks?: Record<string, [at: number, priceMilli: number][]>;
}

/** What the visitor brings that practice doesn't own: their saved loot and their starting Bits. Read-only here. */
export interface PracticeBase {
  /** `PRACTICE_START_BITS` plus what their guest nights would have paid. */
  bits: number;
  /** The save's inventory, as it is. */
  items: Readonly<Partial<Record<ItemId, number>>>;
}

export const practiceBase = (guestBits: number, inventory: Readonly<Partial<Record<ItemId, number>>> | null | undefined): PracticeBase => ({
  bits: PRACTICE_START_BITS + Math.max(0, Math.floor(guestBits) || 0),
  items: inventory ?? {},
});

/* ------------------------------------------------------------------ seeding */

/** A live pool as practice starts it: the same curve and holdings, with nobody invested yet. */
function fresh(pool: Pool): Pool {
  const invested = pool.invested ?? 0;
  // Real investors' Bits aren't practice's: hand them back to the virtual reserve, so y is unchanged.
  return { item: pool.item, virtualBits: pool.virtualBits + invested, virtualItems: pool.virtualItems, bits: pool.bits - invested, stock: pool.stock, escrow: 0 };
}

/**
 * A new practice market. With the live market's view it opens on those pools and rules
 * (so its prices are the real ones at that moment); without it, on the seeded defaults.
 * It is always open and always takes investors: that is what it is for.
 */
export function seedPractice(live: Pick<MarketView, "onChain" | "params" | "items"> | null, nowMs: number): PracticeState {
  const pools = live && live.items.length > 0 ? live.items.map((i) => fresh(i.pool)) : seededPools();
  const params: MarketParams = { ...DEFAULT_PARAMS, ...(live?.params ?? {}), open: true, invest: PRACTICE_INVEST_RULES };
  const spark: Record<string, number[]> = {};
  const marks: NonNullable<PracticeState["marks"]> = {};
  for (const p of pools) {
    // Its history starts as the live market's own last day (each step at its real time), ending on the price it opened here with.
    const liveSteps = live?.items.find((i) => i.item === p.item)?.sparkSteps ?? [];
    const rows = liveSteps.map(([t, price]): [number, number] => [Math.round(nowMs - DAY_MS + t * DAY_MS), price]);
    if (rows.at(-1)?.[1] !== spotMilli(p)) rows.push([nowMs, spotMilli(p)]);
    marks[p.item] = rows;
    const liveSpark = live?.items.find((i) => i.item === p.item)?.spark;
    spark[p.item] = liveSpark && liveSpark.length > 1 ? liveSpark.slice(-SPARK_POINTS) : [spotMilli(p), spotMilli(p)];
  }
  return {
    v: 1,
    seededAt: nowMs,
    seededFrom: live ? (live.onChain ? "near" : "simulated") : "defaults",
    book: newBook(params, pools),
    bits: 0,
    items: {},
    npc: { bits: NPC_RULES.seedBits, items: {}, books: newBooks(), log: [] },
    spark,
    traded: {},
    marks,
  };
}

/* ------------------------------------------------------------------ the ledger */

const CROWD = "crowd.practice";

function ledgerOf(s: PracticeState, base: PracticeBase): Ledger {
  const id = (token: string) => token.slice("item:".length);
  return {
    balance(account, token) {
      if (account === CROWD) return token === BITS_TOKEN ? 0 : Number.MAX_SAFE_INTEGER;
      if (account === PRACTICE_NPC_ACCOUNT) return token === BITS_TOKEN ? s.npc.bits : (s.npc.items[id(token)] ?? 0);
      if (account !== PRACTICE_ACCOUNT) return 0;
      if (token === BITS_TOKEN) return Math.max(0, base.bits + s.bits);
      const item = id(token);
      return Math.max(0, (isItem(item) ? (base.items[item] ?? 0) : 0) + (s.items[item] ?? 0));
    },
    credit(account, token, n) {
      if (account === CROWD) return;
      if (account === PRACTICE_NPC_ACCOUNT) {
        if (token === BITS_TOKEN) s.npc.bits += n;
        else s.npc.items[id(token)] = (s.npc.items[id(token)] ?? 0) + n;
      } else if (account === PRACTICE_ACCOUNT) {
        if (token === BITS_TOKEN) s.bits += n;
        else s.items[id(token)] = (s.items[id(token)] ?? 0) + n;
      }
    },
    debit(account, token, n) {
      if (account === CROWD) return;
      if (account === PRACTICE_NPC_ACCOUNT) {
        if (token === BITS_TOKEN) s.npc.bits -= n;
        else s.npc.items[id(token)] = (s.npc.items[id(token)] ?? 0) - n;
      } else if (account === PRACTICE_ACCOUNT) {
        if (token === BITS_TOKEN) s.bits -= n;
        else s.items[id(token)] = (s.items[id(token)] ?? 0) - n;
      }
    },
  };
}

const clone = (s: PracticeState): PracticeState => JSON.parse(JSON.stringify(s)) as PracticeState;

function note(s: PracticeState, item: string, nowMs: number, traded: boolean) {
  const pool = s.book.pools.find((p) => p.item === item);
  if (!pool) return;
  s.spark[item] = [...(s.spark[item] ?? []), spotMilli(pool)].slice(-SPARK_POINTS);
  if (!traded) return;
  s.traded[item] = [...(s.traded[item] ?? []), nowMs].filter((t) => nowMs - t < DAY_MS).slice(-200);
  const marks = (s.marks ??= {});
  marks[item] = [...(marks[item] ?? []), [nowMs, spotMilli(pool)] as [number, number]].slice(-MARKS_KEPT);
}

/* ------------------------------------------------------------------ the visitor's moves */

export interface PracticeResult<R> {
  state: PracticeState;
  receipt: R;
}

/**
 * One practice trade by the visitor, on the market's own rules. Throws MarketError (with
 * the contract's words) when a rule refuses; then nothing changed. Returns a new state:
 * `state` and `base` are not modified.
 */
export function practiceTrade(state: PracticeState, base: PracticeBase, req: SimTradeRequest, nowMs: number): PracticeResult<SimReceipt> {
  const s = clone(state);
  const ledger = ledgerOf(s, base);
  const me = PRACTICE_ACCOUNT;
  let receipt: SimReceipt;
  switch (req.action) {
    case "buy":
      receipt = { kind: "trade", trade: marketBuy(s.book, ledger, me, req.item, req.amount, req.maxBits, nowMs) };
      note(s, req.item, nowMs, true);
      break;
    case "sell":
      receipt = { kind: "trade", trade: marketSell(s.book, ledger, me, req.item, req.amount, req.minBits, nowMs) };
      note(s, req.item, nowMs, true);
      break;
    case "list":
      receipt = { kind: "listing", listing: listItem(s.book, ledger, me, req.item, req.amount, req.price, nowMs) };
      break;
    case "fill":
      receipt = { kind: "fill", fill: buyListing(s.book, ledger, me, req.listingId, nowMs) };
      break;
    case "cancel":
      receipt = { kind: "cancel", listing: cancelListing(s.book, ledger, me, req.listingId) };
      break;
  }
  return { state: s, receipt };
}

/** Invest practice Bits in one of Gwei's tills, withdraw a stake, or claim its earnings. Throws MarketError. */
export function practiceStake(state: PracticeState, base: PracticeBase, req: StakeRequest, nowMs: number): PracticeResult<StakeReceipt> {
  const s = clone(state);
  const ledger = ledgerOf(s, base);
  const me = PRACTICE_ACCOUNT;
  const receipt =
    req.action === "invest" ? marketInvest(s.book, ledger, me, req.item, req.bits, nowMs) : req.action === "withdraw" ? marketWithdraw(s.book, ledger, me, req.item, req.bits, nowMs) : marketClaim(s.book, ledger, me, req.item, nowMs);
  note(s, req.item, nowMs, false);
  return { state: s, receipt };
}

/**
 * Sandwich Man takes one look, as he does after a player's trade on the real market: at
 * most one action, by `decide` in ./npc-rules.ts, through the same market rules. What he
 * did is appended to his log.
 */
export function practiceNpcLooks(state: PracticeState, base: PracticeBase, nowMs: number): { state: PracticeState; events: NpcEvent[] } {
  const s = clone(state);
  const turn = npcTurn(s.book, ledgerOf(s, base), PRACTICE_NPC_ACCOUNT, s.npc.books, nowMs);
  s.npc.books = turn.books;
  s.npc.log = [...turn.events.slice().reverse(), ...s.npc.log].slice(0, LOG_LINES);
  const a = turn.action;
  if (a && !turn.refused && (a.kind === "buy" || a.kind === "sell")) note(s, a.item, nowMs, true);
  return { state: s, events: turn.events };
}

/**
 * A practice scenario, so a visitor with a pocketful of loot can still see a merchant go
 * broke: a crowd of practice sellers dumps `item` on Gwei until her till for it can't pay
 * for another. Every sale goes through the market's own rules at her own prices, so the
 * pool ends exactly where real selling would leave it: overstocked, cheap and broke.
 * Returns how many items the crowd sold.
 */
export function practiceDrain(state: PracticeState, base: PracticeBase, item: ItemId, nowMs: number): { state: PracticeState; sold: number } {
  const s = clone(state);
  const ledger = ledgerOf(s, base);
  const fee = s.book.params.feeBps;
  let sold = 0;
  for (let guard = 0; guard < 400; guard++) {
    const pool = s.book.pools.find((p) => p.item === item);
    if (!pool) break;
    let n = Math.min(s.book.params.maxAmount, 20);
    while (n > 0 && !sellQuote(pool, n, fee)) n -= 1;
    if (n === 0) break;
    marketSell(s.book, ledger, CROWD, item, n, 0, nowMs);
    // The crowd is a scenario, not an account: it keeps no daily counters.
    delete s.book.accounts[CROWD];
    sold += n;
  }
  if (sold > 0) note(s, item, nowMs, true);
  return { state: s, sold };
}

/* ------------------------------------------------------------------ what the screens read */

function itemViews(s: PracticeState, nowMs: number): MarketItemView[] {
  const p = s.book.params;
  return s.book.pools.filter((pool) => isItem(pool.item)).map((pool) => {
    const meta = ITEMS[pool.item as ItemId];
    const spark = s.spark[pool.item] && s.spark[pool.item]!.length > 1 ? s.spark[pool.item]! : [spotMilli(pool), spotMilli(pool)];
    const first = spark[0]!;
    // The step line, from this market's own trades at their own times: the last price before the day as its opening.
    const rows = s.marks?.[pool.item];
    const from = nowMs - DAY_MS;
    const before = rows?.filter(([at]) => at < from).at(-1)?.[1];
    const day: SparkRow[] = (rows ?? []).filter(([at]) => at >= from).map(([at, priceMilli]) => ({ kind: "trade", at, priceMilli }));
    return {
      item: meta.id,
      name: meta.name,
      rarity: meta.rarity,
      priceMilli: spotMilli(pool),
      buyOne: buyQuote(pool, 1, p.feeBps)?.total ?? null,
      sellOne: sellQuote(pool, 1, p.feeBps)?.net ?? null,
      spark,
      ...(rows ? { sparkSteps: sparkSteps(day, before, spotMilli(pool), { from, to: nowMs }) } : {}),
      // Against where this market's own day began (its opening here, when it is younger than a day).
      change24h: ((open) => (open > 0 ? (spotMilli(pool) - open) / open : null))(before ?? day[0]?.priceMilli ?? first),
      trades24h: (s.traded[pool.item] ?? []).filter((t) => nowMs - t < DAY_MS).length,
      pool,
    };
  });
}

export interface PracticeScreen {
  view: MarketView;
  me: MarketMe;
  listings: ListingView[];
  npc: NpcTraderView;
}

/** The practice market as the market screen reads any market: prices, the wallet, listings and the NPC. Pure. */
export function practiceScreen(state: PracticeState, base: PracticeBase, nowMs: number): PracticeScreen {
  const book = state.book;
  const p = book.params;
  const ledger = ledgerOf(state, base);
  const me = PRACTICE_ACCOUNT;
  const a = accountToday(book, me, nowMs);
  const items: Partial<Record<ItemId, number>> = {};
  for (const id of ITEM_IDS) {
    const n = ledger.balance(me, itemToken(id));
    if (n > 0) items[id] = n;
  }
  const view: MarketView = {
    onChain: false,
    network: null,
    contractId: null,
    vendor: null,
    params: p,
    items: itemViews(state, nowMs),
    listings: book.listings.length,
    shops: shopsOf(book.pools, p.open),
    contract: null,
    till: book.pools.reduce((sum, pool) => sum + pool.bits, 0),
    updatedAt: new Date(nowMs).toISOString(),
  };
  const wallet: MarketMe = {
    onChain: false,
    accountId: me,
    bits: ledger.balance(me, BITS_TOKEN),
    items,
    tradesLeft: Math.max(0, p.dailyTrades - a.trades),
    listingsLeft: Math.max(0, p.dailyListings - a.listings),
    fillsLeft: Math.max(0, p.dailyFills - a.fills),
    fillBitsLeft: Math.max(0, p.dailyFillBits - a.fillBits),
    open: a.open,
    pendingBits: 0,
    investor: investorView(p.invest ?? PRACTICE_INVEST_RULES, book.pools, book.investors?.[me], nowMs),
  };
  const listings: ListingView[] = book.listings
    .filter((l) => isItem(l.item))
    .map((l) => {
      const pool = book.pools.find((q) => q.item === l.item);
      const unitMilli = Math.floor((l.price * 1000) / Math.max(1, l.amount));
      const spot = pool ? spotMilli(pool) : 0;
      return { ...l, name: ITEMS[l.item as ItemId].name, unitMilli, vsSpot: spot > 0 ? unitMilli / spot : 1 };
    })
    .sort((x, y) => y.id - x.id);
  return { view, me: wallet, listings, npc: npcView(state, base, nowMs) };
}

/** Sandwich Man in the practice market, as the "Other traders" strip shows him: an NPC, in practice. */
function npcView(state: PracticeState, base: PracticeBase, nowMs: number): NpcTraderView {
  const book = state.book;
  const wallet = walletOnBook(book, ledgerOf(state, base), PRACTICE_NPC_ACCOUNT, state.npc.books, nowMs);
  const books = booksToday(wallet.books, wallet.bits, nowMs);
  const status = npcStatus(book, { ...wallet, books }, nowMs);
  return {
    id: NPC_ID,
    name: NPC_NAME,
    mode: "practice",
    accountId: PRACTICE_NPC_ACCOUNT,
    explorerUrl: null,
    status,
    statusLine: statusLine(status, wallet.bits),
    bits: wallet.bits,
    items: Object.entries(wallet.items).map(([item, amount]) => ({ item, name: itemName(item), amount })),
    listings: book.listings.filter((l) => l.seller === PRACTICE_NPC_ACCOUNT).map((l) => ({ id: l.id, item: l.item, name: itemName(l.item), amount: l.amount, price: l.price })),
    actionsLeft: Math.max(0, NPC_RULES.maxActionsPerDay - books.actions),
    budgetLeft: budgetLeft(books),
    log: state.npc.log.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, text: e.text, reason: e.reason, txHash: null, txUrl: null })),
    rules: NPC_RULE_LINES,
    rulesUrl: NPC_RULES_URL,
    seedBits: NPC_RULES.seedBits,
    now: new Date(nowMs).toISOString(),
  };
}

/** The till to stage a broke shop on: the one holding the fewest Bits that can still pay for an item. Null when every shop is already broke. */
export function stageItem(state: PracticeState): ItemId | null {
  let best: Pool | null = null;
  for (const pool of state.book.pools) {
    if (!isItem(pool.item) || sellPayout(pool, 1) > pool.bits) continue;
    if (!best || pool.bits < best.bits) best = pool;
  }
  return best ? (best.item as ItemId) : null;
}

/* ------------------------------------------------------------------ storage */

const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const count = (v: unknown): v is number => whole(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A stored practice market, or null when it isn't one (corrupt, from another version, or
 * edited into something the maths can't run on). A null is simply reseeded: practice has
 * nothing worth protecting, and nothing in it can leave the browser.
 */
export function parsePractice(raw: string | null | undefined): PracticeState | null {
  if (!raw) return null;
  let s: unknown;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record(s) || s.v !== 1 || !whole(s.seededAt) || !whole(s.bits) || !record(s.items) || !record(s.book) || !record(s.npc) || !record(s.spark) || !record(s.traded)) return null;
  const book = s.book;
  if (!record(book.params) || !Array.isArray(book.pools) || !Array.isArray(book.listings) || !record(book.accounts) || !count(book.burned) || !count(book.nextListingId)) return null;
  if (book.pools.length === 0 || book.pools.length > 32) return null;
  for (const p of book.pools as unknown[]) {
    if (!record(p) || typeof p.item !== "string" || !isItem(p.item)) return null;
    if (!whole(p.virtualBits) || p.virtualBits < 1 || !whole(p.virtualItems) || p.virtualItems < 1 || !count(p.bits) || !count(p.stock) || !count(p.escrow)) return null;
    const staked = [p.invested, p.rewards, p.feeAcc, p.feeCarry].some((v) => v !== undefined);
    if (staked && (!count(p.invested) || !count(p.rewards) || typeof p.feeAcc !== "string" || !/^\d{1,39}$/.test(p.feeAcc) || !count(p.feeCarry))) return null;
  }
  for (const v of Object.values(s.items)) if (!whole(v)) return null;
  if (s.marks !== undefined) {
    if (!record(s.marks)) return null;
    for (const rows of Object.values(s.marks)) {
      if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || r.length !== 2 || !count(r[0]) || !count(r[1]))) return null;
    }
  }
  const npc = s.npc;
  if (!whole(npc.bits) || !record(npc.items) || !record(npc.books) || !Array.isArray(npc.log)) return null;
  const params = book.params;
  if (!count(params.feeBps) || params.feeBps > 1_000 || !count(params.maxAmount) || !count(params.dailyTrades) || !record(params.invest)) return null;
  return s as unknown as PracticeState;
}

export const storePractice = (state: PracticeState): string => JSON.stringify(state);
