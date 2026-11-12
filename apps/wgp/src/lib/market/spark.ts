/**
 * A market sparkline's series, built only from price history that exists
 * (`market_prices` rows, src/server/market/history.ts). Pure: no clock, no database.
 *
 * A price here doesn't drift between trades: it holds until the next trade moves it. So
 * the series is a list of steps, each a time and the price from then on, and the chart
 * draws a flat line between them. Nothing is interpolated and nothing is invented:
 *
 * - With no rows and no known opening price, the series is empty: there is no history.
 * - With an opening price (the last row before the window) and no trades, it is one step:
 *   a flat line, which the chart labels "No trades in 24 hours".
 * - Without an opening price, the line starts at the first row's own time, not at the
 *   window's left edge.
 * - Rows that didn't change the price (hourly snapshots, a buy and a sell that cancel
 *   out) add no step. Player-to-player fills never move Gwei's price and are left out.
 * - If the price now differs from the last row's (a trade the history missed), the last
 *   step sits at the right edge: the chart ends on the true price.
 */

/** [t, priceMilli]: `t` is 0 at the window's start and 1 at its end; the price holds until the next step. */
export type SparkStep = [t: number, priceMilli: number];

export interface SparkRow {
  /** "trade", "snapshot" or "fill". */
  kind: string;
  priceMilli: number;
  at: Date | number;
}

/** Steps a series carries at most. A busier day is thinned to the last price in each slice of the window. */
export const SPARK_MAX_STEPS = 96;

const ms = (at: Date | number) => (typeof at === "number" ? at : at.getTime());

/**
 * The steps for one item. `rows` are that item's rows (any order, any time); `opening` is
 * its last price before the window, when there is one; `now` is the current spot price ×
 * 1000; `window` is the span the chart covers, in epoch ms.
 */
export function sparkSteps(rows: SparkRow[], opening: number | undefined, now: number, window: { from: number; to: number }): SparkStep[] {
  const span = window.to - window.from;
  if (!(span > 0)) return [];
  const mine = rows
    .filter((r) => r.kind !== "fill" && ms(r.at) >= window.from && ms(r.at) <= window.to)
    .sort((a, b) => ms(a.at) - ms(b.at));
  const steps: SparkStep[] = [];
  if (opening !== undefined) steps.push([0, opening]);
  for (const r of mine) {
    const last = steps[steps.length - 1];
    if (last && last[1] === r.priceMilli) continue;
    steps.push([(ms(r.at) - window.from) / span, r.priceMilli]);
  }
  const last = steps[steps.length - 1];
  if (last && last[1] !== now) steps.push([1, now]);
  return thinSteps(steps);
}

/** At most `max` steps: the first, then the last price in each equal slice of the window. Pure. */
export function thinSteps(steps: SparkStep[], max = SPARK_MAX_STEPS): SparkStep[] {
  if (steps.length <= max) return steps;
  const slices = max - 1;
  const out: SparkStep[] = [steps[0]!];
  let slice = -1;
  for (const step of steps.slice(1)) {
    const s = Math.min(slices - 1, Math.floor(step[0] * slices));
    if (s === slice) out[out.length - 1] = step;
    else {
      out.push(step);
      slice = s;
    }
  }
  return out;
}

/** True when the series never changes price: nothing traded (or nothing is known). */
export const sparkQuiet = (steps: SparkStep[]) => steps.every((s) => s[1] === steps[0]![1]);

/**
 * The chart's path in a `width` × `height` box with `pad` units of headroom: a move to the
 * first step, then a horizontal run to each next step's time and a vertical to its price,
 * and a last run to the right edge. `end` is where the current price sits. Null for an
 * empty series.
 */
export function sparkPath(steps: SparkStep[], width = 100, height = 32, pad = 3): { line: string; area: string; start: [number, number]; end: [number, number] } | null {
  if (steps.length === 0) return null;
  const prices = steps.map((s) => s[1]);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const y = (p: number) => (hi === lo ? height / 2 : height - pad - ((p - lo) / (hi - lo)) * (height - 2 * pad));
  const x = (t: number) => Math.min(1, Math.max(0, t)) * width;
  const f = (n: number) => Number(n.toFixed(2));
  const start: [number, number] = [f(x(steps[0]![0])), f(y(steps[0]![1]))];
  let line = `M${start[0]} ${start[1]}`;
  for (const [t, p] of steps.slice(1)) line += ` H${f(x(t))} V${f(y(p))}`;
  const end: [number, number] = [width, f(y(steps[steps.length - 1]![1]))];
  line += ` H${width}`;
  return { line, area: `${line} V${height} H${start[0]} Z`, start, end };
}
