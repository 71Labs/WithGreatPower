"use client";

/**
 * Case File 003's HUD over its night ("Fee Strike"), shown only while the sim's HUD snapshot
 * carries `fee` (game3d/session/hud.ts feeHud); every other night never mounts any of it.
 *
 * - FeeObjective: in the route bar's place. "Find the clues 1/3", "Find the fee meter", then
 *   through the chase the chase panel: Gas Goblin's face, how close you are ("On his tail",
 *   "Keep up", "Falling behind", "He’s getting away!"), the escape meter, checkpoints passed
 *   and losses of five; then "Land on Aunt Mainnet’s roof", "Stop Gas Goblin", "Cool the fees".
 * - FeeVillain: the patrol villain bar (Gas Goblin has his sticker face) through the fight.
 * - FeeCallouts: the case notes (each clue's shopkeeper line, the meter's Downloads note at the
 *   grab), "Lost him!", checkpoints, the "He’s getting away!" and "Fee spike!" warnings (a
 *   striped badge, a word and an icon, never colour alone) and Aunt Mainnet's loaf.
 * - CoolBar: "Cooling the fees" over the meter while you cool it, placed from the camera each
 *   frame like the waypoint.
 * - FeeBeats: the case's encounter card, Gas Goblin's defeat line and the bread coming back.
 * - FeeTips: the case's section of How to play.
 */
import { useEffect, useRef, useState } from "react";

import { CHAPTERS, FEE_STRIKE_LINES, type FeeClueId } from "@wgp/game-core/chapters";
import { MAX_LOSSES } from "@wgp/game-core/sim3d";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { StickerEyebrow, StickerPanel } from "@/components/game/kit";
import { Check, Flame, Gauge, MapPin, Search, TriangleAlert } from "@/components/icons";
import { metres } from "@/game3d/nav/map";
import { project } from "@/game3d/nav/waypoint";
import type { FrameTap } from "@/game3d/nav/tap";
import { chaseCue, feeClue, feeEventLine, feeObjective, feePhaseLine, isFeeEvent, type ChaseTone } from "@/lib/cases/fee-view";
import type { FeeHud, HudStore } from "@/sim/loop";
import { Face } from "@/sim/ui/bits";
import { useHud, useHudValue, VillainBar } from "@/sim/ui/hud";

const INFO = CHAPTERS["case-003"];

/** The loop's event bus, as the case listens to it. */
export interface FeeBus {
  on(fn: (e: { type: string }) => void): () => void;
}

/** The fee HUD from the sim's snapshot, re-rendering only when it changes. */
function useFee(hud: HudStore): FeeHud | null {
  const key = useHudValue(hud, (h) => (h?.fee ? JSON.stringify(h.fee) : null));
  return key ? (JSON.parse(key) as FeeHud) : null;
}

/** Whether this night is Case File 003's (its HUD carries `fee`). */
export function useFeeOn(hud: HudStore): boolean {
  return useHudValue(hud, (h) => !!h?.fee);
}

/* ------------------------------------------------------------------ the objective */

const TONE: Record<ChaseTone, string> = {
  tail: "bg-game-mint text-game-ink",
  close: "bg-game-paper-2 text-game-ink",
  behind: "bg-game-gold text-game-ink",
  away: "bg-game-hero text-game-on-hero",
  waiting: "bg-game-gold text-game-ink",
};

function Lead({ hud }: { hud: FeeHud }) {
  const ring = "grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink";
  if (hud.phase === "investigate")
    return (
      <span className={`${ring} bg-game-gold`}>
        <Search className="size-5" strokeWidth={2.25} />
      </span>
    );
  if (hud.phase === "meter" || hud.phase === "cool")
    return (
      <span className={`${ring} ${hud.phase === "cool" ? "bg-game-mint" : "bg-game-hero text-game-on-hero"}`}>
        <Gauge className="size-5" strokeWidth={2.25} />
      </span>
    );
  if (hud.phase === "done")
    return (
      <span className={`${ring} bg-game-mint`}>
        <Check className="size-5" strokeWidth={3} />
      </span>
    );
  return <Face id="gas-goblin" className="size-11 rounded-full" />;
}

