/**
 * The practice market: a guest's own copy of the market in their browser. That it trades
 * on the market's real rules, that Gwei goes broke and an investment reopens her, that
 * Sandwich Man trades in it as the NPC, and above all that nothing in it can become real:
 * it never touches the save, the server or NEAR.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ITEMS } from "@wgp/game-core/data";
import { newSave } from "@wgp/game-core/engine";
import type { ItemId, Save } from "@wgp/game-core/types";

import type { MarketItemView, MarketView } from "./api";
import { DEFAULT_PARAMS, seededPools } from "./config";
import { MarketError } from "./engine";
import { bitsText } from "./format";
import { DEFAULT_INVEST_RULES, shopOf } from "./invest";
import { buyQuote, sellQuote, spotMilli, type Pool } from "./math";
import {
  parsePractice,
  PRACTICE_ACCOUNT,
  PRACTICE_INVEST_RULES,
  PRACTICE_KEY,
  PRACTICE_LABEL,
  PRACTICE_NPC_ACCOUNT,
  PRACTICE_START_BITS,
  practiceBase,
  practiceDrain,
  practiceNpcLooks,
  practiceScreen,
  practiceStake,
  practiceTrade,
  seedPractice,
  stageItem,
  storePractice,
  type PracticeState,
} from "./practice";
import { explainPrice } from "./reasoning";
import { shopReasons, withShop } from "./reasoning-shop";
import { sparkQuiet } from "./spark";

const T0 = Date.parse("2026-11-12T12:00:00Z");
const MIN = 60_000;

/** The live market as GET /api/market would answer it, with `pools` (the seeded ones by default). */
function liveView(pools: Pool[] = seededPools(), onChain = true): MarketView {
  const items: MarketItemView[] = pools.map((pool) => ({
    item: pool.item as ItemId,
    name: ITEMS[pool.item as ItemId].name,
    rarity: ITEMS[pool.item as ItemId].rarity,
    priceMilli: spotMilli(pool),
    buyOne: buyQuote(pool, 1, 200)?.total ?? null,
    sellOne: sellQuote(pool, 1, 200)?.net ?? null,
    spark: [spotMilli(pool) - 500, spotMilli(pool)],
    change24h: 0.01,
    trades24h: 3,
    pool,
  }));
  return { onChain, network: onChain ? "mainnet" : null, contractId: onChain ? "game.wgpnear.near" : null, vendor: null, params: DEFAULT_PARAMS, items, listings: 0, till: 0, updatedAt: new Date(T0).toISOString() };
}

const pool = (s: PracticeState, item = "crumbs") => s.book.pools.find((p) => p.item === item)!;
const base = (inventory: Partial<Record<ItemId, number>> = {}, guestBits = 0) => practiceBase(guestBits, inventory);

