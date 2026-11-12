/**
 * Sandwich Man's rules, one by one: what fires, what doesn't, the caps, the closed shop,
 * and that nothing he decides is ever refused by the market's own rules (the engine that
 * mirrors the contract check for check).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Economy } from "./bots";
import { BITS_TOKEN, DEFAULT_PARAMS, itemToken, seededPools } from "./config";
import { listItem, marketBuy, marketSell, memoryLedger, newBook, type MarketBook } from "./engine";
import { sellQuote, spotMilli } from "./math";
import { newBooks, reconcile, type NpcBooks } from "./npc-book";
import { budgetLeft, decide, NPC_RULE_LINES, NPC_RULES, npcStatus, openingMilli, SHOP_LEVELS, type NpcAction } from "./npc-rules";
import { actOnBook, npcTurn, walletOnBook } from "./npc-turn";

const ME = "sandwich.test";
const NOW = Date.UTC(2026, 10, 12, 12);
const HOUR = 3_600_000;
const R = NPC_RULES;

/** A fresh market with Sandwich Man and a few players holding what a test needs. */
function world(start: { bits?: number; items?: Record<string, number>; players?: Record<string, Record<string, number>>; params?: Partial<typeof DEFAULT_PARAMS> } = {}) {
  const book = newBook({ ...DEFAULT_PARAMS, ...start.params }, seededPools());
  const balances: Record<string, Record<string, number>> = { [ME]: { [BITS_TOKEN]: start.bits ?? 300 } };
  for (const [item, n] of Object.entries(start.items ?? {})) balances[ME]![itemToken(item)] = n;
  for (const [who, held] of Object.entries(start.players ?? {})) {
    balances[who] = {};
    for (const [k, n] of Object.entries(held)) balances[who]![k === "bits" ? BITS_TOKEN : itemToken(k)] = n;
  }
  const ledger = memoryLedger(balances);
  let books: NpcBooks = newBooks();
  const w = {
    book,
    ledger,
    get books() {
      return books;
    },
    set books(b: NpcBooks) {
      books = b;
    },
    /** His wallet with the books brought up to date, as every look starts. */
    wallet(now = NOW) {
      const first = walletOnBook(book, ledger, ME, books, now);
      const seen = reconcile(first.books, first, book.listings, book.pools, book.params.feeBps, now, false, SHOP_LEVELS);
      return { ...first, books: seen.books };
    },
    decide(now = NOW): NpcAction[] {
      return decide(book, w.wallet(now), book.listings, now);
    },
    /** One whole turn, keeping the books. */
    turn(now = NOW) {
      const t = npcTurn(book, ledger, ME, books, now);
      books = t.books;
      return t;
    },
  };
  return w;
}

/** Pushes an item's price down by having a player sell `n` to Gwei. */
function dump(book: MarketBook, ledger: ReturnType<typeof memoryLedger>, item: string, n: number) {
  ledger.credit("dumper", itemToken(item), n);
  marketSell(book, ledger, "dumper", item, n, 0, NOW);
}

