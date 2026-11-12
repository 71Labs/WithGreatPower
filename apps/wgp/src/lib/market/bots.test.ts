import { describe, expect, it } from "vitest";

import { Economy, LAB_BROKE_SEED } from "./bots";
import { seededPools } from "./config";

const seededTill = seededPools().reduce((s, p) => s + p.bits, 0);

describe("the economy fast-forward", () => {
  it("is the same run for the same seed", () => {
    const run = (seed: number) => {
      const e = new Economy({ days: 10, bots: 30, seed });
      while (!e.done) e.step();
      return e.history.map((d) => [d.prices, d.trades, d.supply]);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it("moves prices without a patch, and never creates or loses a Bit", () => {
    const e = new Economy({ days: 21, bots: 60, seed: 42, params: { craftBits: 25 } });
    while (!e.done) e.step();
    const first = e.history[0]!;
    const last = e.history.at(-1)!;
    expect(e.history).toHaveLength(22);
    expect(Object.keys(last.prices).some((item) => last.prices[item] !== first.prices[item])).toBe(true);
    expect(e.history.reduce((n, d) => n + d.trades, 0)).toBeGreaterThan(100);
    expect(last.crafted).toBeGreaterThan(0);
    expect(last.burned).toBeGreaterThan(0);
    // Every Bit is somewhere: held, in Gwei's till, or burned.
    for (const d of e.history) expect(d.supply + d.burned).toBe(seededTill + d.minted);
  });

  it("has Sandwich Man go broke and recover in the lab's showcase seed", () => {
    const e = new Economy({ days: 21, bots: 60, seed: LAB_BROKE_SEED, params: { craftBits: 25 } });
    while (!e.done) e.step();
    const npc = e.history.map((d) => d.npc!);
    expect(npc.filter((d) => d.closed).length).toBeGreaterThanOrEqual(1);
    expect(npc.flatMap((d) => d.events).some((x) => x.reason.includes("Clearance"))).toBe(true);
    // Back in business by the end, and every Bit he has is still counted.
    expect(npc.at(-1)).toMatchObject({ status: "open", closed: false });
    expect(npc.at(-1)!.bits).toBeGreaterThan(120);
    for (const d of e.history) expect(d.supply + d.burned).toBe(seededTill + d.minted);
  });
});