describe("the practice market", () => {
  it("opens on the live market's own pools and rules, open and taking investors", () => {
    // Mainnet as it might stand: crumbs traded away from its opening price, and (on v3) part-funded by investors.
    const moved = seededPools().map((p) => (p.item === "crumbs" ? { ...p, bits: 700, stock: 31, virtualBits: 380, invested: 100, rewards: 4, feeAcc: "12", feeCarry: 3 } : p));
    const s = seedPractice({ ...liveView(moved), params: { ...DEFAULT_PARAMS, feeBps: 500, open: false } }, T0);
    expect(s.seededFrom).toBe("near");
    // Same curve, same price; real investors' Bits are not practice's.
    expect(spotMilli(pool(s))).toBe(spotMilli(moved.find((p) => p.item === "crumbs")!));
    expect(pool(s)).toEqual({ item: "crumbs", virtualBits: 480, virtualItems: 40, bits: 600, stock: 31, escrow: 0 });
    expect(s.book.params).toMatchObject({ feeBps: 500, open: true, invest: PRACTICE_INVEST_RULES });
    expect(s.spark.crumbs).toEqual([spotMilli(moved.find((p) => p.item === "crumbs")!) - 500, spotMilli(moved.find((p) => p.item === "crumbs")!)]);
    expect(seedPractice(liveView(seededPools(), false), T0).seededFrom).toBe("simulated");
    // With no live market to read, it opens on the seeded defaults.
    const offline = seedPractice(null, T0);
    expect(offline.seededFrom).toBe("defaults");
    expect(offline.book.pools).toEqual(seededPools());
  });

  it("shortens only the lock: every other investing rule is contract v3's", () => {
    expect(PRACTICE_INVEST_RULES).toEqual({ ...DEFAULT_INVEST_RULES, lockMs: 30_000 });
    expect(PRACTICE_LABEL).toBe("Practice market: not on NEAR. Sign in to trade for real.");
  });

  it("gives a visitor practice Bits and a copy of their loot to trade with", () => {
    const s = seedPractice(liveView(), T0);
    const fresh = practiceScreen(s, base(), T0);
    expect(fresh.me).toMatchObject({ onChain: false, accountId: PRACTICE_ACCOUNT, bits: PRACTICE_START_BITS, items: {}, tradesLeft: 40, pendingBits: 0 });
    expect(fresh.view).toMatchObject({ onChain: false, contractId: null, contract: null });
    expect(fresh.view.items.map((i) => i.item)).toEqual(seededPools().map((p) => p.item));
    // What their guest nights would have paid counts too, and their saved loot is there to sell.
    const played = practiceScreen(s, base({ crumbs: 4, "sybil-goo": 1 }, 140), T0);
    expect(played.me.bits).toBe(PRACTICE_START_BITS + 140);
    expect(played.me.items).toEqual({ crumbs: 4, "sybil-goo": 1 });
  });

  it("buys and sells on Gwei's curve: the quote the sheet shows is what it charges, fee burned", () => {
    let s = seedPractice(liveView(), T0);
    const b = base({ crumbs: 4 });
    const quote = buyQuote(pool(s), 3, 200)!;
    const bought = practiceTrade(s, b, { action: "buy", item: "crumbs", amount: 3, maxBits: quote.total }, T0);
    expect(bought.receipt).toMatchObject({ kind: "trade", trade: { side: "buy", bits: quote.total, fee: quote.fee } });
    s = bought.state;
    expect(s.book.burned).toBe(quote.fee);
    expect(practiceScreen(s, b, T0).me).toMatchObject({ bits: PRACTICE_START_BITS - quote.total, items: { crumbs: 7 } });
    expect(spotMilli(pool(s))).toBeGreaterThan(12_000);

    const sq = sellQuote(pool(s), 7, 200)!;
    s = practiceTrade(s, b, { action: "sell", item: "crumbs", amount: 7, minBits: sq.net }, T0 + MIN).state;
    const after = practiceScreen(s, b, T0 + MIN);
    expect(after.me.bits).toBe(PRACTICE_START_BITS - quote.total + sq.net);
    expect(after.me.items).toEqual({});
    const crumbs = after.view.items.find((i) => i.item === "crumbs")!;
    expect(crumbs.trades24h).toBe(2);
    expect(crumbs.spark.at(-1)).toBe(spotMilli(pool(s)));
  });

  it("enforces the slippage cap, the caps and the wallet, and a refused trade changes nothing", () => {
    const s = seedPractice(liveView(), T0);
    const b = base({ crumbs: 2 });
    const tries = [
      () => practiceTrade(s, b, { action: "buy", item: "crumbs", amount: 3, maxBits: 10 }, T0),
      () => practiceTrade(s, b, { action: "sell", item: "crumbs", amount: 2, minBits: 500 }, T0),
      () => practiceTrade(s, b, { action: "sell", item: "crumbs", amount: 3, minBits: 0 }, T0),
      () => practiceTrade(s, b, { action: "buy", item: "goblin-glider", amount: 8, maxBits: 1e9 }, T0),
      () => practiceTrade(s, b, { action: "buy", item: "crumbs", amount: 21, maxBits: 1e9 }, T0),
    ];
    const codes = tries.map((t) => {
      try {
        t();
        return "ok";
      } catch (e) {
        return e instanceof MarketError ? e.code : "?";
      }
    });
    expect(codes).toEqual(["slippage", "slippage", "funds", "funds", "amount"]);
    expect(s).toEqual(seedPractice(liveView(), T0));
  });

  it("lists, fills and cancels in the practice book like the real one", () => {
    let s = seedPractice(liveView(), T0);
    const b = base({ crumbs: 5 });
    const listed = practiceTrade(s, b, { action: "list", item: "crumbs", amount: 2, price: 22 }, T0);
    s = listed.state;
    const id = listed.receipt.kind === "listing" ? listed.receipt.listing.id : -1;
    const screen = practiceScreen(s, b, T0);
    expect(screen.listings.map((l) => [l.id, l.seller, l.amount, l.price])).toEqual([[id, PRACTICE_ACCOUNT, 2, 22]]);
    expect(screen.me).toMatchObject({ items: { crumbs: 3 }, open: [id] });
    s = practiceTrade(s, b, { action: "cancel", listingId: id }, T0).state;
    expect(practiceScreen(s, b, T0).me.items).toEqual({ crumbs: 5 });
  });
});

