"use client";

/**
 * The City HUD, in the sticker kit, over the 3D city. It reads the loop's snapshot (about ten
 * a second, never per frame):
 *
 * - Top: the task tracker (the tracked task first, then what's next on another under way) and
 *   the finds so far (pages, viewpoints); the pause button, and the minimap under it (which
 *   opens the city map).
 * - Bottom middle: what E does here ("Talk to Aunt Mainnet"), and the line someone said, in a
 *   paper speech bubble; over them, Front-run's race chip while its race is on (roam-3).
 * - Finds pop up as toasts (a page's headline, a task done, the XP it paid).
 * - Touch: the move buttons by the right thumb (jump, zip, the act button when there's
 *   something to do, let go while on a wall, the sprint toggle); the left of the screen is
 *   the stick, and a drag anywhere else looks round.
 *
 * Only buttons (and the minimap) take touches; every panel lets them through to the play
 * surface. Panels and buttons are marked `data-hud-zone` so the waypoint keeps clear of them.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";

import { StickerPanel } from "@/components/game/kit";
import { Camera, Check, Newspaper, Pause, Rocket, Target, Zap } from "@/components/icons";
import { FOLKS, PAGES, TASKS, VIEW_NAMES, TASK_DONE, taskStep, type TaskId } from "@wgp/game-core/city";
import { roamWorld } from "@wgp/game-core/sim3d/roam";
import type { CastId } from "@wgp/game-core/cast";

import type { RoamHud, RoamHudStore } from "@/game3d/session/roam-loop";
import { Face, Kbd } from "@/sim/ui/bits";

export function useRoamHud(store: RoamHudStore): RoamHud | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}

const world = () => roamWorld();

/** What E would do, in words: "Talk to Aunt Mainnet", "Take a photo", "Sync the Queens Block mast". */
export function actLabel(act: RoamHud["act"]): string | null {
  if (!act) return null;
  if (act.kind === "talk") {
    const f = world().folks[act.index];
    return `Talk to ${FOLKS[f.key]?.name ?? "them"}`;
  }
  if (act.kind === "photo") return "Take a photo of the tag";
  return `Sync the ${VIEW_NAMES[world().views[act.index].district]}`;
}

/** A face for whoever's speaking: the cast member's sticker, or a paper tile with an initial. */
function Speaker({ folk }: { folk: number }) {
  const f = world().folks[folk];
  if (f.cast) return <Face id={f.cast as CastId} className="size-10" />;
  const name = FOLKS[f.key]?.name ?? "?";
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-gold text-[17px] font-bold text-game-ink">
      {name.replace(/^(Ms|Mrs|Mr|The) /, "").slice(0, 1)}
    </span>
  );
}

/** The tracked task first (picked on the map, even one not started), then the others under way; at most `max`. */
export function trackerTasks(h: Pick<RoamHud, "tasks">, tracked: TaskId | null, max: number): { id: TaskId; stage: number; got: number }[] {
  const all = h.tasks as { id: TaskId; stage: number; got: number }[];
  const first = tracked ? all.filter((t) => t.id === tracked && t.stage !== TASK_DONE) : [];
  const on = all.filter((t) => t.id !== tracked && t.stage > 0 && t.stage < TASK_DONE);
  return [...first, ...on].slice(0, max);
}

