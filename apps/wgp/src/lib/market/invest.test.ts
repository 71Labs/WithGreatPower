/**
 * The TypeScript investing rules against contract v3's: ./invest-vectors.json was printed
 * by the Rust itself (scripts/invest-vectors/generate.mjs runs the contract's code from
 * the branch review/contract-v3), and every step of it is replayed here through
 * ./engine.ts and ./invest.ts. Then the properties the contract's own tests name (prices
 * don't move, a round trip is exact, the books balance), checked on the mirror.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BITS_TOKEN, DEFAULT_PARAMS, itemToken, seededPools, type InvestRules, type MarketParams } from "./config";
import { marketBuy, marketClaim, marketInvest, marketSell, marketWithdraw, MarketError, memoryLedger, newBook, type MarketBook } from "./engine";
import { DEFAULT_INVEST_RULES, INVEST_RISKS, closedReasons, closedText, earned, investRoom, investorCut, investorView, shopOf, shopsOf, tillShort, unlocksIn } from "./invest";
import { buyQuote, reserves, sellQuote, spotMilli, type Pool } from "./math";
import { rng } from "./bots";

interface RawPool {
  item: string;
  virtual_bits: string;
  virtual_items: string;
  bits: string;
  stock: string;
  escrow: string;
  invested: string;
  rewards: string;
  fee_acc: string;
  fee_carry: number;
}

interface RawStep {
  at_ms: number;
  who: string;
  op: "invest" | "withdraw" | "claim" | "buy" | "sell";
  item: string;
  amount: number;
  ok: null | { bits: string; earned?: string; stake?: string; unlocks_at_ms?: number; fee?: string };
  error: string | null;
  pool: RawPool;
  bits: string;
  held: string;
  shop: { item: string; price_milli: string; closed: string[]; buying: boolean; selling: boolean; till: string; needs: string; invested: string; invest_room: string; rewards: string };
  investor: { stakes: { item: string; bits: string; earned: string; unlocks_at_ms: number; withdrawable: string }[]; invests_left: number; invest_bits_left: string };
  supply: string;
}

interface Vectors {
  source: { ref: string; commit: string };
  scenarios: {
    name: string;
    params: { open: boolean; fee_bps: number; max_amount: number; daily_trades: number; invest_open: boolean; invest_fee_bps: number; min_invest: string; max_invest: string; daily_invests: number; daily_invest_bits: string; invest_lock_ms: number };
    pools: RawPool[];
    accounts: string[];
    start_bits: number;
    start_items: number;
    steps: RawStep[];
  }[];
}

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("./invest-vectors.json", import.meta.url)), "utf8")) as Vectors;

const toPool = (p: RawPool): Pool => ({ item: p.item, virtualBits: Number(p.virtual_bits), virtualItems: Number(p.virtual_items), bits: Number(p.bits), stock: Number(p.stock), escrow: Number(p.escrow) });

/** A pool as the contract's JSON prints it, investing fields and all. */
const raw = (p: Pool): RawPool => ({
  item: p.item,
  virtual_bits: String(p.virtualBits),
  virtual_items: String(p.virtualItems),
  bits: String(p.bits),
  stock: String(p.stock),
  escrow: String(p.escrow),
  invested: String(p.invested ?? 0),
  rewards: String(p.rewards ?? 0),
  fee_acc: p.feeAcc ?? "0",
  fee_carry: p.feeCarry ?? 0,
});

/** The contract's words from a unit-test panic (some arrive wrapped in a HostError). */
const said = (error: string) => /panic_msg: "(.*)" \}\)$/.exec(error)?.[1] ?? error;

