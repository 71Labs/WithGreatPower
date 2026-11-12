"use client";

/**
 * Free roam's city map (M, the minimap, or the pause sheet). The map is the sheet: on a phone
 * it fills the screen's height (on its side) or most of it (upright), with the tasks, the finds
 * and the key in a drawer beside it (or under it) that folds away.
 *
 * - Moving it: drag to pan and pinch to zoom (the wheel and a mouse drag on a desktop; the
 *   arrow keys and + / − with the map focused); "Center on me" zooms in on the hero, Home
 *   shows the whole city again (game3d/nav/pan-zoom.ts).
 * - On it: you as an arrow the way you face, ringed; the tracked task's next step in a red ring
 *   with a dotted line to it; who has a task (a gold ring until it's done, a check after);
 *   the Daily Rug pages (each district's once its viewpoint is synced), the masts, Mary's
 *   pixels and Gas Goblin's tags while those tasks are on, the pickpocket bot, and the tasks'
 *   v1.9 marks: a race's numbered gates and the relays to unplug, checked once done. Another
 *   task's pins are dimmed (game3d/nav/roam-pins.ts).
 * - The distance line says where the tracked task's next step is: "Stop, thief.exe: Dev is
 *   74 m east of you." Track another task from the list.
 *
 * The city waits while it's open; Esc or M closes it.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import type { SuitColors } from "@/components/cast";
import { StickerButton, StickerIconButton, StickerPanel } from "@/components/game/kit";
import { StickerTabs, tabPanelProps } from "@/components/game/ui";
import { Check, Crosshair, ListView, Minus, Newspaper, Plug, Plus, Rocket, Target, X } from "@/components/icons";
import { NAV_COLORS as K } from "@/game3d/nav/colors";
import { drawCity } from "@/game3d/nav/draw";
import { toMap } from "@/game3d/nav/map";
import { camView, centreOn, clampCam, fitCam, fitScale, MAX_ZOOM, MIN_ZOOM, panBy, pinch, sameCam, wheelFactor, zoomAt, ZOOM_STEP, type MapCam, type MapFrame, type Pt } from "@/game3d/nav/pan-zoom";
import { roamPins, taskTarget, whereLine, type RoamPin, type RoamTarget } from "@/game3d/nav/roam-pins";
import { Chip, Face, HeroFace, Kbd } from "@/sim/ui/bits";
import { DISTRICTS } from "@wgp/game-core/data";
import { FOLKS, TASKS, TASK_DONE, TASK_IDS, VIEW_NAMES, taskStep, type TaskId } from "@wgp/game-core/city";
import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";
import { roamWorld } from "@wgp/game-core/sim3d/roam";

import { NavStyles } from "../patrol/waypoint";
import { capturePointer } from "@/lib/pointer";

/** The fit leaves this much paper round the city (CSS px). */
const PAD = 18;
/** A press of an arrow key pans this far (CSS px). */
const KEY_PAN = 64;
/** Two taps this close in time (ms) and space (px) zoom in there. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 28;
/** A pointer that moved less than this (px) between down and up was a tap. */
const TAP_SLOP = 8;

export type MapTab = "tasks" | "finds" | "key";

export interface RoamMapProps {
  city: City;
  frame: RenderFrame3D;
  hero: SuitColors;
  onClose(): void;
  /** No pulse or ping (the Steady camera, or reduced motion). */
  still: boolean;
  touch: boolean;
  /** The task the HUD follows (the picked one while it isn't done, else the first under way). */
  tracked: TaskId | null;
  /** Pick a task to track (null: back to the first under way). */
  onTrack(task: TaskId | null): void;
  /** The drawer (tasks, finds, the key): open or folded away; the page keeps the choice for the visit. */
  drawer: boolean;
  onDrawer(open: boolean): void;
  /** The drawer's tab to start on (tests). */
  initialTab?: MapTab;
}

/** The hero's heading on the map: the facing, else the velocity, else north. */
function heading(frame: RenderFrame3D): { x: number; z: number } {
  const f = frame.hero.facing;
  if (f && Math.hypot(f.x, f.z) > 1e-3) return { x: f.x, z: f.z };
  const v = frame.hero.vel;
  if (Math.hypot(v.x, v.z) > 1) return { x: v.x, z: v.z };
  return { x: 0, z: -1 };
}

