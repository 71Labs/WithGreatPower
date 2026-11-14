/**
 * `pnpm traction`'s maths, run on fixtures (no network): which calls count as players', how
 * they are bucketed by UTC day (empty days kept, new accounts counted on their first day), and
 * how retention and concentration are worked out. docs/TRACTION.md's tables are this output.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOT } from "./repo";

interface Call {
  account: string;
  method: string;
  day: string;
  ok: boolean;
}
interface Day {
  day: string;
  activeAccounts: number;
  newAccounts: number;
  calls: number;
  marketCalls: number;
  byMethod: Record<string, number>;
  windows: string[];
}
interface Script {
  utcDay(nanos: string | number): string;
  playerCalls(rows: unknown[], contract?: string): { calls: Call[]; excluded: { author: number; npc: number; team: number } };
  bucketByDay(calls: Call[], opts?: { until?: string }): Day[];
  retention(calls: Call[]): { accounts: number; activeOn2PlusDays: number; activeOn3PlusDays: number; medianActiveDays: number; histogram: Record<string, number> };
  concentration(calls: Call[]): { calls: number; accounts: number; top1Calls: number; top3Calls: number; top1Share: number; top3Share: number };
  windowsOn(day: string): string[];
  rewardMints(rows: unknown[]): { account: string; day: string }[];
}
const script = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/traction.mjs")).href)) as Script;

const GAME = "game.wgpnear.near";
/** A NearBlocks timestamp (nanoseconds, as a string) for a UTC instant. */
const ns = (iso: string) => `${BigInt(Date.parse(iso)) * 1_000_000n}`;
let n = 0;
const row = (from: string, iso: string, methods: string[], ok = true) => ({
  receipt_id: `r${++n}`,
  predecessor_account_id: from,
  receiver_account_id: GAME,
  block_timestamp: ns(iso),
  actions: methods.map((method) => ({ action: "FUNCTION_CALL", method })),
  outcomes: { status: ok },
});
const c = (account: string, day: string, method = "register_hero"): Call => ({ account, method, day, ok: true });

