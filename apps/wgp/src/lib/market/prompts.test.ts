/**
 * The trade prompts' logic: which one step a player is offered for what they hold, the
 * recipes and the pools, at the contract's own quotes; the deep links; and the market's
 * one line.
 */
import { describe, expect, it } from "vitest";

import type { ItemId } from "@wgp/game-core/types";

import type { MarketItemView } from "./api";
import { DEFAULT_PARAMS, seededPools } from "./config";
import { afterBuy, buyCost, buyQuote, sellQuote, spotMilli, type Pool } from "./math";
import {
  buyOffer,
  holdingsOf,
  marketPulse,
  nextTrade,
  parseTradeIntent,
  partOffers,
  promptCopy,
  sellOffer,
  spareItems,
  suitGaps,
  tradeHref,
  type Holdings,
  type MarketFacts,
} from "./prompts";
import { explainPrice } from "./reasoning";

const NAMES: Record<string, string> = { "chain-link": "Chain link", "spare-arm": "Doc’s spare arm", crumbs: "Crumbs" };

function market(change: (pool: Pool) => Pool = (p) => p, params = DEFAULT_PARAMS): MarketFacts {
  const items = seededPools().map((seed): MarketItemView => {
    const pool = change(seed);
    return {
      item: pool.item as ItemId,
      name: NAMES[pool.item] ?? pool.item,
      rarity: "common",
      priceMilli: spotMilli(pool),
      buyOne: buyQuote(pool, 1, params.feeBps)?.total ?? null,
      sellOne: sellQuote(pool, 1, params.feeBps)?.net ?? null,
      spark: [],
      change24h: null,
      trades24h: 0,
      pool,
    };
  });
  return { items, params };
}

const only = (item: string, change: (pool: Pool) => Pool) => (p: Pool) => (p.item === item ? change(p) : p);
function bought(pool: Pool, n: number): Pool {
  let p = pool;
  for (let i = 0; i < n; i++) p = afterBuy(p, 1, buyCost(p, 1)!);
  return p;
}

const STARTERS = ["classic", "midnight", "mint", "snow"] as const;
/** A level-5 hero who owns the starters, Stealth and Glider: the Octo rig and Sesame are left to finish. */
const hero = (inventory: Holdings["inventory"], level = 5, suits: Holdings["suits"] = [...STARTERS, "stealth", "glider"]): Holdings => ({ inventory, suits, level });
const ALL_OWNED = [...STARTERS, "stealth", "glider", "octo", "sesame"] as const;
const quote = (m: MarketFacts, item: string, n: number) => buyQuote(m.items.find((i) => i.item === item)!.pool, n, m.params.feeBps)!.total;
const net = (m: MarketFacts, item: string, n: number) => sellQuote(m.items.find((i) => i.item === item)!.pool, n, m.params.feeBps)!.net;

describe("what a player is missing and what they can spare", () => {
  it("lists every unowned recipe suit with its shortfall", () => {
    const gaps = suitGaps(hero({ "spare-arm": 1, "chain-link": 2, crumbs: 9 }, 2, STARTERS));
    expect(gaps.map((g) => g.suit)).toEqual(["stealth", "glider", "octo", "sesame"]);
    expect(gaps.find((g) => g.suit === "octo")).toMatchObject({ missing: [{ item: "chain-link", short: 1 }], levelShort: true, minLevel: 3 });
    expect(gaps.find((g) => g.suit === "sesame")).toMatchObject({ missing: [{ item: "sesame-seed", short: 1 }], levelShort: false });
    expect(gaps.find((g) => g.suit === "stealth")!.missing).toEqual([{ item: "sybil-goo", short: 3 }]);
  });

  it("an owned suit has no gap, and its parts become spare", () => {
    const owned = hero({ crumbs: 5, "sesame-seed": 1, "press-pass": 2 }, 5, [...STARTERS, "sesame"]);
    expect(suitGaps(owned).some((g) => g.suit === "sesame")).toBe(false);
    expect(spareItems(owned)).toEqual({ crumbs: 5, "sesame-seed": 1, "press-pass": 2 });
  });

  it("keeps back what a recipe still needs", () => {
    // Sesame takes 4 crumbs: 6 held leaves 2 spare. Press passes go in no recipe.
    expect(spareItems(hero({ crumbs: 6, "press-pass": 1, "chain-link": 3 }))).toEqual({ crumbs: 2, "press-pass": 1 });
    expect(spareItems(hero({ crumbs: 4 }))).toEqual({});
  });

  it("reads holdings off a save, hero or not", () => {
    expect(holdingsOf({ inventory: { crumbs: 1 }, suits: ["classic"], hero: { level: 4 } })).toEqual({ inventory: { crumbs: 1 }, suits: ["classic"], level: 4 });
    expect(holdingsOf({})).toEqual({ inventory: {}, suits: [], level: 1 });
  });
});

