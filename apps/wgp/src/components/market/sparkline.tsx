/**
 * Small market pieces shared by the market, The Daily Rug and the economy lab: a
 * sparkline (one series, a 2px ink line over a faint wash, the current price dotted; given
 * `steps` it is a step line at the real trade times, and says so when nothing traded),
 * the 24-hour change pill (a sign and an arrow, never color alone) and the number
 * formats (they live in src/lib/market/format.ts). Server-safe: no hooks.
 */
import { ArrowRight } from "@/components/icons";
import { formatChange } from "@/lib/market/format";
import { sparkPath, sparkQuiet, type SparkStep } from "@/lib/market/spark";

export { bitsText, formatBits, formatChange, formatPrice } from "@/lib/market/format";

/** A day of real price history: flat where nothing traded, a step at each trade's own time. */
function StepSparkline({ steps, label, className }: { steps: SparkStep[]; label: string; className: string }) {
  const path = sparkPath(steps);
  if (!path || sparkQuiet(steps)) {
    // Nothing moved: say so, rather than draw a shape that looks like a chart.
    return (
      <span role="img" aria-label={label} className={`relative flex items-center justify-center ${className}`}>
        <span aria-hidden className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-game-ink/20" />
        <span aria-hidden className="relative whitespace-nowrap rounded-full bg-game-paper px-2 text-[11px] font-semibold leading-4 text-game-muted">
          {path ? "No trades in 24 h" : "No price history yet"}
        </span>
      </span>
    );
  }
  const [ex, ey] = path.end;
  return (
    <span role="img" aria-label={label} className={`relative block ${className}`}>
      <svg aria-hidden viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={path.area} className="fill-game-ink/[0.07]" />
        <path d={path.line} className="fill-none stroke-game-ink" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-ink ring-2 ring-game-paper"
        style={{ left: `${ex}%`, top: `${(ey / 32) * 100}%` }}
      />
    </span>
  );
}

/**
 * `steps` (src/lib/market/spark.ts) draws recorded history truthfully. `points` alone is an
 * evenly spaced series from a source that keeps no times (the economy lab's days).
 */
export function Sparkline({ points, steps, label, className = "h-9 w-full" }: { points: number[]; steps?: SparkStep[]; label: string; className?: string }) {
  if (steps) return <StepSparkline steps={steps} label={label} className={className} />;
  const pts = points.length > 1 ? points : [points[0] ?? 0, points[0] ?? 0];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  // A 100 × 32 box with 3 units of headroom, so the line never touches the edges.
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * 100, hi === lo ? 16 : 29 - ((p - lo) / span) * 26] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const [ex, ey] = xy[xy.length - 1]!;
  return (
    <span role="img" aria-label={label} className={`relative block ${className}`}>
      <svg aria-hidden viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={`${line} L100 32 L0 32 Z`} className="fill-game-ink/[0.07]" />
        <path d={line} className="fill-none stroke-game-ink" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-ink ring-2 ring-game-paper"
        style={{ left: `${ex}%`, top: `${(ey / 32) * 100}%` }}
      />
    </span>
  );
}

/**
 * A price change as a pill: an arrow and a signed percent; "New" without history. `over`
 * is the span the change covers, said after the number for screen readers: the market's
 * pills are over 24 hours (the default), the economy lab's since its simulation opened.
 */
export function ChangePill({ change, over = "in 24 hours", className = "" }: { change: number | null; over?: string; className?: string }) {
  const pct = change === null ? null : Math.round(change * 100);
  const tone = pct === null || pct === 0 ? "bg-game-paper-2 text-game-ink" : pct > 0 ? "bg-game-mint text-game-ink" : "bg-game-hero text-game-on-hero";
  const rotate = pct === null || pct === 0 ? "" : pct > 0 ? "-rotate-45" : "rotate-45";
  return (
    <span
      className={`num inline-flex h-6 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border-2 border-game-ink pl-1 pr-1.5 text-[12px] font-bold leading-none ${tone} ${className}`}
    >
      <ArrowRight aria-hidden className={`size-3.5 ${rotate}`} strokeWidth={2.75} />
      {pct === null ? "New" : formatChange(change!)}
      <span className="sr-only">{pct === null ? ", no history yet" : ` ${over}`}</span>
    </span>
  );
}
