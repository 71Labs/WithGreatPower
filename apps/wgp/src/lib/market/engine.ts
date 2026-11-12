/**
 * The Mempool Market's rules as a pure state machine, mirroring the contract's market
 * methods (contracts/wgp/src/market.rs): the same checks in the same order, the same caps
 * and the same messages. The simulated market (src/server/market/sim.ts) and the
 * /lab/economy bots run on it; on chain the contract does all of this itself.
 *
 * Each action checks everything first and only then changes `book` and the ledger, so a
 * refused action (a thrown MarketError) leaves both untouched.
 */
import { BITS_TOKEN, itemToken, type MarketParams } from "./config";
import { assertInvestAmount, assertInvestOpen, claimFromPool, investInPool, investorCut, investorToday, InvestRefusal, withdrawFromPool, type Investor, type InvestRefusalCode, type StakeMove } from "./invest";
import { afterBuy, afterSell, buyQuote, feeOf, listingBounds, sellPayout, spotMilli, type Pool } from "./math";

export interface Listing {
  id: number;
  seller: string;
  item: string;
  amount: number;
  /** Bits for the whole lot. */
  price: number;
  listedAtMs: number;
}

/** Per account: today's counters and open listings. */
export interface MarketAccount {
  /** Days since the Unix epoch (UTC). */
  day: number;
  trades: number;
  listings: number;
  fills: number;
  fillBits: number;
  open: number[];
}

export interface MarketBook {
  params: MarketParams;
  pools: Pool[];
  listings: Listing[];
  nextListingId: number;
  accounts: Record<string, MarketAccount>;
  /** Bits burned by the gas fee so far (the contract tracks this as lower supply). */
  burned: number;
  /** Stakes and today's investing counters, per investor (contract v3; ./invest.ts). */
  investors?: Record<string, Investor>;
}

/** Balances the market moves. On chain these are NEP-245 balances. */
export interface Ledger {
  balance(account: string, token: string): number;
  credit(account: string, token: string, amount: number): void;
  debit(account: string, token: string, amount: number): void;
}

export type MarketErrorCode =
  | "closed"
  | "unknown_item"
  | "amount"
  | "daily_cap"
  | "slippage"
  | "funds"
  | "stock"
  | "till"
  | "dust"
  | "price"
  | "open_cap"
  | "full"
  | "gone"
  | "own"
  | "not_seller"
  // Investing (./invest.ts). "invest_unsupported": a market that can't take investors (contract v2).
  | "invest_unsupported"
  | InvestRefusalCode;

export class MarketError extends Error {
  constructor(
    readonly code: MarketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketError";
  }
}

const DAY_MS = 86_400_000;
export const dayOf = (ms: number) => Math.floor(ms / DAY_MS);

export interface Trade {
  item: string;
  side: "buy" | "sell";
  amount: number;
  /** Paid with the fee (buy) or received after it (sell). */
  bits: number;
  fee: number;
  /** The investors' share of `fee` (contract v3), when the pool has investors; the rest was burned. */
  cut?: number;
  pool: Pool;
}

export interface Fill {
  listing: Listing;
  buyer: string;
  fee: number;
}

export function newBook(params: MarketParams, pools: Pool[]): MarketBook {
  return { params: { ...params }, pools: pools.map((p) => ({ ...p })), listings: [], nextListingId: 1, accounts: {}, burned: 0 };
}

function poolIndex(book: MarketBook, item: string): number {
  const i = book.pools.findIndex((p) => p.item === item);
  if (i < 0) throw new MarketError("unknown_item", `The market doesn't trade ${item}`);
  return i;
}

function assertOpen(book: MarketBook) {
  if (!book.params.open) throw new MarketError("closed", "The market is closed");
}

function trading(book: MarketBook, item: string, amount: number): number {
  assertOpen(book);
  if (!Number.isInteger(amount) || amount < 1 || amount > book.params.maxAmount) {
    throw new MarketError("amount", `Trade 1 to ${book.params.maxAmount} at a time`);
  }
  return poolIndex(book, item);
}