describe("the rules written at the top of npc-rules.ts", () => {
  const header = readFileSync(fileURLToPath(new URL("./npc-rules.ts", import.meta.url)), "utf8").split("*/")[0]!.replace(/\s*\n \*\s*/g, " ");

  it("quote the numbers he really trades on", () => {
    expect(header).toContain(`has sat for ${R.staleListingHours} hours`);
    expect(header).toContain(`at least ${R.flipMarginBps / 100}% more for the same lot right now (and at least ${R.flipMinBits} Bit more)`);
    expect(header).toContain(`when she pays at least ${R.profitBps / 100}% more than they cost him`);
    expect(header).toContain(`lists up to ${R.listLot} of an item at ${R.undercutBps / 100}% under what she charges`);
    expect(header).toContain(`still ${R.profitBps / 100}% over his cost`);
    expect(header).toContain(`he asks ${R.soldOutMarkupBps / 100}% over her spot price`);
    expect(header).toContain(`He buys ${R.dipLot} of an item from Gwei when its price is under ${R.dipBps / 100}% of its opening price`);
    expect(header).toContain(`he sells up to ${R.clearanceLot} of whatever loses him least`);
    expect(header).toContain(`Spend more than ${R.dailySpendBps / 100}% of the Bits he started the day with`);
    expect(header).toContain(`Take more than ${R.maxActionsPerDay} actions a day`);
    expect(header).toContain(`Hold more than ${R.inventoryCap} of any item`);
    expect(header).toContain(`more per item than ${R.maxPayBps / 100}% of its opening price`);
    expect(header).toContain(`sold her in the last ${R.roundTripHours} hours`);
    expect(header).toContain(`Under ${R.closeBelowBits} Bits he closes shop`);
    expect(header).toContain(`until he is back to ${R.reopenAtBits} Bits`);
  });

  it("stay inside the contract's own daily caps", () => {
    const p = DEFAULT_PARAMS;
    // Every action is at most one vendor trade, one listing or one fill.
    expect(R.maxActionsPerDay).toBeLessThanOrEqual(Math.min(p.dailyTrades, p.dailyListings, p.dailyFills));
    expect((R.seedBits * R.dailySpendBps) / 10_000).toBeLessThan(p.dailyFillBits);
    expect(Math.max(R.listLot, R.dipLot, R.clearanceLot, R.inventoryCap)).toBeLessThanOrEqual(p.maxAmount);
    expect(NPC_RULE_LINES.length).toBeGreaterThan(4);
  });
});

describe("rule 2: flip a cheap listing", () => {
  it("buys a listing Gwei would pay 10% more for, and says why", () => {
    const w = world({ players: { "azalleaxyz.wgpnear.near": { crumbs: 2 } } });
    const listing = listItem(w.book, w.ledger, "azalleaxyz.wgpnear.near", "crumbs", 2, 13, NOW - HOUR);
    const gweiPays = sellQuote(w.book.pools.find((p) => p.item === "crumbs")!, 2, 200)!.net;
    const [a] = w.decide();
    expect(a).toMatchObject({ kind: "fill", rule: 2, listingId: listing.id, item: "crumbs", amount: 2, price: 13 });
    expect(`${a!.text}: ${a!.reason}`).toBe(`Bought 2 × Crumbs from azalleaxyz’s listing at 13 Bits: Gwei pays ${gweiPays}. Lunch money.`);

    const t = w.turn();
    expect(t.refused).toBeNull();
    // The seller is paid their asking price less the gas fee, like any fill.
    expect(w.ledger.balance("azalleaxyz.wgpnear.near", BITS_TOKEN)).toBe(13 - 1);
    expect(w.ledger.balance(ME, itemToken("crumbs"))).toBe(2);
    expect(w.ledger.balance(ME, BITS_TOKEN)).toBe(300 - 13);
    expect(w.books.lots.crumbs).toEqual({ units: 2, cost: 13 });
    expect(w.books.spent).toBe(13);
  });

  it("leaves a listing with too thin a margin", () => {
    const w = world({ players: { p: { crumbs: 2 } } });
    // Gwei pays 22 for two; 21 leaves under 10%.
    listItem(w.book, w.ledger, "p", "crumbs", 2, 21, NOW);
    expect(w.decide().filter((a) => a.kind === "fill")).toEqual([]);
  });

  it("takes the listing with the most in it first", () => {
    const w = world({ players: { p: { crumbs: 2, "sybil-goo": 1 } } });
    listItem(w.book, w.ledger, "p", "crumbs", 2, 14, NOW);
    const goo = listItem(w.book, w.ledger, "p", "sybil-goo", 1, 22, NOW);
    expect(w.decide()[0]).toMatchObject({ kind: "fill", listingId: goo.id });
  });

  it("never buys his own listing", () => {
    const w = world({ items: { crumbs: 2 } });
    listItem(w.book, w.ledger, ME, "crumbs", 2, 13, NOW);
    expect(w.decide().filter((a) => a.kind === "fill")).toEqual([]);
  });

  it("doesn't buy when Gwei's till couldn't pay him for it", () => {
    const w = world({ players: { p: { crumbs: 2 } } });
    const i = w.book.pools.findIndex((p) => p.item === "crumbs");
    w.book.pools[i] = { ...w.book.pools[i]!, bits: 5 };
    listItem(w.book, w.ledger, "p", "crumbs", 2, 13, NOW);
    expect(w.decide().filter((a) => a.kind === "fill")).toEqual([]);
  });

  it("respects the contract's daily fill caps and his own Bits", () => {
    const list = (w: ReturnType<typeof world>) => listItem(w.book, w.ledger, "p", "crumbs", 2, 13, NOW);
    const noFills = world({ players: { p: { crumbs: 2 } } });
    list(noFills);
    noFills.book.accounts[ME] = { day: Math.floor(NOW / 86_400_000), trades: 0, listings: 0, fills: DEFAULT_PARAMS.dailyFills, fillBits: 0, open: [] };
    expect(noFills.decide()).toEqual([]);

    const noFillBits = world({ players: { p: { crumbs: 2 } } });
    list(noFillBits);
    noFillBits.book.accounts[ME] = { day: Math.floor(NOW / 86_400_000), trades: 0, listings: 0, fills: 0, fillBits: DEFAULT_PARAMS.dailyFillBits - 12, open: [] };
    expect(noFillBits.decide()).toEqual([]);
  });

  it("won't pay over 150% of an item's opening price, even when Gwei's price says it's a bargain", () => {
    const w = world({ players: { p: { crumbs: 1, bits: 5_000 } } });
    // A player pumps Gwei's crumbs price, then lists one under her inflated sell-back.
    marketBuy(w.book, w.ledger, "p", "crumbs", 20, 5_000, NOW);
    marketBuy(w.book, w.ledger, "p", "crumbs", 15, 5_000, NOW);
    const pool = w.book.pools.find((p) => p.item === "crumbs")!;
    const pays = sellQuote(pool, 1, 200)!.net;
    expect(pays).toBeGreaterThan(30);
    listItem(w.book, w.ledger, "p", "crumbs", 1, pays - 5, NOW);
    expect(w.decide().filter((a) => a.kind === "fill")).toEqual([]);
  });
});