describe("investing, against contract v3's own vectors", () => {
  it("come from the reviewed v3 branch", () => {
    expect(vectors.source.ref).toBe("origin/review/contract-v3");
    expect(vectors.scenarios.length).toBeGreaterThanOrEqual(4);
  });

  for (const scenario of vectors.scenarios) {
    it(`replays "${scenario.name}" step for step (${scenario.steps.length} steps)`, () => {
      const p = scenario.params;
      const invest: InvestRules = { open: p.invest_open, feeBps: p.invest_fee_bps, min: Number(p.min_invest), max: Number(p.max_invest), dailyInvests: p.daily_invests, dailyBits: Number(p.daily_invest_bits), lockMs: p.invest_lock_ms };
      const params: MarketParams = { ...DEFAULT_PARAMS, open: p.open, feeBps: p.fee_bps, maxAmount: p.max_amount, dailyTrades: p.daily_trades, invest };
      const book = newBook(params, scenario.pools.map(toPool));
      const start: Record<string, Record<string, number>> = {};
      for (const a of scenario.accounts) start[a] = { [BITS_TOKEN]: scenario.start_bits, ...Object.fromEntries(scenario.pools.map((q) => [itemToken(q.item), scenario.start_items])) };
      const ledger = memoryLedger(start);
      const seen = new Set<string>();

      scenario.steps.forEach((step, n) => {
        const at = `${scenario.name} #${n} ${step.op} ${step.amount} ${step.item}`;
        let answer: RawStep["ok"] = null;
        let refused: string | null = null;
        try {
          if (step.op === "invest" || step.op === "withdraw" || step.op === "claim") {
            const r =
              step.op === "invest"
                ? marketInvest(book, ledger, step.who, step.item, step.amount, step.at_ms)
                : step.op === "withdraw"
                  ? marketWithdraw(book, ledger, step.who, step.item, step.amount, step.at_ms)
                  : marketClaim(book, ledger, step.who, step.item, step.at_ms);
            answer = { bits: String(r.bits), earned: String(r.earned), stake: String(r.stake), unlocks_at_ms: r.unlocksAtMs };
          } else {
            const t = step.op === "buy" ? marketBuy(book, ledger, step.who, step.item, step.amount, 1_000_000_000, step.at_ms) : marketSell(book, ledger, step.who, step.item, step.amount, 0, step.at_ms);
            answer = { bits: String(t.bits), fee: String(t.fee) };
          }
        } catch (error) {
          if (!(error instanceof MarketError)) throw error;
          refused = error.message;
        }
        seen.add(refused ? `${step.op}: ${refused.replace(/\d+/g, "N")}` : `${step.op}: ok`);

        expect(refused, at).toBe(step.error === null ? null : said(step.error));
        expect(answer, at).toEqual(step.ok);
        const pool = book.pools.find((q) => q.item === step.item)!;
        expect(raw(pool), at).toEqual(step.pool);
        expect(ledger.balance(step.who, BITS_TOKEN), at).toBe(Number(step.bits));
        expect(ledger.balance(step.who, itemToken(step.item)), at).toBe(Number(step.held));

        const shop = shopOf(pool, book.params.open);
        expect(
          { item: shop.item, price_milli: String(shop.priceMilli), closed: shop.closed, buying: shop.buying, selling: shop.selling, till: String(shop.till), needs: String(shop.needs), invested: String(shop.invested), invest_room: String(shop.investRoom), rewards: String(shop.rewards) },
          at,
        ).toEqual(step.shop);

        const view = investorView(invest, book.pools, book.investors?.[step.who], step.at_ms);
        expect(
          {
            stakes: view.stakes.map((s) => ({ item: s.item, bits: String(s.bits), earned: String(s.earned), unlocks_at_ms: s.unlocksAtMs, withdrawable: String(s.withdrawable) })),
            invests_left: view.investsLeft,
            invest_bits_left: String(view.investBitsLeft),
          },
          at,
        ).toEqual(step.investor);

        // The contract's supply is players + tills + unclaimed earnings; here that is what was minted less what burned.
        const held = scenario.accounts.reduce((sum, a) => sum + ledger.balance(a, BITS_TOKEN), 0);
        const vendor = book.pools.reduce((sum, q) => sum + q.bits + (q.rewards ?? 0), 0);
        expect(held + vendor, at).toBe(Number(step.supply));
      });

      // The walk reached the states worth mirroring, not just the easy ones.
      for (const must of ["invest: ok", "withdraw: ok", "claim: ok", "buy: ok", "sell: ok", "claim: Nothing earned yet"]) expect([...seen], must).toContain(must);
    });
  }

  it("between them the scenarios cover every refusal the contract has for investing", () => {
    const all = new Set(vectors.scenarios.flatMap((s) => s.steps.filter((t) => t.error).map((t) => said(t.error!).replace(/\d+/g, "N").replace(/ (crumbs|fee-bomb|sybil-goo|goblin-glider)$/, " X"))));
    for (const words of [
      "Invest N to N Bits at a time",
      "Daily market limit reached; it resets at midnight UTC",
      "The vendor can take only N more Bits for X",
      "Needs N Bits",
      "You have no stake in X",
      "You have N Bits staked in X",
      "Your stake unlocks in about N minutes",
      "The till can pay back only N Bits right now; it refills as players buy X",
      "Nothing earned yet",
      "The vendor's till holds only N Bits",
    ]) {
      expect([...all], words).toContain(words);
    }
    const closed = new Set(vectors.scenarios.flatMap((s) => s.steps.flatMap((t) => t.shop.closed)));
    // The walks run tills dry; none sells a pool out (that reason is checked on the mirror below).
    expect([...closed]).toContain("broke");
  });
});

