/**
 * The Mempool Market's curve, mirroring contracts/wgp/src/market.rs line for line: the
 * same integers, the same rounding. The contract is the truth on chain; this runs the
 * simulated market before the contract is live, the price previews in the UI and the
 * /lab/economy fast-forward. `math.test.ts` checks both against market-vectors.json.
 *
 * A pool is a virtual-reserve constant product:
 *   x = virtualItems + stock, y = virtualBits + bits, spot = y / x Bits per item
 *   buy n:  ceil(y·n / (x − n))   (only from stock)
 *   sell n: floor(y·n / (x + n))  (only from the till)
 * The gas fee is ceil(bits · feeBps / 10000), burned.
 *
 * Amounts are plain numbers (JSON-friendly); the arithmetic runs in BigInt, so it is
 * exact like the contract's u128.
 */

export interface Pool {
  item: string;
  virtualBits: number;
  virtualItems: number;
  /** Bits in the vendor's till for this item. */
  bits: number;
  /** Items the vendor can sell. */
  stock: number;
  /** Items escrowed in open listings. */
  escrow: number;
}

const BPS = 10_000n;

function num(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${v} is too large for the market`);
  return n;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** [x, y]: items and Bits on the curve. */
export function reserves(p: Pool): [bigint, bigint] {
  return [BigInt(p.virtualItems) + BigInt(p.stock), BigInt(p.virtualBits) + BigInt(p.bits)];
}

/** Spot price × 1000 (Bits per item, three decimals), rounded down. */
export function spotMilli(p: Pool): number {
  const [x, y] = reserves(p);
  return num((y * 1000n) / x);
}

/** Spot price in Bits, for display. */
export const spot = (p: Pool) => spotMilli(p) / 1000;

/** Bits to buy `n` before the fee, or null if the vendor holds fewer than `n`. */
export function buyCost(p: Pool, n: number): number | null {
  if (n <= 0 || n > p.stock) return null;
  const [x, y] = reserves(p);
  return num(ceilDiv(y * BigInt(n), x - BigInt(n)));
}

/** Bits for selling `n` before the fee (it may exceed the till; check `sellQuote`). */
export function sellPayout(p: Pool, n: number): number {
  const [x, y] = reserves(p);
  return num((y * BigInt(n)) / (x + BigInt(n)));
}

/** The gas fee on `bits`, rounded up. */
export function feeOf(bits: number, feeBps: number): number {
  return num(ceilDiv(BigInt(bits) * BigInt(feeBps), BPS));
}

/** The price range a listing of `n` may ask: [floor, ceiling] of spot × n. */
export function listingBounds(p: Pool, n: number, floorBps: number, ceilingBps: number): [number, number] {
  const [x, y] = reserves(p);
  const lo = ceilDiv(y * BigInt(n) * BigInt(floorBps), x * BPS);
  const floor = lo > 1n ? lo : 1n;
  const hi = (y * BigInt(n) * BigInt(ceilingBps)) / (x * BPS);
  return [num(floor), num(hi > floor ? hi : floor)];
}

export interface BuyQuote {
  cost: number;
  fee: number;
  /** What the player pays: cost + fee. */
  total: number;
}

export interface SellQuote {
  payout: number;
  fee: number;
  /** What the player gets: payout − fee. */
  net: number;
}

export function buyQuote(p: Pool, n: number, feeBps: number): BuyQuote | null {
  const cost = buyCost(p, n);
  if (cost === null) return null;
  const fee = feeOf(cost, feeBps);
  return { cost, fee, total: cost + fee };
}

/** Null when it's worth less than a Bit or the till can't pay it. */
export function sellQuote(p: Pool, n: number, feeBps: number): SellQuote | null {
  if (n <= 0) return null;
  const payout = sellPayout(p, n);
  if (payout === 0 || payout > p.bits) return null;
  const fee = feeOf(payout, feeBps);
  return { payout, fee, net: payout - fee };
}

/** The pool after a buy of `n` that cost `cost`. */
export function afterBuy(p: Pool, n: number, cost: number): Pool {
  return { ...p, stock: p.stock - n, bits: p.bits + cost };
}

/** The pool after a sell of `n` that paid `payout` from the till. */
export function afterSell(p: Pool, n: number, payout: number): Pool {
  return { ...p, stock: p.stock + n, bits: p.bits - payout };
}

/** Slippage bound for a buy: the quote plus `bps` (rounded up), so a small move still fills. */
export const withSlippage = (bits: number, bps: number) => num(ceilDiv(BigInt(bits) * (BPS + BigInt(bps)), BPS));

/** Slippage bound for a sell: the quote less `bps` (rounded down). */
export const lessSlippage = (bits: number, bps: number) => num((BigInt(bits) * (BPS - BigInt(bps))) / BPS);
