import { describe, expect, it } from "vitest";

import { SPARK_MAX_STEPS, sparkPath, sparkQuiet, sparkSteps, thinSteps, type SparkRow, type SparkStep } from "./spark";

const HOUR = 3_600_000;
const FROM = Date.UTC(2026, 10, 11, 12);
const WINDOW = { from: FROM, to: FROM + 24 * HOUR };
const at = (hours: number) => new Date(FROM + hours * HOUR);
const trade = (hours: number, priceMilli: number): SparkRow => ({ kind: "trade", priceMilli, at: at(hours) });
const snapshot = (hours: number, priceMilli: number): SparkRow => ({ kind: "snapshot", priceMilli, at: at(hours) });

describe("sparkSteps: a series only from history that exists", () => {
  it("is empty with no rows and no opening price: there is no history to draw", () => {
    expect(sparkSteps([], undefined, 12_000, WINDOW)).toEqual([]);
  });

  it("is one flat step when the price is known and nothing traded", () => {
    const steps = sparkSteps([], 12_000, 12_000, WINDOW);
    expect(steps).toEqual([[0, 12_000]]);
    expect(sparkQuiet(steps)).toBe(true);
  });

  it("hourly snapshots at the same price add nothing: an idle day is still one step", () => {
    const rows = Array.from({ length: 24 }, (_, h) => snapshot(h + 0.5, 12_000));
    expect(sparkSteps(rows, 12_000, 12_000, WINDOW)).toEqual([[0, 12_000]]);
  });

  it("puts one trade at its real time, flat before and after (the judge's one-trade card)", () => {
    // One buy 18 hours into the window; snapshots either side of it.
    const rows = [snapshot(6, 12_000), trade(18, 12_300), snapshot(19, 12_300)];
    const steps = sparkSteps(rows, 12_000, 12_300, WINDOW);
    expect(steps).toEqual([
      [0, 12_000],
      [0.75, 12_300],
    ]);
    expect(sparkQuiet(steps)).toBe(false);
  });

  it("two items with one trade each at different times get different shapes", () => {
    const early = sparkSteps([trade(2, 12_300)], 12_000, 12_300, WINDOW);
    const late = sparkSteps([trade(22, 12_300)], 12_000, 12_300, WINDOW);
    expect(sparkPath(early)!.line).not.toBe(sparkPath(late)!.line);
  });

  it("keeps every price change in order, whatever order the rows come in", () => {
    const rows = [trade(20, 11_700), trade(4, 12_300), trade(12, 12_600)];
    expect(sparkSteps(rows, 12_000, 11_700, WINDOW)).toEqual([
      [0, 12_000],
      [4 / 24, 12_300],
      [0.5, 12_600],
      [20 / 24, 11_700],
    ]);
  });

  it("without an opening price, starts at the first row's own time, not the left edge", () => {
    const steps = sparkSteps([trade(18, 12_300)], undefined, 12_300, WINDOW);
    expect(steps).toEqual([[0.75, 12_300]]);
    expect(sparkPath(steps)!.start[0]).toBe(75);
  });

  it("leaves out player-to-player fills (they never move Gwei's price) and rows outside the window", () => {
    const rows: SparkRow[] = [{ kind: "fill", priceMilli: 30_000, at: at(5) }, trade(-3, 9_000), trade(30, 9_000), trade(6, 12_300)];
    expect(sparkSteps(rows, 12_000, 12_300, WINDOW)).toEqual([
      [0, 12_000],
      [0.25, 12_300],
    ]);
  });

  it("ends on the true price when the history missed a trade", () => {
    expect(sparkSteps([trade(6, 12_300)], 12_000, 12_900, WINDOW)).toEqual([
      [0, 12_000],
      [0.25, 12_300],
      [1, 12_900],
    ]);
  });

  it("every price it carries is one that was recorded, the opening or the price now", () => {
    const rows = [trade(1, 12_100), snapshot(2, 12_100), trade(3, 12_450), trade(9, 12_200), snapshot(10, 12_200), trade(23, 12_800)];
    const steps = sparkSteps(rows, 12_000, 12_800, WINDOW);
    const known = new Set([12_000, 12_800, ...rows.map((r) => r.priceMilli)]);
    for (const [t, p] of steps) {
      expect(known.has(p)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    // And every step that isn't the opening sits exactly on a row's time.
    const times = new Set(rows.map((r) => ((r.at as Date).getTime() - FROM) / (24 * HOUR)));
    for (const [t] of steps.slice(1)) expect(times.has(t)).toBe(true);
  });

  it("an empty or backwards window draws nothing", () => {
    expect(sparkSteps([trade(1, 1)], 1, 1, { from: 5, to: 5 })).toEqual([]);
  });
});

describe("thinSteps", () => {
  it("leaves a quiet day alone", () => {
    const steps: SparkStep[] = [
      [0, 1],
      [0.5, 2],
    ];
    expect(thinSteps(steps)).toBe(steps);
  });

  it("thins a busy day to the cap, keeping the first step, the last price and time order", () => {
    const steps: SparkStep[] = Array.from({ length: 1_000 }, (_, i) => [i / 1_000, 10_000 + ((i * 37) % 500)]);
    const out = thinSteps(steps);
    expect(out.length).toBeLessThanOrEqual(SPARK_MAX_STEPS);
    expect(out[0]).toEqual(steps[0]);
    expect(out[out.length - 1]).toEqual(steps[steps.length - 1]);
    for (let i = 1; i < out.length; i++) expect(out[i]![0]).toBeGreaterThan(out[i - 1]![0]);
    // Thinning drops steps; it never makes one up.
    for (const s of out) expect(steps).toContainEqual(s);
  });
});

describe("sparkPath: a step line, never a slope", () => {
  it("is null for an empty series", () => {
    expect(sparkPath([])).toBeNull();
  });

  it("a quiet series is one horizontal line across the middle", () => {
    expect(sparkPath([[0, 12_000]])).toMatchObject({ line: "M0 16 H100", start: [0, 16], end: [100, 16] });
  });

  it("moves only horizontally and vertically: flat until the trade, then straight up at its time", () => {
    const path = sparkPath([
      [0, 12_000],
      [0.75, 12_300],
    ])!;
    expect(path.line).toBe("M0 29 H75 V3 H100");
    expect(path.line).not.toMatch(/L/);
    expect(path.end).toEqual([100, 3]);
    expect(path.area).toBe("M0 29 H75 V3 H100 V32 H0 Z");
  });
});
