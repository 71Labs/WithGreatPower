/**
 * The market state machine against the contract's own unit tests
 * (contracts/wgp/src/market_tests.rs): the same trades give the same numbers, and the
 * same guards refuse the same things.
 */
import { describe, expect, it } from "vitest";

import { BITS_TOKEN, DEFAULT_PARAMS, seededPools, type MarketParams } from "./config";
import { buyListing, cancelListing, listItem, marketBuy, marketSell, memoryLedger, newBook, MarketError, accountToday, type MarketBook } from "./engine";
import { spotMilli } from "./math";

const DAY = 86_400_000;
const NOW = 20_000 * DAY + 1;

function book(params: Partial<MarketParams> = {}): MarketBook {
  return newBook({ ...DEFAULT_PARAMS, ...params }, seededPools());
}

function code(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof MarketError) return e.code;
    throw e;
  }
  throw new Error("expected a MarketError");
}

describe("vendor trades", () => {
  it("prices a buy exactly as the contract does", () => {
    const b = book();
    const l = memoryLedger({ alice: { [BITS_TOKEN]: 100 } });
    const t = marketBuy(b, l, "alice", "crumbs", 3, 39, NOW);
    // market_tests.rs a_buy_moves_bits_and_items_and_burns_the_fee: 38 + 1 fee, spot 12.961.
    expect([t.bits, t.fee, spotMilli(t.pool)]).toEqual([39, 1, 12_961]);
    expect(l.balance("alice", BITS_TOKEN)).toBe(61);
    expect(l.balance("alice", "item:crumbs")).toBe(3);
    expect(b.burned).toBe(1);
  });

  it("moves the price with the players and keeps slippage limits", () => {
    const b = book();
    const l = memoryLedger({ alice: { [BITS_TOKEN]: 1_000, "item:crumbs": 20 } });
    const start = spotMilli(b.pools.find((p) => p.item === "crumbs")!);
    marketBuy(b, l, "alice", "crumbs", 10, 1_000, NOW);
    const up = spotMilli(b.pools.find((p) => p.item === "crumbs")!);
    expect(up).toBeGreaterThan(start);
    expect(code(() => marketSell(b, l, "alice", "crumbs", 20, 1_000_000, NOW))).toBe("slippage");
    marketSell(b, l, "alice", "crumbs", 20, 0, NOW);
    expect(spotMilli(b.pools.find((p) => p.item === "crumbs")!)).toBeLessThan(start);
    expect(code(() => marketBuy(b, l, "alice", "crumbs", 3, 1, NOW))).toBe("slippage");
  });

  it("sells only stock, pays only from the till, and refuses what it doesn't trade", () => {
    const b = book({ maxAmount: 1_000 });
    const l = memoryLedger({ alice: { [BITS_TOKEN]: 1_000_000, "item:goblin-glider": 500 } });
    expect(code(() => marketBuy(b, l, "alice", "goblin-glider", 9, 1e9, NOW))).toBe("stock");
    expect(code(() => marketSell(b, l, "alice", "goblin-glider", 500, 0, NOW))).toBe("till");
    expect(code(() => marketBuy(b, l, "alice", "bits", 1, 1e9, NOW))).toBe("unknown_item");
    expect(code(() => marketBuy(book(), l, "alice", "crumbs", 21, 1e9, NOW))).toBe("amount");
    expect(code(() => marketBuy(book({ open: false }), l, "alice", "crumbs", 1, 1e9, NOW))).toBe("closed");
    const poor = memoryLedger({ bob: { [BITS_TOKEN]: 5 } });
    expect(code(() => marketBuy(book(), poor, "bob", "crumbs", 1, 100, NOW))).toBe("funds");
  });
});