describe("rule 3: cash out to Gwei", () => {
  it("sells what he flipped, with his margin as the contract's limit", () => {
    const w = world({ players: { p: { crumbs: 2 } } });
    listItem(w.book, w.ledger, "p", "crumbs", 2, 13, NOW);
    w.turn();
    const [a] = w.decide(NOW + 60_000);
    expect(a).toMatchObject({ kind: "sell", rule: 3, item: "crumbs", amount: 2, expectBits: 22 });
    // 13 Bits of cost needs at least 15 back; the limit never drops under that.
    expect(a!.kind === "sell" && a.minBits).toBeGreaterThanOrEqual(15);
    expect(a!.reason).toContain("Cost me 13.");
    const t = w.turn(NOW + 60_000);
    expect(t.refused).toBeNull();
    expect(w.ledger.balance(ME, BITS_TOKEN)).toBe(300 - 13 + 22);
    expect(w.books.lots.crumbs).toBeUndefined();
  });

  it("holds when Gwei pays less than 10% over his cost", () => {
    const w = world({ items: { crumbs: 2 } });
    w.books = { ...newBooks(), lots: { crumbs: { units: 2, cost: 21 } } };
    expect(w.decide().filter((a) => a.kind === "sell")).toEqual([]);
  });
});

describe("rule 4: undercut Gwei", () => {
  it("lists under her price when her sell-back isn't enough, inside the contract's bounds", () => {
    const w = world({ items: { crumbs: 2 } });
    // Cost 21: Gwei pays 22 (under 10%), but she charges 26 for two, so 24 is 6% under and over cost.
    w.books = { ...newBooks(), lots: { crumbs: { units: 2, cost: 21 } } };
    const [a] = w.decide();
    expect(a).toMatchObject({ kind: "list", rule: 4, item: "crumbs", amount: 2, price: 24 });
    expect(a!.reason).toBe("Gwei wants 26 for the same. I’m in front of her, as usual.");
    expect(w.turn().refused).toBeNull();
    expect(w.book.listings).toHaveLength(1);
    // One listing per item: nothing more to list.
    expect(w.decide()).toEqual([]);
  });

  it("asks over spot when Gwei is sold out", () => {
    const w = world({ items: { "goblin-glider": 1 } });
    const i = w.book.pools.findIndex((p) => p.item === "goblin-glider");
    w.book.pools[i] = { ...w.book.pools[i]!, stock: 0, bits: 0 };
    const spot = spotMilli(w.book.pools[i]!);
    const a = w.decide().find((x) => x.kind === "list");
    expect(a).toMatchObject({ kind: "list", item: "goblin-glider", amount: 1, price: Math.floor((spot * 1.25) / 1000) });
    expect(a!.reason).toBe("Gwei’s sold out. I’m not.");
  });

  it("stops at the contract's open-listing cap and daily listing cap", () => {
    const w = world({ items: { crumbs: 2, "fee-bomb": 2, "chain-link": 2, "sybil-goo": 2 } });
    w.books = { ...newBooks(), lots: Object.fromEntries(["crumbs", "fee-bomb", "chain-link"].map((i) => [i, { units: 2, cost: 21 }])) };
    w.books.lots["sybil-goo"] = { units: 2, cost: 70 };
    for (let i = 0; i < DEFAULT_PARAMS.maxOpenListings; i++) expect(w.turn(NOW + i * 1_000).action?.kind).toBe("list");
    expect(w.book.listings).toHaveLength(DEFAULT_PARAMS.maxOpenListings);
    expect(w.decide(NOW + 10_000).filter((a) => a.kind === "list")).toEqual([]);

    const capped = world({ items: { crumbs: 2 } });
    capped.books = { ...newBooks(), lots: { crumbs: { units: 2, cost: 21 } } };
    capped.book.accounts[ME] = { day: Math.floor(NOW / 86_400_000), trades: 0, listings: DEFAULT_PARAMS.dailyListings, fills: 0, fillBits: 0, open: [] };
    expect(capped.decide()).toEqual([]);
  });
});

