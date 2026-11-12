/**
 * INVESTING IN A MERCHANT: the one file to read.
 *
 * Gwei Stacy pays sellers only from the Bits in her till for that item. When a till
 * can't pay for even one, she is **broke** for that item: the shop is closed for buying
 * until someone buys from her, or until someone **invests** in that till.
 *
 * This file is a pure TypeScript mirror of contract v3's investing rules
 * (contracts/wgp/src/invest.rs and the fee split in market.rs, on the branch
 * `review/contract-v3`; v3 is not deployed, mainnet runs v2). Same integers, same
 * rounding, same order of checks, same words when it refuses. `invest.test.ts` replays
 * ./invest-vectors.json, which the Rust itself printed
 * (scripts/invest-vectors/generate.mjs), through the functions below. The practice
 * market, the simulated market and /lab/economy all run on it; on a v3 contract the
 * chain does all of this itself and the app only reads it.
 *
 * THE RULES, IN PLAIN ENGLISH
 *
 * 1. A pool's curve has y = virtualBits + bits Bits on it. Only `bits` (the till) is
 *    real. Investing `n` Bits moves them into the till and takes the same `n` off
 *    `virtualBits`. So y, the spot price and every quote are exactly what they were:
 *    investing changes what Gwei can pay, never what she quotes (`investInPool`).
 *
 * 2. A stake is a claim on its own principal, 1 Bit for 1 Bit. It is not a share of the
 *    till: nobody's trade or investment changes what another investor is owed.
 *
 * 3. A pool takes at most `virtualBits − 1` Bits (`investRoom`). A fully funded curve can
 *    pay for any sale, so there is nothing left to fund.
 *
 * 4. Investors earn `feeBps` (half, by default) of the gas fee on each of that pool's
 *    trades with Gwei, split by stake, instead of that part being burned
 *    (`investorCut`). Whole Bits only; the fraction carries to the next trade. Earnings
 *    sit apart from the till (`rewards`) and can always be claimed.
 *
 * 5. Withdrawing takes real Bits out, so the till must hold them, and a stake is locked
 *    for `lockMs` after its last top-up (`withdrawFromPool`). Players who sell loot into
 *    a funded till are paid from it; the Bits come back only as others buy that stock.
 *    Until then the stake waits. First come, first served.
 *
 * 6. Per call `min`..`max` Bits; per account and UTC day `dailyInvests` calls and
 *    `dailyBits` Bits (`investorToday`, checked by ./engine.ts `marketInvest`).
 *
 * 7. A shop's `closed` reasons: "broke" (the till can't pay for one item), "sold-out"
 *    (no stock), and for the whole market "paused" and "market-closed" (`shopsOf`).
 *
 * Amounts are plain numbers; the arithmetic runs in BigInt, exact like the contract's
 * u128. `feeAcc` (earnings per invested Bit × 10^12) outgrows a JS number, so it travels
 * as a decimal string.
 */
import { plural } from "@/lib/plural";

import type { InvestRules } from "./config";
import { sellPayout, spotMilli, type Pool } from "./math";

export type { InvestRules };

/** contracts/wgp/src/market.rs `MarketParams::default()` on v3 (a fresh deploy; an upgrade arrives with `open: false`). */
export const DEFAULT_INVEST_RULES: InvestRules = {
  open: true,
  feeBps: 5_000,
  min: 10,
  max: 500,
  dailyInvests: 6,
  dailyBits: 1_000,
  lockMs: 3_600_000,
};

/** Scale of `feeAcc`. */
const ACC = 1_000_000_000_000n;
const BPS = 10_000n;