/** The chase's line under the objective: the escape meter, checkpoints and losses. */
function ChaseLine({ chase }: { chase: NonNullable<FeeHud["chase"]> }) {
  const escape = Math.round(chase.escape * 100);
  return (
    <div className="mt-1 flex items-center gap-2">
      <div
        role="meter"
        aria-label="He’s getting away"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={escape}
        className="h-2.5 min-w-[64px] flex-1 overflow-hidden rounded-full border-2 border-game-ink bg-game-paper-2"
      >
        {/* Stripes, not only a colour: the meter fills with a hazard pattern. */}
        <span className="block h-full bg-[repeating-linear-gradient(135deg,var(--game-hero)_0_5px,var(--game-ink)_5px_8px)]" style={{ width: `${escape}%` }} />
      </div>
      <span className="num inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-bold leading-4 text-game-muted" title="Checkpoints passed">
        <MapPin aria-hidden className="size-3" strokeWidth={2.5} />
        {chase.checkpoint}/{chase.checkpoints}
      </span>
      <span className="sr-only">
        Checkpoints {chase.checkpoint} of {chase.checkpoints}.
      </span>
      <span aria-label={`Lost him ${chase.losses} of ${chase.maxLosses} times`} className="flex shrink-0 items-center gap-0.5">
        {Array.from({ length: chase.maxLosses - 1 }, (_, i) => (
          <span key={i} aria-hidden className={`size-2 rounded-full border-[1.5px] border-game-ink ${i < chase.losses ? "bg-game-ink" : "bg-game-paper"}`} />
        ))}
      </span>
    </div>
  );
}

