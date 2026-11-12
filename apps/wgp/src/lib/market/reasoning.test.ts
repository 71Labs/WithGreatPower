import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, seededPools } from "./config";
import { afterBuy, afterSell, buyCost, buyQuote, sellPayout, sellQuote, spotMilli, type Pool } from "./math";
import { covers, explainPrice, openingOf, stockLevel, tillLevel, type PriceFacts, type StockLevel, type TillLevel } from "./reasoning";

const FEE = DEFAULT_PARAMS.feeBps;
const CAP = DEFAULT_PARAMS.maxAmount;
const seeded = (item: string): Pool => seededPools().find((p) => p.item === item)!;
/** A common (12 Bits, 40 in stock), an uncommon (40 Bits, 20) and a rare (150 Bits, 8), as config.ts seeds them. */
const crumbs = () => seeded("crumbs");
const seed = () => seeded("sesame-seed");
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

describe("stockLevel: the word for her stock, across the whole range", () => {
  const cases: [stock: number, opened: number, level: StockLevel][] = [
    // A common opens with 40.
    [0, 40, "out"],
    [1, 40, "nearly-out"],
    [8, 40, "nearly-out"], // exactly 20%
    [9, 40, "low"],
    [20, 40, "low"], // exactly 50%
    [21, 40, "under"],
    [23, 40, "under"], // the judge's "Running low: 23 left of 40"
    [38, 40, "under"], // the judge's "Running low: 38 left of 40"
    [39, 40, "under"],
    [40, 40, "opening"],
    [41, 40, "plenty"],
    [60, 40, "plenty"], // exactly 150%
    [61, 40, "overstocked"],
    [400, 40, "overstocked"],
    // An uncommon opens with 20.
    [4, 20, "nearly-out"],
    [5, 20, "low"],
    [10, 20, "low"],
    [11, 20, "under"],
    [18, 20, "under"], // the judge's "Running low: 18 left of 20"
    [30, 20, "plenty"],
    [31, 20, "overstocked"],
    // A rare opens with 8: 20% is 1.6, 50% is 4.
    [1, 8, "nearly-out"],
    [2, 8, "low"],
    [4, 8, "low"],
    [5, 8, "under"],
    [7, 8, "under"],
    [8, 8, "opening"],
    [12, 8, "plenty"],
    [13, 8, "overstocked"],
  ];
  it.each(cases)("%i of %i is %s", (stock, opened, level) => {
    expect(stockLevel(stock, opened)).toBe(level);
  });
});

describe("tillLevel: the word for her till, across the whole range", () => {
  const cases: [bits: number, opened: number, canCover: number, level: TillLevel][] = [
    [0, 480, 0, "empty"],
    [9, 480, 0, "empty"], // some Bits, but not enough for one
    [96, 480, 9, "nearly-empty"], // exactly 20%
    [97, 480, 9, "low"],
    [240, 480, 20, "low"], // exactly 50%
    [241, 480, 20, "under"],
    [479, 480, 20, "under"],
    [480, 480, 20, "opening"],
    [481, 480, 20, "over"],
    [5_000, 480, 20, "over"],
  ];
  it.each(cases)("%i Bits of %i, covering %i, is %s", (bits, opened, canCover, level) => {
    expect(tillLevel(bits, opened, canCover)).toBe(level);
  });
});

describe("covers: how many she can pay for in one trade", () => {
  it("is the trade cap while the till is deep, and falls to 0 as it empties", () => {
    expect(covers(crumbs(), FEE)).toBe(CAP);
    expect(covers({ ...crumbs(), bits: 0 }, FEE)).toBe(0);
    const thin = { ...crumbs(), bits: 30 };
    const n = covers(thin, FEE);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(CAP);
    expect(sellQuote(thin, n, FEE)).not.toBeNull();
    expect(sellQuote(thin, n + 1, FEE)).toBeNull();
  });

  it("respects a smaller cap", () => {
    expect(covers(crumbs(), FEE, 3)).toBe(3);
  });
});