describe("pnpm traction's maths, on fixtures", () => {
  it("reads a NearBlocks nanosecond timestamp as a UTC day", async () => {
    const s = await script();
    expect(s.utcDay(ns("2026-11-06T23:59:59.999Z"))).toBe("2026-11-06");
    expect(s.utcDay(ns("2026-11-07T00:00:00Z"))).toBe("2026-11-07");
  });

  it("counts only players' calls: not the team's, the contract's, the author's or Sandwich Man's", async () => {
    const s = await script();
    const first = row("alice.wgpnear.near", "2026-11-06T10:00:00Z", ["register_hero"]);
    const rows = [
      row("wgpnear.near", "2026-11-05T09:00:00Z", ["new"]),
      row("operator.wgpnear.near", "2026-11-06T09:00:00Z", ["mint_rewards"]),
      first,
      first, // the same receipt on two pages is one call
      row("alice.wgpnear.near", "2026-11-06T11:00:00Z", ["craft_suit", "equip_suit"]),
      row("bob.near", "2026-11-07T01:00:00Z", ["market_buy"], false),
      row("alice.wgpnear.near", "2026-11-07T02:00:00Z", ["ft_transfer"]),
      row("sele.wgpnear.near", "2026-11-07T03:00:00Z", ["register_hero", "market_buy"]),
      row("sandwich.wgpnear.near", "2026-11-07T04:00:00Z", ["market_buy"]),
      row("relayer.wgpnear.near", "2026-11-07T05:00:00Z", ["register_hero"]),
    ];
    const { calls, excluded } = s.playerCalls(rows, GAME);
    expect(calls).toEqual([
      { account: "alice.wgpnear.near", method: "register_hero", day: "2026-11-06", ok: true },
      { account: "alice.wgpnear.near", method: "craft_suit", day: "2026-11-06", ok: true },
      { account: "alice.wgpnear.near", method: "equip_suit", day: "2026-11-06", ok: true },
      // A failed call is still one the account sent.
      { account: "bob.near", method: "market_buy", day: "2026-11-07", ok: false },
    ]);
    expect(excluded).toEqual({ author: 2, npc: 1, team: 1 });
  });

  it("counts the operator's reward mints per recipient and day, leaving out the author's and the NPC's", async () => {
    const s = await script();
    const mint = (iso: string, accounts: string[], ok = true) => ({
      ...row("operator.wgpnear.near", iso, []),
      actions: [{ action: "FUNCTION_CALL", method: "mint_rewards", args: JSON.stringify({ batch: accounts.map((account_id) => ({ account_id, items: [] })) }) }],
      outcomes: { status: ok },
    });
    const rows = [
      mint("2026-11-06T10:00:00Z", ["alice.wgpnear.near", "bob.near"]),
      mint("2026-11-07T10:00:00Z", ["sele.wgpnear.near", "sandwich.wgpnear.near", "alice.wgpnear.near"]),
      mint("2026-11-07T11:00:00Z", ["carol.near"], false),
      // Only the team's accounts mint: the same call from anyone else is not a reward.
      { ...mint("2026-11-07T12:00:00Z", ["dave.near"]), predecessor_account_id: "dave.near" },
    ];
    expect(s.rewardMints(rows)).toEqual([
      { account: "alice.wgpnear.near", day: "2026-11-06" },
      { account: "bob.near", day: "2026-11-06" },
      { account: "alice.wgpnear.near", day: "2026-11-07" },
    ]);
  });

  it("buckets by UTC day from the first call, keeps empty days and counts an account as new only on its first day", async () => {
    const s = await script();
    const calls = [c("a", "2026-11-06"), c("a", "2026-11-06", "craft_suit"), c("b", "2026-11-06"), c("a", "2026-11-08", "market_buy"), c("c", "2026-11-08")];
    const days = s.bucketByDay(calls, { until: "2026-11-09" });
    expect(days.map((d) => d.day)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(days.map((d) => [d.activeAccounts, d.newAccounts, d.calls, d.marketCalls])).toEqual([
      [2, 2, 3, 0],
      [0, 0, 0, 0],
      [2, 1, 2, 1],
      [0, 0, 0, 0],
    ]);
    expect(days[0].byMethod).toEqual({ register_hero: 2, craft_suit: 1 });
    // `until` before the last call never cuts days off.
    expect(s.bucketByDay(calls, { until: "2026-11-07" }).at(-1)?.day).toBe("2026-11-08");
    expect(s.bucketByDay([])).toEqual([]);
  });

  it("marks the relayer outage and Season 1's airdrops on the days they touch", async () => {
    const s = await script();
    expect(s.windowsOn("2026-11-04")).toEqual([]);
    expect(s.windowsOn("2026-11-12")).toEqual(["airdrops"]);
    expect(s.windowsOn("2026-11-13")).toEqual(["airdrops", "relayer-outage"]);
    expect(s.windowsOn("2026-11-14")).toEqual(["airdrops", "relayer-outage"]);
    expect(s.windowsOn("2026-11-15")).toEqual([]);
  });

  it("counts retention by distinct active days, with the median", async () => {
    const s = await script();
    // a: 3 days, b: 2 days (two calls on one of them), c and d: 1 day.
    const calls = [c("a", "2026-11-06"), c("a", "2026-11-07"), c("a", "2026-11-09"), c("b", "2026-11-06"), c("b", "2026-11-06"), c("b", "2026-11-10"), c("c", "2026-11-07"), c("d", "2026-11-08")];
    expect(s.retention(calls)).toEqual({ accounts: 4, activeOn2PlusDays: 2, activeOn3PlusDays: 1, medianActiveDays: 1.5, histogram: { 1: 2, 2: 1, 3: 1 } });
    expect(s.retention([c("a", "2026-11-06"), c("b", "2026-11-06"), c("c", "2026-11-06"), c("c", "2026-11-07")]).medianActiveDays).toBe(1);
    expect(s.retention([]).medianActiveDays).toBe(0);
  });

  it("works out the share of calls from the busiest 1 and 3 accounts", async () => {
    const s = await script();
    const calls = [...Array(5)].map(() => c("a", "2026-11-06")).concat([c("b", "2026-11-06"), c("b", "2026-11-06"), c("c", "2026-11-06"), c("d", "2026-11-06"), c("e", "2026-11-06")]);
    expect(s.concentration(calls)).toEqual({ calls: 10, accounts: 5, top1Calls: 5, top3Calls: 8, top1Share: 0.5, top3Share: 0.8 });
    expect(s.concentration([])).toMatchObject({ calls: 0, top1Share: 0, top3Share: 0 });
  });
});