/** The case's objective, in the route bar's place; through the chase, the chase panel. */
export function FeeObjective({ hud: store, className = "" }: { hud: HudStore; className?: string }) {
  const hud = useFee(store);
  const mode = useHudValue(store, (h) => h?.mode ?? null);
  if (!hud) return null;
  const o = feeObjective(hud, mode ?? undefined);
  const chase = hud.chase;
  const cue = chase ? chaseCue(chase) : null;
  return (
    <StickerPanel
      as="section"
      aria-label={`Case file ${INFO.number}`}
      className={`flex items-center gap-3 py-1.5 pl-1.5 pr-3 ${chase ? "min-h-[60px] rounded-[30px]" : "h-[60px] rounded-full pr-4"} ${className}`}
    >
      <span aria-hidden className="contents">
        <Lead hud={hud} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[10px] font-bold uppercase leading-3 tracking-[0.1em] text-game-muted">
          Case file <span className="num">{INFO.number}</span>
          {chase ? <span className="sr-only">, the chase</span> : null}
        </p>
        <p className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em]">
          {o.label}
          {o.count ? (
            <span className="num ml-1.5 text-game-ink">
              {o.count.found}/{o.count.total}
            </span>
          ) : null}
        </p>
        {chase ? <ChaseLine chase={chase} /> : null}
      </div>
      {cue && chase ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold leading-5 ${TONE[cue.tone]}`}>
            {cue.tone === "away" ? <TriangleAlert aria-hidden className="size-3.5" strokeWidth={2.5} /> : null}
            {cue.text}
          </span>
          <span className="num text-[11px] font-semibold leading-4 text-game-muted">{metres(chase.gap)} m</span>
        </span>
      ) : null}
      {hud.phase === "investigate" ? (
        <span aria-hidden className="flex shrink-0 gap-1">
          {INFO.clues.map((c, i) => (
            <span
              key={c.id}
              title={`${c.name}: ${hud.found[i] ? "found" : "not found yet"}`}
              className={`grid size-7 place-items-center rounded-full border-2 border-game-ink ${hud.found[i] ? "bg-game-mint text-game-ink" : "border-dashed bg-game-paper-2 text-game-muted"}`}
            >
              {hud.found[i] ? <Check className="size-3.5" strokeWidth={3} /> : <Search className="size-3.5" strokeWidth={2.5} />}
            </span>
          ))}
        </span>
      ) : null}
    </StickerPanel>
  );
}

/** Gas Goblin's bar through the fight on the bakery roof (the patrol's villain bar: he has his sticker face). */
export function FeeVillain({ hud }: { hud: HudStore }) {
  const snap = useHud(hud);
  return snap?.villain ? <VillainBar hud={snap} /> : null;
}

/* ------------------------------------------------------------------ callouts */

/** A warning badge in hazard stripes: a word and an icon, with what to do and the sound written out. */
function Hazard({ word, line, sound, icon }: { word: string; line: string; sound: string; icon: "alert" | "flame" }) {
  return (
    <div key={word} className="wgp-pop flex flex-col items-center gap-1.5">
      <span className="rounded-[18px] bg-[repeating-linear-gradient(135deg,var(--game-ink)_0_7px,var(--game-gold)_7px_14px)] p-[5px] shadow-[var(--game-shadow)]">
        <span className="flex items-center gap-2 rounded-[13px] border-2 border-game-ink bg-game-paper px-4 py-1.5 text-game-ink">
          {icon === "flame" ? <Flame aria-hidden className="size-6 shrink-0" strokeWidth={2.25} /> : <TriangleAlert aria-hidden className="size-6 shrink-0" strokeWidth={2.25} />}
          <span className="font-display text-[24px] font-bold uppercase leading-7 tracking-[0.02em]">{word}</span>
        </span>
      </span>
      <span className="rounded-full border-2 border-game-ink bg-game-ink px-3 py-0.5 text-[13px] font-semibold leading-5 text-game-paper">{line}</span>
      <span className="text-[12px] font-semibold italic leading-4 text-game-paper [text-shadow:0_1px_0_var(--game-ink),0_-1px_0_var(--game-ink),1px_0_0_var(--game-ink),-1px_0_0_var(--game-ink)]">
        {sound}
      </span>
    </div>
  );
}

/** A case note pinned up for a few seconds: a clue's line, or the meter's. */
type Note = { n: number; eyebrow: string; text: string; icon: "clue" | "meter" | "loaf" };

/** A short word over the night: a loss, a checkpoint. */
type Word = { n: number; word: string; line: string; tone: "bad" | "good" };

function useFeeCallouts(bus: FeeBus) {
  const [note, setNote] = useState<Note | null>(null);
  const [word, setWord] = useState<Word | null>(null);
  useEffect(() => {
    let noteTimer = 0;
    let wordTimer = 0;
    let n = 0;
    const pin = (next: Omit<Note, "n">, ms: number) => {
      window.clearTimeout(noteTimer);
      setNote({ ...next, n: ++n });
      noteTimer = window.setTimeout(() => setNote(null), ms);
    };
    const flash = (next: Omit<Word, "n">, ms: number) => {
      window.clearTimeout(wordTimer);
      setWord({ ...next, n: ++n });
      wordTimer = window.setTimeout(() => setWord(null), ms);
    };
    const off = bus.on((ev) => {
      if (!isFeeEvent(ev)) return;
      switch (ev.type) {
        case "fee-clue": {
          const c = feeClue(ev.id as FeeClueId);
          pin({ eyebrow: `Clue ${ev.found} of ${ev.of} · ${c.name}`, text: c.note, icon: "clue" }, 5200);
          break;
        }
        case "meter-grab":
          pin({ eyebrow: FEE_STRIKE_LINES.meter.name, text: FEE_STRIKE_LINES.meter.note, icon: "meter" }, 6500);
          flash({ word: "After him!", line: "He’s got the meter", tone: "bad" }, 2200);
          break;
        case "chase-lost":
          flash({ word: "Lost him!", line: `Back to the last rooftop · ${ev.losses} of ${MAX_LOSSES}`, tone: "bad" }, 2600);
          break;
        case "chase-checkpoint":
          flash({ word: "Checkpoint", line: "Lose him and you start from here", tone: "good" }, 1400);
          break;
        case "chase-end":
          flash({ word: "Bakery!", line: "Land on Aunt Mainnet’s roof", tone: "good" }, 2400);
          break;
        case "loaf":
          pin({ eyebrow: "Aunt Mainnet’s last loaf", text: `Yesterday’s heel, still warm-ish. Plus ${ev.gained} health.`, icon: "loaf" }, 3800);
          break;
        default:
          break;
      }
    });
    return () => {
      off();
      window.clearTimeout(noteTimer);
      window.clearTimeout(wordTimer);
    };
  }, [bus]);
  return { note, word };
}

function NoteCard({ note }: { note: Note }) {
  return (
    <div key={note.n} className="wgp-rise relative w-[min(340px,calc(100vw-48px))] -rotate-1 rounded-[14px] border-[2.5px] border-game-ink bg-game-paper px-3.5 pb-3 pt-3.5 text-game-ink shadow-[var(--game-shadow)]">
      <span aria-hidden className="absolute -top-2.5 left-1/2 h-5 w-14 -translate-x-1/2 rotate-2 rounded-[3px] bg-game-gold/80" />
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        {note.icon === "meter" ? <Gauge aria-hidden className="size-3.5" strokeWidth={2.5} /> : note.icon === "loaf" ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : <Search aria-hidden className="size-3.5" strokeWidth={2.5} />}
        <span>{note.eyebrow}</span>
      </p>
      <p className="mt-1 text-[15px] font-semibold leading-5 text-pretty">{note.text}</p>
    </div>
  );
}

function WordCard({ word }: { word: Word }) {
  return (
    <div key={word.n} className="wgp-pop flex flex-col items-center gap-1.5">
      <span className={`rounded-[14px] border-[2.5px] border-game-ink px-4 py-1 font-display text-[26px] font-bold uppercase leading-8 tracking-[0.02em] shadow-[var(--game-shadow)] ${word.tone === "bad" ? "bg-game-hero text-game-on-hero" : "bg-game-mint text-game-ink"}`}>
        {word.word}
      </span>
      <span className="rounded-full border-2 border-game-ink bg-game-ink px-3 py-0.5 text-[13px] font-semibold leading-5 text-game-paper">{word.line}</span>
    </div>
  );
}

const CALLOUTS = {
  wide: "top-[calc(50%+140px)] flex-col",
  phone: "bottom-[calc(50%-60px)] flex-col-reverse",
  short: "bottom-[max(12px,env(safe-area-inset-bottom))] flex-col",
} as const;

/** The warnings, words and notes, kept off the hero and the controls. Read out by the page's announcer, not here. */
export function FeeCallouts({ hud, bus, layout }: { hud: HudStore; bus: FeeBus; layout: keyof typeof CALLOUTS }) {
  const { note, word } = useFeeCallouts(bus);
  const away = useHudValue(hud, (h) => !!h?.fee?.chase?.warn && (h.fee.chase.escape ?? 0) > 0.15);
  const spike = useHudValue(hud, (h) => (h?.fee?.spike ?? 0) > 0);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 flex items-center gap-3 px-4 ${CALLOUTS[layout]}`}>
      {spike ? <Hazard word="Fee spike!" line="Step out of the ring" sound="[The meter hisses]" icon="flame" /> : null}
      {away && !spike ? <Hazard word={FEE_STRIKE_LINES.warn} line="Swing after him" sound="[A glider whines off]" icon="alert" /> : null}
      {word ? <WordCard word={word} /> : null}
      {note ? <NoteCard note={note} /> : null}
    </div>
  );
}