/** The tracker: the tracked task's step, another under way, and the finds so far. */
export function TaskTracker({ hud, tracked = null }: { hud: RoamHud; tracked?: TaskId | null }) {
  const tasks = trackerTasks(hud, tracked, 2);
  const done = hud.tasks.filter((t) => t.stage === TASK_DONE).length;
  return (
    <StickerPanel as="section" aria-label="City tasks" data-hud-zone="avoid" className="pointer-events-none flex w-[min(320px,calc(100vw-152px))] flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em]">Free roam</span>
        <span className="num flex items-center gap-2 text-[12px] font-semibold leading-4 text-game-muted">
          <span className="flex items-center gap-1" title="Tasks done">
            <Target aria-hidden className="size-3.5" strokeWidth={2.25} />
            {done}/{hud.tasks.length}
          </span>
          <span className="flex items-center gap-1" title="Daily Rug pages found">
            <Newspaper aria-hidden className="size-3.5" strokeWidth={2.25} />
            {hud.pages}/{hud.pagesOf}
          </span>
          <span className="flex items-center gap-1" title="Viewpoints synced">
            <Rocket aria-hidden className="size-3.5" strokeWidth={2.25} />
            {hud.views}/{hud.viewsOf}
          </span>
          <span className="sr-only">
            {done} of {hud.tasks.length} tasks done, {hud.pages} of {hud.pagesOf} pages found, {hud.views} of {hud.viewsOf} viewpoints synced.
          </span>
        </span>
      </div>
      {tasks.length ? (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <li key={t.id} className={`flex flex-col gap-0.5 rounded-[12px] px-2.5 py-1.5 ${t.id === tracked ? "outline outline-2 -outline-offset-2 outline-game-ink" : ""} bg-game-paper-2`}>
              <span className="flex items-center gap-1.5 text-[13px] font-bold leading-4">
                {t.id === tracked ? <Target aria-hidden className="size-3.5 shrink-0 text-game-hero" strokeWidth={2.5} /> : null}
                {TASKS[t.id].title}
                {t.id === tracked ? <span className="sr-only">, tracked</span> : null}
              </span>
              <span className="text-[13px] leading-[18px] text-pretty">{taskStep(t.id, t.stage, t.got)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] leading-[18px] text-pretty text-game-muted">
          {done === hud.tasks.length ? "Every task’s done. The pages and the masts are still out there." : "Folks with something to ask have a gold marker. The map shows where."}
        </p>
      )}
    </StickerPanel>
  );
}

/** The line on screen: who said it, in a paper speech bubble. */
export function SpeechBubble({ hud }: { hud: RoamHud }) {
  const chat = hud.chat;
  if (!chat) return null;
  const f = FOLKS[chat.key];
  return (
    <div className="pointer-events-none flex justify-center px-4">
      <div role="status" aria-live="polite" className="wgp-rise relative flex w-full max-w-[460px] items-start gap-3 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper p-3 pr-4 text-game-ink shadow-[var(--game-shadow)]">
        <Speaker folk={chat.folk} />
        <p className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-bold leading-4">
            {f?.name ?? "Someone"}
            <span className="font-medium text-game-muted">, {f?.who}</span>
          </span>
          <span className="text-[15px] leading-[21px] text-pretty">“{chat.text}”</span>
        </p>
        {/* The tail points down at the street. */}
        <span aria-hidden className="absolute -bottom-[11px] left-10 size-5 rotate-45 border-b-[2.5px] border-r-[2.5px] border-game-ink bg-game-paper" />
      </div>
    </div>
  );
}

/** What the race chip says: the score while Front-run's race runs, how it ended, or how to go again. */
export function raceChipText(hud: RoamHud): { tone: "race" | "won" | "lost" | "again"; title: string; detail: string } | null {
  const r = hud.race;
  const stage = hud.tasks.find((t) => t.id === "frontrun")?.stage ?? 0;
  if (!r) return stage === 1 ? { tone: "again", title: "Front-run", detail: "Talk to Gwei Stacy to race again" } : null;
  if (r.over === "won") return { tone: "won", title: "Order filled", detail: "You beat Sandwich Man to the buyer" };
  if (r.over === "lost") return { tone: "lost", title: r.why === "river" ? "The parcel’s in the river" : "Sandwich Man filled it first", detail: "Back to Gwei’s stall" };
  const lead = r.heroGate > r.rivalGate ? "You’re ahead" : r.heroGate < r.rivalGate ? "He’s ahead" : "Neck and neck";
  return { tone: "race", title: `Gate ${r.heroGate} of ${r.of} · Sandwich Man: gate ${r.rivalGate}`, detail: lead };
}