describe("explainPrice, walked across a pool's whole range", () => {
  /** What each stock level must and must not say. */
  const STOCK_WORDS: Record<StockLevel, RegExp> = {
    out: /none left/,
    "nearly-out": /^Nearly out: /,
    low: /^Running low: /,
    under: /^\d+ left of the \d+ I opened with/,
    opening: /in stock, the same as when I opened\.$/,
    plenty: /^Plenty: /,
    overstocked: /^Overstocked: /,
  };

  for (const [name, make] of [
    ["a common", crumbs],
    ["an uncommon", seed],
    ["a rare", glider],
  ] as const) {
    it(`${name}: bought down to nothing, one at a time, the stock line's word always matches its numbers`, () => {
      const o = openingOf(make())!;
      for (let n = 0; n <= o.stock; n++) {
        const pool = bought(make(), n);
        const r = explain(pool);
        const level = stockLevel(pool.stock, o.stock);
        expect(r.stock).toBe(level);
        const all = [r.headline, ...r.reasons].join(" ");
        // The count and the opening count are always printed.
        if (pool.stock > 0) expect(all).toContain(`${pool.stock}`);
        expect(all).toContain(`${o.stock}`);
        if (level === "out") {
          expect(r.state).toBe("sold-out");
          continue;
        }
        expect(r.reasons[0], `${pool.stock} of ${o.stock}`).toMatch(STOCK_WORDS[level]);
        // "Running low" and "Nearly out" are never said above their thresholds.
        if (pool.stock * 2 > o.stock) expect(all).not.toMatch(/Running low|Nearly out|Heroes keep buying|Almost gone/);
        if (pool.stock * 5 > o.stock) expect(all).not.toMatch(/Nearly out|Almost gone/);
        expect(all).not.toMatch(/Plenty|Overstocked|drowning/);
      }
    });

    it(`${name}: sold to her until the till runs dry, the stock and till words always match their numbers`, () => {
      const o = openingOf(make())!;
      let pool = make();
      let steps = 0;
      const seen = new Set<string>();
      for (;;) {
        const r = explain(pool);
        const sLevel = stockLevel(pool.stock, o.stock);
        const canCover = covers(pool, FEE);
        const tLevel = tillLevel(pool.bits, o.bits, canCover);
        expect(r.stock).toBe(sLevel);
        expect(r.till).toBe(tLevel);
        expect(r.covers).toBe(canCover);
        seen.add(`${sLevel}/${tLevel}`);
        const all = [r.headline, ...r.reasons].join(" ");
        expect(all).toContain(pool.stock.toLocaleString("en-US"));
        expect(all).toContain(pool.bits.toLocaleString("en-US"));
        expect(all).not.toMatch(/Running low:|Nearly out|Heroes keep buying/);
        if (pool.stock * 10 <= o.stock * 15) expect(all).not.toMatch(/Overstocked|drowning/);
        if (tLevel === "empty") {
          expect(r.state).toBe("broke");
          expect(r.cantPay).toBe(true);
          expect(r.sellBlocked).not.toBeNull();
          break;
        }
        // While she can buy, she says what one pays and how many the till covers.
        const afford = r.reasons.find((line) => line.startsWith("Sell me one"))!;
        expect(afford).toContain(`I’ll pay ${sellQuote(pool, 1, FEE)!.net.toLocaleString("en-US")} Bit`);
        expect(afford).toMatch(canCover >= CAP ? new RegExp(`covers a full trade of ${CAP}\\.$`) : canCover === 1 ? /covers that one and no more\.$/ : new RegExp(`covers ${canCover} of yours and no more\\.$`));
        const tillLine = r.reasons[1]!;
        if (tLevel === "nearly-empty") expect(tillLine).toMatch(/^Till’s nearly empty: /);
        else if (tLevel === "low") expect(tillLine).toMatch(/^Till’s running low: /);
        else expect(tillLine).toMatch(/^My till for these holds /);
        if (pool.bits * 2 > o.bits) expect(all).not.toMatch(/Till’s (running low|nearly empty)/);
        pool = afterSell(pool, 1, sellPayout(pool, 1));
        if (++steps > 5_000) throw new Error("the till never ran dry");
      }
      // The walk passed through the middle of the range, not just its ends.
      expect(seen.has("opening/opening")).toBe(true);
      expect(seen.has("plenty/under")).toBe(true);
      expect([...seen].some((s) => s.startsWith("overstocked/"))).toBe(true);
      expect([...seen].some((s) => s.endsWith("/low") || s.endsWith("/nearly-empty"))).toBe(true);
    });
  }

  const table: { name: string; pool: () => Pool; state: string; stock: StockLevel; till: TillLevel; headline: RegExp; first: RegExp }[] = [
    { name: "stock 0", pool: () => bought(crumbs(), 40), state: "sold-out", stock: "out", till: "over", headline: /^Sold out\./, first: /^I opened with 40 and have none left/ },
    { name: "stock 0 and till 0", pool: () => ({ ...crumbs(), stock: 0, bits: 0 }), state: "sold-out", stock: "out", till: "empty", headline: /^Sold out\./, first: /^I opened with 40 and have none left/ },
    { name: "till 0 at opening stock", pool: () => ({ ...crumbs(), bits: 0 }), state: "broke", stock: "opening", till: "empty", headline: /^My till for these is tapped out\./, first: /my till for them holds 0, so I can’t buy more/ },
    { name: "till 0, stock above opening", pool: () => ({ ...crumbs(), stock: 90, bits: 0 }), state: "broke", stock: "overstocked", till: "empty", headline: /^My till for these is tapped out\./, first: /my till for them holds 0/ },
    { name: "the judge's 38 of 40", pool: () => bought(crumbs(), 2), state: "above", stock: "under", till: "over", headline: /^Up 5% since I opened\.$/, first: /^38 left of the 40 I opened with, so I’m asking 5% more than when I opened\.$/ },
    { name: "the judge's 23 of 40", pool: () => bought(crumbs(), 17), state: "above", stock: "under", till: "over", headline: /^Up \d+% since I opened\.$/, first: /^23 left of the 40 I opened with, so I’m asking \d+% more than when I opened\.$/ },
    { name: "the judge's 18 of 20", pool: () => bought(seed(), 2), state: "above", stock: "under", till: "over", headline: /^Up \d+% since I opened\.$/, first: /^18 left of the 20 I opened with, so I’m asking \d+% more than when I opened\.$/ },
    { name: "half gone", pool: () => bought(crumbs(), 20), state: "above", stock: "low", till: "over", headline: /^Up \d+% since I opened\. Heroes keep buying these\.$/, first: /^Running low: 20 left of the 40 I opened with, so I’m asking \d+% more than when I opened\.$/ },
    { name: "a fifth left", pool: () => bought(crumbs(), 32), state: "above", stock: "nearly-out", till: "over", headline: /^Up \d+% since I opened\. Almost gone\.$/, first: /^Nearly out: 8 left of the 40 I opened with, so I’m asking \d+% more than when I opened\.$/ },
    { name: "one left", pool: () => bought(glider(), 7), state: "above", stock: "nearly-out", till: "over", headline: /Almost gone\.$/, first: /^Nearly out: 1 left of the 8 I opened with/ },
    { name: "stock above opening", pool: () => sold(crumbs(), 5), state: "below", stock: "plenty", till: "under", headline: /^Down 11% since I opened\.$/, first: /^Plenty: I’m holding 45, 5 more than the 40 I opened with, so I’m asking 11% less\.$/ },
    { name: "stock far above opening", pool: () => sold(crumbs(), 30), state: "below", stock: "overstocked", till: "low", headline: /^Down \d+% since I opened\. I’m drowning in these\.$/, first: /^Overstocked: I’m holding 70, 30 more than the 40 I opened with, so I’m asking \d+% less\.$/ },
  ];
  it.each(table)("$name", ({ pool, state, stock, till, headline, first }) => {
    const r = explain(pool());
    expect(r).toMatchObject({ state, stock, till });
    expect(r.headline).toMatch(headline);
    expect(r.reasons[0]).toMatch(first);
  });
});

