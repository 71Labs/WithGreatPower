import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, seededPools } from "./config";
import { afterBuy, afterSell, buyCost, buyQuote, sellPayout, sellQuote, spotMilli, type Pool } from "./math";
import { explainPrice, openingOf, type PriceFacts } from "./reasoning";

const FEE = DEFAULT_PARAMS.feeBps;
const seeded = (item: string): Pool => seededPools().find((p) => p.item === item)!;
/** A common (12 Bits, 40 in stock) and a rare (150 Bits, 8 in stock), as config.ts seeds them. */
const crumbs = () => seeded("crumbs");
const glider = () => seeded("goblin-glider");

/** Players buy `n` from Gwei, one at a time, through the real curve. */
function bought(pool: Pool, n: number): Pool {
  let p = pool;
  for (let i = 0; i < n; i++) p = afterBuy(p, 1, buyCost(p, 1)!);
  return p;
}

/** Players sell Gwei `n`, one at a time, while her till can pay. */
function sold(pool: Pool, n: number): Pool {
  let p = pool;
  for (let i = 0; i < n && sellQuote(p, 1, FEE); i++) p = afterSell(p, 1, sellPayout(p, 1));
  return p;
}

const explain = (pool: Pool, more: Partial<PriceFacts> = {}) => explainPrice({ pool, open: true, feeBps: FEE, ...more });

describe("openingOf", () => {
  it("is the pool as config.ts seeds it", () => {
    expect(openingOf(bought(crumbs(), 5))).toEqual({ stock: 40, bits: 480, priceMilli: 12_000 });
    expect(openingOf(glider())).toEqual({ stock: 8, bits: 1_200, priceMilli: 150_000 });
  });

  it("is null for an item or a curve the settings don't know", () => {
    expect(openingOf({ ...crumbs(), item: "mystery" })).toBeNull();
    expect(openingOf({ ...crumbs(), virtualItems: 41 })).toBeNull();
  });
});

