"use client";

/**
 * The cast test bench: every 3D character on a turntable on a stage rooftop, in every state
 * its animator knows (the hero's ten actions, the villains' states, the allies' idle and
 * wave), driven by synthetic motion (script.ts). A slider scrubs a swing arc; the debug
 * overlay draws bones, IK targets and Verlet particles. `?debug=1` exposes
 * `window.__wgpCast` for headless checks.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PerspectiveCamera } from "three";

import { CAST_DEFS } from "@/game3d/scene/characters/cast";
import { C } from "@/game3d/scene/palette";
import { hasWebGL2, TIERS, type QualityTier } from "@/game3d/scene/quality";

import { ALLIES, statesFor, VILLAINS, type LabCharacter } from "./script";
import { LabStage, type StageStats } from "./stage";

const CHARACTERS: LabCharacter[] = ["hero", ...VILLAINS, ...ALLIES];

interface LabApi {
  set(character: LabCharacter, state: string): void;
  scrub(v: number | null): void;
  angle(a: number | null): void;
  debug(on: boolean): void;
  tier(t: QualityTier): void;
  flip(): void;
  miss(): void;
  stats(): StageStats;
}

declare global {
  interface Window {
    __wgpCast?: LabApi;
  }
}

interface StageProps {
  character: LabCharacter;
  state: string;
  tier: QualityTier;
  scrub: number | null;
  turntable: boolean;
  angle: number;
  debug: boolean;
  onStage(stage: LabStage | null): void;
  onStats(s: StageStats): void;
}

/** One stage per featured character (the allies need their own errand zone). */
function Stage({ character, state, tier, scrub, turntable, angle, debug, onStage, onStats }: StageProps) {
  const ally = ALLIES.includes(character) ? character : null;
  const gl = useThree((s) => s.gl);
  const stage = useMemo(() => new LabStage(ally), [ally]);

  useEffect(() => {
    onStage(stage);
    return () => {
      onStage(null);
      stage.dispose();
    };
  }, [stage, onStage]);
  useEffect(() => stage.setTier(tier), [stage, tier]);
  useEffect(() => stage.setDebug(debug), [stage, debug]);
  useEffect(() => stage.show(character, state), [stage, character, state]);
  useEffect(() => stage.setScrub(scrub), [stage, scrub]);
  useEffect(() => stage.setView(turntable, angle), [stage, turntable, angle]);

  useFrame((s, delta) => {
    const stats = stage.frame(s.camera as PerspectiveCamera, s.size, s.viewport.dpr, delta, s.clock.elapsedTime, gl.info.render);
    if (stats) onStats(stats);
  });

  return (
    <>
      <color attach="background" args={[C.skyMid[0], C.skyMid[1], C.skyMid[2]]} />
      {stage.meshes ? <primitive object={stage.meshes.root} /> : null}
      <primitive object={stage.system.root} />
    </>
  );
}

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`h-9 whitespace-nowrap rounded-[10px] border-2 border-game-ink px-2.5 text-[13px] font-semibold transition-[background-color,color,scale] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:h-11 ${
              value === o.value ? "bg-game-ink text-game-paper" : "bg-game-paper text-game-ink [@media(hover:hover)]:hover:bg-game-paper-2"
            }`}
          >
            {o.label}
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
      className="h-9 whitespace-nowrap rounded-[10px] border-2 border-game-ink bg-game-paper px-3 text-sm font-semibold text-game-ink shadow-[var(--game-shadow-sm)] transition-[translate,box-shadow,scale] duration-150 active:translate-y-px active:shadow-none motion-reduce:transition-none motion-reduce:active:translate-y-0 pointer-coarse:h-11 [@media(hover:hover)]:hover:-translate-y-px motion-reduce:[@media(hover:hover)]:hover:translate-y-0"
    >
      {children}
    </button>
  );
}

