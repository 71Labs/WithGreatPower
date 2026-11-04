"use client";

/**
 * The crowd bench: the eight civilian bodies in a row on the stage roof with cast members
 * between them, in the city's crowd shading, standing or each in one of their moves.
 * `?tier=low` shows the light bodies the low and medium tiers draw. `?debug=1` exposes
 * `window.__wgpCrowdLab` for headless shots.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PerspectiveCamera } from "three";

import { C } from "@/game3d/scene/palette";
import { hasWebGL2, type QualityTier } from "@/game3d/scene/quality";

import { LineupStage, VIEWS, type LineupStats, type LineupView } from "./stage";

interface LabApi {
  ready(): boolean;
  view(v: LineupView): void;
  stats(): LineupStats;
}

declare global {
  interface Window {
    __wgpCrowdLab?: LabApi;
  }
}

const VIEW_LABEL: Record<LineupView, string> = { front: "Front", "three-quarter": "Three-quarter", close: "Close", poses: "Moves" };

function Stage({ tier, view, onStage, onStats }: { tier: QualityTier; view: LineupView; onStage(s: LineupStage | null): void; onStats(s: LineupStats): void }) {
  const gl = useThree((s) => s.gl);
  const stage = useMemo(() => new LineupStage(tier), [tier]);
  useEffect(() => {
    onStage(stage);
    return () => {
      onStage(null);
      stage.dispose();
    };
  }, [stage, onStage]);
  useEffect(() => stage.setView(view), [stage, view]);
  useFrame((s, delta) => {
    const stats = stage.frame(s.camera as PerspectiveCamera, s.size, s.viewport.dpr, delta, s.clock.elapsedTime, gl.info.render);
    if (stats) onStats(stats);
  });
  return (
    <>
      <color attach="background" args={[C.skyMid[0], C.skyMid[1], C.skyMid[2]]} />
      {stage.meshes ? <primitive object={stage.meshes.root} /> : null}
      <primitive object={stage.root} />
    </>
  );
}

export default function CrowdBench() {
  const [webgl] = useState(() => hasWebGL2());
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const tier: QualityTier = params.get("tier") === "low" ? "low" : "high";
  const [view, setView] = useState<LineupView>(() => (VIEWS.includes(params.get("view") as LineupView) ? (params.get("view") as LineupView) : "front"));
  const stage = useRef<LineupStage | null>(null);
  const stats = useRef<LineupStats>({ calls: 0, triangles: 0, crowdMs: 0, fps: 0 });
  const readout = useRef<HTMLPreElement>(null);
  const onStage = useCallback((s: LineupStage | null) => {
    stage.current = s;
  }, []);
  const onStats = useCallback((s: LineupStats) => {
    stats.current = s;
    if (readout.current) readout.current.textContent = [`fps       ${s.fps.toFixed(0)}`, `calls     ${s.calls}`, `triangles ${s.triangles.toLocaleString("en-US")}`, `crowd ms  ${s.crowdMs.toFixed(2)}`].join("\n");
  }, []);

  useEffect(() => {
    if (params.get("debug") !== "1") return;
    window.__wgpCrowdLab = {
      ready: () => !!stage.current?.ready,
      view: (v) => {
        if (VIEWS.includes(v)) setView(v);
      },
      stats: () => stats.current,
    };
    return () => {
      delete window.__wgpCrowdLab;
    };
  }, [params]);

  if (!webgl) {
    return (
      <div className="grid h-full place-items-center p-4">
        <p className="max-w-[40ch] rounded-[14px] border-2 border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)]">This browser can’t draw WebGL 2, so the crowd can’t show here.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Canvas className="absolute inset-0" flat linear dpr={[1, tier === "high" ? 2 : 1.5]} gl={{ antialias: tier === "high", alpha: false, stencil: false }} camera={{ fov: 40, near: 4, far: 8000, position: [-1300, 420, 0] }}>
        <Stage tier={tier} view={view} onStage={onStage} onStats={onStats} />
      </Canvas>
      <section aria-labelledby="crowd-lab-title" className="absolute left-4 top-4 flex w-[min(360px,calc(100vw-32px))] flex-col gap-4 rounded-[18px] border-2 border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)]">
        <h1 id="crowd-lab-title" className="text-base font-semibold tracking-tight">
          <span className="text-game-muted">Lab /</span> Crowd
        </h1>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-game-muted">View</legend>
          <div role="radiogroup" aria-label="View" className="flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={`h-9 whitespace-nowrap rounded-[10px] border-2 border-game-ink px-2.5 text-[13px] font-semibold transition-[background-color,color,scale] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-game-ink active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:h-11 ${
                  view === v ? "bg-game-ink text-game-paper" : "bg-game-paper text-game-ink [@media(hover:hover)]:hover:bg-game-paper-2"
                }`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-[13px] text-game-muted [text-wrap:pretty]">
          {tier === "low" ? "Light bodies, as the low and medium tiers draw them." : "Full bodies, as the high tier draws them near the camera."} Cast members stand between the civilians.
        </p>
        <pre ref={readout} aria-live="off" className="rounded-[12px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 font-mono text-xs leading-5 text-game-ink" />
      </section>
    </div>
  );
}
