"use client";

/**
 * Case file 002's HUD over a "Sybil Vote" night, mounted only on that case
 * (play-surface.tsx); a patrol night or Case file 001 never mounts any of it.
 *
 * - VoteStore: the HUD's view of `frame.chapter.vote` (lib/cases/vote-view.ts voteHud), fed
 *   from the frame tap about 12 times a second and published only when it changes.
 * - VoteObjective: in the route bar's place. "Read the drop boxes 1/3", "Find the real
 *   Sybil", "Win the vote", "Catch the ballot thief", "Drop the ballot in the box".
 * - SybilVoteBar: in the villain bar's place in the fight: hits left, the copies standing, and
 *   what he's doing ("Fork vote!", "Fake vote", "Open: hit him").
 * - Callouts: the suspect profile (what the drop boxes said) while you pick him out, the fork
 *   vote's warning (hazard stripes, a countdown and which side you're on, never colour alone),
 *   the recount, and each drop box's note as it's read.
 * - BallotPointer: "Uncle Gen's ballot" over the runner, then "Drop it in the box", placed
 *   from the camera each frame like the waypoint.
 * - VoteBeats and VoteTips: the case's banners, and its section of How to play.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { StickerEyebrow, StickerPanel } from "@/components/game/kit";
import { ArrowLeftRight, Check, Search, Users, Vote } from "@/components/icons";
import { project } from "@/game3d/nav/waypoint";
import { throttled, type FrameTap } from "@/game3d/nav/tap";
import type { HudStore } from "@/sim/loop";
import { Face } from "@/sim/ui/bits";
import { useHudValue } from "@/sim/ui/hud";
import { CASE_002, SYBIL, VOTE_CLUES, voteClueCopy } from "@/lib/cases/content-002";
import { isVoteEvent, realBits, voteCue, voteHud, voteLine, voteObjective, votePhaseLine, type ProfileLine, type VoteHud } from "@/lib/cases/vote-view";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";
import type { ClueId } from "@wgp/game-core/chapters";

/** The loop's event bus, as the case listens to it. */
export interface VoteBus {
  on(fn: (e: { type: string }) => void): () => void;
}

/* ------------------------------------------------------------------ the store */

export class VoteStore {
  private snap: VoteHud | null = null;
  private key = "";
  /** The real one's tells (for the clue notes), once a frame has said. */
  real = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;
  set(next: VoteHud | null) {
    const key = next ? JSON.stringify(next) : "";
    if (key === this.key) return;
    this.key = key;
    this.snap = next;
    this.listeners.forEach((l) => l());
  }
}

/** Feed the store from the frame tap, with what the sim's own HUD snapshot adds (a blow lands now). */
export function feedVote(tap: FrameTap, store: VoteStore, hud: HudStore): () => void {
  return tap.on(
    throttled(12, (t) => {
      const f = t.frame as RenderFrame3D;
      if (f.chapter?.vote) store.real = realBits(f.chapter.vote);
      store.set(voteHud(f, hud.getSnapshot()?.villain ?? null));
    }),
  );
}

export function useVote(store: VoteStore): VoteHud | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}

export function useVoteValue<T extends string | number | boolean | null>(store: VoteStore, select: (c: VoteHud | null) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(null),
  );
}

