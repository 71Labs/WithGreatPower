"use client";

/**
 * The Case file 001 bench: the full 3D scene on a real night's city with fixture chapter frames
 * (script.ts) driving everything the 3D build draws: the clues, the Right-Clicker's moves and
 * his SCREENSHOT, the paper copies, captive Mary and her restore. Pick a scene, hold one of
 * his phases, hold Mary's restore, switch the tier and reduced motion. `?debug=1` shows
 * renderer.info and exposes `window.__wgpCase` for headless shots and measurements.
 *
 * URL: `?scene=standoff&phase=aim&restore=0.5&clue=cursor&tier=high&reduced=1&debug=1`.
 */
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";

import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { RIGHT_CLICKER_PHASES, type ChapterEvent } from "@/game3d/scene/chapter/contract";
import { QUALITY_PRESETS, TIERS, hasWebGL2, type QualityTier } from "@/game3d/scene/quality";
import type { SceneCue } from "@/game3d/scene/camera/director";
import { SceneCanvas, type SceneHandle, type SceneStats } from "@/game3d/scene/Scene";
import { sceneEffects } from "@/game3d/session/effects";

import { CASE_SCENES, CaseScript, CLUE_VIEWS, caseCity, type CaseScene, type ClueView, type PhaseChoice } from "./script";
import { capturePointer } from "@/lib/pointer";

const STEP = 1 / 60;
const PHASES: PhaseChoice[] = ["cycle", ...RIGHT_CLICKER_PHASES];

interface CaseApi {
  /** `restart`: the scene's script from its start (after the other settings). */
  set(opts: { scene?: CaseScene; phase?: PhaseChoice; restore?: number | null; clue?: ClueView; tier?: QualityTier; reduced?: boolean; paused?: boolean; restart?: boolean }): void;
  stats(): SceneStats | null;
  /** The fixture frame the scene reads. */
  frame(): RenderFrame3D;
  /** Turns the chase camera by these radians and holds it there (`hold: false` lets it recentre). */
  orbit(dYaw: number, dPitch?: number, hold?: boolean): void;
}

declare global {
  interface Window {
    __wgpCase?: CaseApi;
  }
}

/** Steps the fixture at 60 Hz inside the render loop and passes its events to the scene, as the game loop's bus does. */
function Driver({ script, handle, paused }: { script: CaseScript; handle: RefObject<SceneHandle | null>; paused: boolean }) {
  const acc = useRef(0);
  const events = useRef<ChapterEvent[]>([]);
  const effects = useMemo(() => sceneEffects(() => handle.current), [handle]);
  useFrame((_, delta) => {
    if (paused) return;
    acc.current += Math.min(delta, 0.1);
    while (acc.current >= STEP) {
      acc.current -= STEP;
      script.step(STEP, events.current);
    }
    for (const ev of events.current) effects(ev as unknown as Parameters<typeof effects>[0]);
    events.current.length = 0;
  }, -1);
  return null;
}

