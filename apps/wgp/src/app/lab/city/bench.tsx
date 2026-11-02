"use client";

/**
 * The city test bench: the full 3D scene on a city (game-core's `generateCity`, or the scene's
 * fixture with `?city=fixture`), a scripted hero swinging stop to stop with a web, Gas
 * Goblin looping over his arena, the chase camera (drag to orbit), and switches for the
 * quality tier and the arena two-shot. `?debug=1` shows renderer.info and the frame rate.
 */
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";

import { generateCity } from "@wgp/game-core/sim3d";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

import { generateFixtureCity } from "@/game3d/scene/fixture-city";
import { QUALITY_PRESETS, TIERS, detectTier, hasWebGL2, type QualityTier } from "@/game3d/scene/quality";
import { SceneCanvas, type SceneHandle, type SceneStats } from "@/game3d/scene/Scene";

import { SwingScript, type SwingEvent } from "./swing";

type CameraMode = "chase" | "arena";

/** A night with every kind of stop: Gas Goblin's arena, an errand, Doc's bridge, Sandwich Man. */
const LAB_STOPS: Stop[] = [
  { kind: "fight", villain: "gas-goblin", district: "sector-7", level: 1, boss: false, quest: false },
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 2, boss: false, quest: false },
  { kind: "fight", villain: "sandwich-man", district: "mempool-market", level: 2, boss: true, quest: false },
];

/** game-core's generator (the real night), or `?city=fixture` for the scene's own stand-in. */
function labCity(): City {
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get("seed")) || 7;
  return params.get("city") === "fixture" ? generateFixtureCity(seed) : generateCity(seed, LAB_STOPS);
}

const STEP = 1 / 60;

/** Steps the scripted hero at 60 Hz inside the render loop, before the scene reads the frame. */
function Driver({ script, handle, paused }: { script: SwingScript; handle: RefObject<SceneHandle | null>; paused: boolean }) {
  const acc = useRef(0);
  const time = useRef(0);
  const events = useRef<SwingEvent[]>([]);
  useFrame((_, delta) => {
    if (paused) return;
    acc.current += Math.min(delta, 0.1);
    while (acc.current >= STEP) {
      acc.current -= STEP;
      time.current += STEP;
      script.step(STEP, time.current, events.current);
    }
    const h = handle.current;
    for (const ev of events.current) {
      if (ev.kind === "attach") h?.burst("THWIP!", { x: ev.at.x, y: ev.at.y + 40, z: ev.at.z }, { size: 64, life: 0.55, rise: 20 });
      else if (ev.kind === "release" && ev.perfect) {
        h?.burst("PERFECT!", ev.at, { size: 84, life: 0.8 });
        h?.flip();
      } else if (ev.kind === "bounce") h?.burst("OOF!", ev.at, { size: 90, life: 0.8 });
    }
    events.current.length = 0;
  }, -1);
  return null;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-[12px] border-2 border-game-ink bg-game-paper-2 p-[3px]">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`h-9 flex-1 whitespace-nowrap rounded-[9px] px-3 text-sm font-semibold transition-[background-color,color,scale] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:h-11 ${
              value === o.value ? "bg-game-ink text-game-paper" : "text-game-ink hover:bg-game-paper"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, pressed }: { children: ReactNode; onClick(): void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="h-9 whitespace-nowrap rounded-[10px] border-2 border-game-ink bg-game-paper px-3 text-sm font-semibold text-game-ink shadow-[var(--game-shadow-sm)] transition-[translate,box-shadow,scale] duration-150 hover:-translate-y-px active:translate-y-px active:shadow-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0 pointer-coarse:h-11"
    >
      {children}
    </button>
  );
}