/** What a Fee Strike night says out loud (the page's live region): each new phase and the case's events. */
export function useFeeLines(hud: HudStore, bus: FeeBus, say: (text: string, urgent?: boolean) => void) {
  useEffect(() => {
    let phase: FeeHud["phase"] | null = null;
    let away = false;
    const offHud = hud.subscribe(() => {
      const f = hud.getSnapshot()?.fee;
      if (f && f.phase !== phase) {
        phase = f.phase;
        say(feePhaseLine(f.phase), true);
      }
      const warn = !!f?.chase?.warn;
      if (warn && !away) say(`${FEE_STRIKE_LINES.warn} Swing after him.`, true);
      away = warn;
    });
    const offBus = bus.on((ev) => {
      if (!isFeeEvent(ev)) return;
      const line = feeEventLine(ev);
      if (line) say(line.text, line.urgent);
    });
    return () => {
      offHud();
      offBus();
    };
  }, [hud, bus, say]);
}

/* ------------------------------------------------------------------ the beats */

/**
 * The case's own beats where a patrol's encounter banner and win caption go: Gas Goblin on
 * Aunt Mainnet's roof as the fight opens, his defeat line once he's webbed, and the bread
 * coming back once the fees are cooled.
 */
export function FeeBeats({ hud }: { hud: HudStore }) {
  const beat = useHudValue(hud, (h) => {
    const f = h?.fee;
    if (!f) return null;
    if (h.mode === "intro" && f.phase === "showdown") return "encounter";
    if (h.mode === "won" && f.phase === "showdown") return "webbed";
    if (f.phase === "done" && f.cooled) return "cooled";
    return null;
  });
  const v = INFO.villain;
  if (beat === "encounter")
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center px-4 md:top-[30%] short:top-[84px]">
        <StickerPanel className="animate-rise flex w-full max-w-[460px] items-start gap-4 p-4 sm:p-5">
          <Face id="gas-goblin" className="size-20 rounded-[24px] border-[5px] sm:size-24" />
          <div className="flex min-w-0 flex-col gap-2">
            <StickerEyebrow>
              <span>
                Case file <span className="num">{INFO.number}</span> · Aunt Mainnet’s roof
              </span>
            </StickerEyebrow>
            <h2 className="text-[26px] font-bold leading-7 tracking-[-0.02em] text-game-ink sm:text-[30px] sm:leading-8">{v.name}</h2>
            <p className="text-[13px] italic leading-[18px] text-game-muted">“{v.tagline}”</p>
            <p className="relative mt-1 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 text-[14px] font-medium leading-5">“{v.taunt}”</p>
          </div>
        </StickerPanel>
      </div>
    );
  if (beat === "webbed" || beat === "cooled")
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(28px,env(safe-area-inset-bottom))] flex justify-center px-4">
        <StickerPanel className="animate-rise flex max-w-[460px] items-center gap-3 rounded-full py-2 pl-2 pr-5">
          <Face id={beat === "webbed" ? "gas-goblin" : "aunt-mainnet"} className="size-10 rounded-full" />
          <p className="text-[14px] font-semibold leading-5 text-pretty">{beat === "webbed" ? v.defeat : `Aunt Mainnet: “${INFO.captive.freed}” The ovens are back on.`}</p>
        </StickerPanel>
      </div>
    );
  return null;
}