const label = (s: string) => (s === "cycle" ? "Cycle" : s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-game-ink focus-visible:ring-offset-2 focus-visible:ring-offset-game-paper";

function Chips<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly T[]; onChange(v: T): void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">{name}</legend>
      <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            onClick={() => onChange(o)}
            className={`h-9 whitespace-nowrap rounded-[10px] border-2 border-game-ink px-2.5 text-[13px] font-semibold transition-[background-color,color,scale] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:h-11 ${FOCUS} ${
              value === o ? "bg-game-ink text-game-paper" : "bg-game-paper text-game-ink [@media(hover:hover)]:hover:bg-game-paper-2"
            }`}
          >
            {label(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ActionButton({ children, onClick, pressed }: { children: ReactNode; onClick(): void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`h-9 whitespace-nowrap rounded-[10px] border-2 border-game-ink bg-game-paper px-3 text-sm font-semibold text-game-ink shadow-[var(--game-shadow-sm)] transition-[translate,box-shadow,scale] duration-150 active:translate-y-px active:scale-[0.97] active:shadow-none motion-reduce:transition-none motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 pointer-coarse:h-11 [@media(hover:hover)]:hover:-translate-y-px motion-reduce:[@media(hover:hover)]:hover:translate-y-0 ${FOCUS}`}
    >
      {children}
    </button>
  );
}

function pick<T extends string>(v: string | null, list: readonly T[], fallback: T): T {
  return v && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export default function CaseBench() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const city = useMemo(() => caseCity(Number(params.get("seed")) || 7), [params]);
  // `?chapter=0`: the same frames with the chapter off, a normal night's baseline for perf.
  const script = useMemo(() => new CaseScript(city, params.get("chapter") === "0"), [city, params]);
  const frame = useRef<RenderFrame3D | null>(null);
  // A night under way (no countdown), so the director runs its beats: the rescue's two-shot.
  const cue = useRef<SceneCue | null>({ status: "live", introLeft: 0, introTotal: 0 });
  const handle = useRef<SceneHandle | null>(null);
  const readout = useRef<HTMLPreElement>(null);
  const lastStats = useRef<SceneStats | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [webgl] = useState(() => hasWebGL2());
  const [scene, setScene] = useState<CaseScene>(() => pick(params.get("scene"), CASE_SCENES, "investigate"));
  const [phase, setPhase] = useState<PhaseChoice>(() => pick(params.get("phase"), PHASES, "cycle"));
  const [clue, setClue] = useState<ClueView>(() => pick(params.get("clue"), CLUE_VIEWS, "tabs"));
  const [restore, setRestore] = useState<number | null>(() => (params.has("restore") ? Math.min(1, Math.max(0, Number(params.get("restore")) || 0)) : null));
  const [tier, setTier] = useState<QualityTier>(() => pick(params.get("tier"), TIERS, "high"));
  const [reduced, setReduced] = useState(() => params.get("reduced") === "1" || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [paused, setPaused] = useState(false);
  const [debug] = useState(() => params.get("debug") === "1");
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640 && params.get("panel") !== "0");

  useEffect(() => {
    frame.current = script.frame;
  }, [script]);
  useEffect(() => script.set(scene), [script, scene]);
  useEffect(() => {
    script.hold(phase);
  }, [script, phase]);
  useEffect(() => {
    script.look(clue);
  }, [script, clue]);
  useEffect(() => {
    script.holdRestore(restore);
  }, [script, restore]);

  useEffect(() => {
    if (!debug) return;
    window.__wgpCase = {
      set: (o) => {
        if (o.scene && CASE_SCENES.includes(o.scene)) setScene(o.scene);
        if (o.phase && PHASES.includes(o.phase)) setPhase(o.phase);
        if (o.clue && CLUE_VIEWS.includes(o.clue)) setClue(o.clue);
        if (o.restore !== undefined) setRestore(o.restore === null ? null : Math.min(1, Math.max(0, o.restore)));
        if (o.tier && TIERS.includes(o.tier)) setTier(o.tier);
        if (o.reduced !== undefined) setReduced(o.reduced);
        if (o.paused !== undefined) setPaused(o.paused);
        if (o.restart) script.set(o.scene ?? script.scene);
      },
      stats: () => lastStats.current,
      frame: () => script.frame,
      orbit: (dYaw, dPitch = 0, hold = true) => handle.current?.orbit(dYaw, dPitch, hold),
    };
    return () => {
      delete window.__wgpCase;
    };
  }, [debug, script]);

  const onStats = useCallback((s: SceneStats) => {
    lastStats.current = s;
    const el = readout.current;
    if (!el) return;
    el.textContent = [`tier      ${s.tier}`, `fps       ${s.fps.toFixed(0)}`, `calls     ${s.calls}`, `triangles ${s.triangles.toLocaleString("en-US")}`, `cast ms   ${s.castMs.toFixed(2)}`].join("\n");
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    capturePointer(e.currentTarget, e.pointerId);
    handle.current?.orbit(0, 0, true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    handle.current?.orbit(-(e.clientX - d.x) * 0.006, (e.clientY - d.y) * 0.004, true);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    handle.current?.orbit(0, 0, false);
  };

  if (!webgl) {
    return (
      <div className="grid h-full place-items-center p-4">
        <p className="max-w-[40ch] rounded-[14px] border-2 border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)]">This browser can’t draw WebGL 2, so the case’s 3D scene can’t run here.</p>
      </div>
    );
  }

  const restoreValue = restore ?? 0;
  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <SceneCanvas city={city} frame={frame} cue={cue} quality={QUALITY_PRESETS[tier]} handle={handle} reducedMotion={reduced} onStats={debug ? onStats : undefined}>
          <Driver script={script} handle={handle} paused={paused} />
        </SceneCanvas>
      </div>

      <details
        open={panelOpen}
        onToggle={(e) => setPanelOpen(e.currentTarget.open)}
        className="group absolute left-4 top-4 max-h-[calc(100dvh-32px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-[18px] border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)]"
      >
        <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[16px] px-4 py-2 [&::-webkit-details-marker]:hidden ${FOCUS}`}>
          <h1 className="text-base font-semibold tracking-tight text-game-ink">
            <span className="text-game-muted">Lab /</span> Case file 001
          </h1>
          <span className="text-xs font-semibold text-game-muted">
            <span className="group-open:hidden">Show controls</span>
            <span className="hidden group-open:inline">Hide controls</span>
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
          <Chips<CaseScene> name="Scene" value={scene} options={CASE_SCENES} onChange={setScene} />
          {scene === "investigate" ? <Chips<ClueView> name="Clue" value={clue} options={CLUE_VIEWS} onChange={setClue} /> : null}
          {scene === "standoff" ? <Chips<PhaseChoice> name="Right-Clicker" value={phase} options={PHASES} onChange={setPhase} /> : null}
          {scene === "rescue" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="case-restore" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">
                Mary’s restore <span className="tabular-nums">{restore === null ? "(filling)" : restoreValue.toFixed(2)}</span>
              </label>
              <input
                id="case-restore"
                type="range"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.05}
                value={restoreValue}
                onChange={(e) => setRestore(Number(e.currentTarget.value))}
                className={`h-11 accent-game-ink ${FOCUS}`}
              />
              <div>
                <ActionButton onClick={() => setRestore(null)} pressed={restore === null}>
                  Fill it on a loop
                </ActionButton>
              </div>
            </div>
          ) : null}
          <Chips<QualityTier> name="Quality" value={tier} options={TIERS} onChange={setTier} />
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => setReduced((r) => !r)} pressed={reduced}>
              Reduce motion
            </ActionButton>
            <ActionButton onClick={() => setPaused((p) => !p)} pressed={paused}>
              {paused ? "Resume" : "Pause"}
            </ActionButton>
            <ActionButton onClick={() => script.set(scene)}>Restart scene</ActionButton>
          </div>
          <p className="text-xs text-game-muted">Fixture frames in the spec’s field names, standing in for the chapter sim. Drag to look around.</p>
        </div>
      </details>

      {debug ? (
        <pre
          ref={readout}
          aria-live="off"
          className="pointer-events-none absolute bottom-4 right-4 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-2 font-mono text-xs leading-5 text-game-ink tabular-nums shadow-[var(--game-shadow-sm)]"
        />
      ) : null}
    </div>
  );
}