describe("explainPrice", () => {
  it("at the opening price: says so, with the stock and till she opened with", () => {
    const r = explain(crumbs());
    expect(r.state).toBe("opening");
    expect(r.headline).toBe("Opening price: 12.0 Bits. Not a gwei more.");
    expect(r.reasons).toEqual(["40 in stock, the same as when I opened.", "My till for these holds 480 Bits, the same as when I opened."]);
    expect(r).toMatchObject({ closed: false, soldOut: false, cantPay: false, buyBlocked: null, sellBlocked: null });
  });

  it("above: one rare bought, so she's running low and asks more", () => {
    const pool = bought(glider(), 1);
    const pct = Math.round(((spotMilli(pool) - 150_000) / 150_000) * 100);
    const r = explain(pool);
    expect(pct).toBe(14);
    expect(r.state).toBe("above");
    expect(r.headline).toBe("Up 14% since I opened. Heroes keep buying these.");
    expect(r.reasons).toEqual([
      "Running low: 7 left of 8, so I’m asking 14% more than when I opened.",
      `My till for these holds ${pool.bits.toLocaleString("en-US")} Bits, up from 1,200 at opening. Buyers paid in, and that lifts the price.`,
    ]);
    expect(r.buyBlocked).toBeNull();
    expect(r.sellBlocked).toBeNull();
  });

  it("below: players sold her five, so she's overstocked and asks less", () => {
    const pool = sold(crumbs(), 5);
    const r = explain(pool);
    expect(pool.stock).toBe(45);
    expect(r.state).toBe("below");
    expect(r.headline).toBe("Down 11% since I opened. I’m drowning in these.");
    expect(r.reasons).toEqual([
      "Overstocked: I’m holding 45, 5 more than the 40 I opened with, so I’m asking 11% less.",
      `My till for these holds ${pool.bits} Bits, down from 480 at opening. I paid sellers out, and that lowers the price.`,
    ]);
  });

  it("a small move is stated without the remark", () => {
    expect(explain(bought(crumbs(), 1)).headline).toMatch(/^Up [1-9]% since I opened\.$/);
    expect(explain(sold(crumbs(), 1)).headline).toMatch(/^Down [1-9]% since I opened\.$/);
  });

  it("sold out: stock 0, she can't sell, and says what she'd pay for one", () => {
    const pool = bought(glider(), 8);
    const r = explain(pool);
    expect(pool.stock).toBe(0);
    expect(r.state).toBe("sold-out");
    expect(r.soldOut).toBe(true);
    expect(r.headline).toBe("Sold out. I can’t sell what I don’t hold.");
    expect(r.reasons).toEqual([
      "I opened with 8 and have none left, so I can’t sell you one.",
      `The price sits at ${Math.round(spotMilli(pool) / 1000)} Bits, ${Math.round(((spotMilli(pool) - 150_000) / 150_000) * 100)}% over my opening price, until someone sells me one.`,
      `Sell me one and I’ll pay ${sellQuote(pool, 1, FEE)!.net} Bits after the gas fee.`,
    ]);
    expect(r.buyBlocked).toBe("Gwei has none left to sell. Sell her one and she’s back in stock.");
    expect(r.sellBlocked).toBeNull();
  });

  it("broke: her till for the item can't pay for one, so she can't buy", () => {
    const pool = sold(crumbs(), 10_000);
    const payout = sellPayout(pool, 1);
    expect(payout).toBeGreaterThan(pool.bits);
    const r = explain(pool);
    expect(r.state).toBe("broke");
    expect(r.cantPay).toBe(true);
    expect(r.headline).toBe("My till for these is tapped out. Not stingy, just solvent.");
    expect(r.reasons[0]).toBe(`One of these would cost me ${payout} Bits and my till for them holds ${pool.bits}, so I can’t buy more until someone buys from me.`);
    expect(r.reasons[1]).toMatch(new RegExp(`^Overstocked: I’m holding ${pool.stock}, ${pool.stock - 40} more than the 40 I opened with, so I’m asking \\d+% less\\.$`));
    expect(r.reasons[2]).toBe(`Buy one for ${buyQuote(pool, 1, FEE)!.total} Bits, gas fee included, and I can buy again.`);
    expect(r.sellBlocked).toBe("Gwei’s till for these can’t pay for one. Buy one and she can buy again.");
    expect(r.buyBlocked).toBeNull();
    // Her promise holds: after one buy, the till covers buying one back.
    expect(sellQuote(bought(pool, 1), 1, FEE)).not.toBeNull();
  });

  it("closed: no trading either way, whatever the pool holds", () => {
    const r = explain(bought(glider(), 8), { open: false });
    expect(r.state).toBe("closed");
    expect(r.closed).toBe(true);
    expect(r.headline).toBe("Stall’s closed. Even a gwei counter takes a break.");
    expect(r.reasons[0]).toBe("The market is switched off, so I’m not buying or selling right now.");
    expect(r.reasons[1]).toMatch(/^Last price: \d+ Bits, with 0 in stock\.$/);
    expect(r.buyBlocked).toBe("The stall is closed, so Gwei isn’t selling right now.");
    expect(r.sellBlocked).toBe("The stall is closed, so Gwei isn’t buying right now.");
  });

  it("mentions the last 24 hours only when the caller has that history", () => {
    const pool = bought(crumbs(), 3);
    expect(explain(pool).reasons).toHaveLength(2);
    expect(explain(pool, { change24h: null }).reasons).toHaveLength(2);
    expect(explain(pool, { trades24h: 3, change24h: 0.08 }).reasons[2]).toBe("3 trades with me in the last 24 hours moved the price +8%.");
    expect(explain(pool, { trades24h: 1, change24h: -0.031 }).reasons[2]).toBe("1 trade with me in the last 24 hours moved the price −3%.");
    expect(explain(pool, { trades24h: 2, change24h: 0 }).reasons[2]).toBe("2 trades with me in the last 24 hours, and the price is back where it was.");
    expect(explain(pool, { trades24h: 4, change24h: null }).reasons[2]).toBe("4 trades with me in the last 24 hours. Every one moved the price.");
    expect(explain(pool, { trades24h: 0, change24h: 0 }).reasons[2]).toBe("Nobody’s traded these with me in the last 24 hours, so the price hasn’t moved.");
    // The economy lab knows a day's change but not its trades per item.
    expect(explain(pool, { change24h: 0.06 }).reasons[2]).toBe("Up 6% in the last 24 hours.");
    expect(explain(pool, { change24h: -0.11 }).reasons[2]).toBe("Down 11% in the last 24 hours.");
  });

  it("without a known opening, only says what she holds now", () => {
    const pool = { ...bought(crumbs(), 4), item: "mystery" };
    const r = explain(pool);
    expect(r.state).toBe("opening");
    expect(r.headline).toMatch(/^\d+\.\d Bits\. I counted it in gwei twice\.$/);
    expect(r.reasons).toEqual(["I’m holding 36, and the price follows what I hold.", `My till for these holds ${pool.bits} Bits.`]);
  });

  it("every number she says is in the pool, its opening or its quotes; two or three reasons, sentence case, curly quotes", () => {
    const pools = [crumbs(), glider(), bought(crumbs(), 12), bought(glider(), 7), bought(glider(), 8), sold(crumbs(), 30), sold(crumbs(), 10_000), sold(glider(), 3)];
    for (const pool of pools) {
      for (const open of [true, false]) {
        const r = explain(pool, { open });
        const o = openingOf(pool)!;
        const price = spotMilli(pool);
        const pct = Math.round((Math.abs(price - o.priceMilli) / o.priceMilli) * 100);
        const allowed = new Set(
          [pool.stock, pool.bits, o.stock, o.bits, Math.abs(pool.stock - o.stock), pct, sellPayout(pool, 1), sellQuote(pool, 1, FEE)?.net, buyQuote(pool, 1, FEE)?.total]
            .filter((n): n is number => n !== undefined)
            .map(String),
        );
        // A price prints with up to two decimals: allow it whole, to one and to two places.
        for (const d of [0, 1, 2]) allowed.add((price / 1000).toFixed(d));
        allowed.add((o.priceMilli / 1000).toFixed(1));
        expect(r.reasons.length).toBeGreaterThanOrEqual(2);
        expect(r.reasons.length).toBeLessThanOrEqual(3);
        for (const line of [r.headline, ...r.reasons]) {
          expect(line).not.toMatch(/['"]/);
          expect(line[0]).toBe(line[0]!.toUpperCase());
          for (const n of line.replace(/,/g, "").match(/\d+(\.\d+)?/g) ?? []) expect(allowed, `“${line}” says ${n}`).toContain(n);
        }
      }
    }
  });
});