describe("Gwei goes broke in practice, and an investment reopens her", () => {
  /** Sell the visitor's own crumbs into her until the till can't pay for another. */
  function sellUntilBroke(start: PracticeState, b: ReturnType<typeof base>) {
    let s = start;
    for (let i = 0; i < 20; i++) {
      let n = 20;
      while (n > 0 && !sellQuote(pool(s), n, 200)) n -= 1;
      if (n === 0) return s;
      s = practiceTrade(s, b, { action: "sell", item: "crumbs", amount: n, minBits: 0 }, T0 + i).state;
    }
    throw new Error("never broke");
  }

  it("closes the shop with the reason, reopens it on an investment, pays a fee share and lets the stake out", () => {
    const b = base({ crumbs: 120 });
    let s = sellUntilBroke(seedPractice(liveView(), T0), b);
    let screen = practiceScreen(s, b, T0 + MIN);
    const brokeShop = screen.view.shops!.find((x) => x.item === "crumbs")!;
    expect(brokeShop.closed).toEqual(["broke"]);
    expect(brokeShop).toMatchObject({ buying: false, selling: true });
    expect(screen.view.items.find((i) => i.item === "crumbs")!.sellOne).toBeNull();
    // "Why this price?" says she is closed, why, and that investing reopens her here.
    const why = withShop(explainPrice({ pool: pool(s), open: true, feeBps: 200 }), brokeShop, "available");
    expect(why.state).toBe("broke");
    expect(why.reasons.at(-1)).toBe(`I’m closed for buying these: my till is ${bitsText(brokeShop.needs)} short of paying for one. Besides buying from me, investing in this till reopens me, at the same price.`);
    expect(() => practiceTrade(s, b, { action: "sell", item: "crumbs", amount: 1, minBits: 0 }, T0 + MIN)).toThrow(/till holds only/);

    // Invest: the shop reopens, the price doesn't move, and the stake is on the books.
    const price = spotMilli(pool(s));
    const invested = practiceStake(s, b, { action: "invest", item: "crumbs", bits: 150 }, T0 + MIN);
    expect(invested.receipt).toMatchObject({ item: "crumbs", bits: 150, stake: 150, unlocksAtMs: T0 + MIN + 30_000 });
    s = invested.state;
    screen = practiceScreen(s, b, T0 + MIN);
    expect(spotMilli(pool(s))).toBe(price);
    expect(screen.view.shops!.find((x) => x.item === "crumbs")).toMatchObject({ closed: [], buying: true, invested: 150 });
    expect(screen.me.investor!.stakes).toEqual([{ item: "crumbs", bits: 150, earned: 0, unlocksAtMs: T0 + MIN + 30_000, withdrawable: 0 }]);
    const bitsAfterInvest = screen.me.bits;

    // Another trade on that item pays the investor a share of its fee.
    let cut = 0;
    for (let i = 0; i < 4; i++) {
      const t = practiceTrade(s, b, { action: "buy", item: "crumbs", amount: 20, maxBits: 1e9 }, T0 + MIN + i);
      if (t.receipt.kind === "trade") cut += t.receipt.trade.cut ?? 0;
      s = t.state;
    }
    expect(cut).toBeGreaterThan(0);
    const stake = practiceScreen(s, b, T0 + MIN + 10).me.investor!.stakes[0]!;
    expect(stake.earned).toBeGreaterThan(0);
    expect(stake.earned).toBeLessThanOrEqual(cut);

    // Locked for 30 seconds, then it comes home with what it earned.
    expect(() => practiceStake(s, b, { action: "withdraw", item: "crumbs", bits: 150 }, T0 + MIN + 29_000)).toThrow(/unlocks in about 1 minutes/);
    const spent = bitsAfterInvest - practiceScreen(s, b, T0 + MIN + 10).me.bits;
    const out = practiceStake(s, b, { action: "withdraw", item: "crumbs", bits: 150 }, T0 + MIN + 30_000);
    expect(out.receipt).toMatchObject({ bits: 150, earned: stake.earned, stake: 0 });
    expect(practiceScreen(out.state, b, T0 + 2 * MIN).me.bits).toBe(bitsAfterInvest - spent + 150 + stake.earned);
    expect(practiceScreen(out.state, b, T0 + 2 * MIN).me.investor!.stakes).toEqual([]);
  });

  it("can stage it for a visitor with no loot: a crowd sells into one till until it is empty", () => {
    const b = base();
    const s0 = seedPractice(liveView(), T0);
    expect(stageItem(s0)).toBe("fee-bomb");
    const { state: s, sold } = practiceDrain(s0, b, "crumbs", T0);
    expect(sold).toBeGreaterThan(60);
    expect(shopOf(pool(s), true).closed).toEqual(["broke"]);
    // It went through Gwei's own prices: more stock, a lower price, x·y never down.
    expect(pool(s).stock).toBe(40 + sold);
    expect(spotMilli(pool(s))).toBeLessThan(12_000);
    expect((pool(s).virtualItems + pool(s).stock) * (pool(s).virtualBits + pool(s).bits)).toBeGreaterThanOrEqual(80 * 960);
    // The crowd is a scenario, not a player: the visitor's wallet and counters are untouched.
    expect(practiceScreen(s, b, T0).me).toMatchObject({ bits: PRACTICE_START_BITS, items: {}, tradesLeft: 40 });
    expect(Object.keys(s.book.accounts)).toEqual([]);
    expect(practiceDrain(s, b, "crumbs", T0).sold).toBe(0);
    // The visitor's 300 practice Bits are enough to reopen her.
    const open = practiceStake(s, b, { action: "invest", item: "crumbs", bits: 50 }, T0).state;
    expect(shopOf(pool(open), true).closed).toEqual([]);
  });

  it("adds no line to a healthy shop, and says the honest thing where investing isn't live", () => {
    const s = seedPractice(liveView(), T0);
    expect(shopReasons(shopOf(pool(s), true), "available")).toEqual([]);
    const broke = shopOf({ ...pool(s), bits: 0 }, true);
    expect(shopReasons(broke, "not-live")[0]).toMatch(/Investing would reopen me too, but it comes with contract v3, which isn’t live yet\. You can try it in the practice market\.$/);
    expect(shopReasons(broke, "paused")[0]).toMatch(/not taking new investors right now/);
    expect(shopReasons({ closed: ["sold-out"], needs: 0, invested: 0 }, "available")).toEqual(["I’m closed for selling these until someone sells me one. Investing fills my till, not my shelf."]);
    expect(shopReasons({ closed: [], needs: 0, invested: 120 }, "available")[0]).toMatch(/Players have invested 120 Bits in this till/);
  });
});

