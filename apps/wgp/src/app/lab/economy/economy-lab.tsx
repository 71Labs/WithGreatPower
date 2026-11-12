"use client";

/**
 * /lab/economy: a judges' fast-forward of the Mempool Market. Pick how many days and bot
 * heroes, press Run, and watch every item's price and Gwei's stock respond, day by day,
 * at the speed you choose. The bots trade through the market engine the server's
 * simulated market runs on, whose curve math is tested against the contract's own
 * (contracts/wgp/market-vectors.json), so this is how the real market would move.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";

import { KitStyles, StickerButton, StickerPanel } from "@/components/game/kit";
import { ArrowRight, ChartLine, Pause, Play, RotateCcw } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { ITEM_SOURCE } from "@/components/market/copy";
import { ChangePill, formatBits, formatPrice } from "@/components/market/sparkline";
import { Reasoning } from "@/components/market/why-price";
import { ITEMS, RARITY_LABEL } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { Economy, type DaySnapshot } from "@/lib/market/bots";
import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { explainPrice } from "@/lib/market/reasoning";

const SPEEDS = [
  { id: "1x", label: "1×", ms: 450 },
  { id: "4x", label: "4×", ms: 110 },
  { id: "16x", label: "16×", ms: 28 },
  { id: "max", label: "Instant", ms: 0 },
] as const;
type Speed = (typeof SPEEDS)[number]["id"];

const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
const CRAFT_BITS = 25;
const noop = () => () => {};
/** Each item's curve as seeded; a day's stock and till go on top to rebuild that day's pool. */
const SEEDED = new Map(seededPools().map((p) => [p.item, p]));

/* ------------------------------------------------------------------ chart */

/**
 * One item's price over the days (a 2px ink line), with Gwei's stock as bars underneath
 * on its own scale. The crosshair is shared by every chart: point at a day on any one
 * and all of them read that day. Arrow keys move it too.
 */
