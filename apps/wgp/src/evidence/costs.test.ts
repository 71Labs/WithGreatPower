/**
 * `pnpm costs`' math, run on fixtures shaped like NearBlocks' rows and the RPC's `view_account`
 * (scripts/costs.mjs). The figures in docs/SUSTAINABILITY.md's "Measured costs" section are this
 * math's output on mainnet history, so what they mean is settled here: a relayed action is a
 * meta-transaction the relayer signed, gas refunds are not counted twice, the daily average
 * includes idle days, the relayer's runway ends at its cut-off and not at zero, and a refill is
 * priced after 1Click's fee. No network: every input is a fixture.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOT } from "./repo";

interface Txn {
  hash: string;
  at: number;
  costNear: number;
  feeNear: number;
  depositNear: number;
  ok: boolean;
}
interface Window {
  days: number;
  buckets: { from: string; near: number; count: number }[];
  totalNear: number;
  count: number;
  perDayNear: number;
  busiestDayNear: number;
}
interface View {
  amount: string;
  locked?: string;
  storage_usage: number;
}
interface Report {
  relayer: { actions: number; failedActions: number; gasBurntNearMedian: number; nearPerActionMean: number; totalNear: number; window: Window; availableNear: number; runwayDays: number | null; runwayDaysAtBusiestDay: number | null; refills: { usd: number; near: number | null; actions: number | null }[] };
  operator: { batches: number; runsMinted: number | null; nearPerRun: number | null; totalNear: number; runwayDays: number | null };
  factory: { playerAccounts: number; nearPerAccountMean: number; moreAccounts: number | null };
  contract: { bytes: number; lockedNear: number; freeNear: number; headroomBytes: number };
  perPlayer: { players: number; actionsPerPlayer: number; runsPerPlayer: number; accountNear: number; actionsNear: number; mintsNear: number; totalNear: number; totalUsd: number | null };
}
interface Script {
  median(xs: number[]): number | null;
  mean(xs: number[]): number | null;
  signedTxns(rows: unknown[], signer: string, pick?: (r: unknown) => boolean): Txn[];
  isRelayed(r: unknown): boolean;
  batchSize(args: unknown): number | null;
  dailySpend(txns: { at: number; costNear: number }[], now: number, days?: number): Window;
  runwayDays(spendableNear: number, perDayNear: number): number | null;
  availableNear(view: View): number;
  storageOf(view: View): { bytes: number; lockedNear: number; freeNear: number; headroomBytes: number };
  refillBuys(usd: number, nearUsd: number | null, nearPerAction: number | null, feeRate?: number): { usd: number; near: number | null; actions: number | null };
  costPerPlayer(input: { accountNear: number; actionsPerPlayer: number; nearPerAction: number; runsPerPlayer: number; nearPerRun: number }): { accountNear: number; actionsNear: number; mintsNear: number; totalNear: number };
  measure(input: { rows: Record<string, unknown[]>; views: Record<string, View>; nearUsd: number | null; now: number }): Report;
  render(report: Report): string;
}
const script = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/costs.mjs")).href)) as Script;

const NOW = Date.parse("2026-11-14T21:00:00Z");
const DAY = 86_400_000;
const Y = 1e24;
const ns = (ms: number) => String(BigInt(ms) * 1_000_000n);
const yocto = (near: number) => String(BigInt(Math.round(near * 1e6)) * 10n ** 18n);

/** A NearBlocks row: the first receipt of a transaction, or a refund back to the signer. */
function row(o: { hash: string; from: string; to: string; at: number; fee?: number; deposit?: number; actions: { action: string; method?: string; args?: string }[]; ok?: boolean }) {
  return {
    transaction_hash: o.hash,
    predecessor_account_id: o.from,
    receiver_account_id: o.to,
    block_timestamp: ns(o.at),
    actions: o.actions.map((a) => ({ method: null, args: null, deposit: 0, ...a })),
    actions_agg: { deposit: (o.deposit ?? 0) * Y },
    outcomes: { status: o.ok ?? true },
    outcomes_agg: { transaction_fee: (o.fee ?? 0) * Y },
  };
}
const relayed = (hash: string, at: number, fee: number, ok = true) => row({ hash, from: "relayer.wgpnear.near", to: "p1.wgpnear.near", at, fee, ok, actions: [{ action: "DELEGATE_ACTION" }, { action: "FUNCTION_CALL", method: "market_buy" }] });
const refund = (hash: string, at: number) => row({ hash, from: "system", to: "relayer.wgpnear.near", at, actions: [{ action: "TRANSFER" }] });
const mint = (hash: string, at: number, fee: number, runs: number) => row({ hash, from: "operator.wgpnear.near", to: "game.wgpnear.near", at, fee, actions: [{ action: "FUNCTION_CALL", method: "mint_rewards", args: JSON.stringify({ batch: Array.from({ length: runs }, (_, i) => ({ account_id: `p${i}.wgpnear.near`, nonce: 1 })) }) }] });
const create = (hash: string, name: string, at: number, fee: number, deposit = 0) => row({ hash, from: "wgpnear.near", to: name, at, fee, deposit, actions: [{ action: "CREATE_ACCOUNT" }, { action: "ADD_KEY" }] });
const view = (near: number, bytes: number): View => ({ amount: yocto(near), locked: "0", storage_usage: bytes });

