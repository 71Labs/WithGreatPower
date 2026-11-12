"use client";

/**
 * Sandwich Man in the economy fast-forward: his Bits day by day (with the days he closed
 * shop marked), what he owns, and what he did on the day the charts are reading, each
 * move with his reason. He trades among the bots through the same `decide` the live
 * market runs for him (src/lib/market/npc-rules.ts).
 */
import { createElement, useSyncExternalStore } from "react";

import { StickerButton, StickerFrame, StickerPanel } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { ExternalLink, Lock, Store } from "@/components/icons";
import { formatBits } from "@/components/market/sparkline";

import { LAB_BROKE_SEED, type DaySnapshot } from "@/lib/market/bots";
import { NPC_ID, NPC_NAME, NPC_RULES, NPC_RULES_URL } from "@/lib/market/npc-rules";

const noop = () => () => {};
const chip = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink pl-1 pr-2 text-[12px] font-bold leading-none text-game-ink";

export function NpcPanel({ history, hover, onShowBroke }: { history: DaySnapshot[]; hover: number | null; onShowBroke(): void }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const days = history.map((d) => d.npc).filter((d) => d !== null);
  if (days.length === 0) return null;
  const n = days.length;
  const at = hover !== null && hover < n ? hover : n - 1;
  const day = days[at]!;
  const bits = days.map((d) => d.bits);
  const hi = Math.max(...bits, NPC_RULES.seedBits);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (b: number) => 92 - (b / hi) * 84;
  const line = bits.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(b).toFixed(2)}`).join(" ");
  const closedDays = days.filter((d) => d.closed).length;
  const moves = days.reduce((sum, d) => sum + d.events.filter((e) => e.kind !== "sold").length, 0);
  const band = n > 1 ? 100 / (n - 1) : 100;

  return (
    <StickerPanel as="section" aria-labelledby="lab-npc" className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[320px] items-start gap-3.5">
          <StickerFrame drop="sm" label={`${NPC_NAME}, the arbitrageur`} className="[--s:64px]">
            {/* The cast art's float math can differ between Node and the browser, so it renders after hydration. */}
            {mounted ? createElement(AVATARS[NPC_ID]) : null}
          </StickerFrame>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id="lab-npc" className="text-[16px] font-semibold leading-5">
              {NPC_NAME} <span className="font-normal text-game-muted">· the arbitrageur</span>
            </h2>
            <p className="flex flex-wrap gap-1.5">
              <span className={`${chip} bg-game-paper-2 pl-2`}>NPC</span>
              {day.closed ? (
                <span className={`${chip} bg-game-gold`}>
                  <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
                  Closed shop
                </span>
              ) : (
                <span className={`${chip} bg-game-paper`}>
                  <Store aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
                  Trading
                </span>
              )}
            </p>
            <p className="max-w-[60ch] text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">
              One more trader among the bots, with his own wallet and a one-off seed of {formatBits(NPC_RULES.seedBits)} Bits. He flips cheap listings, buys dips and undercuts Gwei, by the same rules file the live market
              runs. Under {NPC_RULES.closeBelowBits} Bits he closes shop and sells down until he’s back to {NPC_RULES.reopenAtBits}.
            </p>
            <a
              href={NPC_RULES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 items-center gap-1 self-start rounded-[6px] text-[13px] font-semibold leading-4 text-game-ink underline decoration-game-ink/40 underline-offset-[3px] [text-decoration-skip-ink:auto] focus-visible:outline-offset-2 pointer-coarse:min-h-11 pointer-fine:hover:decoration-game-ink"
            >
              Read his rules file on GitHub
              <ExternalLink aria-hidden className="size-4 shrink-0" strokeWidth={2} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
        <dl className="num grid shrink-0 grid-cols-3 gap-x-5 gap-y-1 text-[13px] leading-[18px]">
          <div className="flex flex-col">
            <dt className="text-[12px] font-semibold leading-4 text-game-muted">Bits, day {history[at]!.day}</dt>
            <dd className="text-[22px] font-bold leading-7 tracking-[-0.02em]">{formatBits(day.bits)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[12px] font-semibold leading-4 text-game-muted">Items held</dt>
            <dd className="text-[22px] font-bold leading-7 tracking-[-0.02em]">{formatBits(day.units)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[12px] font-semibold leading-4 text-game-muted">Moves so far</dt>
            <dd className="text-[22px] font-bold leading-7 tracking-[-0.02em]">{formatBits(moves)}</dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-x-5 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] font-semibold leading-4 text-game-muted">His Bits by day{closedDays > 0 ? `; shaded on the ${closedDays} ${closedDays === 1 ? "day" : "days"} he closed shop` : ""}</p>
          <div
            role="img"
            aria-label={`${NPC_NAME}’s Bits: ${formatBits(bits[0]!)} on day 0, ${formatBits(bits[n - 1]!)} on day ${history[n - 1]!.day}. He closed shop on ${closedDays} ${closedDays === 1 ? "day" : "days"}.`}
            className="grid grid-cols-[34px_1fr] gap-x-1.5"
          >
            <span aria-hidden className="num flex h-24 flex-col justify-between py-[3px] text-right text-[10px] leading-3 text-game-muted">
              <span>{formatBits(hi)}</span>
              <span>0</span>
            </span>
            <div className="relative h-24">
              <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                {days.map((d, i) => (d.closed ? <rect key={i} x={Math.max(0, x(i) - band / 2)} width={band} y={8} height={84} className="fill-game-gold" /> : null))}
                <line x1="0" x2="100" y1="92" y2="92" className="stroke-game-ink/15" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {/* The level he closes shop under. */}
                <line x1="0" x2="100" y1={y(NPC_RULES.closeBelowBits)} y2={y(NPC_RULES.closeBelowBits)} className="stroke-game-ink/30" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <path d={line} className="fill-none stroke-game-ink" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              {hover !== null ? <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-game-hero" style={{ left: `${x(at)}%` }} /> : null}
              <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-ink ring-2 ring-game-paper" style={{ left: `${x(at)}%`, top: `${y(bits[at]!)}%` }} />
            </div>
          </div>
          <p className="text-[11px] leading-4 text-game-muted">The dashed line is {NPC_RULES.closeBelowBits} Bits, where he closes shop. Point at any price chart to read a day.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-[12px] font-semibold leading-4 text-game-muted">What he did on day {history[at]!.day}</h3>
          {day.events.length === 0 ? (
            <p className="text-[13px] leading-[18px] [text-wrap:pretty]">{history[at]!.day === 0 ? "Nothing yet. He opens with his seed and waits for the market to move." : "Nothing. No rule fired: no cheap listing, no dip he could afford, nothing worth selling."}</p>
          ) : (
            <ol className="flex flex-col divide-y-2 divide-dashed divide-game-ink/10">
              {day.events.map((e, i) => (
                <li key={i} className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0">
                  <p className="num text-[13px] font-semibold leading-[18px] [text-wrap:pretty]">{e.text}</p>
                  <p className="num text-[13px] leading-[18px] [text-wrap:pretty]">“{e.reason}”</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-dashed border-game-ink/20 pt-3">
        <StickerButton size="sm" onClick={onShowBroke}>
          Load a run where he goes broke
        </StickerButton>
        <p className="min-w-0 flex-1 basis-[240px] text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
          Sets seed {LAB_BROKE_SEED} with 21 days and 60 heroes: he runs out of Bits twice, clears stock to Gwei at a loss and reopens. Press Run to watch it.
        </p>
      </div>
    </StickerPanel>
  );
}
