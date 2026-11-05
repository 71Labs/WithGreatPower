"use client";

/**
 * The chapter's HUD over a case night, shown only while the frame carries `chapter`
 * (src/lib/cases/types.ts); a normal night never mounts any of it.
 *
 * - ChapterStore: the HUD's view of `frame.chapter` (lib/cases/view.ts chapterHud), fed from
 *   the frame tap about 12 times a second and published only when it changes.
 * - ObjectiveChip: in the route bar's place. "Find the clues 1/3", "Stop the Right-Clicker",
 *   "Restore Mary".
 * - RightClickerBar: in the villain bar's place during the standoff: his name and line, hits
 *   left, and what he's doing ("Saving…" while he aims, "Open: hit him" while he reloads).
 * - Callouts: the SCREENSHOT warning while he aims (a striped badge, a word and an icon, so
 *   it never relies on colour, with the shutter's sound written out), and the case note
 *   for each clue found.
 * - RestoreBar: "Restoring quality" over Mary during the rescue, placed from the camera each
 *   frame like the waypoint.
 * - ChapterTips: the case's section of How to play.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { CHAPTERS } from "@wgp/game-core/chapters";

import { StickerEyebrow, StickerPanel } from "@/components/game/kit";
import { RightClickerArt } from "@/components/cases/art";
import { Camera, Check, Cursor, Search } from "@/components/icons";
import { project } from "@/game3d/nav/waypoint";
import { throttled, type FrameTap } from "@/game3d/nav/tap";
import type { HudStore } from "@/sim/loop";
import { Face } from "@/sim/ui/bits";
import { useHudValue } from "@/sim/ui/hud";
import { CASE_001, CLUES, RIGHT_CLICKER, clueCopy } from "@/lib/cases/content";
import type { ChapterPhase, ChapterRenderFrame, ClueId } from "@/lib/cases/types";
import { chapterHud, chapterLine, isChapterEvent, objective, phaseLine, villainCue, type ChapterHud } from "@/lib/cases/view";

/** The loop's event bus, as the chapter listens to it (its events aren't in the sim's union yet). */
export interface ChapterBus {
  on(fn: (e: { type: string }) => void): () => void;
}

/* ------------------------------------------------------------------ the store */

export class ChapterStore {
  private snap: ChapterHud | null = null;
  private key = "";
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;
  set(next: ChapterHud | null) {
    const key = next ? JSON.stringify(next) : "";
    if (key === this.key) return;
    this.key = key;
    this.snap = next;
    this.listeners.forEach((l) => l());
  }
}

/**
 * Feed the store from the frame tap (after the camera moves, like the minimap), with what the
 * sim's own HUD snapshot adds (`hud.chapter`: a blow lands now, beside Mary, SAVED).
 */
export function feedChapter(tap: FrameTap, store: ChapterStore, hud: HudStore): () => void {
  return tap.on(throttled(12, (t) => store.set(chapterHud(t.frame as ChapterRenderFrame, hud.getSnapshot()?.chapter))));
}

export function useChapter(store: ChapterStore): ChapterHud | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}

/** One value from the chapter's view: re-renders only when it changes. */
export function useChapterValue<T extends string | number | boolean | null>(store: ChapterStore, select: (c: ChapterHud | null) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(null),
  );
}

/**
 * What a case night says out loud (the page's live region): each new phase, the warning
 * as he starts to aim, and the chapter's events (lib/cases/view.ts chapterLine).
 */
export function useChapterLines(store: ChapterStore, bus: ChapterBus, say: (text: string, urgent?: boolean) => void) {
  useEffect(() => {
    let phase: ChapterPhase | null = null;
    let aiming = false;
    const offStore = store.subscribe(() => {
      const c = store.getSnapshot();
      if (c && c.phase !== phase) {
        phase = c.phase;
        say(phaseLine(c.phase), true);
      }
      const aim = c?.villain?.phase === "aim";
      if (aim && !aiming) say("Screenshot! Step out of the cone.", true);
      aiming = aim;
    });
    const offBus = bus.on((ev) => {
      if (!isChapterEvent(ev)) return;
      const line = chapterLine(ev);
      if (line) say(line.text, line.urgent);
    });
    return () => {
      offStore();
      offBus();
    };
  }, [store, bus, say]);
}