describe("the one next trade (nextTrade)", () => {
  it("one part short of a suit, and the Bits to cover it: buy the part", () => {
    const m = market();
    const p = nextTrade(hero({ "spare-arm": 1, "chain-link": 2 }), m, 500)!;
    expect(p).toMatchObject({ kind: "finish-suit", suit: "octo", affordable: true, needBits: 0, intent: { kind: "trade", item: "chain-link", side: "buy", amount: 1 } });
    expect(p.kind === "finish-suit" && p.cost).toBe(quote(m, "chain-link", 1));
    expect(promptCopy(p)).toEqual({ title: "The Octo rig suit is only missing Chain link ×1", action: `Buy it from Gwei · ${quote(m, "chain-link", 1)} Bits`, note: null });
  });

  it("a suit missing several of one part: the whole shortfall, quoted on the curve in one trade", () => {
    const m = market();
    const p = nextTrade(hero({ "spare-arm": 1 }), m, 500)!;
    expect(p).toMatchObject({ kind: "finish-suit", intent: { item: "chain-link", amount: 3 } });
    expect(p.kind === "finish-suit" && p.cost).toBe(quote(m, "chain-link", 3));
    expect(promptCopy(p).action).toBe(`Buy them from Gwei · ${quote(m, "chain-link", 3)} Bits`);
  });

  it("prefers the suit that costs least to finish", () => {
    // Octo needs a rare arm (about 150 Bits); sesame needs one uncommon seed (about 40).
    const p = nextTrade(hero({ "chain-link": 3, crumbs: 4 }), market(), 1_000)!;
    expect(p).toMatchObject({ kind: "finish-suit", suit: "sesame", intent: { item: "sesame-seed", amount: 1 } });
  });

  it("spare loot and nothing to finish: sell the stack worth the most", () => {
    const m = market();
    const p = nextTrade(hero({ crumbs: 2, "press-pass": 1 }, 5, ALL_OWNED), m, 0)!;
    // Two crumbs (about 12 each) are worth less than one press pass (about 40).
    expect(p).toMatchObject({ kind: "sell-spares", intent: { kind: "trade", item: "press-pass", side: "sell", amount: 1 }, toward: null });
    expect(p.kind === "sell-spares" && p.proceeds).toBe(net(m, "press-pass", 1));
    expect(promptCopy(p).action).toBe(`Sell it to Gwei · +${net(m, "press-pass", 1)} Bits`);
  });

  it("a part short but too few Bits: sell spares towards it", () => {
    const m = market();
    const p = nextTrade(hero({ "spare-arm": 1, "chain-link": 2, crumbs: 7 }), m, 3)!;
    expect(p).toMatchObject({ kind: "sell-spares", intent: { item: "crumbs", side: "sell", amount: 3 }, toward: { suitName: "Octo rig", cost: quote(m, "chain-link", 1) } });
    expect(promptCopy(p)).toMatchObject({ title: "No suit you’re missing uses your Crumbs ×3", note: `That goes towards the Octo rig suit’s last part (${quote(m, "chain-link", 1)} Bits).` });
  });

  it("a part short, too few Bits and nothing to sell: show the price and the gap", () => {
    const m = market();
    const cost = quote(m, "chain-link", 1);
    const p = nextTrade(hero({ "spare-arm": 1, "chain-link": 2 }), m, 3)!;
    expect(p).toMatchObject({ kind: "finish-suit", affordable: false, needBits: cost - 3, cost });
    expect(promptCopy(p).note).toBe(`You need ${cost - 3} Bits more. A verified night pays Bits.`);
  });

  it("a new hero with empty pockets is offered the suit that takes one kind of part", () => {
    // Stealth is three Sybil goo and nothing else: one trade from done.
    const m = market();
    expect(nextTrade(hero({}, 2, STARTERS), m, 500)).toMatchObject({ kind: "finish-suit", suit: "stealth", cost: quote(m, "sybil-goo", 3), intent: { item: "sybil-goo", side: "buy", amount: 3 } });
  });

  it("an unknown wallet (a guest) is shown the price as it stands", () => {
    expect(nextTrade(hero({ "spare-arm": 1, "chain-link": 2 }), market(), null)).toMatchObject({ kind: "finish-suit", affordable: true, needBits: 0 });
  });

  it("several kinds short: a step towards the suit that is fewest Bits away, its cheapest part first", () => {
    const m = market();
    // Sesame (4 crumbs and a seed, about 90 Bits) is nearer than the Octo rig (an arm and 3 links, about 210).
    const p = nextTrade(hero({ crumbs: 1 }), m, 60)!;
    expect(p).toMatchObject({ kind: "finish-suit", suit: "sesame", affordable: true, intent: { item: "crumbs", side: "buy", amount: 3 }, cost: quote(m, "crumbs", 3), then: [{ item: "sesame-seed", short: 1 }] });
    expect(promptCopy(p)).toEqual({ title: "The Sesame suit still needs Crumbs ×3", action: `Buy them from Gwei · ${quote(m, "crumbs", 3)} Bits`, note: "After that it needs Golden sesame seed ×1." });
    // A wallet that covers neither part of the nearest suit, nor any of the next: no nagging.
    expect(nextTrade(hero({ crumbs: 1 }), m, 5)).toBeNull();
    // Glider: a glider and two fee bombs. The bombs are the part 60 Bits covers.
    expect(nextTrade(hero({}, 5, [...STARTERS, "stealth", "octo", "sesame"]), m, 60)).toMatchObject({ suit: "glider", intent: { item: "fee-bomb", amount: 2 }, then: [{ item: "goblin-glider", short: 1 }] });
  });

  it("no prompt for a suit that is level-locked", () => {
    // Octo needs level 3, Sesame's parts are all there: nothing to buy, nothing spare.
    expect(nextTrade(hero({ "spare-arm": 1, "chain-link": 2, crumbs: 4, "sesame-seed": 1 }, 2), market(), 500)).toBeNull();
    // A level-1 hero can't craft yet, so there is nothing to work towards.
    expect(nextTrade(hero({}, 1, STARTERS), market(), 500)).toBeNull();
  });

  it("never offers a buy Gwei can't fill: sold out, short stock, or a closed stall", () => {
    const h = hero({ "spare-arm": 1, "chain-link": 2 });
    const sesameReady = { crumbs: 4, "sesame-seed": 1 } as const;
    expect(nextTrade({ ...h, inventory: { ...h.inventory, ...sesameReady } }, market(only("chain-link", (p) => ({ ...p, stock: 0 }))), 500)).toBeNull();
    expect(nextTrade(hero({ "spare-arm": 1, ...sesameReady }), market(only("chain-link", (p) => ({ ...p, stock: 2 }))), 500)).toBeNull();
    // A step is only offered towards a suit whose every missing part is in stock.
    expect(nextTrade(hero({}, 5, [...STARTERS, "stealth", "glider", "sesame"]), market(only("spare-arm", (p) => ({ ...p, stock: 0 }))), 500)).toBeNull();
    expect(nextTrade(hero({ "spare-arm": 1, "chain-link": 2, crumbs: 9 }), market((p) => p, { ...DEFAULT_PARAMS, open: false }), 500)).toBeNull();
  });

  it("never offers a sale Gwei's till can't pay; it offers fewer when it can pay for fewer", () => {
    const h = hero({ "press-pass": 2 }, 5, ALL_OWNED);
    const broke = market(only("press-pass", (p) => ({ ...p, bits: 0 })));
    expect(nextTrade(h, broke, 0)).toBeNull();
    // A till too thin for all five: the offer is the most she can pay for, at that amount's quote.
    const thin = market(only("press-pass", (p) => ({ ...p, bits: 60 })));
    const pool = thin.items.find((i) => i.item === "press-pass")!.pool;
    const fee = DEFAULT_PARAMS.feeBps;
    expect(sellQuote(pool, 5, fee)).toBeNull();
    const offer = sellOffer(thin, "press-pass", 5)!;
    expect(offer.amount).toBeGreaterThanOrEqual(1);
    expect(offer.amount).toBeLessThan(5);
    expect(offer.proceeds).toBe(sellQuote(pool, offer.amount, fee)!.net);
    expect(sellQuote(pool, offer.amount + 1, fee)).toBeNull();
    expect(nextTrade(hero({ "press-pass": 5 }), thin, 0)).toMatchObject({ kind: "sell-spares", intent: { item: "press-pass", amount: offer.amount }, proceeds: offer.proceeds });
  });

  it("caps a sale at the market's amount per trade", () => {
    const p = nextTrade(hero({ "press-pass": 50 }), market(), 0)!;
    expect(p.intent.amount).toBeLessThanOrEqual(DEFAULT_PARAMS.maxAmount);
  });
});

