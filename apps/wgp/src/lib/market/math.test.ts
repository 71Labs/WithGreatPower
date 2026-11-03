/**
 * The TypeScript market math against the contract's: both check
 * contracts/wgp/market-vectors.json (generated from the Rust implementation), so the
 * simulated market and /lab/economy price exactly as the chain does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, defaultPoolConfigs, seededPools, setMarketParamsArgs } from "./config";
import { afterBuy, afterSell, buyCost, feeOf, lessSlippage, listingBounds, sellPayout, spotMilli, withSlippage, type Pool } from "./math";

interface RawPool {
  virtual_bits: string;
  virtual_items: string;
  bits: string;
  stock: string;
}

interface Vectors {
  cases: {
    pool: RawPool;
    amount: number;
    fee_bps: number;
    floor_bps: number;
    ceiling_bps: number;
    spot_milli: string;
    buy_cost: string | null;
    buy_fee: string;
    sell_payout: string;
    sell_fee: string;
    floor: string;
    ceiling: string;
  }[];
  sequences: {
    pool: RawPool;
    fee_bps: number;
    steps: { side: "buy" | "sell"; amount: number; bits: string; fee: string; after: { bits: string; stock: string }; spot_milli: string }[];
  }[];
}

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../contracts/wgp/market-vectors.json", import.meta.url)), "utf8")) as Vectors;

const pool = (r: RawPool): Pool => ({
  item: "x",
  virtualBits: Number(r.virtual_bits),
  virtualItems: Number(r.virtual_items),
  bits: Number(r.bits),
  stock: Number(r.stock),
  escrow: 0,
});

describe("market math matches the contract", () => {
  it("prices every shared case the same", () => {
    expect(vectors.cases.length).toBeGreaterThan(100);
    for (const c of vectors.cases) {
      const p = pool(c.pool);
      const label = JSON.stringify(c);
      expect(spotMilli(p), label).toBe(Number(c.spot_milli));
      const cost = buyCost(p, c.amount);
      expect(cost === null ? null : String(cost), label).toBe(c.buy_cost);
      if (cost !== null) expect(feeOf(cost, c.fee_bps), label).toBe(Number(c.buy_fee));
      const payout = sellPayout(p, c.amount);
      expect(payout, label).toBe(Number(c.sell_payout));
      expect(feeOf(payout, c.fee_bps), label).toBe(Number(c.sell_fee));
      expect(listingBounds(p, c.amount, c.floor_bps, c.ceiling_bps), label).toEqual([Number(c.floor), Number(c.ceiling)]);
    }
  });

  it("walks every shared sequence of trades to the same pools", () => {
    for (const seq of vectors.sequences) {
      let p = pool(seq.pool);
      for (const step of seq.steps) {
        let bits: number;
        let fee: number;
        if (step.side === "buy") {
          const cost = buyCost(p, step.amount)!;
          fee = feeOf(cost, seq.fee_bps);
          bits = cost + fee;
          p = afterBuy(p, step.amount, cost);
        } else {
          const pay = sellPayout(p, step.amount);
          fee = feeOf(pay, seq.fee_bps);
          bits = pay - fee;
          p = afterSell(p, step.amount, pay);
        }
        expect([bits, fee, p.bits, p.stock, spotMilli(p)]).toEqual([
          Number(step.bits),
          Number(step.fee),
          Number(step.after.bits),
          Number(step.after.stock),
          Number(step.spot_milli),
        ]);
      }
    }
  });
});

describe("market config", () => {
  it("starts commons at 12 Bits, uncommons at 40 and rares at 150", () => {
    const pools = seededPools();
    const price = (item: string) => spotMilli(pools.find((p) => p.item === item)!) / 1000;
    expect(price("crumbs")).toBe(12);
    expect(price("sybil-goo")).toBe(40);
    expect(price("goblin-glider")).toBe(150);
    expect(pools).toHaveLength(8);
  });

  it("matches the curves the contract tests open the market with", () => {
    const crumbs = defaultPoolConfigs().find((p) => p.item === "crumbs")!;
    expect(crumbs).toEqual({ item: "crumbs", virtualBits: 480, virtualItems: 40, seedBits: 480, seedStock: 40 });
    const args = setMarketParamsArgs();
    expect(args.params).toMatchObject({ fee_bps: 200, floor_bps: 5000, ceiling_bps: 40000, daily_fill_bits: "3000", craft_bits: "0" });
    expect(args.pools[0]).toEqual({ item: "fee-bomb", virtual_bits: "480", virtual_items: "40", seed_bits: "480", seed_stock: "40" });
    expect(DEFAULT_PARAMS.feeBps).toBe(200);
  });

  it("pads slippage limits the right way", () => {
    expect(withSlippage(100, 300)).toBe(103);
    expect(withSlippage(101, 300)).toBe(105);
    expect(lessSlippage(100, 300)).toBe(97);
    expect(lessSlippage(101, 300)).toBe(97);
  });
});