/** The account's counters for the day of `nowMs` (yesterday's reset). Doesn't store it. */
export function accountToday(book: MarketBook, account: string, nowMs: number): MarketAccount {
  const a = book.accounts[account] ?? { day: 0, trades: 0, listings: 0, fills: 0, fillBits: 0, open: [] };
  const day = dayOf(nowMs);
  if (a.day !== day) return { day, trades: 0, listings: 0, fills: 0, fillBits: 0, open: [...a.open] };
  return { ...a, open: [...a.open] };
}

function counted(book: MarketBook, account: string, nowMs: number, count: (a: MarketAccount, p: MarketParams) => boolean): MarketAccount {
  const a = accountToday(book, account, nowMs);
  if (!count(a, book.params)) throw new MarketError("daily_cap", "Daily market limit reached; it resets at midnight UTC");
  return a;
}

/** Buy `amount` of `item` from the vendor, paying at most `maxBits`, fee included. */
export function marketBuy(book: MarketBook, ledger: Ledger, account: string, item: string, amount: number, maxBits: number, nowMs: number): Trade {
  const i = trading(book, item, amount);
  const acct = counted(book, account, nowMs, (a, p) => ++a.trades <= p.dailyTrades);
  const pool = book.pools[i]!;
  const q = buyQuote(pool, amount, book.params.feeBps);
  if (!q) throw new MarketError("stock", `The vendor has only ${pool.stock} ${item}`);
  if (q.total > maxBits) throw new MarketError("slippage", `That costs ${q.total} Bits now, over your limit of ${maxBits}`);
  if (ledger.balance(account, BITS_TOKEN) < q.total) throw new MarketError("funds", `Needs ${q.total} Bits`);
  ledger.debit(account, BITS_TOKEN, q.total);
  ledger.credit(account, itemToken(item), amount);
  // With investors in the pool, their share of the fee is booked to them instead of burned.
  const shared = investorCut(pool, q.fee, book.params.invest?.feeBps ?? 0);
  book.burned += q.fee - shared.cut;
  book.pools[i] = afterBuy(shared.pool, amount, q.cost);
  book.accounts[account] = acct;
  return { item, side: "buy", amount, bits: q.total, fee: q.fee, ...(shared.cut > 0 ? { cut: shared.cut } : {}), pool: { ...book.pools[i]! } };
}

/** Sell `amount` of `item` to the vendor for at least `minBits`, after the fee. */
export function marketSell(book: MarketBook, ledger: Ledger, account: string, item: string, amount: number, minBits: number, nowMs: number): Trade {
  const i = trading(book, item, amount);
  const acct = counted(book, account, nowMs, (a, p) => ++a.trades <= p.dailyTrades);
  const pool = book.pools[i]!;
  const payout = sellPayout(pool, amount);
  if (payout <= 0) throw new MarketError("dust", "That's worth less than a Bit");
  if (payout > pool.bits) throw new MarketError("till", `The vendor's till holds only ${pool.bits} Bits`);
  const fee = feeOf(payout, book.params.feeBps);
  const net = payout - fee;
  if (net < minBits) throw new MarketError("slippage", `That pays ${net} Bits now, under your limit of ${minBits}`);
  if (ledger.balance(account, itemToken(item)) < amount) throw new MarketError("funds", `Not enough item:${item}`);
  ledger.debit(account, itemToken(item), amount);
  ledger.credit(account, BITS_TOKEN, net);
  const shared = investorCut(pool, fee, book.params.invest?.feeBps ?? 0);
  book.burned += fee - shared.cut;
  book.pools[i] = afterSell(shared.pool, amount, payout);
  book.accounts[account] = acct;
  return { item, side: "sell", amount, bits: net, fee, ...(shared.cut > 0 ? { cut: shared.cut } : {}), pool: { ...book.pools[i]! } };
}