describe("quotes", () => {
  it("a buy offer is the contract's quote, or her reason", () => {
    const m = market(only("spare-arm", (p) => ({ ...p, stock: 0 })));
    expect(buyOffer(m, "chain-link", 2)).toEqual({ ok: true, item: "chain-link", amount: 2, cost: quote(m, "chain-link", 2) });
    expect(buyOffer(m, "spare-arm", 1)).toEqual({ ok: false, item: "spare-arm", amount: 1, stock: 0, reason: "Gwei has none left to sell. Sell her one and she’s back in stock." });
    expect(buyOffer(market(only("spare-arm", (p) => ({ ...p, stock: 1 }))), "spare-arm", 2)).toMatchObject({ ok: false, reason: "Gwei has only 1 left." });
    expect(buyOffer({ items: [], params: DEFAULT_PARAMS }, "crumbs", 1)).toBeNull();
  });

  it("a sale under a Bit after the fee is no offer", () => {
    const worthless = market(only("crumbs", (p) => ({ ...p, virtualBits: 1, bits: 1 })));
    expect(sellOffer(worthless, "crumbs", 1)).toBeNull();
  });

  it("the Suit lab gets one offer per missing part", () => {
    const m = market(only("goblin-glider", (p) => ({ ...p, stock: 0 })));
    const gap = suitGaps(hero({}, 5, STARTERS)).find((g) => g.suit === "glider")!;
    const offers = partOffers(gap, m);
    expect(offers.map((o) => [o.item, o.short, o.offer?.ok])).toEqual([
      ["goblin-glider", 1, false],
      ["fee-bomb", 2, true],
    ]);
  });
});