function ItemChart({
  item,
  history,
  hover,
  onHover,
}: {
  item: ItemId;
  history: DaySnapshot[];
  hover: number | null;
  onHover(day: number | null): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const prices = history.map((d) => d.prices[item] ?? 0);
  const stock = history.map((d) => d.stock[item] ?? 0);
  const n = history.length;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const y = (p: number) => (hi === lo ? 50 : 92 - ((p - lo) / span) * 84);
  const line = prices.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(p).toFixed(2)}`).join(" ");
  const maxStock = Math.max(1, ...stock);
  const at = hover !== null && hover < n ? hover : n - 1;
  const change = prices[0] ? (prices[at]! - prices[0]) / prices[0] : 0;
  // Gwei's reasoning for the day the card reads, from that day's own stock and till.
  const why = explainPrice({
    pool: { ...SEEDED.get(item)!, stock: stock[at]!, bits: history[at]!.tills[item] ?? 0 },
    open: true,
    feeBps: DEFAULT_PARAMS.feeBps,
    change24h: at > 0 && prices[at - 1] ? (prices[at]! - prices[at - 1]!) / prices[at - 1]! : null,
  });

  function pick(e: PointerEvent<HTMLDivElement>) {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onHover(Math.round(f * (n - 1)));
  }

  function keys(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) onHover(Math.max(0, Math.min(n - 1, at + step)));
    else if (e.key === "Home") onHover(0);
    else if (e.key === "End") onHover(n - 1);
    else return;
    e.preventDefault();
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-[20px] border-2 border-game-ink bg-game-paper p-3 text-game-ink shadow-[var(--game-shadow-sm)]">
      <div className="flex items-start gap-2.5">
        {/* The cast art draws with float math that can differ in its last digit between Node and the browser, so it renders after hydration. */}
        {mounted ? <MiniAvatar id={ITEM_SOURCE[item]} className="size-9 rounded-[10px]" /> : <span aria-hidden className="size-9 shrink-0 rounded-[10px] bg-sticker" />}
        <span className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-[14px] font-semibold leading-5 text-game-ink [overflow-wrap:anywhere]">{ITEMS[item].name}</h3>
          <span className="num text-[12px] leading-4 text-game-muted">
            {RARITY_LABEL[ITEMS[item].rarity]} · day {history[at]!.day}
          </span>
        </span>
        <ChangePill change={n > 1 ? change : null} />
      </div>
      <p className="flex items-baseline gap-1">
        <span className="num text-[22px] font-bold leading-6 tracking-[-0.02em]">{formatPrice(prices[at]!)}</span>
        <span className="text-[12px] font-semibold text-game-muted">Bits</span>
        <span className="num ml-auto text-[12px] text-game-muted">stock {formatBits(stock[at]!)}</span>
      </p>
      <div
        tabIndex={0}
        role="img"
        aria-label={`${ITEMS[item].name}: ${formatPrice(prices[0]!)} Bits on day 0, ${formatPrice(prices[n - 1]!)} on day ${history[n - 1]!.day}. Use the arrow keys to read each day.`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => onHover(null)}
        onBlur={() => onHover(null)}
        onKeyDown={keys}
        className="grid touch-pan-y grid-cols-[34px_1fr] gap-x-1.5 gap-y-1 rounded-[8px] focus-visible:outline-offset-2"
      >
        {/* The price axis sits in its own gutter, so labels never cross the line. */}
        <span aria-hidden className="num pointer-events-none flex h-24 flex-col justify-between py-[3px] text-right text-[10px] leading-3 text-game-muted">
          <span>{formatPrice(hi)}</span>
          <span>{formatPrice(lo)}</span>
        </span>
        <div ref={ref} className="relative h-24">
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <line x1="0" x2="100" y1="92" y2="92" className="stroke-game-ink/15" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="100" y1="8" y2="8" className="stroke-game-ink/10" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <path d={line} className="fill-none stroke-game-ink" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {hover !== null ? <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-game-hero" style={{ left: `${x(at)}%` }} /> : null}
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-game-ink ring-2 ring-game-paper"
            style={{ left: `${x(at)}%`, top: `${y(prices[at]!)}%` }}
          />
        </div>
        <span aria-hidden className="self-center text-right text-[10px] leading-3 text-game-muted">
          stock
        </span>
        {/* Gwei's stock, on its own scale: bars with a gap between them. */}
        <svg aria-hidden viewBox={`0 0 ${n * 10} 20`} preserveAspectRatio="none" className="h-5 w-full">
          {stock.map((v, i) => (
            <rect key={i} x={i * 10 + 1} width={8} y={20 - (v / maxStock) * 20} height={(v / maxStock) * 20} rx={1} className={i === at && hover !== null ? "fill-game-hero" : "fill-game-gold"} />
          ))}
        </svg>
      </div>
      <Reasoning reasoning={why} className="border-t-2 border-dashed border-game-ink/20 pt-2.5" />
    </li>
  );
}

/* ------------------------------------------------------------------ the lab */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[16px] border-2 border-game-ink bg-game-paper px-3.5 py-2.5 text-game-ink shadow-[var(--game-shadow-sm)]">
      <dt className="text-[12px] font-semibold leading-4 text-game-muted">{label}</dt>
      <dd className="num text-[22px] font-bold leading-7 tracking-[-0.02em]">{value}</dd>
      {hint ? <dd className="text-[11px] leading-4 text-game-muted">{hint}</dd> : null}
    </div>
  );
}

function Slider({ id, label, value, min, max, step = 1, onChange, disabled }: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; disabled?: boolean }) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1">
      <label htmlFor={id} className="flex justify-between text-[13px] font-semibold leading-4">
        {label}
        <span className="num">{value}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full cursor-pointer accent-[var(--game-hero)] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

interface Setup {
  days: number;
  bots: number;
  seed: number;
  sink: boolean;
}

const build = (s: Setup) => new Economy({ days: s.days, bots: s.bots, seed: s.seed, params: { craftBits: s.sink ? CRAFT_BITS : 0 } });

export function EconomyLab() {
  const ids = useId();
  const [setup, setSetup] = useState<Setup>({ days: 21, bots: 60, seed: 2026, sink: true });
  const [speed, setSpeed] = useState<Speed>("4x");
  const [running, setRunning] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [econ, setEcon] = useState(() => build(setup));
  const [history, setHistory] = useState<DaySnapshot[]>(() => econ.history.slice());
  const { days, bots, seed, sink } = setup;

  /** A fresh run, for `next` setup (any change to the setup starts over). */
  function fresh(next: Setup = setup): Economy {
    const e = build(next);
    setSetup(next);
    setEcon(e);
    setHistory(e.history.slice());
    setHover(null);
    setRunning(false);
    return e;
  }
  const change = (patch: Partial<Setup>) => fresh({ ...setup, ...patch });

  useEffect(() => {
    if (!running) return;
    const e = econ;
    const ms = SPEEDS.find((s) => s.id === speed)!.ms || 1;
    const id = window.setInterval(() => {
      e.step();
      setHistory(e.history.slice());
      if (e.done) {
        window.clearInterval(id);
        setRunning(false);
      }
    }, ms);
    return () => window.clearInterval(id);
  }, [running, speed, econ]);

  const last = history[history.length - 1]!;
  const done = last.day >= days;
  const totals = history.reduce((t, d) => ({ trades: t.trades + d.trades, fills: t.fills + d.fills }), { trades: 0, fills: 0 });

  function toggle() {
    if (running) return setRunning(false);
    const e = done ? fresh() : econ;
    if (speed === "max") {
      // Instant: play every remaining day now.
      while (!e.done) e.step();
      setHistory(e.history.slice());
      return;
    }
    setRunning(true);
  }

  return (
    <main id="main" data-wgp-night="" className="min-h-dvh bg-game-night px-4 pb-16 pt-6 text-game-paper [--vs-focus:var(--game-gold)] sm:px-6 sm:pt-10">
      <KitStyles />
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
        <header className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-gold">
            <ChartLine aria-hidden className="size-4" strokeWidth={2} />
            Lab · Mempool Market
          </p>
          <h1 className="font-display text-[30px] font-semibold text-game-paper leading-[32px] tracking-[-0.03em] [text-shadow:0_2px_0_var(--game-ink)] [text-wrap:balance] sm:text-[40px] sm:leading-[42px]">
            Economy fast-forward
          </h1>
          <p className="max-w-[68ch] text-[15px] leading-6 text-game-paper/85 [text-wrap:pretty]">
            Bot heroes patrol every night for Bits and loot, then trade with Gwei, list for each other and craft suits. Every trade runs the market’s real pricing code, the
            same math the contract is tested against, so you can watch prices move with no patch: dumpers sink a price, crafters lift what their recipes need.
          </p>
          <Link href="/play/market" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[14px] font-semibold text-game-gold underline decoration-game-gold/40 underline-offset-4 pointer-fine:hover:decoration-game-gold">
            Open the live market
            <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
          </Link>
        </header>

        <StickerPanel as="section" aria-label="Setup" className="flex flex-wrap items-end gap-x-5 gap-y-4 p-4">
          <Slider id={`${ids}-days`} label="Days" value={days} min={7} max={90} onChange={(v) => change({ days: v })} />
          <Slider id={`${ids}-bots`} label="Bot heroes" value={bots} min={10} max={200} step={10} onChange={(v) => change({ bots: v })} />
          <div className="flex flex-col gap-1">
            <span id={`${ids}-speed`} className="text-[13px] font-semibold leading-4">
              Speed
            </span>
            <div role="group" aria-labelledby={`${ids}-speed`} className="flex gap-1 rounded-full border-2 border-game-ink bg-game-paper p-1">
              {SPEEDS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={speed === s.id}
                  onClick={() => setSpeed(s.id)}
                  className={`num h-9 min-w-11 rounded-full px-2.5 text-[13px] font-semibold focus-visible:outline-offset-2 pointer-coarse:h-11 ${speed === s.id ? "bg-game-ink text-game-paper" : "pointer-fine:hover:bg-game-paper-2"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-semibold">
            <input type="checkbox" checked={sink} onChange={(e) => change({ sink: e.target.checked })} className="size-5 accent-[var(--game-hero)]" />
            Crafting burns {CRAFT_BITS} Bits
          </label>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-seed`} className="text-[13px] font-semibold leading-4">
                Seed
              </label>
              <input
                id={`${ids}-seed`}
                type="number"
                inputMode="numeric"
                value={seed}
                onChange={(e) => change({ seed: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
                className="num h-11 w-24 rounded-[12px] border-2 border-game-ink bg-game-paper px-2 text-[15px] font-semibold focus-visible:outline-offset-2"
              />
            </div>
            <StickerButton size="sm" onClick={() => change({ seed: Math.floor(Math.random() * 100_000) })} className="h-11">
              <RotateCcw aria-hidden className="size-4" strokeWidth={2} />
              Reroll
            </StickerButton>
          </div>
          <div className="ml-auto flex gap-2 max-sm:w-full">
            <StickerButton variant="hero" onClick={toggle} className="max-sm:flex-1">
              {running ? <Pause aria-hidden className="size-5" strokeWidth={2.25} /> : <Play aria-hidden className="size-5" strokeWidth={2.25} />}
              {running ? "Pause" : done ? `Run ${days} days again` : last.day > 0 ? "Resume" : `Run ${days} days`}
            </StickerButton>
            <StickerButton onClick={() => fresh()} disabled={last.day === 0}>
              Reset
            </StickerButton>
          </div>
        </StickerPanel>

        <dl aria-live="off" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Day" value={`${last.day} / ${days}`} />
          <Stat label="Bits in play" value={formatBits(last.supply)} hint="Held by heroes, plus Gwei’s till" />
          <Stat label="Gwei’s till" value={formatBits(last.till)} hint="The vendor’s own wallet" />
          <Stat label="Bits burned" value={formatBits(last.burned)} hint={`Gas fee${sink ? " and crafting" : ""}, of ${formatBits(last.minted)} earned`} />
          <Stat label="Suits crafted" value={formatBits(last.crafted)} />
          <Stat label="Trades" value={formatBits(totals.trades + totals.fills)} hint={`${formatBits(totals.fills)} player-to-player · ${last.listings} listed now`} />
        </dl>

        <section aria-labelledby={`${ids}-prices`} className="flex flex-col gap-3">
          <h2 id={`${ids}-prices`} className="text-[13px] font-bold uppercase leading-4 tracking-[0.08em] text-game-paper/85">
            Price, Gwei’s stock and her reasoning, by day
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ITEM_IDS.map((item) => (
              <ItemChart key={item} item={item} history={history} hover={hover} onHover={setHover} />
            ))}
          </ul>
        </section>

        <details className="rounded-[20px] border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)]">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[14px] font-semibold focus-visible:outline-offset-2">See the numbers</summary>
          <div className="overflow-x-auto px-4 pb-4">
            <table className="num w-full min-w-[480px] text-left text-[13px]">
              <caption className="sr-only">Each item on day 0 and day {last.day}</caption>
              <thead>
                <tr className="border-b-2 border-game-ink">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Item
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Day 0
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Day {last.day}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Change
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {ITEM_IDS.map((item) => {
                  const a = history[0]!.prices[item]!;
                  const b = last.prices[item]!;
                  return (
                    <tr key={item} className="border-b border-game-ink/10">
                      <th scope="row" className="py-2 pr-3 font-medium">
                        {ITEMS[item].name}
                      </th>
                      <td className="py-2 pr-3 text-right">{formatPrice(a)}</td>
                      <td className="py-2 pr-3 text-right">{formatPrice(b)}</td>
                      <td className="py-2 pr-3 text-right">{a ? `${b >= a ? "+" : "−"}${Math.abs(Math.round(((b - a) / a) * 100))}%` : "—"}</td>
                      <td className="py-2 text-right">
                        {history[0]!.stock[item]} → {last.stock[item]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
        <p className="text-[12px] leading-4 text-game-paper/70">
          Starting curves and rules: {DEFAULT_PARAMS.feeBps / 100}% gas fee, listings between {DEFAULT_PARAMS.floorBps / 100}% and {DEFAULT_PARAMS.ceilingBps / 100}% of Gwei’s price,{" "}
          {DEFAULT_PARAMS.dailyTrades} vendor trades per hero a day. Runs are deterministic for a seed. Gwei’s pricing rules are one file, <code className="font-mono">apps/wgp/src/lib/market/math.ts</code>,
          and every line she says here is worked out from that day’s stock and till.
        </p>
      </div>
    </main>
  );
}