/* ------------------------------------------------------------------ the objective */

function ClueMark({ found, name }: { found: boolean; name: string }) {
  return (
    <span
      title={`${name}: ${found ? "found" : "not found yet"}`}
      className={`grid size-7 place-items-center rounded-full border-2 border-game-ink ${found ? "bg-game-mint text-game-ink" : "border-dashed bg-game-paper-2 text-game-muted"}`}
    >
      {found ? <Check className="size-3.5" strokeWidth={3} /> : <Search className="size-3.5" strokeWidth={2.5} />}
    </span>
  );
}

/** The case's objective, in the route bar's place and size. */
export function ObjectiveChip({ store, className = "" }: { store: ChapterStore; className?: string }) {
  const hud = useChapter(store);
  if (!hud) return null;
  const o = objective(hud);
  const lead =
    hud.phase === "investigate" ? (
      <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold">
        <Search className="size-5" strokeWidth={2.25} />
      </span>
    ) : hud.phase === "standoff" ? (
      <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-hero text-game-on-hero">
        <Cursor className="size-5" strokeWidth={2.25} />
      </span>
    ) : hud.phase === "rescue" ? (
      <Face id="mary-jpeg" className="size-11 rounded-full" />
    ) : (
      <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-mint">
        <Check className="size-5" strokeWidth={3} />
      </span>
    );
  return (
    <StickerPanel as="section" aria-label={`Case file ${CASE_001.number}`} className={`flex h-[60px] items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 ${className}`}>
      <span aria-hidden className="contents">
        {lead}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[10px] font-bold uppercase leading-3 tracking-[0.1em] text-game-muted">
          Case file <span className="num">{CASE_001.number}</span>
        </p>
        <p className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em]">
          {o.label}
          {o.count ? (
            <span className="num ml-1.5 text-game-ink">
              {o.count.found}/{o.count.total}
            </span>
          ) : null}
        </p>
      </div>
      {hud.phase === "investigate" ? (
        <span aria-hidden className="flex shrink-0 gap-1">
          {hud.clues.map((c) => (
            <ClueMark key={c.id} found={c.found} name={clueCopy(c.id).name} />
          ))}
        </span>
      ) : null}
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ the villain */

const CUE_TONE = {
  warn: "bg-game-hero text-game-on-hero",
  open: "bg-game-gold text-game-ink",
  plain: "bg-game-paper-2 text-game-ink",
} as const;

/** The Right-Clicker's bar, in the villain bar's place during the standoff. */
export function RightClickerBar({ store }: { store: ChapterStore }) {
  const hud = useChapter(store);
  const v = hud?.villain;
  if (!v) return null;
  const cue = villainCue(v.phase, v.open);
  return (
    <StickerPanel className="flex max-w-full items-center gap-2.5 rounded-[22px] py-1.5 pl-1.5 pr-3">
      <span aria-hidden className="grid size-10 shrink-0 overflow-hidden rounded-full border-2 border-white bg-sticker shadow-[0_2px_0_var(--game-ink)]">
        <RightClickerArt />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-[13px] font-semibold leading-4">{RIGHT_CLICKER.name}</p>
        <p className="text-[11px] italic leading-[14px] text-game-muted max-[379px]:hidden">“{RIGHT_CLICKER.tagline}”</p>
        <p className="mt-0.5 flex items-center gap-1" aria-label={`${v.hits} of ${v.hitsMax} hits left`}>
          {Array.from({ length: v.hitsMax }, (_, i) => (
            <span key={i} aria-hidden className={`size-2.5 rounded-full border-2 border-game-ink ${i < v.hits ? "bg-game-hero" : "bg-game-paper-2"}`} />
          ))}
        </p>
      </div>
      {cue ? (
        <span className={`ml-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold leading-5 ${CUE_TONE[cue.tone]}`}>
          {cue.tone === "warn" ? <Camera aria-hidden className="size-3.5" strokeWidth={2.5} /> : null}
          {cue.text}
        </span>
      ) : null}
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ callouts */

/** A flash's outcome, kept on screen a moment after the event. */
type Shot = { hit: boolean; at: number } | null;

/**
 * The SCREENSHOT warning: while he aims, "Screenshot!" in a hazard-striped badge with a
 * camera, and what to do; after the flash, whether it caught you. The sound line under it
 * is the shutter written out, for anyone playing without sound.
 */
function ScreenshotAlert({ store, bus }: { store: ChapterStore; bus: ChapterBus }) {
  const aiming = useChapterValue(store, (c) => c?.villain?.phase === "aim");
  // Frozen by the flash: the sim's word, for as long as it lasts.
  const saved = useChapterValue(store, (c) => !!c?.saved);
  const [shot, setShot] = useState<Shot>(null);
  useEffect(() => {
    let timer = 0;
    const off = bus.on((ev) => {
      if (!isChapterEvent(ev) || ev.type !== "screenshot") return;
      window.clearTimeout(timer);
      setShot({ hit: ev.hit, at: performance.now() });
      timer = window.setTimeout(() => setShot(null), 1300);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [bus]);

  const view =
    saved || shot?.hit
      ? { word: "Saved!", line: "Frozen for a second", sound: "[Shutter clicks]" }
      : shot
        ? { word: "Missed you", line: "He’s reloading: hit him", sound: "[Shutter clicks]" }
        : aiming
          ? { word: "Screenshot!", line: "Step out of the cone", sound: "[Shutter winding up]" }
          : null;
  if (!view) return null;
  return (
    <div key={view.word} className="wgp-pop flex flex-col items-center gap-1.5">
      {/* Hazard stripes round the badge: a pattern, not only a colour. */}
      <span className="rounded-[18px] bg-[repeating-linear-gradient(135deg,var(--game-ink)_0_7px,var(--game-gold)_7px_14px)] p-[5px] shadow-[var(--game-shadow)]">
        <span className="flex items-center gap-2 rounded-[13px] border-2 border-game-ink bg-game-paper px-4 py-1.5 text-game-ink">
          <Camera aria-hidden className="size-6 shrink-0" strokeWidth={2.25} />
          <span className="font-display text-[24px] font-bold uppercase leading-7 tracking-[0.02em]">{view.word}</span>
        </span>
      </span>
      <span className="rounded-full border-2 border-game-ink bg-game-ink px-3 py-0.5 text-[13px] font-semibold leading-5 text-game-paper">{view.line}</span>
      <span className="text-[12px] font-semibold italic leading-4 text-game-paper [text-shadow:0_1px_0_var(--game-ink),0_-1px_0_var(--game-ink),1px_0_0_var(--game-ink),-1px_0_0_var(--game-ink)]">
        {view.sound}
      </span>
    </div>
  );
}

/** The note each clue leaves in the case file, for a few seconds after it's found. */
function CaseNote({ bus }: { bus: ChapterBus }) {
  const [note, setNote] = useState<{ id: ClueId; n: number; found: number; of: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    let n = 0;
    const off = bus.on((ev) => {
      if (!isChapterEvent(ev) || ev.type !== "clue-found") return;
      window.clearTimeout(timer);
      setNote({ id: ev.id, n: ++n, found: ev.found, of: ev.of });
      timer = window.setTimeout(() => setNote(null), 4800);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [bus]);
  if (!note) return null;
  const c = clueCopy(note.id);
  return (
    <div key={note.n} className="wgp-rise relative w-[min(320px,calc(100vw-48px))] -rotate-1 rounded-[14px] border-[2.5px] border-game-ink bg-game-paper px-3.5 pb-3 pt-3.5 text-game-ink shadow-[var(--game-shadow)]">
      <span aria-hidden className="absolute -top-2.5 left-1/2 h-5 w-14 -translate-x-1/2 rotate-2 rounded-[3px] bg-game-gold/80" />
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        <Search aria-hidden className="size-3.5" strokeWidth={2.5} />
        <span>
          Clue <span className="num">{note.found}</span> of <span className="num">{note.of}</span> · {c.name}
        </span>
      </p>
      <p className="mt-1 text-[15px] font-semibold leading-5 text-pretty">“{c.note}”</p>
    </div>
  );
}

const CALLOUTS = {
  /** A mouse and keys: under the hero's feet, where the countdown sat. */
  wide: "top-[calc(50%+140px)] flex-col",
  /** A phone held upright: over the hero's head, growing up, clear of the thumbs' powers below. */
  phone: "bottom-[calc(50%-60px)] flex-col-reverse",
  /** A phone held sideways: along the bottom edge, between the thumbs. */
  short: "bottom-[max(12px,env(safe-area-inset-bottom))] flex-col",
} as const;

/** The warning and the notes, kept off the hero and the controls. Read out by the page's announcer, not here. */
export function ChapterCallouts({ store, bus, layout }: { store: ChapterStore; bus: ChapterBus; layout: keyof typeof CALLOUTS }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 flex items-center gap-3 px-4 ${CALLOUTS[layout]}`}>
      <ScreenshotAlert store={store} bus={bus} />
      <CaseNote bus={bus} />
    </div>
  );
}

/* ------------------------------------------------------------------ the standoff's beats */

/** The Right-Clicker's sticker face (he isn't in the cast's art). */
function RightClickerFace({ className = "size-10 rounded-full" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 overflow-hidden border-2 border-white bg-sticker shadow-[0_2px_0_var(--game-ink)] ${className}`}>
      <RightClickerArt />
    </span>
  );
}

/**
 * The case's own beats over the night, where a patrol's encounter banner and win caption
 * go: the Right-Clicker on the deck as the standoff opens, his defeat line once he's
 * webbed, and Mary's "gm" once she's free.
 */
export function ChapterBeats({ hud }: { hud: HudStore }) {
  const beat = useHudValue(hud, (h) => {
    const c = h?.chapter;
    if (!c) return null;
    if (h.mode === "intro" && c.phase === "standoff") return "encounter";
    if (h.mode === "won" && c.phase === "standoff") return "webbed";
    if (c.phase === "done" && c.freed) return "freed";
    return null;
  });
  const v = CHAPTERS["case-001"].villain;
  if (beat === "encounter")
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center px-4 md:top-[30%] short:top-[84px]">
        <StickerPanel className="animate-rise flex w-full max-w-[460px] items-start gap-4 p-4 sm:p-5">
          <RightClickerFace className="size-20 rounded-[24px] border-[5px] sm:size-24" />
          <div className="flex min-w-0 flex-col gap-2">
            <StickerEyebrow>
              <span>
                Case file <span className="num">{CASE_001.number}</span> · {CASE_001.district}
              </span>
            </StickerEyebrow>
            <h2 className="text-[26px] font-bold leading-7 tracking-[-0.02em] text-game-ink sm:text-[30px] sm:leading-8">{v.name}</h2>
            <p className="text-[13px] italic leading-[18px] text-game-muted">“{v.tagline}”</p>
            <p className="relative mt-1 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 text-[14px] font-medium leading-5">“{v.taunt}”</p>
          </div>
        </StickerPanel>
      </div>
    );
  if (beat === "webbed" || beat === "freed")
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(28px,env(safe-area-inset-bottom))] flex justify-center px-4">
        <StickerPanel className="animate-rise flex max-w-[460px] items-center gap-3 rounded-full py-2 pl-2 pr-5">
          {beat === "webbed" ? <RightClickerFace /> : <Face id="mary-jpeg" className="size-10 rounded-full" />}
          <p className="text-[14px] font-semibold leading-5 text-pretty">
            {beat === "webbed" ? v.defeat : `${CHAPTERS["case-001"].captive.name}: “${CHAPTERS["case-001"].captive.freed}.” Back to full quality.`}
          </p>
        </StickerPanel>
      </div>
    );
  return null;
}

/* ------------------------------------------------------------------ the rescue */

/** The bar floats this far above Mary’s feet (world units; she’s about 88 tall): just over her head. */
const LIFT = 120;

/** "Restoring quality" over Mary while you hold web beside her, placed from the camera each frame. */
export function RestoreBar({ tap, touch, store }: { tap: FrameTap; touch: boolean; store: ChapterStore }) {
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
      const c = (t.frame as unknown as ChapterRenderFrame).chapter;
      const cap = c?.phase === "rescue" && c.captive && !c.captive.freed ? c.captive : null;
      const show = !!cap && !!t.pose;
      if (show !== shown) {
        shown = show;
        el.style.visibility = show ? "visible" : "hidden";
      }
      if (!cap || !t.pose) return;
      at.x = cap.pos.x;
      at.y = cap.pos.y + LIFT;
      at.z = cap.pos.z;
      const p = project(at, t.pose, t.width, t.height);
      // Off screen or behind: held inside the screen, clear of the HUD's top band.
      const x = Math.max(110, Math.min(t.width - 110, p.behind ? t.width / 2 : p.x));
      const y = Math.max(200, Math.min(t.height - 150, p.behind ? t.height / 2 : p.y));
      const place = `translate3d(${(Math.round(x * 2) / 2).toFixed(1)}px, ${(Math.round(y * 2) / 2).toFixed(1)}px, 0)`;
      if (place !== lastPlace) {
        lastPlace = place;
        el.style.transform = place;
      }
      const n = Math.round(Math.max(0, Math.min(1, cap.restore)) * 100);
      if (n !== lastPct) {
        lastPct = n;
        if (fill.current) fill.current.style.width = `${n}%`;
        if (pct.current) pct.current.textContent = `${n}%`;
        meter.current?.setAttribute("aria-valuenow", String(n));
      }
      // What to do: get beside her, then hold the web (the sim says which).
      const words = store.getSnapshot()?.beside ? (touch ? "Hold the right side to restore her" : "Hold Space to restore her") : "Stand beside her and hold web";
      if (words !== lastHint && hint.current) {
        lastHint = words;
        hint.current.textContent = words;
      }
    });
    return () => {
      off();
      el.style.visibility = "hidden";
    };
  }, [tap, store, touch]);
  return (
    <div ref={root} className="pointer-events-none invisible absolute left-0 top-0 z-0 will-change-transform">
      <div className="absolute bottom-0 left-0 flex w-[200px] -translate-x-1/2 flex-col items-center">
        <StickerPanel className="flex w-full flex-col gap-1.5 rounded-[16px] px-3 py-2">
          <p className="flex items-baseline justify-between gap-2 text-[12px] font-bold leading-4">
            <span>Restoring quality</span>
            <span ref={pct} className="num">
              0%
            </span>
          </p>
          <div ref={meter} role="meter" aria-label="Restoring Mary’s quality" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className="h-3 overflow-hidden rounded-full border-2 border-game-ink bg-game-paper-2">
            <span ref={fill} className="block h-full w-0 bg-game-mint" />
          </div>
          <p ref={hint} className="text-[11px] font-medium leading-[14px] text-game-muted">
            Stand beside her and hold web
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

/** The case's section of How to play (the pause sheet), first while a case is on. */
export function ChapterTips({ touch }: { touch: boolean }) {
  const web = touch ? "hold the right side of the screen" : "hold Space or the mouse";
  return (
    <section className="flex flex-col gap-2 rounded-[14px] border-2 border-game-ink bg-game-folder p-3">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-game-ink">
        <Search aria-hidden className="size-4" strokeWidth={2.5} />
        Case file {CASE_001.number}: {CASE_001.title}
      </h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-game-ink">
        <li>
          Three clues are hidden on the Bridge District’s roofs: {CLUES.map((c) => c.name.toLowerCase()).join(", ")}. Swing close to one to pick it up; the minimap and the city map pin
          them, and tick them off once found.
        </li>
        <li>
          {RIGHT_CLICKER.name} waits on the bridge deck. When he aims (“Saving…” and a <span className="font-semibold">Screenshot!</span> warning), step sideways out of his cone
          before the flash, or you’re saved: frozen for a second.
        </li>
        <li>After a flash he reloads: that’s your opening. Ctrl+C makes paper copies of you that block a hit each, and you can punch your way out of his drag.</li>
        <li>Then stand next to Mary and {web} to restore her. Getting hurt pauses it.</li>
      </ul>
    </section>
  );
}