describe("Sandwich Man in the practice market", () => {
  it("trades by his own rules from his own practice wallet, labelled as the NPC", () => {
    const b = base();
    // A dip he buys (rule 5): a crowd has sold crumbs down to well under 85% of its opening price.
    let s = practiceDrain(seedPractice(liveView(), T0), b, "crumbs", T0).state;
    s = practiceStake(s, b, { action: "invest", item: "crumbs", bits: 100 }, T0).state;
    const looked = practiceNpcLooks(s, b, T0 + MIN);
    expect(looked.events).toHaveLength(1);
    expect(looked.events[0]).toMatchObject({ kind: "buy", item: "crumbs", onChain: false });
    const npc = practiceScreen(looked.state, b, T0 + MIN).npc;
    expect(npc).toMatchObject({ id: "sandwich-man", mode: "practice", accountId: PRACTICE_NPC_ACCOUNT, explorerUrl: null });
    expect(npc.items).toEqual([{ item: "crumbs", name: "Crumbs", amount: 2 }]);
    expect(npc.bits).toBeLessThan(300);
    expect(npc.log[0]).toMatchObject({ kind: "buy", txHash: null, txUrl: null });
    // His purchase paid the investor a fee share like anyone's.
    expect(pool(looked.state).rewards ?? 0).toBeGreaterThanOrEqual(0);
    // He never touches the visitor's wallet.
    expect(practiceScreen(looked.state, b, T0 + MIN).me.bits).toBe(PRACTICE_START_BITS - 100);
    // With nothing worth doing, he does nothing.
    expect(practiceNpcLooks(seedPractice(liveView(), T0), b, T0).events).toEqual([]);
  });
});