/** Front-run's race chip: "Gate 3 of 6 · Sandwich Man: gate 4", who's ahead, then how it ended. */
export function RaceChip({ hud }: { hud: RoamHud }) {
  const t = raceChipText(hud);
  if (!t) return null;
  const mark = t.tone === "won" ? "bg-game-mint" : "bg-game-gold";
  return (
    <div className="pointer-events-none flex justify-center px-4">
      <p role="status" aria-live="polite" className="wgp-pop flex max-w-full items-center gap-2.5 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper py-1.5 pl-1.5 pr-4 text-game-ink shadow-[var(--game-shadow-sm)]">
        {t.tone === "race" || t.tone === "lost" ? (
          <Face id="sandwich-man" className="size-8" />
        ) : (
          <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-game-ink ${mark}`}>
            {t.tone === "won" ? <Check className="size-4" strokeWidth={3} /> : <Zap className="size-4" strokeWidth={2.25} />}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="num text-[14px] font-bold leading-[18px] text-pretty">{t.title}</span>
          <span className="text-[12px] font-medium leading-4 text-pretty text-game-muted">{t.detail}</span>
        </span>
      </p>
    </div>
  );
}

/** "E  Talk to Aunt Mainnet": what the act key does here (keyboard players). */
export function ActPrompt({ hud, touch }: { hud: RoamHud; touch: boolean }) {
  const label = actLabel(hud.act);
  if (!label || touch) return null;
  return (
    <div className="pointer-events-none flex justify-center">
      <span className="wgp-pop inline-flex h-11 items-center gap-2 rounded-full border-[2.5px] border-game-ink bg-game-paper px-4 text-[15px] font-semibold text-game-ink shadow-[var(--game-shadow)]">
        <Kbd className="!inline-flex">E</Kbd>
        {label}
      </span>
    </div>
  );
}

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "page" | "task" | "sync" | "xp" | "info";
}

/** Finds pop up for a few seconds, newest on top, at most three. */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <ol aria-live="polite" className="pointer-events-none flex flex-col items-end gap-2">
      {toasts.slice(-3).map((t) => (
        <li key={t.id} className="wgp-rise flex max-w-[300px] items-start gap-2.5 rounded-[18px] border-[2.5px] border-game-ink bg-game-paper px-3 py-2 text-game-ink shadow-[var(--game-shadow-sm)]">
          <span aria-hidden className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2 border-game-ink ${t.tone === "xp" ? "bg-game-gold" : t.tone === "task" ? "bg-game-mint" : "bg-game-paper-2"}`}>
            {t.tone === "page" ? <Newspaper className="size-4" strokeWidth={2.25} /> : t.tone === "sync" ? <Rocket className="size-4" strokeWidth={2.25} /> : t.tone === "task" ? <Check className="size-4" strokeWidth={3} /> : t.tone === "xp" ? <Zap className="size-4" strokeWidth={2.25} /> : <Target className="size-4" strokeWidth={2.25} />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-bold leading-[18px] text-pretty">{t.title}</span>
            {t.body ? <span className="text-[13px] leading-[18px] text-pretty text-game-muted">{t.body}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A toast's words for a find. */
export function pageToast(page: number, got: number, of: number): Omit<Toast, "id"> {
  const p = PAGES[page];
  return { tone: "page", title: `Daily Rug page ${got} of ${of}`, body: p ? `“${p.headline}.” ${p.body}` : undefined };
}

/** A press that fires the moment a finger lands (and on click for mice and keys). */
function usePress(onUse: () => void) {
  const touchedAt = useRef(-Infinity);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      touchedAt.current = e.timeStamp;
      onUse();
    },
    onClick: (e: { timeStamp: number }) => {
      if (e.timeStamp - touchedAt.current < 700) return;
      onUse();
    },
  };
}

function MoveButton({ label, onUse, onRelease, size = "md", tone = "paper", pressed, children }: { label: string; onUse(): void; onRelease?(): void; size?: "md" | "lg"; tone?: "paper" | "hero" | "gold"; pressed?: boolean; children: ReactNode }) {
  const press = usePress(onUse);
  const dim = size === "lg" ? "size-[76px]" : "size-[58px]";
  const bg = tone === "hero" ? "bg-game-hero text-game-on-hero" : tone === "gold" || pressed ? "bg-game-gold text-game-ink" : "bg-game-paper text-game-ink";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      {...press}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      className={`pointer-events-auto grid ${dim} touch-none select-none place-items-center rounded-full border-[2.5px] border-game-ink ${bg} shadow-[var(--game-shadow)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow,scale] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:scale-[0.96] active:shadow-[var(--game-shadow-sm)] [&>svg]:size-6`}
    >
      {children}
    </button>
  );
}

export interface MoveButtonsProps {
  hud: RoamHud;
  onJump(): void;
  onZip(): void;
  onAct(): void;
  onDrop(): void;
  onSprint(on: boolean): void;
  sprintOn: boolean;
}

/** The right thumb's buttons on touch: jump, zip, act (when there's something), let go (on a wall), sprint. */
export function MoveButtons({ hud, onJump, onZip, onAct, onDrop, onSprint, sprintOn }: MoveButtonsProps) {
  const act = actLabel(hud.act);
  const onWall = hud.move === "climb" || hud.move === "hang" || hud.move === "wallrun";
  return (
    <div data-hud-zone="avoid" className="pointer-events-none grid grid-cols-[auto_auto] items-end gap-3">
      <div className="flex flex-col items-end gap-3">
        {act ? (
          <MoveButton label={act} tone="gold" onUse={onAct}>
            {hud.act?.kind === "photo" ? <Camera aria-hidden strokeWidth={2.25} /> : hud.act?.kind === "sync" ? <Rocket aria-hidden strokeWidth={2.25} /> : <span className="text-[13px] font-bold">Talk</span>}
          </MoveButton>
        ) : null}
        {onWall ? (
          <MoveButton label="Let go" onUse={onDrop}>
            <span className="text-[13px] font-bold">Drop</span>
          </MoveButton>
        ) : null}
        <MoveButton label={sprintOn ? "Stop sprinting" : "Sprint"} pressed={sprintOn} onUse={() => onSprint(!sprintOn)}>
          <Zap aria-hidden strokeWidth={2.25} />
        </MoveButton>
      </div>
      <div className="flex flex-col items-end gap-3">
        <MoveButton label={hud.zip ? "Zip to the marked point" : "Zip (nothing in reach)"} onUse={onZip}>
          <span className={`text-[13px] font-bold ${hud.zip ? "" : "opacity-55"}`}>Zip</span>
        </MoveButton>
        <MoveButton label="Jump" size="lg" tone="hero" onUse={onJump}>
          <span className="text-[15px] font-bold">Jump</span>
        </MoveButton>
      </div>
    </div>
  );
}

/** Top right: the pause button, and the minimap under it (it's the map button). */
export function CornerButtons({ minimap, onPause }: { minimap: ReactNode; onPause(): void }) {
  return (
    <div data-hud-zone="avoid" className="pointer-events-none flex flex-col items-end gap-2">
      <button
        type="button"
        aria-label="Pause"
        aria-keyshortcuts="Escape P"
        onClick={onPause}
        className="pointer-events-auto grid size-12 touch-none place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2"
      >
        <Pause aria-hidden className="size-5" strokeWidth={2.25} />
      </button>
      {minimap}
    </div>
  );
}

/** A first-visit hint over the city, gone after a few seconds or the first move. */
export function FirstHint({ touch, hud }: { touch: boolean; hud: RoamHud }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(false), 9000);
    return () => window.clearTimeout(t);
  }, []);
  // Gone after a few seconds, or once the outing's been going a moment.
  if (!shown || hud.ticks > 60 * 6) return null;
  return (
    <div className="pointer-events-none flex justify-center px-4">
      <p data-hud-zone="avoid" className="wgp-rise max-w-[460px] rounded-[18px] border-[2.5px] border-game-ink bg-game-paper px-4 py-2.5 text-center text-[14px] leading-5 text-pretty text-game-ink shadow-[var(--game-shadow-sm)]">
        {touch
          ? "Drag on the left to run. Drag anywhere else to look around; hold it to swing. Run into a wall to climb."
          : "WASD to run, Shift to sprint, Space to jump. Run into a wall to climb. Hold F or the mouse to swing, Q to zip."}
      </p>
    </div>
  );
}