export default function CityBench() {
  const city = useMemo(() => labCity(), []);
  const script = useMemo(() => new SwingScript(city), [city]);
  const frame = useRef<RenderFrame3D | null>(null);
  const handle = useRef<SceneHandle | null>(null);
  const stats = useRef<HTMLPreElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [webgl] = useState(() => hasWebGL2());
  const [tier, setTier] = useState<QualityTier>(() => {
    const forced = new URLSearchParams(window.location.search).get("tier");
    return forced === "low" || forced === "medium" || forced === "high" ? forced : detectTier();
  });
  const [adaptive, setAdaptive] = useState(() => !new URLSearchParams(window.location.search).has("tier"));
  const [mode, setMode] = useState<CameraMode>(() => (new URLSearchParams(window.location.search).get("camera") === "arena" ? "arena" : "chase"));
  const [paused, setPaused] = useState(false);
  const [debug] = useState(() => new URLSearchParams(window.location.search).get("debug") === "1");
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    frame.current = script.frame;
    // ?debug=1: let a headless check read the scripted frame.
    if (debug)
      (window as Window & { __wgpLab?: { frame: RenderFrame3D; handle(): SceneHandle | null } }).__wgpLab = {
        frame: script.frame,
        handle: () => handle.current,
      };
  }, [script, debug]);
  useEffect(() => {
    script.setArena(mode === "arena");
  }, [script, mode]);

  const onStats = useCallback((s: SceneStats) => {
    (window as Window & { __wgpScene?: SceneStats }).__wgpScene = s;
    const el = stats.current;
    if (!el) return;
    el.textContent = [
      `tier      ${s.tier}`,
      `fps       ${s.fps.toFixed(0)}`,
      `dpr       ${s.dpr.toFixed(2)}`,
      `calls     ${s.calls}`,
      `triangles ${s.triangles.toLocaleString("en-US")}`,
      `points    ${s.points}`,
      `geometry  ${s.geometries}`,
      `textures  ${s.textures}`,
      `programs  ${s.programs}`,
    ].join("\n");
  }, []);

  const onTierSuggest = useCallback((t: QualityTier) => setTier(t), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
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
        <p className="max-w-[40ch] rounded-[14px] border-2 border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)]">
          This browser can’t draw WebGL 2, so the 3D city can’t run here. The classic 2D patrol still works.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <SceneCanvas
          city={city}
          frame={frame}
          quality={QUALITY_PRESETS[tier]}
          handle={handle}
          reducedMotion={reducedMotion}
          onStats={debug ? onStats : undefined}
          onTierSuggest={adaptive ? onTierSuggest : undefined}
        >
          <Driver script={script} handle={handle} paused={paused} />
        </SceneCanvas>
      </div>

      <details
        open={panelOpen}
        onToggle={(e) => setPanelOpen(e.currentTarget.open)}
        className="group absolute left-4 top-4 w-[min(340px,calc(100vw-32px))] rounded-[18px] border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)]"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[16px] px-4 py-2 [&::-webkit-details-marker]:hidden">
          <h1 className="text-base font-semibold tracking-tight text-game-ink">
            <span className="text-game-muted">Lab /</span> City
          </h1>
          <span className="text-xs font-semibold text-game-muted">
            <span className="group-open:hidden">Show controls</span>
            <span className="hidden group-open:inline">Hide controls</span>
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
          <Segmented<QualityTier>
            label="Quality"
            value={tier}
            options={TIERS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
            onChange={(t) => {
              setAdaptive(false);
              setTier(t);
            }}
          />
          <Segmented<CameraMode>
            label="Camera"
            value={mode}
            options={[
              { value: "chase", label: "Chase" },
              { value: "arena", label: "Arena two-shot" },
            ]}
            onChange={setMode}
          />
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => handle.current?.burst("POW!", script.frame.hero.pos, { size: 120 })}>Pop a burst</ActionButton>
            <ActionButton onClick={() => handle.current?.flip()}>Do a flip</ActionButton>
            <ActionButton onClick={() => setPaused((p) => !p)} pressed={paused}>
              {paused ? "Resume" : "Pause"}
            </ActionButton>
          </div>
          <p className="text-xs text-game-muted">
            Drag to look around; the camera eases back behind the hero 2 s after you let go.{adaptive ? " Quality follows the frame rate until you pick a tier." : ""}
          </p>
        </div>
      </details>

      {debug ? (
        <pre
          ref={stats}
          aria-live="off"
          className="pointer-events-none absolute bottom-4 left-4 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-2 font-mono text-xs leading-5 text-game-ink tabular-nums shadow-[var(--game-shadow-sm)]"
        />
      ) : null}
    </div>
  );
}