/* ------------------------------------------------------------------ nothing here can become real */

describe("practice gains can't be laundered", () => {
  it("never changes the save: practice items are a delta kept beside it", () => {
    const save: Save = { ...newSave(), inventory: { crumbs: 3 } };
    Object.freeze(save);
    Object.freeze(save.inventory);
    const b = practiceBase(0, save.inventory);
    Object.freeze(b);
    let s = seedPractice(liveView(), T0);
    s = practiceTrade(s, b, { action: "buy", item: "goblin-glider", amount: 1, maxBits: 1e9 }, T0).state;
    s = practiceTrade(s, b, { action: "sell", item: "crumbs", amount: 3, minBits: 0 }, T0).state;
    s = practiceStake(s, b, { action: "invest", item: "crumbs", bits: 50 }, T0).state;
    // Frozen and still equal: nothing wrote to the save, and the practice state holds only deltas.
    expect(save.inventory).toEqual({ crumbs: 3 });
    expect(s.items).toEqual({ "goblin-glider": 1, crumbs: -3 });
    expect(practiceScreen(s, b, T0).me.items).toEqual({ "goblin-glider": 1 });
    // The stored practice market holds no copy of the save, and no hero.
    const stored = storePractice(s);
    expect(stored).not.toContain('"hero"');
    expect(stored).not.toContain('"inventory"');
  });

  it("is stored under its own key, never the save's", () => {
    expect(PRACTICE_KEY).toBe("wgp:practice:v1");
    expect(PRACTICE_KEY).not.toBe("wgp:save:v1");
    const store = readFileSync(fileURLToPath(new URL("../../game/store.ts", import.meta.url)), "utf8");
    // The game's store (which holds the save, and builds what the import sends) knows nothing of practice.
    expect(store).toContain('const KEY = "wgp:save:v1"');
    expect(store).not.toMatch(/practice/i);
  });

  it("has no way to write the save or reach the server: its rules and its hook only read", () => {
    const rules = readFileSync(fileURLToPath(new URL("./practice.ts", import.meta.url)), "utf8");
    const hook = readFileSync(fileURLToPath(new URL("../../components/market/use-practice.ts", import.meta.url)), "utf8");
    // The rules are pure: no storage, no network, no game store.
    expect(rules).not.toMatch(/localStorage|sessionStorage|fetch\(|@\/game\/store|window\./);
    for (const src of [rules, hook]) {
      // Nothing that writes a save, imports one, posts to the server or signs a call.
      expect(src).not.toMatch(/commitLocalSave|adoptServerSave|dispatch\(|migrateLocalSave|acceptMigration|postAction|postSim|callGame|session-key|\/api\//);
      expect(src).not.toContain("wgp:save:v1");
    }
    // The hook's only write is the practice market's own key (and its on/off choice).
    const writes = [...hook.matchAll(/(?:local|session)Storage\.(?:setItem|removeItem)\(([^,)]+)/g)].map((m) => m[1]!.trim());
    expect(new Set(writes)).toEqual(new Set(["PRACTICE_KEY", "MODE_KEY"]));
    // From the game's store it takes one thing, to read the loot practice items start from.
    expect([...hook.matchAll(/import \{([^}]+)\} from "@\/game\/store"/g)].map((m) => m[1]!.trim())).toEqual(["useGame"]);
    expect(hook).not.toMatch(/useGame\(\)[^;]*dispatch|\{ save, dispatch \}/);
  });

  it("reads back only a market the maths can run on; anything else is dropped and reseeded", () => {
    const s = practiceStake(seedPractice(liveView(), T0), base(), { action: "invest", item: "crumbs", bits: 50 }, T0).state;
    expect(parsePractice(storePractice(s))).toEqual(s);
    expect(parsePractice(null)).toBeNull();
    expect(parsePractice("")).toBeNull();
    expect(parsePractice("{nope")).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, v: 2 }))).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, bits: 1e30 }))).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, bits: "lots" }))).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, book: { ...s.book, pools: [] } }))).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, book: { ...s.book, pools: [{ ...s.book.pools[0], virtualBits: 0 }] } }))).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, book: { ...s.book, pools: [{ ...s.book.pools[0], item: "gold-bar" }] } }))).toBeNull();
    expect(parsePractice(JSON.stringify({ ...s, book: { ...s.book, pools: [{ ...s.book.pools[0], feeAcc: "1e9" }] } }))).toBeNull();
    // A wallet edited to a fortune is still only a practice wallet: it parses, and buys practice items.
    const rich = parsePractice(JSON.stringify({ ...s, bits: 1_000_000 }))!;
    expect(practiceScreen(rich, base(), T0).me.bits).toBe(PRACTICE_START_BITS + 1_000_000);
  });
});