describe("rule 5: buy the dip", () => {
  it("buys 2 from Gwei when a price is under 85% of its opening price", () => {
    const w = world();
    expect(w.decide()).toEqual([]);
    dump(w.book, w.ledger, "crumbs", 12);
    const pool = w.book.pools.find((p) => p.item === "crumbs")!;
    expect(spotMilli(pool)).toBeLessThan(openingMilli("crumbs")! * 0.85);
    const [a] = w.decide();
    expect(a).toMatchObject({ kind: "buy", rule: 5, item: "crumbs", amount: 2 });
    expect(a!.reason).toMatch(/^\d+% under the opening price\. First in line for the dip\.$/);
    const t = w.turn();
    expect(t.refused).toBeNull();
    expect(w.ledger.balance(ME, itemToken("crumbs"))).toBe(2);
  });

  it("stops at his inventory cap", () => {
    const w = world({ items: { crumbs: R.inventoryCap - 1 } });
    dump(w.book, w.ledger, "crumbs", 16);
    expect(w.decide().filter((a) => a.kind === "buy")).toEqual([]);
  });

  it("doesn't buy back from Gwei what he sold her in the last 72 hours", () => {
    const w = world();
    dump(w.book, w.ledger, "crumbs", 12);
    w.books = { ...newBooks(), soldToGwei: { crumbs: NOW - 71 * HOUR } };
    expect(w.decide()).toEqual([]);
    w.books = { ...newBooks(), soldToGwei: { crumbs: NOW - 73 * HOUR } };
    expect(w.decide()[0]).toMatchObject({ kind: "buy", item: "crumbs" });
  });
});