/** What the case says out loud (the page's live region): each new phase and stage, and its events. */
export function useVoteLines(store: VoteStore, bus: VoteBus, say: (text: string, urgent?: boolean) => void) {
  useEffect(() => {
    let key = "";
    const offStore = store.subscribe(() => {
      const c = store.getSnapshot();
      if (!c) return;
      const next = `${c.phase}:${c.phase === "standoff" ? c.stage : ""}`;
      if (next !== key) {
        key = next;
        // The runoff follows the recount quietly; the rest is worth saying.
        if (!(c.phase === "standoff" && c.stage === "runoff")) say(votePhaseLine(c.phase, c.stage), true);
      }
    });
    const offBus = bus.on((ev) => {
      if (!isVoteEvent(ev)) return;
      const line = voteLine(ev, store.real);
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
      title={`${name}: ${found ? "read" : "not read yet"}`}
      className={`grid size-7 place-items-center rounded-full border-2 border-game-ink ${found ? "bg-game-mint text-game-ink" : "border-dashed bg-game-paper-2 text-game-muted"}`}
    >
      {found ? <Check className="size-3.5" strokeWidth={3} /> : <Search className="size-3.5" strokeWidth={2.5} />}
    </span>
  );
}

function Lead({ hud }: { hud: VoteHud }) {
  const ring = "grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink";
  switch (hud.phase) {
    case "investigate":
      return (
        <span className={`${ring} bg-game-gold`}>
          <Search className="size-5" strokeWidth={2.25} />
        </span>
      );
    case "lineup":
      return (
        <span className={`${ring} bg-game-paper-2`}>
          <Users className="size-5" strokeWidth={2.25} />
        </span>
      );
    case "standoff":
      return (
        <span className={`${ring} bg-game-hero text-game-on-hero`}>
          <Vote className="size-5" strokeWidth={2.25} />
        </span>
      );
    case "rescue":
      return <Face id="uncle-gen" className="size-11 rounded-full" />;
    case "done":
      return (
        <span className={`${ring} bg-game-mint`}>
          <Check className="size-5" strokeWidth={3} />
        </span>
      );
  }
}

/** The case's objective, in the route bar's place and size. */
export function VoteObjective({ store, className = "" }: { store: VoteStore; className?: string }) {
  const hud = useVote(store);
  if (!hud) return null;
  const o = voteObjective(hud);
  return (
    <StickerPanel as="section" aria-label={`Case file ${CASE_002.number}`} className={`flex h-[60px] items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 ${className}`}>
      <span aria-hidden className="contents">
        <Lead hud={hud} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[10px] font-bold uppercase leading-3 tracking-[0.1em] text-game-muted">
          Case file <span className="num">{CASE_002.number}</span>
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
            <ClueMark key={c.id} found={c.found} name={voteClueCopy(c.id).name} />
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

/** The Sybil's bar, in the villain bar's place during the fight. */
export function SybilVoteBar({ store }: { store: VoteStore }) {
  const v = useVoteValue(store, (c) => (c?.villain ? JSON.stringify(c.villain) : null));
  if (!v) return null;
  const villain = JSON.parse(v) as NonNullable<VoteHud["villain"]>;
  const cue = voteCue(villain.state, villain.open);
  return (
    <StickerPanel className="flex max-w-full items-center gap-2.5 rounded-[22px] py-1.5 pl-1.5 pr-3">
      <Face id="sybil" className="size-10 rounded-full" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex items-baseline gap-1.5 truncate text-[13px] font-semibold leading-4">
          <span className="truncate">{SYBIL.name}</span>
          <span className="num whitespace-nowrap text-[11px] font-medium text-game-muted">
            + {villain.copies} {villain.copies === 1 ? "copy" : "copies"}
          </span>
        </p>
        <p className="text-[11px] italic leading-[14px] text-game-muted max-[379px]:hidden">“{SYBIL.tagline}”</p>
        <p className="mt-0.5 flex items-center gap-1" aria-label={`${villain.hits} of ${villain.hitsMax} hits left`}>
          {Array.from({ length: villain.hitsMax }, (_, i) => (
            <span key={i} aria-hidden className={`size-2.5 rounded-full border-2 border-game-ink ${i < villain.hits ? "bg-game-hero" : "bg-game-paper-2"}`} />
          ))}
        </p>
      </div>
      {cue ? (
        <span className={`ml-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold leading-5 ${CUE_TONE[cue.tone]}`}>
          {cue.tone === "warn" ? <Vote aria-hidden className="size-3.5" strokeWidth={2.5} /> : null}
          {cue.text}
        </span>
      ) : null}
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ the suspect profile */

/** The tell's own little picture, drawn like the game's stickers (decorative). */
function TellGlyph({ tell }: { tell: ProfileLine["tell"] }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (tell === "shadow")
    return (
      <svg {...common}>
        <circle cx="12" cy="6" r="3" />
        <path d="M12 9v7M9 12h6M12 16l-3 4M12 16l3 4" />
        <ellipse cx="12" cy="21" rx="7" ry="1.6" fill="currentColor" stroke="none" opacity="0.45" />
      </svg>
    );
  if (tell === "blink")
    return (
      <svg {...common}>
        <path d="M2.5 12c2.6-4.4 5.8-6.5 9.5-6.5s6.9 2.1 9.5 6.5c-2.6 4.4-5.8 6.5-9.5 6.5S5.1 16.4 2.5 12Z" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="6" y="3" width="12" height="15" rx="1.6" />
      <path d="M9 7l6 6M15 7l-6 6M8 21h8" />
    </svg>
  );
}

/** What the drop boxes said about the real one: each tell, or which clue still has it. */
function SuspectProfile({ profile, title }: { profile: ProfileLine[]; title: string }) {
  return (
    <section aria-label="Suspect profile" className="relative w-[min(320px,calc(100vw-48px))] rotate-[0.6deg] rounded-[14px] border-[2.5px] border-game-ink bg-game-paper px-3.5 pb-3 pt-3 text-game-ink shadow-[var(--game-shadow)]">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        <Users aria-hidden className="size-3.5" strokeWidth={2.5} />
        {title}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {profile.map((p) => (
          <li key={p.tell} className={`flex items-center gap-2.5 rounded-[10px] border-2 px-2 py-1.5 ${p.known ? "border-game-ink bg-game-paper-2" : "border-dashed border-game-ink/40"}`}>
            <span className={`grid size-7 shrink-0 place-items-center ${p.known ? "text-game-ink" : "text-game-muted"}`}>
              <TellGlyph tell={p.tell} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[10px] font-bold uppercase leading-3 tracking-[0.08em] text-game-muted">{p.label}</span>
              <span className={`text-[14px] leading-5 ${p.known ? "font-bold" : "italic text-game-muted"}`}>{p.known ? p.words : `Unknown: you missed the ${p.clue.toLowerCase()}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ callouts */

/** A hazard-striped badge: a pattern as well as a colour. */
function Striped({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[18px] bg-[repeating-linear-gradient(135deg,var(--game-ink)_0_7px,var(--game-gold)_7px_14px)] p-[5px] shadow-[var(--game-shadow)]">
      <span className="flex items-center gap-2 rounded-[13px] border-2 border-game-ink bg-game-paper px-4 py-1.5 text-game-ink">{children}</span>
    </span>
  );
}

/** The fork vote: the warning, its countdown, which side you're on and what stops it. */
function ForkAlert({ store, bus }: { store: VoteStore; bus: VoteBus }) {
  const fork = useVoteValue(store, (c) => (c?.fork ? JSON.stringify(c.fork) : null));
  const [result, setResult] = useState<{ passed: boolean; hit: boolean; n: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    let n = 0;
    const off = bus.on((ev) => {
      if (!isVoteEvent(ev) || ev.type !== "fork") return;
      window.clearTimeout(timer);
      setResult({ passed: ev.passed, hit: ev.hit, n: ++n });
      timer = window.setTimeout(() => setResult(null), 1400);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [bus]);
  if (fork) {
    const f = JSON.parse(fork) as NonNullable<VoteHud["fork"]>;
    const pops = Math.max(0, f.votes - f.need + 1);
    return (
      <div className="flex flex-col items-center gap-1.5">
        <Striped>
          <ArrowLeftRight aria-hidden className="size-6 shrink-0" strokeWidth={2.25} />
          <span className="font-display text-[24px] font-bold uppercase leading-7 tracking-[0.02em]">Fork vote!</span>
          <span className="num ml-1 rounded-full border-2 border-game-ink bg-game-ink px-2 text-[15px] font-bold leading-6 text-game-paper">{f.left.toFixed(1)}</span>
        </Striped>
        <span className={`rounded-full border-2 border-game-ink px-3 py-0.5 text-[13px] font-semibold leading-5 ${f.orphaned ? "bg-game-hero text-game-on-hero" : "bg-game-mint text-game-ink"}`}>
          {f.orphaned ? "You’re on the orphaned side: cross the line" : "Safe side. Stay put"}
        </span>
        <span className="text-[12px] font-semibold leading-4 text-game-paper [text-shadow:0_1px_0_var(--game-ink),0_-1px_0_var(--game-ink),1px_0_0_var(--game-ink),-1px_0_0_var(--game-ink)]">
          {pops > 0 ? `Or pop ${pops} voting ${pops === 1 ? "copy" : "copies"} to block it` : "Quorum’s gone: it can’t pass"}
        </span>
      </div>
    );
  }
  if (!result) return null;
  return (
    <div key={result.n} className="wgp-pop flex flex-col items-center gap-1.5">
      <Striped>
        <Vote aria-hidden className="size-6 shrink-0" strokeWidth={2.25} />
        <span className="font-display text-[24px] font-bold uppercase leading-7 tracking-[0.02em]">{result.passed ? (result.hit ? "Forked!" : "Passed") : "Quorum failed"}</span>
      </Striped>
      <span className="rounded-full border-2 border-game-ink bg-game-ink px-3 py-0.5 text-[13px] font-semibold leading-5 text-game-paper">
        {result.passed ? (result.hit ? "Reorged off the orphaned side" : "You were on the right side") : "He’s open: hit him"}
      </span>
    </div>
  );
}

/** The note each drop box leaves, for a few seconds after it's read: what it says about him. */
function BoxNote({ bus, store }: { bus: VoteBus; store: VoteStore }) {
  const [note, setNote] = useState<{ id: ClueId; n: number; found: number; of: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    let n = 0;
    const off = bus.on((ev) => {
      if (!isVoteEvent(ev) || ev.type !== "clue-found") return;
      window.clearTimeout(timer);
      setNote({ id: ev.id, n: ++n, found: ev.found, of: ev.of });
      timer = window.setTimeout(() => setNote(null), 5600);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [bus]);
  if (!note) return null;
  const c = voteClueCopy(note.id);
  return (
    <div key={note.n} className="wgp-rise relative w-[min(320px,calc(100vw-48px))] -rotate-1 rounded-[14px] border-[2.5px] border-game-ink bg-game-paper px-3.5 pb-3 pt-3.5 text-game-ink shadow-[var(--game-shadow)]">
      <span aria-hidden className="absolute -top-2.5 left-1/2 h-5 w-14 -translate-x-1/2 rotate-2 rounded-[3px] bg-game-gold/80" />
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        <Search aria-hidden className="size-3.5" strokeWidth={2.5} />
        <span>
          Drop box <span className="num">{note.found}</span> of <span className="num">{note.of}</span> · {c.name}
        </span>
      </p>
      <p className="mt-1 text-[15px] font-semibold leading-5 text-pretty">“{c.note(store.real)}”</p>
    </div>
  );
}

/** The recount's clock while he hides. */
function RecountAlert({ store }: { store: VoteStore }) {
  const left = useVoteValue(store, (c) => (c?.phase === "standoff" && c.recount ? c.recount.left : null));
  if (left === null) return null;
  return (
    <Striped>
      <Users aria-hidden className="size-6 shrink-0" strokeWidth={2.25} />
      <span className="font-display text-[22px] font-bold uppercase leading-7 tracking-[0.02em]">Recount</span>
      <span className="num ml-1 rounded-full border-2 border-game-ink bg-game-ink px-2 text-[15px] font-bold leading-6 text-game-paper">{left}</span>
    </Striped>
  );
}

/** The profile as a stack of chips, for a phone: each tell, or a dashed "?" while its clue's unread. */
function ProfileChips({ profile }: { profile: ProfileLine[] }) {
  return (
    <ul aria-label="Suspect profile" className="flex flex-col items-start gap-1.5">
      {profile.map((p) => (
        <li
          key={p.tell}
          className={`flex h-8 items-center gap-1 rounded-full border-2 px-2 text-[12px] font-bold leading-4 text-game-ink shadow-[var(--game-shadow-sm)] ${p.known ? "border-game-ink bg-game-paper" : "border-dashed border-game-ink/60 bg-game-paper-2 italic text-game-muted"}`}
        >
          <span className="grid size-5 place-items-center [&>svg]:size-[18px]">
            <TellGlyph tell={p.tell} />
          </span>
          {p.known ? p.words : `${p.label}: ?`}
        </li>
      ))}
    </ul>
  );
}

const PROFILE_AT = {
  /** A mouse and keys: down the left, under the vitals. */
  wide: "left-4 top-[176px] items-start",
  /** A phone held upright: down the left under the objective (the minimap keeps the right). */
  phone: "left-3 top-[calc(max(12px,env(safe-area-inset-top))+184px)] items-start",
  /** Held sideways: down the left under the vitals. */
  short: "left-3 top-[calc(max(8px,env(safe-area-inset-top))+96px)] items-start",
} as const;

/** While you pick him out (the lineup, the recount): what the drop boxes said about him. */
export function VoteProfile({ store, layout }: { store: VoteStore; layout: keyof typeof PROFILE_AT }) {
  const key = useVoteValue(store, (c) => {
    if (!c) return null;
    const picking = c.phase === "lineup" || (c.phase === "standoff" && c.stage === "recount");
    return picking ? JSON.stringify({ p: c.profile, w: c.wrong, ph: c.phase }) : null;
  });
  if (!key) return null;
  const { p, w, ph } = JSON.parse(key) as { p: ProfileLine[]; w: number; ph: string };
  return (
    <div aria-hidden className={`pointer-events-none absolute flex flex-col ${PROFILE_AT[layout]}`}>
      {layout === "wide" ? (
        <SuspectProfile profile={p} title={ph === "lineup" ? (w > 0 ? `Suspect profile · ${w} wrong` : "Suspect profile: hit the match") : "He’s one of these: hit the match"} />
      ) : (
        <ProfileChips profile={p} />
      )}
    </div>
  );
}

const CALLOUTS = {
  wide: "top-[calc(50%+140px)] flex-col",
  phone: "bottom-[calc(50%-60px)] flex-col-reverse",
  short: "bottom-[max(12px,env(safe-area-inset-bottom))] flex-col",
} as const;

/** The warnings and the notes, kept off the hero and the controls. Read out by the page's announcer, not here. */
export function VoteCallouts({ store, bus, layout }: { store: VoteStore; bus: VoteBus; layout: keyof typeof CALLOUTS }) {
  return (
    <>
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 flex items-center gap-3 px-4 ${CALLOUTS[layout]}`}>
        <ForkAlert store={store} bus={bus} />
        <RecountAlert store={store} />
        <BoxNote bus={bus} store={store} />
      </div>
      <VoteProfile store={store} layout={layout} />
    </>
  );
}

/* ------------------------------------------------------------------ the beats */

/**
 * The case's own beats over the night, where a patrol's encounter banner and win caption go:
 * the polling station as the lineup opens, his defeat line once he's webbed, and Uncle Gen's
 * "Counted." once his ballot's in.
 */
export function VoteBeats({ hud }: { hud: HudStore }) {
  const beat = useHudValue(hud, (h) => {
    const c = h?.chapter;
    if (!c) return null;
    if (h.mode === "intro" && c.phase === "lineup") return "station";
    if (h.mode === "won" && c.phase === "standoff") return "webbed";
    if (c.phase === "done" && c.freed) return "counted";
    return null;
  });
  if (beat === "station")
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center px-4 md:top-[30%] short:top-[84px]">
        <StickerPanel className="animate-rise flex w-full max-w-[460px] items-start gap-4 p-4 sm:p-5">
          <Face id="sybil" className="size-20 rounded-[24px] border-[5px] sm:size-24" />
          <div className="flex min-w-0 flex-col gap-2">
            <StickerEyebrow>
              <span>
                Case file <span className="num">{CASE_002.number}</span> · The polling station
              </span>
            </StickerEyebrow>
            <h2 className="text-[26px] font-bold leading-7 tracking-[-0.02em] text-game-ink text-balance sm:text-[30px] sm:leading-8">Eight voters. One man.</h2>
            <p className="relative mt-1 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 text-[14px] font-medium leading-5">“{SYBIL.taunt}”</p>
          </div>
        </StickerPanel>
      </div>
    );
  if (beat === "webbed" || beat === "counted")
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(28px,env(safe-area-inset-bottom))] flex justify-center px-4">
        <StickerPanel className="animate-rise flex max-w-[460px] items-center gap-3 rounded-full py-2 pl-2 pr-5">
          {beat === "webbed" ? <Face id="sybil" className="size-10 rounded-full" /> : <Face id="uncle-gen" className="size-10 rounded-full" />}
          <p className="text-[14px] font-semibold leading-5 text-pretty">{beat === "webbed" ? SYBIL.defeat : `${CASE_002.gen.name}: “Counted.” His vote decides the toll.`}</p>
        </StickerPanel>
      </div>
    );
  return null;
}

/* ------------------------------------------------------------------ the ballot */

/** The label floats this far above what it points at (world units). */
const LIFT = 96;

/** "Uncle Gen's ballot" over the runner, then "Drop it in the box" over the box, placed from the camera each frame. */
export function BallotPointer({ tap }: { tap: FrameTap }) {
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let shown = false;
    let lastPlace = "";
    let lastText = "";
    const at = { x: 0, y: 0, z: 0 };
    const off = tap.on((t) => {
      const c = (t.frame as RenderFrame3D).chapter;
      const vote = c?.id === "case-002" && c.phase === "rescue" ? c.vote : null;
      const ballot = vote?.ballot;
      const point = ballot?.state === "runner" ? ballot.pos : ballot?.state === "carried" && vote ? vote.box : null;
      const show = !!point && !!t.pose;
      if (show !== shown) {
        shown = show;
        el.style.visibility = show ? "visible" : "hidden";
      }
      if (!point || !t.pose) return;
      at.x = point.x;
      at.y = point.y + LIFT;
      at.z = point.z;
      const p = project(at, t.pose, t.width, t.height);
      const x = Math.max(110, Math.min(t.width - 110, p.behind ? t.width / 2 : p.x));
      const y = Math.max(200, Math.min(t.height - 150, p.behind ? t.height / 2 : p.y));
      const place = `translate3d(${(Math.round(x * 2) / 2).toFixed(1)}px, ${(Math.round(y * 2) / 2).toFixed(1)}px, 0)`;
      if (place !== lastPlace) {
        lastPlace = place;
        el.style.transform = place;
      }
      const text = ballot?.state === "runner" ? "Uncle Gen’s ballot: catch it" : "Drop it in the box";
      if (text !== lastText && label.current) {
        lastText = text;
        label.current.textContent = text;
      }
    });
    return () => {
      off();
      el.style.visibility = "hidden";
    };
  }, [tap]);
  return (
    <div ref={root} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 z-0 will-change-transform">
      <div className="absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center">
        <StickerPanel className="flex items-center gap-2 whitespace-nowrap rounded-full py-1 pl-1 pr-3">
          <Face id="uncle-gen" className="size-7 rounded-full" />
          <span ref={label} className="text-[13px] font-bold leading-5">
            Uncle Gen’s ballot: catch it
          </span>
        </StickerPanel>
        <svg aria-hidden width="16" height="12" viewBox="0 0 16 12" className="-mt-px block">
          <path d="M1.5 1.5 L8 10.5 L14.5 1.5 Z" fill="var(--game-paper)" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ how to play */

/** The case's section of How to play (the pause sheet), first while the case is on. */
export function VoteTips({ touch }: { touch: boolean }) {
  const web = touch ? "tap the right side of the screen" : "press Space or click";
  return (
    <section className="flex flex-col gap-2 rounded-[14px] border-2 border-game-ink bg-game-folder p-3">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-game-ink">
        <Vote aria-hidden className="size-4" strokeWidth={2.5} />
        Case file {CASE_002.number}: {CASE_002.title}
      </h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-game-ink">
        <li>
          Three drop boxes on Validator Heights roofs each tell you one thing about the real Sybil: {VOTE_CLUES.map((c) => c.name.toLowerCase()).join(", ")}. Swing close to read one;
          the map pins them.
        </li>
        <li>
          At the polling station, eight voters look the same. Check each one’s shadow, whether he blinks, and the hand his ballot is in. Stand next to the match and {web}. A wrong
          one pops, nicks you and joins the fight.
        </li>
        <li>
          When the copies call a <span className="font-semibold">fork vote</span>, the roof splits: cross to the safe side before the count, or pop enough voting copies to break
          quorum and leave him open.
        </li>
        <li>At half his hits he hides in a ring again: hit the match. Then catch the copy with Uncle Gen’s ballot and drop it in the box beside him.</li>
      </ul>
    </section>
  );
}