describe("the practice cards' step lines", () => {
  it("are drawn from the practice market's own trades at their own times, not a fallback", () => {
    const b = base({ crumbs: 5 });
    let s = seedPractice(liveView(), T0);
    const crumbs = (st: PracticeState, at: number) => practiceScreen(st, b, at).view.items.find((i) => i.item === "crumbs")!;
    // Just opened: one step where it opened, and nothing has traded.
    expect(crumbs(s, T0 + MIN).sparkSteps).toHaveLength(1);
    expect(sparkQuiet(crumbs(s, T0 + MIN).sparkSteps!)).toBe(true);
    expect(crumbs(s, T0 + MIN).change24h).toBe(0);

    s = practiceTrade(s, b, { action: "buy", item: "crumbs", amount: 3, maxBits: 1e9 }, T0 + 60 * MIN).state;
    const afterBuy = spotMilli(pool(s));
    s = practiceTrade(s, b, { action: "sell", item: "crumbs", amount: 8, minBits: 0 }, T0 + 120 * MIN).state;
    const item = crumbs(s, T0 + 180 * MIN);
    // Three steps: the opening, the buy, the sell, each at its real place in the last 24 hours.
    expect(item.sparkSteps!.map(([, price]) => price)).toEqual([12_000, afterBuy, spotMilli(pool(s))]);
    const day = 24 * 60 * MIN;
    expect(item.sparkSteps!.map(([t]) => Math.round(t * day))).toEqual([day - 180 * MIN, day - 120 * MIN, day - 60 * MIN]);
    expect(sparkQuiet(item.sparkSteps!)).toBe(false);
    expect(item.trades24h).toBe(2);
    expect(item.change24h).toBeCloseTo((spotMilli(pool(s)) - 12_000) / 12_000, 10);
    // An investment moves no price, so it adds no step.
    const staked = practiceStake(s, b, { action: "invest", item: "crumbs", bits: 50 }, T0 + 150 * MIN).state;
    expect(crumbs(staked, T0 + 180 * MIN).sparkSteps).toEqual(item.sparkSteps);
    // Two days on with nothing traded: a flat line from the last price, which the card labels as quiet.
    const later = crumbs(s, T0 + 3 * day);
    expect(later.sparkSteps).toEqual([[0, spotMilli(pool(s))]]);
    expect(later.trades24h).toBe(0);
  });

  it("survive storage, and a market stored before they were kept still draws", () => {
    const s = practiceTrade(seedPractice(liveView(), T0), base(), { action: "buy", item: "crumbs", amount: 1, maxBits: 1e9 }, T0 + MIN).state;
    expect(parsePractice(storePractice(s))!.marks).toEqual(s.marks);
    const { marks: _dropped, ...old } = s;
    void _dropped;
    const read = parsePractice(JSON.stringify(old))!;
    expect(practiceScreen(read, base(), T0 + MIN).view.items[0]!.sparkSteps).toBeUndefined();
    expect(parsePractice(JSON.stringify({ ...s, marks: { crumbs: [[1, "x"]] } }))).toBeNull();
  });
});