/** Escrow `amount` of `item` for sale at `price` Bits for the lot. */
export function listItem(book: MarketBook, ledger: Ledger, account: string, item: string, amount: number, price: number, nowMs: number): Listing {
  const i = trading(book, item, amount);
  const p = book.params;
  if (book.listings.length >= p.maxListings) throw new MarketError("full", "The market is full; try again later");
  const acct = counted(book, account, nowMs, (a, params) => ++a.listings <= params.dailyListings);
  if (acct.open.length >= p.maxOpenListings) throw new MarketError("open_cap", `You can have ${p.maxOpenListings} listings open`);
  const [lo, hi] = listingBounds(book.pools[i]!, amount, p.floorBps, p.ceilingBps);
  if (!Number.isInteger(price) || price < lo || price > hi) throw new MarketError("price", `Price it between ${lo} and ${hi} Bits`);
  if (ledger.balance(account, itemToken(item)) < amount) throw new MarketError("funds", `Not enough item:${item}`);
  ledger.debit(account, itemToken(item), amount);
  book.pools[i] = { ...book.pools[i]!, escrow: book.pools[i]!.escrow + amount };
  const listing: Listing = { id: book.nextListingId++, seller: account, item, amount, price, listedAtMs: nowMs };
  book.listings.push(listing);
  acct.open.push(listing.id);
  book.accounts[account] = acct;
  return { ...listing };
}

function closeListing(book: MarketBook, listing: Listing) {
  book.listings = book.listings.filter((l) => l.id !== listing.id);
  const i = book.pools.findIndex((p) => p.item === listing.item);
  if (i >= 0) book.pools[i] = { ...book.pools[i]!, escrow: Math.max(0, book.pools[i]!.escrow - listing.amount) };
  const seller = book.accounts[listing.seller];
  if (seller) book.accounts[listing.seller] = { ...seller, open: seller.open.filter((id) => id !== listing.id) };
}

/** Buy a whole listing at its price; the seller gets it less the gas fee. */
export function buyListing(book: MarketBook, ledger: Ledger, account: string, listingId: number, nowMs: number): Fill {
  assertOpen(book);
  const listing = book.listings.find((l) => l.id === listingId);
  if (!listing) throw new MarketError("gone", "That listing is gone");
  if (listing.seller === account) throw new MarketError("own", "That's your own listing");
  const acct = counted(book, account, nowMs, (a, p) => {
    a.fills += 1;
    a.fillBits += listing.price;
    return a.fills <= p.dailyFills && a.fillBits <= p.dailyFillBits;
  });
  const fee = feeOf(listing.price, book.params.feeBps);
  if (ledger.balance(account, BITS_TOKEN) < listing.price) throw new MarketError("funds", `Needs ${listing.price} Bits`);
  ledger.debit(account, BITS_TOKEN, listing.price);
  ledger.credit(account, itemToken(listing.item), listing.amount);
  ledger.credit(listing.seller, BITS_TOKEN, listing.price - fee);
  book.burned += fee;
  closeListing(book, listing);
  book.accounts[account] = acct;
  return { listing: { ...listing }, buyer: account, fee };
}

/** Take a listing down; the items go back to the seller. Works while trading is closed. */
export function cancelListing(book: MarketBook, ledger: Ledger, account: string, listingId: number): Listing {
  const listing = book.listings.find((l) => l.id === listingId);
  if (!listing) throw new MarketError("gone", "That listing is gone");
  if (listing.seller !== account) throw new MarketError("not_seller", "Only the seller can cancel a listing");
  ledger.credit(account, itemToken(listing.item), listing.amount);
  closeListing(book, listing);
  return { ...listing };
}

/* ------------------------------------------------------------------ investing (contract v3; ./invest.ts) */

/** What an invest, withdraw or claim did (the contract's `StakeReceipt`). */
export interface StakeReceipt {
  item: string;
  /** Bits invested or withdrawn by this call (0 for a claim). */
  bits: number;
  /** Fee earnings paid to the caller by this call. */
  earned: number;
  /** The caller's stake in the pool afterwards. */
  stake: number;
  unlocksAtMs: number;
  pool: Pool;
}

function investRules(book: MarketBook) {
  const rules = book.params.invest;
  if (!rules) throw new MarketError("invest_unsupported", "This market doesn't take investors yet");
  return rules;
}

/** Runs an investing check or move, turning a refused rule into a MarketError with the contract's words. */
function ruled<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof InvestRefusal) throw new MarketError(error.code, error.message);
    throw error;
  }
}

