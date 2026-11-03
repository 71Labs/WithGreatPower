"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";

export interface CurvePoint {
  /** Items bought from the stall so far. */
  bought: number;
  /** Gwei's spot price after that many, in Bits. */
  price: number;
}

const Y_MAX = 50;
const Y_TICKS = [0, 10, 20, 30, 40, 50];
const bits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * One series, so no legend: the title names it. A 2px line with a 10% wash, end dots with
 * direct labels, and a crosshair that snaps to the nearest item on hover or with the arrow
 * keys. Labels are HTML over a stretched SVG, so text and strokes keep their size.
 */
export function PriceCurve({ points, item }: { points: CurvePoint[]; item: string }) {
  const [active, setActive] = useState<number | null>(null);
  const last = points.length - 1;
  const x = (i: number) => (points[i]!.bought / points[last]!.bought) * 100;
  const y = (price: number) => 100 - (price / Y_MAX) * 100;
  const line = points.map((p, i) => `${x(i)},${y(p.price)}`).join(" ");
  const first = points[0]!;
  const end = points[last]!;
  const at = active === null ? null : points[active]!;

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setActive(Math.round(t * last));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? -1) + step));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? 1) - step));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative pb-7 pl-9 pr-2 pt-3">
        {/* Gridlines and the y axis. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-2 bottom-7 left-9 top-3">
          {Y_TICKS.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-game-paper-2" style={{ top: `${y(t)}%` }}>
              <span className="num absolute -left-9 w-7 -translate-y-1/2 text-right text-[12px] leading-4 text-game-muted">{t}</span>
            </div>
          ))}
        </div>

        <div
          role="group"
          tabIndex={0}
          aria-label={`${item} price chart. Use the arrow keys to read the price after each one bought.`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="relative h-[220px] touch-pan-y rounded-[4px] focus-visible:outline-offset-4 sm:h-[260px]"
        >
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <polygon points={`0,100 ${line} 100,100`} className="fill-game-hero/10" />
            <polyline points={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-game-hero" />
          </svg>

          {/* End dots with direct labels. */}
          <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-hero ring-2 ring-game-paper" style={{ left: `${x(0)}%`, top: `${y(first.price)}%` }} />
          <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-hero ring-2 ring-game-paper" style={{ left: `${x(last)}%`, top: `${y(end.price)}%` }} />
          <span aria-hidden className="num pointer-events-none absolute whitespace-nowrap text-[13px] font-semibold leading-4 text-game-ink" style={{ left: `${x(0)}%`, top: `calc(${y(first.price)}% - 26px)` }}>
            {bits.format(first.price)} Bits
          </span>
          <span aria-hidden className="num pointer-events-none absolute -translate-x-full whitespace-nowrap text-[13px] font-semibold leading-4 text-game-ink" style={{ left: `${x(last)}%`, top: `calc(${y(end.price)}% - 26px)` }}>
            {bits.format(end.price)} Bits
          </span>

          {/* The crosshair and its readout. */}
          {at && active !== null ? (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-game-ink/50" style={{ left: `${x(active)}%` }} />
              <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-hero ring-2 ring-game-paper" style={{ left: `${x(active)}%`, top: `${y(at.price)}%` }} />
              <span
                aria-hidden
                className={`num pointer-events-none absolute top-1 flex flex-col whitespace-nowrap rounded-[10px] border-2 border-game-ink bg-game-paper px-2.5 py-1.5 text-[12px] leading-4 text-game-ink shadow-[var(--game-shadow-sm)] ${active > last / 2 ? "-translate-x-[calc(100%+10px)]" : "translate-x-[10px]"}`}
                style={{ left: `${x(active)}%` }}
              >
                <span className="font-bold">{bits.format(at.price)} Bits</span>
                <span className="text-game-muted">
                  after {at.bought} bought, {points[last]!.bought - at.bought} left
                </span>
              </span>
            </>
          ) : null}
        </div>

        <div aria-hidden className="pointer-events-none absolute inset-x-2 bottom-0 left-9 flex justify-between text-[12px] leading-4 text-game-muted">
          <span className="num">0</span>
          <span>{item}s bought from the stall</span>
          <span className="num">{points[last]!.bought}</span>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {at ? `After ${at.bought} bought, ${bits.format(at.price)} Bits.` : ""}
      </p>
      {/* The table view. A table ignores sr-only's 1px width, so a wrapper hides it. */}
      <div className="sr-only">
        <table>
          <caption>
            {item} spot price at Gwei’s stall as players buy her stock
          </caption>
          <thead>
            <tr>
              <th scope="col">Bought</th>
              <th scope="col">Price in Bits</th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((p) => p.bought % 5 === 0)
              .map((p) => (
                <tr key={p.bought}>
                  <td>{p.bought}</td>
                  <td>{bits.format(p.price)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
