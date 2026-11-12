/**
 * GWEI STACY'S PRICING RULES: the one file to read.
 *
 * Gwei Stacy is the Mempool Market's merchant, an NPC. Nobody types her prices in: each
 * item's price is worked out from two things she really holds for that item, her stock
 * and the Bits in her till. This file is every rule she prices by. It mirrors the
 * contract (contracts/wgp/src/market.rs) line for line, with the same integers and the
 * same rounding, and `math.test.ts` runs both against the same cases
 * (contracts/wgp/market-vectors.json).
 *
 * THE RULES, IN PLAIN ENGLISH
 *
 * 1. One pool per item. A pool is her stock of the item, her till for it (Bits), and two
 *    fixed "virtual" amounts that give the curve its depth:
 *      x = virtualItems + stock      items on the curve
 *      y = virtualBits  + bits       Bits on the curve
 *
 * 2. The price follows stock and demand. The spot price is y / x Bits per item
 *    (`spotMilli`). Buying takes stock out and puts Bits in, so x falls, y rises and the
 *    price goes up. Selling to her does the opposite and the price goes down. That is
 *    all "demand" is here: the trades players actually made.
 *      buying n costs    ceil(y·n / (x − n)) Bits    `buyCost`
 *      selling n pays    floor(y·n / (x + n)) Bits   `sellPayout`
 *    A buy rounds up and a sell rounds down, so buying and selling straight back never
 *    makes a profit.
 *
 * 3. She sells only what she holds. With fewer than n in stock there is no price for n
 *    (`buyCost` is null); at stock 0 she is sold out and can't sell at all.
 *
 * 4. She pays only from her till. If selling n would pay more than the Bits in that
 *    item's till, she can't buy them (`sellQuote` is null). When the till can't cover
 *    even one, she is broke for that item until someone buys from her and refills it.
 *
 * 5. The gas fee. Every trade burns ceil(bits · feeBps / 10000) Bits (`feeOf`); the fee
 *    is 2% (feeBps 200). A buyer pays the cost plus the fee; a seller gets the payout
 *    less the fee. Nobody receives the fee: it leaves the supply.
 *
 * 6. Player listings stay near her price. A listing of n items must ask between 50% and
 *    400% of her spot price × n (floorBps 5000, ceilingBps 40000) and never less than
 *    1 Bit (`listingBounds`).
 *
 * 7. Closed means closed. While the market is switched off (`open: false`) she neither
 *    buys nor sells; open listings can still be taken down.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * The fee, the listing bounds, the caps (20 items a trade, 40 trades with her a day) and
 * each item's starting curve are settings, in ./config.ts, the same values the contract
 * holds (`MarketParams::default()` in market.rs). Starting prices follow rarity: commons
 * open at 12 Bits with 40 in stock, uncommons at 40 with 20, rares at 150 with 8; half
 * of each curve's Bits is real (her till) and half is virtual. `rules.test.ts` fails if
 * a number in this comment drifts from those settings.
 *
 * Her own explanation of a price ("Running low: 4 left of the 8 I opened with…") is
 * ./reasoning.ts, which only reads a pool through the functions below.
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