/* ------------------------------------------------------------------ the safety properties, on the mirror */

const QUICK: InvestRules = { ...DEFAULT_INVEST_RULES, min: 1, max: 1_000_000, dailyInvests: 1_000_000, dailyBits: 1_000_000_000, lockMs: 0 };
const T0 = 20_000 * 86_400_000;

function market(invest: InvestRules | null = QUICK, bits = 5_000, items = 400) {
  const book = newBook({ ...DEFAULT_PARAMS, dailyTrades: 1_000_000, ...(invest ? { invest } : {}) }, seededPools());
  const ledger = memoryLedger();
  for (const a of ["ann", "ben", "cat", "dan"]) {
    ledger.credit(a, BITS_TOKEN, bits);
    for (const q of book.pools) ledger.credit(a, itemToken(q.item), items);
  }
  return { book, ledger };
}

const pool = (book: MarketBook, item = "crumbs") => book.pools.find((p) => p.item === item)!;

/** Sells `item` to Gwei one at a time until her till can't pay for another. */
function drain(book: MarketBook, ledger: ReturnType<typeof memoryLedger>, who: string, item = "crumbs") {
  for (let i = 0; i < 2_000 && sellQuote(pool(book, item), 1, book.params.feeBps); i++) marketSell(book, ledger, who, item, 1, 0, T0);
}