function num(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${v} is too large for the market`);
  return n;
}

/** One account's stake in one pool. */
export interface Stake {
  item: string;
  /** Principal: Bits this account has in the pool's till. */
  bits: number;
  /** Earnings already settled: ceil(bits · feeAcc / 10^12) at the last change. */
  debt: number;
  /** The last top-up; the stake can be withdrawn `lockMs` after it. */
  sinceMs: number;
}

/** Per investor: today's counters and at most one stake per pool. */
export interface Investor {
  /** Days since the Unix epoch (UTC) the counters belong to. */
  day: number;
  invests: number;
  investBits: number;
  stakes: Stake[];
}

/** A pool's investing fields with their defaults: a pool nobody invested in carries none. */
export interface PoolStakes {
  invested: number;
  rewards: number;
  feeAcc: bigint;
  feeCarry: number;
}

export const stakesOf = (p: Pool): PoolStakes => ({
  invested: p.invested ?? 0,
  rewards: p.rewards ?? 0,
  feeAcc: BigInt(p.feeAcc ?? "0"),
  feeCarry: p.feeCarry ?? 0,
});

const withStakes = (p: Pool, s: PoolStakes): Pool => ({ ...p, invested: s.invested, rewards: s.rewards, feeAcc: s.feeAcc.toString(), feeCarry: s.feeCarry });

/** bits · acc / 10^12, rounded down (or up). */
function share(bits: number, acc: bigint, up: boolean): number {
  const v = BigInt(bits) * acc;
  return num(up ? (v + ACC - 1n) / ACC : v / ACC);
}

/** Fee earnings a stake can claim from its pool right now. */
export function earned(stake: Pick<Stake, "bits" | "debt">, pool: Pool): number {
  const s = stakesOf(pool);
  return Math.min(Math.max(0, share(stake.bits, s.feeAcc, false) - stake.debt), s.rewards);
}

/** Bits a pool can still take from investors: the curve's unfunded part, less one. */
export const investRoom = (p: Pool): number => Math.max(0, p.virtualBits - 1);

/** Bits the till is short of to buy one item from a player; 0 when it can. */
export const tillShort = (p: Pool): number => Math.max(0, sellPayout(p, 1) - p.bits);

export type PoolClosed = "broke" | "sold-out";
export type ClosedReason = "paused" | "market-closed" | PoolClosed;

/** Why Gwei can't trade this item right now, if she can't. */
export function closedReasons(p: Pool): PoolClosed[] {
  const out: PoolClosed[] = [];
  if (tillShort(p) > 0) out.push("broke");
  if (p.stock === 0) out.push("sold-out");
  return out;
}

/**
 * The investors' share of a trade's gas fee: taken out of what would be burned and booked
 * to the pool's investors. Returns the pool with it booked and the whole Bits taken (0
 * while the pool has no investors, and then the pool comes back untouched).
 */
export function investorCut(p: Pool, fee: number, shareBps: number): { pool: Pool; cut: number } {
  const s = stakesOf(p);
  if (s.invested === 0 || shareBps === 0) return { pool: p, cut: 0 };
  const carry = BigInt(s.feeCarry) + BigInt(fee) * BigInt(shareBps);
  const cut = num(carry / BPS);
  const next: PoolStakes = { ...s, feeCarry: num(carry % BPS) };
  if (cut > 0) {
    next.rewards += cut;
    next.feeAcc += (BigInt(cut) * ACC) / BigInt(s.invested);
  }
  return { pool: withStakes(p, next), cut };
}

/* ------------------------------------------------------------------ refusals */

export type InvestRefusalCode = "invest_closed" | "invest_amount" | "invest_room" | "no_stake" | "stake_amount" | "locked" | "till_short" | "nothing_earned";

/** A rule refused it. The message is the contract's, word for word. */
export class InvestRefusal extends Error {
  constructor(
    readonly code: InvestRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "InvestRefusal";
  }
}

/* ------------------------------------------------------------------ the three moves */

export interface StakeMove {
  pool: Pool;
  /** The stake afterwards; `bits` 0 means it is gone. */
  stake: Stake;
  /** Bits invested or withdrawn by this move (0 for a claim). */
  bits: number;
  /** Fee earnings paid to the investor by this move. */
  earned: number;
  /** Rounding dust burned when the pool's last investor leaves. */
  dust: number;
}

const DAY_MS = 86_400_000;

/** The investor's counters for the day of `nowMs` (yesterday's reset). */
export function investorToday(investor: Investor | undefined, nowMs: number): Investor {
  const day = Math.floor(nowMs / DAY_MS);
  const i = investor ?? { day: 0, invests: 0, investBits: 0, stakes: [] };
  if (i.day !== day) return { day, invests: 0, investBits: 0, stakes: i.stakes.map((s) => ({ ...s })) };
  return { ...i, stakes: i.stakes.map((s) => ({ ...s })) };
}

/** `market_invest`'s first check: investing is switched on. Throws InvestRefusal. */
export function assertInvestOpen(rules: InvestRules): void {
  if (!rules.open) throw new InvestRefusal("invest_closed", "The vendor isn't taking investors right now");
}

/** `market_invest`'s amount check, made once the pool is known to exist. Throws InvestRefusal. */
export function assertInvestAmount(rules: InvestRules, amount: number): void {
  if (!Number.isInteger(amount) || amount < rules.min || amount > rules.max) throw new InvestRefusal("invest_amount", `Invest ${rules.min} to ${rules.max} Bits at a time`);
}

/** Real Bits in, the same number of virtual Bits out: y doesn't move. Pending earnings are paid out. */
export function investInPool(pool: Pool, stake: Stake | undefined, amount: number, nowMs: number): StakeMove {
  const room = investRoom(pool);
  if (amount > room) throw new InvestRefusal("invest_room", `The vendor can take only ${room} more Bits for ${pool.item}`);
  const before = stake ?? { item: pool.item, bits: 0, debt: 0, sinceMs: 0 };
  const s = stakesOf(pool);
  const paid = earned(before, pool);
  const next: PoolStakes = { ...s, rewards: s.rewards - paid, invested: s.invested + amount };
  const bits = before.bits + amount;
  return {
    pool: withStakes({ ...pool, bits: pool.bits + amount, virtualBits: pool.virtualBits - amount }, next),
    stake: { item: pool.item, bits, debt: share(bits, s.feeAcc, true), sinceMs: nowMs },
    bits: amount,
    earned: paid,
    dust: 0,
  };
}

/**
 * Real Bits out, the same number of virtual Bits back. Needs the lock to have passed
 * (unless `locked` is false: the owner's refund) and the till to hold the Bits. `amount`
 * null takes the whole stake.
 */
export function withdrawFromPool(pool: Pool, stake: Stake | undefined, amount: number | null, nowMs: number, lockMs: number, locked = true): StakeMove {
  if (!stake) throw new InvestRefusal("no_stake", `You have no stake in ${pool.item}`);
  const n = amount ?? stake.bits;
  if (!Number.isInteger(n) || n < 1 || n > stake.bits) throw new InvestRefusal("stake_amount", `You have ${stake.bits} Bits staked in ${pool.item}`);
  const unlocks = stake.sinceMs + lockMs;
  if (locked && nowMs < unlocks) throw new InvestRefusal("locked", `Your stake unlocks in about ${Math.ceil((unlocks - nowMs) / 60_000)} minutes`);
  if (n > pool.bits) throw new InvestRefusal("till_short", `The till can pay back only ${pool.bits} Bits right now; it refills as players buy ${pool.item}`);
  const s = stakesOf(pool);
  const paid = earned(stake, pool);
  const next: PoolStakes = { ...s, rewards: s.rewards - paid, invested: s.invested - n };
  const bits = stake.bits - n;
  // With the last investor gone, what rounding left behind is burned like any fee.
  let dust = 0;
  if (next.invested === 0) {
    dust = next.rewards;
    next.rewards = 0;
    next.feeCarry = 0;
  }
  return {
    pool: withStakes({ ...pool, bits: pool.bits - n, virtualBits: pool.virtualBits + n }, next),
    stake: { ...stake, bits, debt: share(bits, s.feeAcc, true) },
    bits: n,
    earned: paid,
    dust,
  };
}

/** Pays the stake's fee earnings; the stake stays. */
export function claimFromPool(pool: Pool, stake: Stake | undefined): StakeMove {
  if (!stake) throw new InvestRefusal("no_stake", `You have no stake in ${pool.item}`);
  const paid = earned(stake, pool);
  if (paid <= 0) throw new InvestRefusal("nothing_earned", "Nothing earned yet");
  const s = stakesOf(pool);
  return { pool: withStakes(pool, { ...s, rewards: s.rewards - paid }), stake: { ...stake, debt: stake.debt + paid }, bits: 0, earned: paid, dust: 0 };
}

/* ------------------------------------------------------------------ views (market_shops, market_investor) */

/** One merchant's stall: whether it can trade, and what investing in it looks like. */
export interface Shop {
  item: string;
  /** Spot price × 1000. */
  priceMilli: number;
  /** Why it can't trade right now; empty when it buys and sells. */
  closed: ClosedReason[];
  /** Gwei buys this item from players right now. */
  buying: boolean;
  /** Gwei sells this item to players right now. */
  selling: boolean;
  /** Bits in the till, and how many more it needs to buy one item (0 when it can). */
  till: number;
  needs: number;
  /** Investors' Bits in the till, and how many more the pool can take. */
  invested: number;
  investRoom: number;
  /** Fee earnings waiting for this pool's investors. */
  rewards: number;
}

export function shopOf(p: Pool, open: boolean, paused = false): Shop {
  const global: ClosedReason[] = [];
  if (paused) global.push("paused");
  if (!open) global.push("market-closed");
  const own = closedReasons(p);
  const s = stakesOf(p);
  return {
    item: p.item,
    priceMilli: spotMilli(p),
    closed: [...global, ...own],
    buying: global.length === 0 && !own.includes("broke"),
    selling: global.length === 0 && !own.includes("sold-out"),
    till: p.bits,
    needs: tillShort(p),
    invested: s.invested,
    investRoom: investRoom(p),
    rewards: s.rewards,
  };
}

export const shopsOf = (pools: Pool[], open: boolean, paused = false): Shop[] => pools.map((p) => shopOf(p, open, paused));

export interface StakeView {
  item: string;
  bits: number;
  /** Fee earnings ready to claim. */
  earned: number;
  unlocksAtMs: number;
  /** What a withdrawal would pay back right now: 0 while locked, never more than the till holds. */
  withdrawable: number;
}

export interface InvestorView {
  stakes: StakeView[];
  investsLeft: number;
  investBitsLeft: number;
}

export const NO_INVESTOR: InvestorView = { stakes: [], investsLeft: 0, investBitsLeft: 0 };

/** An account's stakes, what each has earned and can withdraw, and what it may still invest today. */
export function investorView(rules: InvestRules, pools: Pool[], investor: Investor | undefined, nowMs: number): InvestorView {
  const today = investorToday(investor, nowMs);
  const stakes: StakeView[] = [];
  for (const s of today.stakes) {
    const pool = pools.find((p) => p.item === s.item);
    if (!pool) continue;
    const unlocksAtMs = s.sinceMs + rules.lockMs;
    stakes.push({ item: s.item, bits: s.bits, earned: earned(s, pool), unlocksAtMs, withdrawable: nowMs >= unlocksAtMs ? Math.min(s.bits, pool.bits) : 0 });
  }
  return { stakes, investsLeft: Math.max(0, rules.dailyInvests - today.invests), investBitsLeft: Math.max(0, rules.dailyBits - today.investBits) };
}

/* ------------------------------------------------------------------ what the screen says */

/**
 * What a player risks by investing, said before they confirm. Plain, short, no hype:
 * contract v3's own list (docs/CONTRACT-V3.md, "What an investor does risk") and the
 * independent review's point that a funded till is exit liquidity for whoever holds loot.
 */
export const INVEST_RISKS: readonly string[] = [
  "Your stake waits when the till is empty. You can only withdraw Bits the till holds.",
  "Withdrawals are first come, first served. If the till holds less than all investors put in, whoever withdraws first is paid first.",
  "Other players can sell loot into a till you funded and take the Bits. They only come back when someone buys that stock, and nothing makes anyone buy it.",
];

/** One line for a closed reason, in the market's words. */
export function closedText(reason: ClosedReason): string {
  switch (reason) {
    case "broke":
      return "Broke: her till for these can’t pay for one, so she isn’t buying.";
    case "sold-out":
      return "Sold out: she holds none, so she isn’t selling.";
    case "paused":
      return "Paused: the game is paused, so nothing trades.";
    case "market-closed":
      return "Closed: the market is switched off.";
  }
}

/** "about 12 minutes", "about 2 hours", "under a minute": how long until `unlocksAtMs`, or null once it has passed. */
export function unlocksIn(unlocksAtMs: number, nowMs: number): string | null {
  const left = unlocksAtMs - nowMs;
  if (left <= 0) return null;
  if (left < 60_000) return "under a minute";
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 90) return `about ${plural(minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hours`;
}