describe("explainPrice", () => {
  it("at the opening price: says so, with the stock and till she opened with, and what she'd pay", () => {
    const r = explain(crumbs());
    expect(r.state).toBe("opening");
    expect(r.headline).toBe("Opening price: 12.0 Bits. Not a gwei more.");
    expect(r.reasons).toEqual([
      "40 in stock, the same as when I opened.",
      "My till for these holds 480 Bits, the same as when I opened.",
      `Sell me one and I’ll pay ${sellQuote(crumbs(), 1, FEE)!.net} Bits after the gas fee. My till covers a full trade of 20.`,
    ]);
    expect(r).toMatchObject({ closed: false, soldOut: false, cantPay: false, stock: "opening", till: "opening", covers: 20, buyBlocked: null, sellBlocked: null });
  });

  it("above: one rare bought, so she asks more, without calling seven of eight “running low”", () => {
    const pool = bought(glider(), 1);
    const pct = Math.round(((spotMilli(pool) - 150_000) / 150_000) * 100);
    const r = explain(pool);
    expect(pct).toBe(14);
    expect(r.state).toBe("above");
    expect(r.headline).toBe("Up 14% since I opened.");
    expect(r.reasons.slice(0, 2)).toEqual([
      "7 left of the 8 I opened with, so I’m asking 14% more than when I opened.",
      `My till for these holds ${pool.bits.toLocaleString("en-US")} Bits, up from 1,200 at opening. Buyers paid in, and that lifts the price.`,
    ]);
    expect(r.buyBlocked).toBeNull();
    expect(r.sellBlocked).toBeNull();
  });

  it("below: players sold her five, so she has plenty and asks less", () => {
    const pool = sold(crumbs(), 5);
    const r = explain(pool);
    expect(pool.stock).toBe(45);
    expect(r.state).toBe("below");
    expect(r.headline).toBe("Down 11% since I opened.");
    expect(r.reasons.slice(0, 2)).toEqual([
      "Plenty: I’m holding 45, 5 more than the 40 I opened with, so I’m asking 11% less.",
      `My till for these holds ${pool.bits} Bits, down from 480 at opening. I paid sellers out, and that lowers the price.`,
    ]);
  });

  it("a thin till: she says how few she can still pay for", () => {
    const pool = { ...sold(crumbs(), 30), bits: 30 };
    const n = covers(pool, FEE);
    const r = explain(pool);
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(CAP);
    expect(r.till).toBe("nearly-empty");
    expect(r.reasons[1]).toBe("Till’s nearly empty: 30 Bits left of the 480 I opened with. I paid sellers out, and that lowers the price.");
    expect(r.reasons[2]).toBe(`Sell me one and I’ll pay ${sellQuote(pool, 1, FEE)!.net} Bits after the gas fee. My till covers ${n} of yours and no more.`);
  });

  it("a small move is stated without a remark", () => {
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
      `Sell me one and I’ll pay ${sellQuote(pool, 1, FEE)!.net} Bits after the gas fee. My till covers a full trade of 20.`,
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
    expect(r.covers).toBe(0);
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
    expect(r.covers).toBe(0);
    expect(r.headline).toBe("Stall’s closed. Even a gwei counter takes a break.");
    expect(r.reasons[0]).toBe("The market is switched off, so I’m not buying or selling right now.");
    expect(r.reasons[1]).toMatch(/^Last price: \d+ Bits, with 0 in stock\.$/);
    expect(r.buyBlocked).toBe("The stall is closed, so Gwei isn’t selling right now.");
    expect(r.sellBlocked).toBe("The stall is closed, so Gwei isn’t buying right now.");
  });

  it("mentions the last 24 hours only when the caller has that history, and never “1 trades”", () => {
    const pool = bought(crumbs(), 3);
    expect(explain(pool).reasons).toHaveLength(3);
    expect(explain(pool, { change24h: null }).reasons).toHaveLength(3);
    expect(explain(pool, { trades24h: 3, change24h: 0.08 }).reasons[3]).toBe("3 trades with me in the last 24 hours moved the price +8%.");
    expect(explain(pool, { trades24h: 1, change24h: -0.031 }).reasons[3]).toBe("1 trade with me in the last 24 hours moved the price −3%.");
    expect(explain(pool, { trades24h: 2, change24h: 0 }).reasons[3]).toBe("2 trades with me in the last 24 hours, and the price is back where it was.");
    expect(explain(pool, { trades24h: 4, change24h: null }).reasons[3]).toBe("4 trades with me in the last 24 hours. Every one moved the price.");
    expect(explain(pool, { trades24h: 0, change24h: 0 }).reasons[3]).toBe("Nobody’s traded these with me in the last 24 hours, so the price hasn’t moved.");
    // The economy lab knows a day's change but not its trades per item.
    expect(explain(pool, { change24h: 0.06 }).reasons[3]).toBe("Up 6% in the last 24 hours.");
    expect(explain(pool, { change24h: -0.11 }).reasons[3]).toBe("Down 11% in the last 24 hours.");
  });

  it("without a known opening, only says what she holds now", () => {
    const pool = { ...bought(crumbs(), 4), item: "mystery" };
    const r = explain(pool);
    expect(r.state).toBe("opening");
    expect(r).toMatchObject({ stock: null, till: null });
    expect(r.headline).toMatch(/^\d+\.\d Bits\. I counted it in gwei twice\.$/);
    expect(r.reasons).toEqual([
      "I’m holding 36, and the price follows what I hold.",
      `My till for these holds ${pool.bits} Bits.`,
      `Sell me one and I’ll pay ${sellQuote(pool, 1, FEE)!.net} Bits after the gas fee. My till covers a full trade of 20.`,
    ]);
  });

  it("the trade cap she quotes is the market's own", () => {
    expect(explain(crumbs(), { maxAmount: 5 }).reasons[2]).toMatch(/My till covers a full trade of 5\.$/);
  });

  it("every number she says is in the pool, its opening or its quotes; two to four reasons, sentence case, curly quotes", () => {
    const pools = [
      crumbs(),
      glider(),
      bought(crumbs(), 12),
      bought(crumbs(), 25),
      bought(glider(), 7),
      bought(glider(), 8),
      sold(crumbs(), 30),
      sold(crumbs(), 10_000),
      sold(glider(), 3),
      { ...crumbs(), bits: 0 },
      { ...crumbs(), stock: 0, bits: 0 },
      { ...sold(crumbs(), 30), bits: 30 },
    ];
    for (const pool of pools) {
      for (const open of [true, false]) {
        const r = explain(pool, { open });
        const o = openingOf(pool)!;
        const price = spotMilli(pool);
        const pct = Math.round((Math.abs(price - o.priceMilli) / o.priceMilli) * 100);
        const allowed = new Set(
          [pool.stock, pool.bits, o.stock, o.bits, Math.abs(pool.stock - o.stock), pct, sellPayout(pool, 1), sellQuote(pool, 1, FEE)?.net, buyQuote(pool, 1, FEE)?.total, covers(pool, FEE), CAP]
            .filter((n): n is number => n !== undefined)
            .map(String),
        );
        // A price prints with up to two decimals: allow it whole, to one and to two places.
        for (const d of [0, 1, 2]) allowed.add((price / 1000).toFixed(d));
        allowed.add((o.priceMilli / 1000).toFixed(1));
        expect(r.reasons.length).toBeGreaterThanOrEqual(2);
        expect(r.reasons.length).toBeLessThanOrEqual(4);
        for (const line of [r.headline, ...r.reasons]) {
          expect(line).not.toMatch(/['"]/);
          expect(line[0]).toBe(line[0]!.toUpperCase());
          for (const n of line.replace(/,/g, "").match(/\d+(\.\d+)?/g) ?? []) expect(allowed, `“${line}” says ${n}`).toContain(n);
        }
      }
    }
  });
});