describe("listings", () => {
  it("escrows, cancels and fills like the contract", () => {
    const b = book();
    const l = memoryLedger({ alice: { "item:crumbs": 5 }, bob: { [BITS_TOKEN]: 50 } });
    const first = listItem(b, l, "alice", "crumbs", 4, 40, NOW);
    expect(l.balance("alice", "item:crumbs")).toBe(1);
    expect(b.pools.find((p) => p.item === "crumbs")!.escrow).toBe(4);
    cancelListing(b, l, "alice", first.id);
    expect(l.balance("alice", "item:crumbs")).toBe(5);
    const second = listItem(b, l, "alice", "crumbs", 4, 40, NOW);
    const fill = buyListing(b, l, "bob", second.id, NOW);
    expect(fill.fee).toBe(1);
    expect(l.balance("bob", "item:crumbs")).toBe(4);
    expect(l.balance("bob", BITS_TOKEN)).toBe(10);
    expect(l.balance("alice", BITS_TOKEN)).toBe(39);
    expect(b.listings).toHaveLength(0);
    expect(b.accounts.alice!.open).toEqual([]);
  });

  it("keeps prices between the floor and the ceiling", () => {
    const l = memoryLedger({ alice: { "item:crumbs": 10 } });
    for (const [price, ok] of [
      [11, false],
      [12, true],
      [96, true],
      [97, false],
    ] as const) {
      const b = book();
      if (ok) expect(listItem(b, l, "alice", "crumbs", 2, price, NOW).price).toBe(price);
      else expect(code(() => listItem(b, l, "alice", "crumbs", 2, price, NOW))).toBe("price");
    }
  });

  it("refuses your own listing, other people's cancels and gone listings", () => {
    const b = book();
    const l = memoryLedger({ alice: { "item:crumbs": 3 }, bob: { [BITS_TOKEN]: 5 } });
    const x = listItem(b, l, "alice", "crumbs", 2, 20, NOW);
    expect(code(() => buyListing(b, l, "alice", x.id, NOW))).toBe("own");
    expect(code(() => cancelListing(b, l, "bob", x.id))).toBe("not_seller");
    expect(code(() => buyListing(b, l, "bob", x.id, NOW))).toBe("funds");
    expect(code(() => buyListing(b, l, "bob", 999, NOW))).toBe("gone");
  });

  it("caps open listings per account and overall", () => {
    const b = book({ maxListings: 4 });
    const l = memoryLedger({ alice: { "item:crumbs": 10 }, bob: { "item:crumbs": 10 } });
    for (let i = 0; i < 3; i++) listItem(b, l, "alice", "crumbs", 1, 10, NOW);
    expect(code(() => listItem(b, l, "alice", "crumbs", 1, 10, NOW))).toBe("open_cap");
    listItem(b, l, "bob", "crumbs", 1, 10, NOW);
    expect(code(() => listItem(b, l, "bob", "crumbs", 1, 10, NOW))).toBe("full");
  });
});

describe("daily caps", () => {
  it("count per UTC day and reset at midnight", () => {
    const b = book({ dailyTrades: 2, dailyFills: 2, dailyFillBits: 50, maxOpenListings: 10 });
    const l = memoryLedger({ alice: { [BITS_TOKEN]: 1_000, "item:crumbs": 10 }, bob: { "item:crumbs": 10 } });
    marketBuy(b, l, "alice", "crumbs", 1, 100, NOW);
    marketBuy(b, l, "alice", "crumbs", 1, 100, NOW);
    expect(code(() => marketSell(b, l, "alice", "crumbs", 1, 0, NOW))).toBe("daily_cap");
    const a = listItem(b, l, "bob", "crumbs", 1, 20, NOW);
    const c = listItem(b, l, "bob", "crumbs", 2, 40, NOW);
    buyListing(b, l, "alice", a.id, NOW);
    expect(code(() => buyListing(b, l, "alice", c.id, NOW))).toBe("daily_cap");
    expect(accountToday(b, "alice", NOW + DAY)).toMatchObject({ trades: 0, fills: 0, fillBits: 0 });
    marketSell(b, l, "alice", "crumbs", 1, 0, NOW + DAY);
    buyListing(b, l, "alice", c.id, NOW + DAY);
  });
});