describe("rule 1: stale listings", () => {
  it("takes a listing down after 48 hours, and prices it again", () => {
    const w = world({ items: { crumbs: 2 } });
    w.books = { ...newBooks(), lots: { crumbs: { units: 2, cost: 21 } } };
    w.turn(NOW);
    expect(w.decide(NOW + 47 * HOUR)).toEqual([]);
    const later = NOW + 49 * HOUR;
    expect(w.decide(later)[0]).toMatchObject({ kind: "cancel", rule: 1, item: "crumbs", amount: 2 });
    expect(w.turn(later).refused).toBeNull();
    expect(w.book.listings).toHaveLength(0);
    expect(w.ledger.balance(ME, itemToken("crumbs"))).toBe(2);
    expect(w.books.lots.crumbs).toEqual({ units: 2, cost: 21 });
  });
});

describe("the caps", () => {
  it("never spends more than 35% of the day's opening Bits", () => {
    const w = world({ bits: 100, players: { p: { crumbs: 6 } } });
    for (const price of [13, 14, 15]) listItem(w.book, w.ledger, "p", "crumbs", 2, price, NOW);
    let spent = 0;
    for (let i = 0; i < 6; i++) {
      const t = w.turn(NOW + i * 60_000);
      if (t.action?.kind === "fill") spent += t.action.price;
    }
    // 35 Bits to spend: 13 and 14 fit, then 15 doesn't.
    expect(spent).toBe(27);
    expect(budgetLeft(w.wallet().books)).toBe(8);
    expect(w.book.listings.map((l) => l.price)).toEqual([15]);
    // A new UTC day, a new budget from what he holds then.
    expect(w.decide(NOW + 24 * HOUR).some((a) => a.kind === "fill")).toBe(true);
  });

  it("takes at most 10 actions a day, refused ones included", () => {
    const w = world();
    w.books = { ...newBooks(), day: Math.floor(NOW / 86_400_000), actions: R.maxActionsPerDay, dayStartBits: 300 };
    dump(w.book, w.ledger, "crumbs", 12);
    expect(w.decide()).toEqual([]);
    expect(npcStatus(w.book, w.wallet(), NOW)).toBe("resting");
    expect(w.decide(NOW + 24 * HOUR)).not.toEqual([]);
  });

  it("does nothing while the market is closed", () => {
    const w = world({ params: { open: false }, items: { crumbs: 2 } });
    expect(w.decide()).toEqual([]);
    expect(npcStatus(w.book, w.wallet(), NOW)).toBe("market-closed");
  });
});

describe("broke: he closes shop", () => {
  it("buys nothing under 60 Bits, whatever is on offer", () => {
    const w = world({ bits: 59, players: { p: { crumbs: 2 } } });
    listItem(w.book, w.ledger, "p", "crumbs", 2, 13, NOW);
    dump(w.book, w.ledger, "fee-bomb", 12);
    expect(w.decide()).toEqual([]);
    expect(npcStatus(w.book, w.wallet(), NOW)).toBe("closed-shop");
  });

  it("holds a clearance sale, then reopens only once he is back to 120 Bits", () => {
    const w = world({ bits: 40, items: { "sybil-goo": 4 } });
    // He paid well over today's price: no sale clears his margin.
    w.books = { ...newBooks(), lots: { "sybil-goo": { units: 4, cost: 400 } } };
    const [a] = w.decide();
    expect(a).toMatchObject({ kind: "sell", rule: 6, item: "sybil-goo", amount: R.clearanceLot });
    expect(a!.reason).toContain("Clearance");
    w.turn(NOW);
    // 40 + about 70: still under 120, so still closed and still clearing.
    expect(w.ledger.balance(ME, BITS_TOKEN)).toBeGreaterThan(R.closeBelowBits);
    expect(w.ledger.balance(ME, BITS_TOKEN)).toBeLessThan(R.reopenAtBits);
    expect(npcStatus(w.book, w.wallet(NOW + 60_000), NOW + 60_000)).toBe("closed-shop");
    expect(w.turn(NOW + 60_000).action).toMatchObject({ kind: "sell", rule: 6 });
    expect(w.ledger.balance(ME, BITS_TOKEN)).toBeGreaterThanOrEqual(R.reopenAtBits);
    expect(npcStatus(w.book, w.wallet(NOW + 120_000), NOW + 120_000)).toBe("open");
    // Open again, and no clearance: nothing left that he'd sell at a loss.
    expect(w.decide(NOW + 120_000).filter((x) => x.rule === 6)).toEqual([]);
  });

  it("never holds a clearance sale while he's open", () => {
    const w = world({ bits: 200, items: { "sybil-goo": 4 } });
    w.books = { ...newBooks(), lots: { "sybil-goo": { units: 4, cost: 400 } } };
    expect(w.decide()).toEqual([]);
  });
});