describe("investing: what it can and can't do", () => {
  it("funds the till and moves no price", () => {
    const { book, ledger } = market();
    const before = pool(book);
    const quotes = (p: Pool) => [spotMilli(p), buyQuote(p, 5, 200), reserves(p).join()];
    const r = marketInvest(book, ledger, "ann", "crumbs", 300, T0);
    const after = pool(book);
    expect(after.bits).toBe(before.bits + 300);
    expect(after.virtualBits).toBe(before.virtualBits - 300);
    expect(quotes(after)).toEqual(quotes(before));
    expect(r).toMatchObject({ item: "crumbs", bits: 300, earned: 0, stake: 300, unlocksAtMs: T0 });
    expect(ledger.balance("ann", BITS_TOKEN)).toBe(4_700);
  });

  it("returns exactly what went in on a round trip, and leaves the pool as it was", () => {
    const { book, ledger } = market();
    const before = { ...pool(book) };
    marketInvest(book, ledger, "ann", "crumbs", 479, T0);
    marketWithdraw(book, ledger, "ann", "crumbs", 479, T0);
    expect(ledger.balance("ann", BITS_TOKEN)).toBe(5_000);
    expect(pool(book)).toMatchObject(before);
    expect(pool(book)).toMatchObject({ invested: 0, rewards: 0, feeCarry: 0 });
    expect(book.investors?.ann?.stakes).toEqual([]);
  });

  it("takes at most the curve's unfunded part, less one", () => {
    const { book, ledger } = market();
    expect(investRoom(pool(book))).toBe(479);
    expect(investRoom(pool(book, "sybil-goo"))).toBe(799);
    expect(investRoom(pool(book, "goblin-glider"))).toBe(1_199);
    expect(() => marketInvest(book, ledger, "ann", "crumbs", 480, T0)).toThrow("The vendor can take only 479 more Bits for crumbs");
    marketInvest(book, ledger, "ann", "crumbs", 479, T0);
    expect(investRoom(pool(book))).toBe(0);
  });

  it("reopens a broke shop, and the reason says why it was closed", () => {
    const { book, ledger } = market();
    drain(book, ledger, "ben");
    const broke = shopOf(pool(book), true);
    expect(broke.closed).toEqual(["broke"]);
    expect(broke).toMatchObject({ buying: false, selling: true });
    expect(broke.needs).toBe(tillShort(pool(book)));
    expect(broke.needs).toBeGreaterThan(0);
    expect(() => marketSell(book, ledger, "ben", "crumbs", 1, 0, T0)).toThrow(/till holds only/);

    marketInvest(book, ledger, "ann", "crumbs", 100, T0);
    const open = shopOf(pool(book), true);
    expect(open.closed).toEqual([]);
    expect(open).toMatchObject({ buying: true, invested: 100, needs: 0 });
    // She buys again, at the price she would have paid: the investment didn't move it.
    expect(marketSell(book, ledger, "ben", "crumbs", 1, 0, T0).side).toBe("sell");
  });

  it("pays investors half the fee on that pool's trades, pro rata, instead of burning it", () => {
    const { book, ledger } = market();
    marketInvest(book, ledger, "ann", "crumbs", 300, T0);
    marketInvest(book, ledger, "ben", "crumbs", 100, T0);
    const burnedBefore = book.burned;
    let fees = 0;
    let cuts = 0;
    for (let i = 0; i < 40; i++) {
      const t = i % 2 ? marketBuy(book, ledger, "cat", "crumbs", 5, 1e9, T0) : marketSell(book, ledger, "cat", "crumbs", 5, 0, T0);
      fees += t.fee;
      cuts += t.cut ?? 0;
    }
    expect(cuts).toBe(Math.floor(fees / 2));
    expect(book.burned - burnedBefore).toBe(fees - cuts);
    expect(pool(book).rewards).toBe(cuts);
    const ann = earned(book.investors!.ann!.stakes[0]!, pool(book));
    const ben = earned(book.investors!.ben!.stakes[0]!, pool(book));
    // 3:1 by stake, each rounded down.
    expect(ann + ben).toBeLessThanOrEqual(cuts);
    expect(ann + ben).toBeGreaterThanOrEqual(cuts - 2);
    expect(Math.abs(ann - 3 * ben)).toBeLessThanOrEqual(3);
    // Another pool's trades pay them nothing.
    marketBuy(book, ledger, "cat", "fee-bomb", 5, 1e9, T0);
    expect(earned(book.investors!.ann!.stakes[0]!, pool(book))).toBe(ann);
    const claim = marketClaim(book, ledger, "ann", "crumbs", T0);
    expect(claim).toMatchObject({ bits: 0, earned: ann, stake: 300 });
    expect(() => marketClaim(book, ledger, "ann", "crumbs", T0)).toThrow("Nothing earned yet");
  });

  it("burns the whole fee in a pool with no investors, exactly as before investing existed", () => {
    const a = market(QUICK);
    const b = market(null);
    for (let i = 0; i < 30; i++) {
      for (const { book, ledger } of [a, b]) {
        if (i % 3) marketSell(book, ledger, "cat", "crumbs", 3, 0, T0);
        else marketBuy(book, ledger, "cat", "crumbs", 4, 1e9, T0);
      }
    }
    expect(a.book.pools).toEqual(b.book.pools);
    expect(a.book.burned).toBe(b.book.burned);
    expect(investorCut(pool(a.book), 50, 5_000)).toEqual({ pool: pool(a.book), cut: 0 });
  });

  it("makes a stake wait when the till is empty, and never writes it off", () => {
    const { book, ledger } = market();
    drain(book, ledger, "ben");
    marketInvest(book, ledger, "ann", "crumbs", 200, T0);
    // Another player sells loot into the till Ann funded and takes the Bits.
    drain(book, ledger, "ben");
    const till = pool(book).bits;
    expect(till).toBeLessThan(200);
    expect(() => marketWithdraw(book, ledger, "ann", "crumbs", 200, T0)).toThrow(`The till can pay back only ${till} Bits right now; it refills as players buy crumbs`);
    expect(investorView(QUICK, book.pools, book.investors!.ann, T0).stakes[0]).toMatchObject({ bits: 200, withdrawable: till });
    // The Bits come back only as someone buys that stock.
    for (let i = 0; i < 40 && pool(book).bits < 200; i++) marketBuy(book, ledger, "cat", "crumbs", 5, 1e9, T0);
    const r = marketWithdraw(book, ledger, "ann", "crumbs", 200, T0);
    expect(r.bits).toBe(200);
    expect(ledger.balance("ann", BITS_TOKEN)).toBeGreaterThanOrEqual(5_000);
  });

  it("is first come, first served when the till holds less than everyone put in", () => {
    const { book, ledger } = market();
    drain(book, ledger, "cat");
    marketInvest(book, ledger, "ann", "crumbs", 100, T0);
    marketInvest(book, ledger, "ben", "crumbs", 100, T0);
    for (let i = 0; i < 400 && pool(book).bits > 110; i++) marketSell(book, ledger, "cat", "crumbs", 1, 0, T0);
    marketWithdraw(book, ledger, "ben", "crumbs", 100, T0);
    expect(() => marketWithdraw(book, ledger, "ann", "crumbs", 100, T0)).toThrow(/The till can pay back only/);
    expect(book.investors!.ann!.stakes[0]!.bits).toBe(100);
  });

  it("locks a stake after each top-up and bounds a day's investing", () => {
    const { book, ledger } = market(DEFAULT_INVEST_RULES);
    expect(() => marketInvest(book, ledger, "ann", "crumbs", 9, T0)).toThrow("Invest 10 to 500 Bits at a time");
    expect(() => marketInvest(book, ledger, "ann", "crumbs", 501, T0)).toThrow("Invest 10 to 500 Bits at a time");
    marketInvest(book, ledger, "ann", "crumbs", 100, T0);
    expect(() => marketWithdraw(book, ledger, "ann", "crumbs", 100, T0 + 59 * 60_000)).toThrow("Your stake unlocks in about 1 minutes");
    marketInvest(book, ledger, "ann", "sybil-goo", 500, T0);
    marketInvest(book, ledger, "ann", "goblin-glider", 400, T0);
    // 1,000 Bits in three calls: the Bits cap, before the count.
    expect(() => marketInvest(book, ledger, "ann", "fee-bomb", 10, T0)).toThrow("Daily market limit reached; it resets at midnight UTC");
    expect(investorView(DEFAULT_INVEST_RULES, book.pools, book.investors!.ann, T0)).toMatchObject({ investsLeft: 3, investBitsLeft: 0 });
    // The next UTC day starts fresh, and the lock has passed.
    const tomorrow = T0 + 86_400_000;
    expect(investorView(DEFAULT_INVEST_RULES, book.pools, book.investors!.ann, tomorrow)).toMatchObject({ investsLeft: 6, investBitsLeft: 1_000 });
    expect(marketWithdraw(book, ledger, "ann", "crumbs", 100, tomorrow).stake).toBe(0);
  });

  it("lets stakes come home after investing is switched off or the market closes, but takes no new ones", () => {
    const { book, ledger } = market();
    marketInvest(book, ledger, "ann", "crumbs", 50, T0);
    book.params = { ...book.params, invest: { ...QUICK, open: false } };
    expect(() => marketInvest(book, ledger, "ann", "crumbs", 50, T0)).toThrow("The vendor isn't taking investors right now");
    book.params = { ...book.params, open: false };
    expect(() => marketInvest(book, ledger, "ann", "crumbs", 50, T0)).toThrow("The market is closed");
    expect(shopsOf(book.pools, false)[0]!.closed).toContain("market-closed");
    expect(marketWithdraw(book, ledger, "ann", "crumbs", 50, T0).bits).toBe(50);
  });

  it("refuses investing on a market that has no investing rules (contract v2)", () => {
    const { book, ledger } = market(null);
    for (const call of [() => marketInvest(book, ledger, "ann", "crumbs", 50, T0), () => marketWithdraw(book, ledger, "ann", "crumbs", 50, T0), () => marketClaim(book, ledger, "ann", "crumbs", T0)]) {
      expect(call).toThrow(MarketError);
      try {
        call();
      } catch (error) {
        expect((error as MarketError).code).toBe("invest_unsupported");
      }
    }
    expect(book.investors).toBeUndefined();
    expect(ledger.balance("ann", BITS_TOKEN)).toBe(5_000);
  });

  it("keeps the books balanced through 4,000 random trades and investments", () => {
    const { book, ledger } = market({ ...QUICK, lockMs: 60_000 });
    const rand = rng(2026);
    const who = ["ann", "ben", "cat", "dan"];
    // What exists: the four wallets and the Bits Gwei's tills were seeded with.
    const minted = 4 * 5_000 + seededPools().reduce((s, p) => s + p.bits, 0);
    const y0 = new Map(book.pools.map((p) => [p.item, reserves(p)[1] - BigInt(p.bits)] as const));
    let now = T0;
    for (let i = 0; i < 4_000; i++) {
      now += Math.floor(rand() * 90_000);
      const a = who[Math.floor(rand() * 4)]!;
      const item = book.pools[Math.floor(rand() * book.pools.length)]!.item;
      const roll = rand();
      const before = reserves(pool(book, item));
      try {
        if (roll < 0.25) marketInvest(book, ledger, a, item, 1 + Math.floor(rand() * 300), now);
        else if (roll < 0.45) marketWithdraw(book, ledger, a, item, 1 + Math.floor(rand() * 300), now);
        else if (roll < 0.55) marketClaim(book, ledger, a, item, now);
        else if (roll < 0.75) marketBuy(book, ledger, a, item, 1 + Math.floor(rand() * 6), 1e9, now);
        else marketSell(book, ledger, a, item, 1 + Math.floor(rand() * 20), 0, now);
      } catch (error) {
        if (!(error instanceof MarketError)) throw error;
      }
      // Investing, withdrawing and claiming never move a reserve.
      if (roll < 0.55) expect(reserves(pool(book, item))).toEqual(before);
      const held = who.reduce((s, w) => s + ledger.balance(w, BITS_TOKEN), 0);
      const vendor = book.pools.reduce((s, p) => s + p.bits + (p.rewards ?? 0), 0);
      // Every Bit is with a player, in a till, owed to investors, or burned.
      expect(held + vendor + book.burned).toBe(minted);
      for (const p of book.pools) {
        const stakes = who.map((w) => book.investors?.[w]?.stakes.find((s) => s.item === p.item)).filter((s) => !!s);
        expect(stakes.reduce((s, st) => s + st!.bits, 0)).toBe(p.invested ?? 0);
        expect(stakes.reduce((s, st) => s + earned(st!, p), 0)).toBeLessThanOrEqual(p.rewards ?? 0);
        // virtualBits + invested is what the owner set: investors' Bits stand in for virtual ones.
        expect(BigInt(p.virtualBits) + BigInt(p.invested ?? 0)).toBe(y0.get(p.item)!);
        expect(p.virtualBits).toBeGreaterThanOrEqual(1);
      }
    }
    expect(book.pools.some((p) => (p.invested ?? 0) > 0)).toBe(true);
  });
});