export function RoamMap({ city, frame, hero, onClose, still, touch, tracked, onTrack, drawer, onDrawer, initialTab = "tasks" }: RoamMapProps) {
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  const roam = frame.roam!;
  const w = roamWorld();
  const [tab, setTab] = useState<MapTab>(initialTab);

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  const h = frame.hero.pos;
  const pins = useMemo(() => roamPins(roam, w, tracked), [roam, w, tracked]);
  const target = tracked ? taskTarget(tracked, roam, h, w) : null;
  const allDone = roam.tasks.every((t) => t.stage === TASK_DONE);
  const where = whereLine(target, h, allDone);
  const drawerId = `${id}-drawer`;

  return (
    <div className="absolute inset-0 flex bg-game-night/70 pb-[max(8px,env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] pt-[max(8px,env(safe-area-inset-top))] sm:p-4">
      <StickerPanel
        as="section"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-where`}
        data-drawer={drawer ? "open" : "shut"}
        className="animate-rise relative mx-auto flex size-full max-h-[920px] max-w-[1320px] flex-col self-center overflow-hidden landscape:flex-row"
      >
        <NavStyles />
        <MapPane
          city={city}
          frame={frame}
          pins={pins}
          target={target}
          heroColor={hero.suit}
          still={still}
          label={`${id}-title`}
          described={`${id}-where`}
        >
          {/* Top left: what this is and where the tracked task's next step is (on a wide screen with the drawer open, the drawer's top shows it instead, clear of the city). */}
          <div className={`pointer-events-none absolute left-2 top-2 max-w-[min(400px,calc(100%-124px))] sm:left-3 sm:top-3 ${drawer ? "landscape:hidden" : ""}`}>
            <MapHeader where={where} ids={{ title: `${id}-title`, where: `${id}-where` }} />
          </div>
          {/* Top right: the drawer and close. */}
          <div className="absolute right-2 top-2 flex gap-2 sm:right-3 sm:top-3">
            <StickerIconButton label={drawer ? "Hide the task list" : "Show the task list"} aria-expanded={drawer} aria-controls={drawerId} onClick={() => onDrawer(!drawer)} className={drawer ? "!bg-game-ink !text-game-paper" : ""}>
              <ListView aria-hidden strokeWidth={2.25} />
            </StickerIconButton>
            <StickerIconButton ref={close} label="Close the map" onClick={onClose} aria-keyshortcuts="Escape M">
              <X aria-hidden strokeWidth={2.25} />
            </StickerIconButton>
          </div>
        </MapPane>

        {drawer ? (
          <aside
            id={drawerId}
            aria-label="Tasks, finds and the key"
            className="flex max-h-[42%] min-h-0 shrink-0 flex-col gap-3 border-t-[2.5px] border-game-ink bg-game-paper p-3 landscape:max-h-none landscape:w-[min(330px,38%)] landscape:border-l-[2.5px] landscape:border-t-0 sm:p-4"
          >
            {/* The same words as the map's header (which a screen reader reads): shown here on a wide screen. */}
            <div aria-hidden className="hidden landscape:block">
              <MapHeader where={where} />
            </div>
            <StickerTabs<MapTab>
              idPrefix={id}
              label="What the drawer shows"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "tasks", label: "Tasks" },
                { id: "finds", label: "Finds" },
                { id: "key", label: "Key" },
              ]}
            />
            <div className="-mx-1 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-1 pb-1">
              {tab === "tasks" ? (
                <div {...tabPanelProps(id, "tasks")} className="flex flex-col gap-2 outline-offset-2">
                  <TaskList tracked={tracked} onTrack={onTrack} tasks={roam.tasks} />
                </div>
              ) : tab === "finds" ? (
                <div {...tabPanelProps(id, "finds")} className="outline-offset-2">
                  <Finds frame={frame} />
                </div>
              ) : (
                <div {...tabPanelProps(id, "key")} className="outline-offset-2">
                  <Legend hero={hero} still={still} touch={touch} />
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </StickerPanel>
    </div>
  );
}

/** "City map" and the distance line. `ids` on the copy that names and describes the dialog. */
function MapHeader({ where, ids }: { where: string; ids?: { title: string; where: string } }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border-2 border-game-ink bg-game-paper/95 px-3 py-2 shadow-[var(--game-shadow-sm)]">
      <h2 id={ids?.title} className="text-[17px] font-bold leading-5 tracking-[-0.01em] text-game-ink">
        City map
      </h2>
      <p id={ids?.where} className="text-[13px] leading-[18px] text-pretty text-game-ink">
        {where}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ the map itself */

interface MapPaneProps {
  city: City;
  frame: RenderFrame3D;
  pins: RoamPin[];
  target: RoamTarget | null;
  heroColor: string;
  still: boolean;
  /** The ids of the title and the distance line. */
  label: string;
  described: string;
  children: ReactNode;
}

/** The map: the city on a canvas, the pins and you over it, and the zoom buttons; drag, pinch, wheel and keys move it. */
function MapPane({ city, frame, pins, target, heroColor, still, label, described, children }: MapPaneProps) {
  const pane = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Measured before the first paint; a sensible size for the server's render.
  const [size, setSize] = useState({ w: 640, h: 420 });
  const [cam, setCamState] = useState<MapCam>(() => fitCam(city.bounds));
  const f: MapFrame = useMemo(() => ({ bounds: city.bounds, w: size.w, h: size.h, pad: PAD }), [city.bounds, size.w, size.h]);
  const camNow = useRef(cam);
  const setCam = useCallback((next: MapCam) => {
    if (sameCam(next, camNow.current)) return;
    camNow.current = next;
    setCamState(next);
  }, []);
  const frameNow = useRef(f);
  useLayoutEffect(() => {
    frameNow.current = f;
  }, [f]);

  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const measure = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    const r = el.getBoundingClientRect();
    measure(r.width, r.height);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new size can leave the camera off the city: clamp it.
  const view = useMemo(() => camView(f, clampCam(f, cam)), [f, cam]);

  // The city, and the dotted way to the tracked step.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(f.w * dpr);
    const H = Math.round(f.h * dpr);
    if (el.width !== W || el.height !== H) {
      el.width = W;
      el.height = H;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.w, f.h);
    // Edges a little heavier as it zooms in, so the blocks keep reading as stickers.
    drawCity(ctx, city, view, null, 1.1 + 0.2 * Math.min(3, view.scale / fitScale(f)));
    if (target) {
      const a = toMap(view, frame.hero.pos.x, frame.hero.pos.z);
      const b = toMap(view, target.at.x, target.at.z);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.setLineDash([0.01, 9]);
      ctx.lineCap = "round";
      ctx.lineWidth = 7;
      ctx.strokeStyle = K.paper;
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = K.next;
      ctx.stroke();
      ctx.restore();
    }
  }, [city, f, view, target, frame]);

  // Pointers: one drags, two pinch; a quick double tap (or click) zooms in there.
  const pointers = useRef(new Map<number, Pt>());
  const pinchFrom = useRef<{ cam: MapCam; a: Pt; b: Pt; ids: [number, number] } | null>(null);
  const downAt = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = pane.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startPinch = () => {
    const [[ia, a], [ib, b]] = [...pointers.current.entries()];
    pinchFrom.current = { cam: camNow.current, a: { ...a }, b: { ...b }, ids: [ia, ib] };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    capturePointer(e.currentTarget, e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) downAt.current = { id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp };
    else downAt.current = null;
    if (pointers.current.size === 2) startPinch();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const pf = pinchFrom.current;
    if (pf && pointers.current.size >= 2) {
      const a = pointers.current.get(pf.ids[0]);
      const b = pointers.current.get(pf.ids[1]);
      if (a && b) setCam(pinch(frameNow.current, pf.cam, pf.a, pf.b, a, b));
      return;
    }
    setCam(panBy(frameNow.current, camNow.current, p.x - was.x, p.y - was.y));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
    if (pointers.current.size === 2) startPinch();
    const d = downAt.current;
    downAt.current = null;
    if (e.type !== "pointerup" || !d || d.id !== e.pointerId || Math.hypot(p.x - d.x, p.y - d.y) > TAP_SLOP) return;
    // A tap: a second one soon after, near the first, zooms in there.
    const last = lastTap.current;
    if (last && e.timeStamp - last.t < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      setCam(zoomAt(frameNow.current, camNow.current, ZOOM_STEP, p.x, p.y));
    } else lastTap.current = { x: p.x, y: p.y, t: e.timeStamp };
  };

  // The wheel zooms about the cursor (a native listener: React's wheel handlers can't preventDefault).
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCam(zoomAt(frameNow.current, camNow.current, wheelFactor(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setCam]);

  const zoomBy = (k: number) => setCam(zoomAt(frameNow.current, camNow.current, k));
  const centre = () => setCam(centreOn(frameNow.current, camNow.current, frame.hero.pos.x, frame.hero.pos.z));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const pan = (dx: number, dy: number) => setCam(panBy(frameNow.current, camNow.current, dx, dy));
    const keys: Record<string, () => void> = {
      ArrowLeft: () => pan(KEY_PAN, 0),
      ArrowRight: () => pan(-KEY_PAN, 0),
      ArrowUp: () => pan(0, KEY_PAN),
      ArrowDown: () => pan(0, -KEY_PAN),
      "+": () => zoomBy(ZOOM_STEP),
      "=": () => zoomBy(ZOOM_STEP),
      "-": () => zoomBy(1 / ZOOM_STEP),
      _: () => zoomBy(1 / ZOOM_STEP),
      c: centre,
      C: centre,
      Home: () => setCam(fitCam(city.bounds)),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  const at = (x: number, z: number) => {
    const p = toMap(view, x, z);
    return { transform: `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)` };
  };
  const hd = heading(frame);
  const hp = frame.hero.pos;
  const zoomedOut = cam.zoom <= MIN_ZOOM + 1e-3;
  const zoomedIn = cam.zoom >= MAX_ZOOM - 1e-3;

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-game-paper-2">
      <div
        ref={pane}
        data-map-view
        role="application"
        aria-roledescription="map"
        aria-labelledby={label}
        aria-describedby={described}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none select-none outline-none active:cursor-grabbing [-webkit-touch-callout:none] focus-visible:shadow-[inset_0_0_0_3px_var(--game-hero)]"
      >
        <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 block size-full" />
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {pins.map((p) => (
            <span key={p.key} data-pin={p.kind} data-done={p.done || undefined} className="absolute left-0 top-0" style={at(p.x, p.z)}>
              <span className={`absolute -translate-x-1/2 -translate-y-1/2 ${p.task && !p.tracked && p.kind !== "giver" ? "opacity-50" : ""}`}>
                <PinMark pin={p} still={still} />
              </span>
            </span>
          ))}
          {target ? (
            <span data-pin="target" className="absolute left-0 top-0" style={at(target.at.x, target.at.z)}>
              {still ? null : <span className="wgp-ping absolute block size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-game-hero" />}
              <span className="absolute block size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3.5px] border-game-hero shadow-[0_0_0_2px_var(--game-paper)]" />
            </span>
          ) : null}
          {/* You: an inked arrow the way you face, in a halo, with a tag. */}
          <span data-pin="you" className="absolute left-0 top-0" style={at(hp.x, hp.z)}>
            {still ? null : <span className="wgp-ping absolute block size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-game-ink" />}
            <span className="absolute block size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-game-ink bg-game-paper/85" />
            <svg width="32" height="32" viewBox="-16 -16 32 32" className="absolute -translate-x-1/2 -translate-y-1/2 overflow-visible" style={{ rotate: `${Math.atan2(hd.z, hd.x)}rad` }}>
              <path d="M13 0 L-9 -9.5 L-4 0 L-9 9.5 Z" fill={heroColor} stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            <span className="absolute left-0 top-[22px] -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-ink px-2 text-[11px] font-bold leading-4 text-game-paper">You</span>
          </span>
        </div>
      </div>
      {children}
      {/* Bottom right: zoom and find yourself. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-2 sm:bottom-3 sm:right-3">
        <StickerIconButton label="Zoom in" aria-keyshortcuts="+" onClick={() => zoomBy(ZOOM_STEP)} aria-disabled={zoomedIn || undefined} className="aria-disabled:opacity-50">
          <Plus aria-hidden strokeWidth={2.5} />
        </StickerIconButton>
        <StickerIconButton label="Zoom out" aria-keyshortcuts="-" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-disabled={zoomedOut || undefined} className="aria-disabled:opacity-50">
          <Minus aria-hidden strokeWidth={2.5} />
        </StickerIconButton>
        <StickerIconButton label="Center on me" aria-keyshortcuts="C" onClick={centre} className="!bg-game-ink !text-game-paper">
          <Crosshair aria-hidden strokeWidth={2.25} />
        </StickerIconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pins */

/** A pin's mark, for the map and the key alike. Status is never colour alone: a check when done, a number on a gate, a ring on the next. */
export function PinMark({ pin, still }: { pin: Pick<RoamPin, "kind" | "done" | "cast" | "initial" | "order" | "next" | "tracked">; still: boolean }) {
  const done = pin.done ? <DoneBadge /> : null;
  switch (pin.kind) {
    case "giver":
      return (
        <span className="relative block">
          {!pin.done ? <span className={`absolute -inset-1.5 rounded-full border-[3px] border-game-gold ${still ? "" : "wgp-pulse"}`} /> : null}
          {pin.cast ? (
            <Face id={pin.cast as CastId} className={`size-8 ring-2 ring-game-ink ${pin.done ? "opacity-60" : ""}`} />
          ) : (
            <span className={`grid size-8 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-[13px] font-bold text-game-ink ${pin.done ? "opacity-60" : ""}`}>{pin.initial ?? "?"}</span>
          )}
          {done}
        </span>
      );
    case "view":
      return (
        <span className={`relative grid size-7 place-items-center rounded-full border-2 border-game-ink shadow-[var(--game-shadow-sm)] ${pin.done ? "bg-game-mint text-game-ink" : "bg-game-paper text-game-ink"}`}>
          {pin.done ? <Check className="size-3.5" strokeWidth={3} /> : <Rocket className="size-3.5" strokeWidth={2.25} />}
        </span>
      );
    case "page":
      return (
        <span className={`relative grid size-5 place-items-center rounded-[6px] border-2 border-game-ink text-game-ink ${pin.done ? "bg-game-paper-2 opacity-60" : "bg-white"}`}>
          <Newspaper className="size-3" strokeWidth={2.5} />
        </span>
      );
    case "pixel":
      return <span className="block size-3.5 border-2 border-game-ink" style={{ backgroundColor: K.pixel }} />;
    case "tag":
      return <span className="block size-3.5 rotate-45 border-2 border-game-ink" style={{ backgroundColor: K.tag }} />;
    case "bot":
      return <span className="grid h-6 place-items-center rounded-[8px] border-2 border-game-ink bg-game-hero px-1 text-[10px] font-bold leading-none text-game-on-hero">BOT</span>;
    case "gate":
      // A hoop with its place in the race; passed ones checked and faded.
      return (
        <span className="relative block">
          {pin.next ? <span className={`absolute -inset-1.5 rounded-full border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} /> : null}
          <span className={`num grid size-7 place-items-center rounded-full border-[4px] bg-game-paper text-[12px] font-bold leading-none text-game-ink ${pin.done ? "opacity-60" : ""}`} style={{ borderColor: K.gate, boxShadow: "0 0 0 2px var(--game-ink)" }}>
            {pin.order ?? ""}
          </span>
          {done}
        </span>
      );
    case "relay":
      // A box with its plug, lit until unplugged (then dark, checked).
      return (
        <span className="relative block">
          {pin.next ? <span className={`absolute -inset-1.5 rounded-[12px] border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} /> : null}
          <span className={`grid size-7 place-items-center rounded-[8px] border-2 border-game-ink ${pin.done ? "bg-game-paper-2 text-game-muted opacity-70" : "text-game-ink"}`} style={pin.done ? undefined : { backgroundColor: K.relay, color: K.relayLit }}>
            <Plug className="size-4" strokeWidth={2.25} />
          </span>
          {done}
        </span>
      );
  }
}

function DoneBadge() {
  return (
    <span className="absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border-2 border-game-ink bg-game-mint text-game-ink">
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

/* ------------------------------------------------------------------ the drawer */

function TaskList({ tasks, tracked, onTrack }: { tasks: { id: string; stage: number; got: number }[]; tracked: TaskId | null; onTrack(t: TaskId | null): void }) {
  const w = roamWorld();
  return (
    <ol className="flex flex-col gap-2">
      {TASK_IDS.map((t) => {
        const st = tasks.find((x) => x.id === t) ?? { stage: 0, got: 0 };
        const giver = w.folks.find((f) => f.gives === t);
        const name = giver ? (FOLKS[giver.key]?.name ?? "?") : "?";
        const on = t === tracked;
        const done = st.stage === TASK_DONE;
        return (
          <li key={t} aria-current={on ? "step" : undefined} className={`flex items-center gap-2.5 rounded-[14px] border-2 px-2.5 py-2 ${on ? "border-game-ink bg-game-paper" : "border-transparent bg-game-paper-2"}`}>
            {giver?.cast ? <Face id={giver.cast as CastId} className="size-9" /> : <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border-2 border-game-ink bg-game-gold text-[15px] font-bold">{name.slice(0, 1)}</span>}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[14px] font-semibold leading-5">{TASKS[t]?.title ?? t}</span>
                <Chip size="xs" flat tone={done ? "mint" : st.stage > 0 ? "gold" : "muted"}>
                  {done ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
                  {done ? "Done" : st.stage > 0 ? "Under way" : "New"}
                </Chip>
              </span>
              <span className="text-[12px] leading-4 text-pretty text-game-muted">{taskStep(t, st.stage, st.got)}</span>
            </span>
            {done ? null : (
              <StickerButton
                size="sm"
                variant={on ? "ink" : "paper"}
                aria-pressed={on}
                aria-label={on ? `Tracking ${TASKS[t]?.title ?? t}` : `Track ${TASKS[t]?.title ?? t}`}
                onClick={() => onTrack(on ? null : t)}
                className="!px-3"
              >
                <Target aria-hidden className="size-4" strokeWidth={2.25} />
                {on ? "Tracking" : "Track"}
              </StickerButton>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Finds({ frame }: { frame: RenderFrame3D }) {
  const roam = frame.roam!;
  const w = roamWorld();
  const synced = new Set(w.views.map((v, i) => (roam.views[i]?.synced ? v.district : null)).filter(Boolean));
  const hidden = roam.pages.filter((p, i) => !p.found && !synced.has(w.pages[i].district)).length;
  return (
    <section className="flex flex-col gap-2">
      <p className="num text-[14px] font-semibold leading-5">
        {roam.pages.filter((p) => p.found).length} of {roam.pages.length} Daily Rug pages · {roam.views.filter((v) => v.synced).length} of {roam.views.length} viewpoints
      </p>
      <p className="text-[13px] leading-[18px] text-pretty text-game-muted">{hidden ? `${hidden} pages aren’t on the map yet: sync a district’s mast to reveal its pages.` : "Every page left is on the map."}</p>
      <ul className="flex flex-wrap gap-1.5">
        {w.views.map((v, i) => (
          <li key={i}>
            <Chip size="xs" flat tone={roam.views[i]?.synced ? "mint" : "muted"}>
              {roam.views[i]?.synced ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
              {VIEW_NAMES[v.district] ?? DISTRICTS[v.district].name}
              <span className="sr-only">{roam.views[i]?.synced ? ", synced" : ", not synced"}</span>
            </Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What each mark means. */
function Legend({ hero, still, touch }: { hero: SuitColors; still: boolean; touch: boolean }) {
  const row = (mark: ReactNode, text: string) => (
    <li className="flex min-h-9 items-center gap-3">
      <span aria-hidden className="grid w-10 shrink-0 place-items-center">
        {mark}
      </span>
      <span className="text-[13px] leading-[18px] text-pretty">{text}</span>
    </li>
  );
  const base = { done: false, tracked: true } as const;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {row(<HeroFace colors={hero} className="size-7 rounded-full" />, "You: the arrow points the way you face")}
        {row(<span className="block size-8 rounded-full border-[3px] border-game-hero" />, "The tracked task’s next step, with a dotted line to it")}
        {row(<PinMark pin={{ ...base, kind: "giver", initial: "A" }} still />, "Someone with a task for you (a check once it’s done)")}
        {row(<PinMark pin={{ ...base, kind: "page" }} still />, "A Daily Rug page")}
        {row(<PinMark pin={{ ...base, kind: "view" }} still />, "A viewpoint mast: sync it to show its district’s pages")}
        {row(<PinMark pin={{ ...base, kind: "pixel" }} still />, "One of Mary’s lost pixels")}
        {row(<PinMark pin={{ ...base, kind: "tag" }} still />, "A Gas Goblin tag to photograph")}
        {row(<PinMark pin={{ ...base, kind: "bot" }} still />, "The pickpocket bot")}
        {row(<PinMark pin={{ ...base, kind: "gate", order: 3 }} still />, "A race gate, in order")}
        {row(<PinMark pin={{ ...base, kind: "relay" }} still />, "A relay to unplug")}
        {row(<PinMark pin={{ ...base, kind: "gate", order: 1, done: true }} still={still} />, "Done: passed, unplugged, found")}
      </ul>
      <p className="text-[12px] leading-4 text-pretty text-game-muted">Another task’s pins are faded. Track a task from the list to point the way there.</p>
      <p className="text-[12px] leading-4 text-pretty text-game-muted">
        {touch ? "Drag to move the map, pinch to zoom, double-tap to zoom in." : "Drag or use the arrow keys to move the map; the wheel or + and − zoom."}
      </p>
      {touch ? null : (
        <p aria-hidden className="hidden items-center gap-1.5 text-[12px] leading-4 text-game-muted pointer-fine:flex">
          <Kbd>M</Kbd>
          <span>or</span>
          <Kbd>Esc</Kbd>
          <span>closes the map.</span>
        </p>
      )}
    </div>
  );
}

