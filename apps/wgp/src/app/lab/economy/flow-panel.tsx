/**
 * Bits earned against Bits burned, day by day, for the run on screen: two running totals
 * on one scale, so the gap between the lines is the Bits the run added to the supply.
 * Under it, how many item-days Gwei ended sold out or with a till that couldn't buy one.
 */
import { formatBits } from "@/components/market/sparkline";

import type { DaySnapshot } from "@/lib/market/bots";
import { seededPools } from "@/lib/market/config";
import { sellQuote } from "@/lib/market/math";

const SEEDED = seededPools();

/** Item-days in `history` that ended with Gwei sold out, and with a till that can't buy one. */
export function vendorLimits(history: DaySnapshot[], feeBps: number): { soldOut: number; broke: number; itemDays: number } {
  let soldOut = 0;
  let broke = 0;
  const days = history.slice(1);
  for (const d of days) {
    for (const p of SEEDED) {
      if (d.stock[p.item] === 0) soldOut += 1;
      if (sellQuote({ ...p, stock: d.stock[p.item] ?? 0, bits: d.tills[p.item] ?? 0 }, 1, feeBps) === null) broke += 1;
    }
  }
  return { soldOut, broke, itemDays: days.length * SEEDED.length };
}

export function FlowPanel({ history, days, feeBps, headingId }: { history: DaySnapshot[]; days: number; feeBps: number; headingId: string }) {
  const last = history[history.length - 1]!;
  const top = Math.max(1, last.minted);
  const x = (day: number) => (days > 0 ? (day / days) * 100 : 0);
  const y = (bits: number) => 94 - (bits / top) * 88;
  const path = (pick: (d: DaySnapshot) => number) => history.map((d, i) => `${i ? "L" : "M"}${x(d.day).toFixed(2)} ${y(pick(d)).toFixed(2)}`).join(" ");
  const share = last.minted ? Math.round((last.burned / last.minted) * 100) : 0;
  const limits = vendorLimits(history, feeBps);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow-sm)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-[14px] font-semibold leading-5">
          Bits earned and Bits burned
        </h2>
        <p className="num text-[13px] leading-5 text-game-muted">
          {last.day === 0 ? "Press Run to fill this in" : `${share}% of what heroes earned has been burned`}
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-stretch gap-x-3">
        <svg
          role="img"
          aria-label={`By day ${last.day}, heroes earned ${formatBits(last.minted)} Bits and ${formatBits(last.burned)} were burned.`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-28 w-full overflow-visible"
        >
          <line x1="0" x2="100" y1="94" y2="94" className="stroke-game-ink/15" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={path((d) => d.minted)} className="fill-none stroke-game-ink" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={path((d) => d.burned)} className="fill-none stroke-game-hero" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Each line is labelled at its own end, and the burned line is dashed, so colour isn't the only cue. */}
        <dl className="num relative w-[112px] text-[12px] leading-4">
          <div className="absolute inset-x-0 top-0 flex flex-col">
            <dt className="font-semibold">Earned</dt>
            <dd className="text-[15px] font-bold leading-5">{formatBits(last.minted)}</dd>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col">
            <dt className="font-semibold">Burned (dashed)</dt>
            <dd className="text-[15px] font-bold leading-5">{formatBits(last.burned)}</dd>
          </div>
        </dl>
      </div>
      <p className="num border-t-2 border-dashed border-game-ink/20 pt-2.5 text-[13px] leading-5 text-game-muted [text-wrap:pretty]">
        Gwei’s limits so far: sold out on {formatBits(limits.soldOut)} and unable to buy on {formatBits(limits.broke)} of {formatBits(limits.itemDays)} item-days (8 items × each day’s close). She sells only
        what she holds and pays only from her till.
      </p>
    </section>
  );
}