/** Writes a move's pool and stake into the book; a stake at 0 is removed. */
function settleStake(book: MarketBook, i: number, account: string, investor: Investor, move: StakeMove, lockMs: number): StakeReceipt {
  book.pools[i] = move.pool;
  // A stake keeps its place in the list, as on chain; a new one goes last.
  const at = investor.stakes.findIndex((s) => s.item === move.stake.item);
  const stakes = [...investor.stakes];
  if (at < 0) stakes.push(move.stake);
  else if (move.stake.bits > 0) stakes[at] = move.stake;
  else stakes.splice(at, 1);
  (book.investors ??= {})[account] = { ...investor, stakes };
  book.burned += move.dust;
  return { item: move.stake.item, bits: move.bits, earned: move.earned, stake: move.stake.bits, unlocksAtMs: move.stake.sinceMs + lockMs, pool: { ...move.pool } };
}

/** Put `bits` of the caller's Bits into `item`'s till (`market_invest`). */
export function marketInvest(book: MarketBook, ledger: Ledger, account: string, item: string, bits: number, nowMs: number): StakeReceipt {
  assertOpen(book);
  const rules = investRules(book);
  ruled(() => assertInvestOpen(rules));
  const i = poolIndex(book, item);
  ruled(() => assertInvestAmount(rules, bits));
  const investor = investorToday(book.investors?.[account], nowMs);
  investor.invests += 1;
  investor.investBits += bits;
  if (investor.invests > rules.dailyInvests || investor.investBits > rules.dailyBits) throw new MarketError("daily_cap", "Daily market limit reached; it resets at midnight UTC");
  const move = ruled(() => investInPool(book.pools[i]!, investor.stakes.find((s) => s.item === item), bits, nowMs));
  if (ledger.balance(account, BITS_TOKEN) < bits) throw new MarketError("funds", `Needs ${bits} Bits`);
  ledger.debit(account, BITS_TOKEN, bits);
  if (move.earned > 0) ledger.credit(account, BITS_TOKEN, move.earned);
  return settleStake(book, i, account, investor, move, rules.lockMs);
}

/**
 * Take `bits` of the caller's stake in `item` back out of the till, with any fee earnings
 * (`market_withdraw`). Works while trading is closed, and after investing is switched off.
 */
export function marketWithdraw(book: MarketBook, ledger: Ledger, account: string, item: string, bits: number, nowMs: number): StakeReceipt {
  const rules = investRules(book);
  const i = poolIndex(book, item);
  const investor = investorToday(book.investors?.[account], nowMs);
  const move = ruled(() => withdrawFromPool(book.pools[i]!, investor.stakes.find((s) => s.item === item), bits, nowMs, rules.lockMs));
  ledger.credit(account, BITS_TOKEN, move.bits + move.earned);
  return settleStake(book, i, account, investor, move, rules.lockMs);
}

/** Pay the caller the fee earnings of their stake in `item`; the stake stays (`market_claim`). */
export function marketClaim(book: MarketBook, ledger: Ledger, account: string, item: string, nowMs: number): StakeReceipt {
  const rules = investRules(book);
  const i = poolIndex(book, item);
  const investor = investorToday(book.investors?.[account], nowMs);
  const move = ruled(() => claimFromPool(book.pools[i]!, investor.stakes.find((s) => s.item === item)));
  ledger.credit(account, BITS_TOKEN, move.earned);
  return settleStake(book, i, account, investor, move, rules.lockMs);
}

/** The spot price of every pool × 1000, in pool order. */
export const pricesMilli = (book: MarketBook) => book.pools.map(spotMilli);

/** A Ledger over a plain balance map, for bots and tests. */
export function memoryLedger(start: Record<string, Record<string, number>> = {}): Ledger & { balances: Record<string, Record<string, number>> } {
  const balances = start;
  return {
    balances,
    balance: (a, t) => balances[a]?.[t] ?? 0,
    credit(a, t, n) {
      const row = (balances[a] ??= {});
      row[t] = (row[t] ?? 0) + n;
    },
    debit(a, t, n) {
      const row = (balances[a] ??= {});
      const have = row[t] ?? 0;
      if (have < n) throw new MarketError("funds", `Not enough ${t}`);
      row[t] = have - n;
    },
  };
}