describe("his books follow his wallet", () => {
  it("books a listing a player bought as a sale, with what it cleared", () => {
    const w = world({ items: { crumbs: 2 }, players: { buyer: { bits: 100 } } });
    w.books = { ...newBooks(), lots: { crumbs: { units: 2, cost: 21 } } };
    const listed = w.turn(NOW).action;
    expect(listed).toMatchObject({ kind: "list", price: 24 });
    actOnBook(w.book, w.ledger, "buyer", { kind: "fill", rule: 2, listingId: w.book.listings[0]!.id, item: "crumbs", amount: 2, price: 24, seller: ME, text: "", reason: "" }, NOW + 1_000);
    const t = w.turn(NOW + 60_000);
    expect(t.events[0]).toMatchObject({ kind: "sold", item: "crumbs", amount: 2, bits: 23 });
    expect(t.events[0]!.text).toBe("A player bought my 2 × Crumbs listing for 24 Bits");
    expect(w.books.lots.crumbs).toBeUndefined();
    expect(w.books.listed).toEqual([]);
  });

  it("books items he was given (the owner's seed) at Gwei's price", () => {
    const w = world({ items: { crumbs: 3 } });
    expect(w.wallet().books.lots.crumbs).toEqual({ units: 3, cost: 36 });
  });
});

describe("decide", () => {
  it("is deterministic: the same inputs give the same answer", () => {
    const build = () => {
      const w = world({ players: { p: { crumbs: 2 } } });
      listItem(w.book, w.ledger, "p", "crumbs", 2, 13, NOW);
      dump(w.book, w.ledger, "fee-bomb", 12);
      return w;
    };
    const a = build();
    const wallet = a.wallet();
    const before = JSON.stringify([a.book, wallet]);
    const first = decide(a.book, wallet, a.book.listings, NOW);
    expect(decide(a.book, wallet, a.book.listings, NOW)).toEqual(first);
    expect(build().decide()).toEqual(first);
    // And it only reads: nothing it was given has changed.
    expect(JSON.stringify([a.book, wallet])).toBe(before);
    expect(first.map((x) => x.kind)).toEqual(["fill", "buy"]);
  });

  it("never sends the market a call it refuses: every candidate goes through, across 40 fast-forwards", () => {
    let turns = 0;
    let closed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const e = new Economy({ days: 21, bots: 40 + (seed % 3) * 20, seed, params: { craftBits: seed % 2 ? 25 : 0 } });
      while (!e.done) e.step();
      for (const d of e.history) {
        expect(d.npc!.refused).toBe(0);
        turns += d.npc!.events.length;
        if (d.npc!.closed) closed += 1;
        expect(d.npc!.bits).toBeGreaterThanOrEqual(0);
        // At most 10 of his own actions a day; sales of his listings are other people's.
        expect(d.npc!.events.filter((x) => x.kind !== "sold").length).toBeLessThanOrEqual(R.maxActionsPerDay);
      }
    }
    expect(turns).toBeGreaterThan(200);
    // He does go broke in some of them.
    expect(closed).toBeGreaterThan(0);
  });

  it("can be switched off in the fast-forward", () => {
    const e = new Economy({ days: 3, bots: 20, seed: 5, npc: false });
    while (!e.done) e.step();
    expect(e.history.every((d) => d.npc === null)).toBe(true);
  });
});