describe("investing: the words on screen", () => {
  it("states the three risks before a player confirms", () => {
    expect(INVEST_RISKS).toHaveLength(3);
    expect(INVEST_RISKS[0]).toMatch(/waits when the till is empty/);
    expect(INVEST_RISKS[1]).toMatch(/first come, first served/);
    expect(INVEST_RISKS[2]).toMatch(/sell loot into a till you funded and take the Bits/);
    expect(INVEST_RISKS[2]).toMatch(/only come back when someone buys that stock/);
    // No hype: nothing promises a return.
    expect(INVEST_RISKS.join(" ")).not.toMatch(/guarantee|profit|APY|yield|risk-free|passive/i);
  });

  it("names each closed reason, and says how long a lock has left", () => {
    expect(closedReasons({ item: "x", virtualBits: 480, virtualItems: 40, bits: 0, stock: 0, escrow: 0 })).toEqual(["broke", "sold-out"]);
    for (const r of ["broke", "sold-out", "paused", "market-closed"] as const) expect(closedText(r)).toMatch(/^[A-Z][a-z -]+: /);
    expect(unlocksIn(1_000, 2_000)).toBeNull();
    expect(unlocksIn(30_000, 0)).toBe("under a minute");
    expect(unlocksIn(60_000, 0)).toBe("about 1 minute");
    expect(unlocksIn(45 * 60_000, 0)).toBe("about 45 minutes");
    expect(unlocksIn(3 * 3_600_000, 0)).toBe("about 3 hours");
  });
});