describe("pnpm costs' math, on fixtures", () => {
  it("takes the median and the mean of what each action cost", async () => {
    const { median, mean } = await script();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(mean([1, 2, 6])).toBe(3);
    expect(mean([])).toBeNull();
  });

  it("counts each transaction the relayer signed once, at its whole fee, and never a refund", async () => {
    const { signedTxns, isRelayed } = await script();
    const rows = [
      relayed("a", NOW - DAY, 0.0004),
      refund("a", NOW - DAY + 1000),
      relayed("a", NOW - DAY, 0.0004), // NearBlocks can list a row twice as a page shifts
      relayed("b", NOW - 2 * DAY, 0.0006, false),
      row({ hash: "c", from: "relayer.wgpnear.near", to: "game.wgpnear.near", at: NOW, fee: 0.0001, deposit: 1, actions: [{ action: "TRANSFER" }] }),
    ];
    const txns = signedTxns(rows, "relayer.wgpnear.near", isRelayed);
    expect(txns.map((t) => t.hash)).toEqual(["b", "a"]);
    expect(txns[1]!.costNear).toBeCloseTo(0.0004, 12);
    expect(txns[0]!.ok).toBe(false);
    // The 1 NEAR transfer out is the relayer's, but not a player action.
    expect(signedTxns(rows, "relayer.wgpnear.near").find((t) => t.hash === "c")!.costNear).toBeCloseTo(1.0001, 12);
  });

  it("reads how many runs a mint_rewards batch carried, and says so when it can't", async () => {
    const { batchSize } = await script();
    expect(batchSize(JSON.stringify({ batch: [{}, {}, {}] }))).toBe(3);
    expect(batchSize({ batch: [{}] })).toBe(1);
    expect(batchSize("not json")).toBeNull();
    expect(batchSize(null)).toBeNull();
  });

  it("buckets spend into the last 7 days, and averages over all 7, idle days included", async () => {
    const { dailySpend } = await script();
    const w = dailySpend(
      [
        { at: NOW - 8 * DAY, costNear: 5 }, // outside the window
        { at: NOW - 6.5 * DAY, costNear: 0.7 },
        { at: NOW - 1.5 * DAY, costNear: 0.2 },
        { at: NOW - 0.5 * DAY, costNear: 0.5 },
        { at: NOW - 0.25 * DAY, costNear: 0.0 },
      ],
      NOW,
    );
    expect(w.buckets).toHaveLength(7);
    expect(w.buckets.map((b) => b.count)).toEqual([1, 0, 0, 0, 0, 1, 2]);
    expect(w.buckets[0]!.from).toBe("2026-11-07T21:00:00.000Z");
    expect(w.totalNear).toBeCloseTo(1.4, 12);
    expect(w.perDayNear).toBeCloseTo(0.2, 12);
    expect(w.busiestDayNear).toBeCloseTo(0.7, 12);
  });

  it("works out runway as spendable over daily spend, and none when nothing is spent", async () => {
    const { runwayDays } = await script();
    expect(runwayDays(3, 0.2)).toBeCloseTo(15, 12);
    expect(runwayDays(-0.5, 0.2)).toBe(0);
    expect(runwayDays(3, 0)).toBeNull();
  });

  it("takes available balance as NEAR's RPC does: the balance less what storage holds", async () => {
    const { availableNear, storageOf } = await script();
    // 100,000 bytes hold 1 NEAR at 10^19 yoctoNEAR a byte.
    expect(availableNear(view(2.5, 100_000))).toBeCloseTo(1.5, 9);
    expect(availableNear({ amount: yocto(2), locked: yocto(3), storage_usage: 100_000 })).toBeCloseTo(2, 9);
    const s = storageOf(view(5.49, 375_000));
    expect(s.lockedNear).toBeCloseTo(3.75, 9);
    expect(s.freeNear).toBeCloseTo(1.74, 9);
    expect(s.headroomBytes).toBe(174_000);
  });

  it("prices a Gas tank refill after 1Click's 0.2% fee, in whole relayed actions", async () => {
    const { refillBuys } = await script();
    // $2 at $2.50 a NEAR is 0.8 NEAR, 0.7984 after the fee; at 0.0004 NEAR an action, 1,996 actions.
    const r = refillBuys(2, 2.5, 0.0004);
    expect(r.near).toBeCloseTo(0.7984, 12);
    expect(r.actions).toBe(1996);
    expect(refillBuys(2, null, 0.0004).actions).toBeNull();
    expect(refillBuys(2, 2.5, null).actions).toBeNull();
  });

  it("adds a player's account, relayed actions and minted runs into one cost", async () => {
    const { costPerPlayer } = await script();
    const c = costPerPlayer({ accountNear: 0.001, actionsPerPlayer: 10, nearPerAction: 0.0004, runsPerPlayer: 5, nearPerRun: 0.0002 });
    expect(c.actionsNear).toBeCloseTo(0.004, 12);
    expect(c.mintsNear).toBeCloseTo(0.001, 12);
    expect(c.totalNear).toBeCloseTo(0.006, 12);
  });

  it("measures the whole report from rows and views: the relayer's runway ends at its 1 NEAR cut-off", async () => {
    const { measure, render } = await script();
    const rows = {
      relayer: [relayed("r1", NOW - 0.5 * DAY, 0.0004), relayed("r2", NOW - 1.5 * DAY, 0.0004), relayed("r3", NOW - 2.5 * DAY, 0.0007), refund("r1", NOW - 0.5 * DAY), relayed("r0", NOW - 20 * DAY, 0.0005)],
      operator: [mint("m1", NOW - DAY, 0.002, 4), mint("m2", NOW - 3 * DAY, 0.003, 6)],
      factory: [create("f1", "p1.wgpnear.near", NOW - 9 * DAY, 0.0005), create("f2", "p2.wgpnear.near", NOW - 2 * DAY, 0.0007), create("f3", "sandwich.wgpnear.near", NOW - DAY, 0.0005, 0.3)],
    };
    const views = { relayer: view(1.5, 500), operator: view(0.5, 300), factory: view(0.4, 2000), contract: view(5.49, 375_000) };
    const r = measure({ rows, views, nearUsd: 2.5, now: NOW });

    expect(r.relayer.actions).toBe(4);
    expect(r.relayer.gasBurntNearMedian).toBeCloseTo(0.00045, 12);
    expect(r.relayer.nearPerActionMean).toBeCloseTo(0.0005, 12);
    expect(r.relayer.window.count).toBe(3);
    expect(r.relayer.window.perDayNear).toBeCloseTo(0.0015 / 7, 12);
    // Available is 1.5 less 500 bytes' storage (0.005); the relay stops at 1 NEAR.
    expect(r.relayer.availableNear).toBeCloseTo(1.495, 9);
    expect(r.relayer.runwayDays).toBeCloseTo(0.495 / (0.0015 / 7), 6);
    expect(r.relayer.runwayDaysAtBusiestDay).toBeCloseTo(0.495 / 0.0007, 6);
    expect(r.relayer.refills.map((f) => f.actions)).toEqual([798, 1596, 3992]);

    expect(r.operator.batches).toBe(2);
    expect(r.operator.runsMinted).toBe(10);
    expect(r.operator.nearPerRun).toBeCloseTo(0.0005, 12);
    expect(r.operator.runwayDays).toBeCloseTo(0.497 / (0.005 / 7), 6);

    // Sandwich Man's account is the team's, not a player's.
    expect(r.factory.playerAccounts).toBe(2);
    expect(r.factory.nearPerAccountMean).toBeCloseTo(0.0006, 12);
    expect(r.factory.moreAccounts).toBe(Math.floor((0.4 - 0.02) / 0.0006));

    expect(r.contract.headroomBytes).toBe(174_000);

    expect(r.perPlayer.actionsPerPlayer).toBe(2);
    expect(r.perPlayer.runsPerPlayer).toBe(5);
    expect(r.perPlayer.totalNear).toBeCloseTo(0.0006 + 2 * 0.0005 + 5 * 0.0005, 12);
    expect(r.perPlayer.totalUsd).toBeCloseTo((0.0006 + 0.001 + 0.0025) * 2.5, 12);

    const text = render(r);
    expect(text).toMatch(/measured 2026-11-14 21:00:00 UTC/);
    expect(text).toMatch(/measured: relayed player actions/);
    expect(text).toMatch(/derived: runway to the cut-off, 7-day average/);
    expect(text).toMatch(/estimate: a \$2 Gas tank refill buys\s+1,596 relayed actions/);
  });
});