/* ------------------------------------------------------------------ the cooling */

/** The bar floats this far above the meter's base (world units; the meter stands about 70 tall). */
const LIFT = 130;

/** "Cooling the fees" over the meter while it's on the bakery roof, placed from the camera each frame. */
export function CoolBar({ tap, touch, hud }: { tap: FrameTap; touch: boolean; hud: HudStore }) {
  const root = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let shown = false;
    let lastPlace = "";
    let lastPct = -1;
    let lastHint = "";
    const at = { x: 0, y: 0, z: 0 };
    const off = tap.on((t) => {
      const fee = (t.frame as RenderFrame3D).fee;
      const m = fee?.phase === "cool" && !fee.meter.cooled ? fee.meter : null;
      const show = !!m && !!t.pose;
      if (show !== shown) {
        shown = show;
        el.style.visibility = show ? "visible" : "hidden";
      }
      if (!m || !t.pose) return;
      at.x = m.pos.x;
      at.y = m.pos.y + LIFT;
      at.z = m.pos.z;
      const p = project(at, t.pose, t.width, t.height);
      const x = Math.max(110, Math.min(t.width - 110, p.behind ? t.width / 2 : p.x));
      const y = Math.max(200, Math.min(t.height - 150, p.behind ? t.height / 2 : p.y));
      const place = `translate3d(${(Math.round(x * 2) / 2).toFixed(1)}px, ${(Math.round(y * 2) / 2).toFixed(1)}px, 0)`;
      if (place !== lastPlace) {
        lastPlace = place;
        el.style.transform = place;
      }
      const n = Math.round(Math.max(0, Math.min(1, 1 - m.heat)) * 100);
      if (n !== lastPct) {
        lastPct = n;
        if (fill.current) fill.current.style.width = `${n}%`;
        if (pct.current) pct.current.textContent = `${n}%`;
        meter.current?.setAttribute("aria-valuenow", String(n));
      }
      const f = hud.getSnapshot()?.fee;
      const words = f && f.spike > 0 ? "Step out of the ring!" : f?.beside ? (touch ? "Hold the right side to cool it" : "Hold Space to cool it") : "Stand at the meter and hold web";
      if (words !== lastHint && hint.current) {
        lastHint = words;
        hint.current.textContent = words;
      }
    });
    return () => {
      off();
      el.style.visibility = "hidden";
    };
  }, [tap, hud, touch]);
  return (
    <div ref={root} className="pointer-events-none invisible absolute left-0 top-0 z-0 will-change-transform">
      <div className="absolute bottom-0 left-0 flex w-[200px] -translate-x-1/2 flex-col items-center">
        <StickerPanel className="flex w-full flex-col gap-1.5 rounded-[16px] px-3 py-2">
          <p className="flex items-baseline justify-between gap-2 text-[12px] font-bold leading-4">
            <span>Cooling the fees</span>
            <span ref={pct} className="num">
              0%
            </span>
          </p>
          <div ref={meter} role="meter" aria-label="Cooling the fee meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className="h-3 overflow-hidden rounded-full border-2 border-game-ink bg-game-paper-2">
            <span ref={fill} className="block h-full w-0 bg-game-mint" />
          </div>
          <p ref={hint} className="text-[11px] font-medium leading-[14px] text-game-muted">
            Stand at the meter and hold web
          </p>
        </StickerPanel>
        <svg aria-hidden width="16" height="12" viewBox="0 0 16 12" className="-mt-px block">
          <path d="M1.5 1.5 L8 10.5 L14.5 1.5 Z" fill="var(--game-paper)" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ how to play */

/** The case's section of How to play (the pause sheet), first while it's on. */
export function FeeTips({ touch }: { touch: boolean }) {
  const web = touch ? "hold the right side of the screen" : "hold Space or the mouse";
  return (
    <section className="flex flex-col gap-2 rounded-[14px] border-2 border-game-ink bg-game-folder p-3">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-game-ink">
        <Gauge aria-hidden className="size-4" strokeWidth={2.5} />
        Case file {INFO.number}: {INFO.title}
      </h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-game-ink">
        <li>Three clues wait on the Mempool Market’s roofs: {INFO.clues.map((c) => c.name.toLowerCase()).join(", ")}. Swing close to one to pick it up; the minimap pins them.</li>
        <li>Then find the fee meter. Gas Goblin grabs it and flees across the roofs: keep up by running, climbing and swinging. Stay close and he bolts; fall far behind and the escape meter fills. Fill it and you’re back at the last checkpoint. Lose him five times and he’s gone.</li>
        <li>He lobs fee bombs back at you: swerve when one’s coming down. Node sense slows him too.</li>
        <li>At Aunt Mainnet’s bakery, land on the roof and beat him. His stall after a dive is your opening.</li>
        <li>Then stand at the meter and {web} to cool the fees. When it hisses, step out of the ring.</li>
      </ul>
    </section>
  );
}