const label = (s: string) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function CastBench() {
  const [webgl] = useState(() => hasWebGL2());
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [character, setCharacter] = useState<LabCharacter>(() => (CHARACTERS.includes(params.get("c") as LabCharacter) ? (params.get("c") as LabCharacter) : "hero"));
  const [state, setState] = useState(() => params.get("s") ?? "idle");
  const [tier, setTier] = useState<QualityTier>(() => (TIERS.includes(params.get("tier") as QualityTier) ? (params.get("tier") as QualityTier) : "high"));
  const [scrub, setScrub] = useState<number | null>(null);
  const [turntable, setTurntable] = useState(() => params.get("turn") !== "0");
  const [angle, setAngle] = useState(0.6);
  const [debug, setDebug] = useState(() => params.get("bones") === "1");
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const stats = useRef<StageStats>({ calls: 0, triangles: 0, cast: 0, fps: 0, physicsMs: 0 });
  const readout = useRef<HTMLPreElement>(null);
  const actions = useRef<LabStage | null>(null);
  const onStage = useCallback((s: LabStage | null) => {
    actions.current = s;
  }, []);
  const states = statesFor(character);
  const current = states.includes(state) ? state : states[0];

  const onStats = useCallback((s: StageStats) => {
    stats.current = s;
    const el = readout.current;
    if (!el) return;
    el.textContent = [
      `fps       ${s.fps.toFixed(0)}`,
      `calls     ${s.calls}`,
      `triangles ${s.triangles.toLocaleString("en-US")}`,
      `cast tris ${s.cast.toLocaleString("en-US")} (×2 with ink)`,
      `cast ms   ${s.physicsMs.toFixed(2)}`,
    ].join("\n");
  }, []);

  useEffect(() => {
    if (params.get("debug") !== "1") return;
    window.__wgpCast = {
      set: (c, s) => {
        if (!CHARACTERS.includes(c) || !statesFor(c).includes(s)) return;
        setCharacter(c);
        setState(s);
      },
      scrub: (v) => setScrub(v === null || !Number.isFinite(v) ? null : Math.min(1, Math.max(0, v))),
      angle: (a) => {
        setTurntable(a === null || !Number.isFinite(a));
        if (a !== null && Number.isFinite(a)) setAngle(a);
      },
      debug: (on) => setDebug(on),
      tier: (t) => setTier(t),
      flip: () => actions.current?.flip(),
      miss: () => actions.current?.miss(),
      stats: () => stats.current,
    };
    return () => {
      delete window.__wgpCast;
    };
  }, [params]);

  if (!webgl) {
    return (
      <div className="grid h-full place-items-center p-4">
        <p className="max-w-[40ch] rounded-[14px] border-2 border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)]">
          This browser can’t draw WebGL 2, so the 3D cast can’t show here.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Canvas className="absolute inset-0" flat linear dpr={[1, tier === "high" ? 2 : 1.5]} gl={{ antialias: tier === "high", alpha: false, stencil: false }} camera={{ fov: 40, near: 4, far: 8000, position: [0, 400, 400] }}>
        <Stage character={character} state={current} tier={tier} scrub={scrub} turntable={turntable} angle={angle} debug={debug} onStage={onStage} onStats={onStats} />
      </Canvas>

      <details
        open={panelOpen}
        onToggle={(e) => setPanelOpen(e.currentTarget.open)}
        className="group absolute left-4 top-4 max-h-[calc(100dvh-32px)] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-[18px] border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)]"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[16px] px-4 py-2 [&::-webkit-details-marker]:hidden">
          <h1 className="text-base font-semibold tracking-tight text-game-ink">
            <span className="text-game-muted">Lab /</span> Cast
          </h1>
          <span className="text-xs font-semibold text-game-muted">
            <span className="group-open:hidden">Show controls</span>
            <span className="hidden group-open:inline">Hide controls</span>
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
          <Chips<LabCharacter> label="Character" value={character} options={CHARACTERS.map((c) => ({ value: c, label: CAST_DEFS[c].name }))} onChange={setCharacter} />
          <Chips<string> label="State" value={current} options={states.map((s) => ({ value: s, label: label(s) }))} onChange={setState} />
          {character === "hero" && current === "swing" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="scrub" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">
                Swing arc
              </label>
              <div className="flex items-center gap-2">
                <input id="scrub" type="range" min={0} max={1} step={0.005} value={scrub ?? 0.25} onChange={(e) => setScrub(Number(e.target.value))} className="h-11 flex-1 accent-game-ink" />
                <ActionButton onClick={() => setScrub(null)} pressed={scrub === null}>
                  Play arc
                </ActionButton>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="angle" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">
              Turntable
            </label>
            <div className="flex items-center gap-2">
              <input
                id="angle"
                type="range"
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                value={angle}
                onChange={(e) => {
                  setTurntable(false);
                  setAngle(Number(e.target.value));
                }}
                className="h-11 flex-1 accent-game-ink"
              />
              <ActionButton onClick={() => setTurntable((t) => !t)} pressed={turntable}>
                {turntable ? "Stop turning" : "Turn"}
              </ActionButton>
            </div>
          </div>
          <Chips<QualityTier> label="Quality" value={tier} options={TIERS.map((t) => ({ value: t, label: label(t) }))} onChange={setTier} />
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => setDebug((d) => !d)} pressed={debug}>
              {debug ? "Hide physics" : "Show physics"}
            </ActionButton>
            {character === "hero" ? (
              <>
                <ActionButton onClick={() => actions.current?.flip()}>Flip the hero</ActionButton>
                <ActionButton onClick={() => actions.current?.miss()}>Miss a web</ActionButton>
              </>
            ) : null}
          </div>
          <pre ref={readout} aria-live="off" className="rounded-[12px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 font-mono text-xs leading-5 text-game-ink" />
        </div>
      </details>
    </div>
  );
}