describe("Gwei's closed-shop lines beside her own reasoning", () => {
  it("never contradict the till line: a broke till says buying from her reopens it, and investing too", () => {
    const s = practiceDrain(seedPractice(liveView(), T0), base(), "crumbs", T0).state;
    const why = withShop(explainPrice({ pool: pool(s), open: true, feeBps: 200 }), shopOf(pool(s), true), "available");
    expect(why.state).toBe("broke");
    expect(why.reasons[0]).toMatch(/can’t buy more until someone buys from me/);
    expect(why.reasons.at(-1)).toMatch(/Besides buying from me, investing in this till reopens me, at the same price\.$/);
    expect(why.covers).toBe(0);
  });

  it("in a till players funded, state her stock and till plainly and say whose Bits keep her buying", () => {
    let s = practiceDrain(seedPractice(liveView(), T0), base(), "crumbs", T0).state;
    s = practiceStake(s, base(), { action: "invest", item: "crumbs", bits: 150 }, T0).state;
    const why = withShop(explainPrice({ pool: pool(s), open: true, feeBps: 200 }), shopOf(pool(s), true), "available");
    const all = why.reasons.join(" ");
    // No "up from … at opening. Buyers paid in, and that lifts the price": investors paid in, and the price didn't move.
    expect(all).not.toMatch(/Buyers paid in|lifts the price|up from/);
    expect(all).toContain(`My till for these holds ${bitsText(pool(s).bits)}.`);
    expect(why.reasons.at(-1)).toBe("Players have invested 150 Bits in this till. That’s what lets me keep buying; it doesn’t change the price.");
    expect(why.covers).toBeGreaterThan(0);
    expect(why.reasons.length).toBeLessThanOrEqual(5);
  });
});