describe("deep links", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("round-trips a prefilled trade and a listing", () => {
    expect(tradeHref({ kind: "trade", item: "chain-link", side: "buy", amount: 3 })).toBe("/play/market?item=chain-link&side=buy&amount=3");
    expect(parseTradeIntent(q("item=chain-link&side=buy&amount=3"))).toEqual({ kind: "trade", item: "chain-link", side: "buy", amount: 3 });
    expect(tradeHref({ kind: "list", item: "crumbs" })).toBe("/play/market?item=crumbs&side=list");
    expect(parseTradeIntent(q("item=crumbs&side=list"))).toEqual({ kind: "list", item: "crumbs" });
  });

  it("refuses anything that isn't a real item and side, and clamps the amount", () => {
    expect(parseTradeIntent(q(""))).toBeNull();
    expect(parseTradeIntent(q("item=bits&side=buy"))).toBeNull();
    expect(parseTradeIntent(q("item=__proto__&side=buy"))).toBeNull();
    expect(parseTradeIntent(q("item=crumbs&side=steal"))).toBeNull();
    expect(parseTradeIntent(q("item=crumbs&side=sell"))).toMatchObject({ amount: 1 });
    expect(parseTradeIntent(q("item=crumbs&side=sell&amount=999"))).toMatchObject({ amount: 20 });
    expect(parseTradeIntent(q("item=crumbs&side=sell&amount=-4"))).toMatchObject({ amount: 1 });
    expect(parseTradeIntent(q("item=crumbs&side=sell&amount=abc"))).toMatchObject({ amount: 1 });
    expect(parseTradeIntent(q("item=crumbs&side=buy&amount=7"), 5)).toMatchObject({ amount: 5 });
  });
});

describe("the market in one line (marketPulse)", () => {
  it("picks the pool that moved furthest from its opening, in Gwei's words", () => {
    const m = market(only("spare-arm", (p) => bought(p, 1)));
    const pulse = marketPulse(m)!;
    const pool = m.items.find((i) => i.item === "spare-arm")!.pool;
    expect(pulse).toMatchObject({ item: "spare-arm", name: "Doc’s spare arm", state: "above", stock: 7, priceMilli: spotMilli(pool) });
    expect(pulse.headline).toBe(explainPrice({ pool, open: true, feeBps: DEFAULT_PARAMS.feeBps }).headline);
    expect(pulse.headline).toMatch(/^Up \d+% since I opened\./);
  });

  it("speaks about the part the player is after when told", () => {
    const m = market(only("spare-arm", (p) => bought(p, 1)));
    expect(marketPulse(m, "chain-link")).toMatchObject({ item: "chain-link", state: "opening", stock: 40 });
  });

  it("says closed for a closed stall, and nothing for no pools", () => {
    expect(marketPulse(market((p) => p, { ...DEFAULT_PARAMS, open: false }))).toMatchObject({ state: "closed" });
    expect(marketPulse({ items: [], params: DEFAULT_PARAMS })).toBeNull();
  });
});
