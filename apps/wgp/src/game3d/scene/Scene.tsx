"use client";

/**
 * The 3D city scene for React Three Fiber.
 *
 * - `<SceneCanvas>` is the whole thing: a Canvas set up for the sticker look (flat, linear,
 *   no shadows), the tier's DPR with adaptive resolution, an FPS probe, a context-loss guard
 *   and `<Scene>` inside. Lazy-load it (next/dynamic, ssr: false).
 * - `<Scene>` alone goes inside a Canvas you own.
 *
 * Per-frame data is read from `frame.current` inside `useFrame`; nothing per frame touches
 * React state. Imperative extras (bursts, the flip, orbit input, camera cuts) go through
 * the `handle` ref.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { PerspectiveCamera } from "three";

import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { NODE_COLORS, type SuitColors } from "@/components/cast";

import type { ChasePose, Raycast } from "./camera/chase";
import { watchContextRecovery } from "./context-recovery";
import type { BurstOptions } from "./effects";
import { ALL_CAST, SceneEngine } from "./engine";
import { FpsMeter, FpsProbe, FrameBudget, MIN_FRAME_SCALE, sceneDpr, type QualityPreset, type QualityTier } from "./quality";

export interface SceneHandle {
  /** Pop a comic burst ("THWIP!", "POW!", "WHAM!", "ZAP!", "PERFECT!", "OOF!", "SPLASH!") at a world point. */
  burst(word: string, at: Vec3, opts?: BurstOptions): void;
  /** Spin the hero card a full turn (a perfect release). */
  flip(): void;
  /** Manual camera orbit: radians to add this frame, and whether a pointer holds the camera. */
  orbit(dYaw: number, dPitch: number, holding: boolean): void;
  /** Cut the camera to its wanted pose (a teleport, a new stop). */
  cut(): void;
  /** The last chase pose, for HUD projection. */
  pose(): ChasePose | null;
}

export interface SceneStats {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  fps: number;
  dpr: number;
  tier: QualityTier;
}

export interface SceneProps {
  city: City;
  /** Written by the game loop every frame; read here in useFrame. Null before a run starts. */
  frame: RefObject<RenderFrame3D | null>;
  quality: QualityPreset;
  heroColors?: SuitColors;
  /** Cast members to put in the card atlas (all of them by default). */
  cast?: CastId[];
  reducedMotion?: boolean;
  /** Camera collision. Defaults to a local raycast over the city's boxes. */
  raycast?: Raycast;
  handle?: RefObject<SceneHandle | null>;
  /** About four times a second, renderer.info and the frame rate (for `?debug=1`). */
  onStats?(stats: SceneStats): void;
}

export function Scene({ city, frame, quality, heroColors = NODE_COLORS, cast = ALL_CAST, reducedMotion = false, raycast, handle, onStats }: SceneProps) {
  const engine = useMemo(() => new SceneEngine(city, raycast ?? null), [city, raycast]);
  const lastPose = useRef<ChasePose | null>(null);
  const meter = useMemo(() => new FpsMeter(), []);
  const statsAt = useRef(0);
  const gl = useThree((s) => s.gl);

  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => {
    engine.loadCards(heroColors, cast).catch(() => {
      // Cards failing to build (a decode error) leaves the city drawable.
    });
  }, [engine, heroColors, cast]);
  useEffect(() => engine.setQuality(quality), [engine, quality]);
  useEffect(() => engine.setReducedMotion(reducedMotion), [engine, reducedMotion]);

  useImperativeHandle(
    handle,
    () => ({
      burst: (word, at, opts) => engine.burst(word, at, opts),
      flip: () => engine.flip(),
      orbit: (dy, dp, holding) => engine.orbit(dy, dp, holding),
      cut: () => engine.cut(),
      pose: () => lastPose.current,
    }),
    [engine],
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    lastPose.current = engine.update(frame.current, state.camera as PerspectiveCamera, state.size, state.viewport.dpr, dt, state.clock.elapsedTime);
    meter.push(delta);
    if (onStats && state.clock.elapsedTime - statsAt.current > 0.25) {
      statsAt.current = state.clock.elapsedTime;
      const info = gl.info;
      onStats({
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        fps: meter.fps,
        dpr: state.viewport.dpr,
        tier: quality.tier,
      });
    }
  });

  return <primitive object={engine.root} />;
}

/** Drawing-buffer pixel ratio: the tier and screen allow a DPR, the frame budget scales it. */
function PixelBudget({ preset }: { preset: QualityPreset }) {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const setDpr = useThree((s) => s.setDpr);
  const budget = useMemo(() => new FrameBudget(), []);
  const [scale, setScale] = useState(1);
  useFrame((_, delta) => {
    const next = budget.push(delta);
    if (next !== null) setScale(next);
  });
  useLayoutEffect(() => {
    const full = sceneDpr(width, height, window.devicePixelRatio, preset);
    setDpr(Math.max(full * MIN_FRAME_SCALE, full * scale));
  }, [width, height, preset, scale, setDpr]);
  return null;
}

/** Measures once, from the median frame time after a warm-up, and reports the tier it suggests. */
function TierProbe({ tier, onResult }: { tier: QualityTier; onResult(tier: QualityTier): void }) {
  const probe = useMemo(() => new FpsProbe(tier), [tier]);
  useFrame((_, delta) => {
    const next = probe.push(delta);
    if (next) onResult(next);
  });
  return null;
}

/** Cancels context loss (so the browser may restore it), and reports loss and stalls. */
function ContextGuard({ onLost, onRestored, onStalled }: { onLost?(): void; onRestored?(): void; onStalled?(): void }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(
    () =>
      watchContextRecovery({
        canvas: gl.domElement,
        visibility: document,
        onLost: () => onLost?.(),
        onRestored: () => {
          invalidate();
          onRestored?.();
        },
        onStalled: () => onStalled?.(),
      }),
    [gl, invalidate, onLost, onRestored, onStalled],
  );
  return null;
}

export interface SceneCanvasProps extends SceneProps {
  className?: string;
  style?: CSSProperties;
  /** Called at most once per canvas, if the FPS probe says this device wants another tier. */
  onTierSuggest?(tier: QualityTier): void;
  onContextLost?(): void;
  onContextRestored?(): void;
  /** The context didn't come back within 6 s: show the 2D fallback. */
  onContextStalled?(): void;
  /** Rendered inside the Canvas (a loop driver using useFrame, helpers). */
  children?: ReactNode;
}

export function SceneCanvas({ className, style, onTierSuggest, onContextLost, onContextRestored, onContextStalled, children, ...scene }: SceneCanvasProps) {
  const { quality } = scene;
  // One probe per SceneCanvas, so a device near a threshold can't bounce between tiers.
  const [probed, setProbed] = useState(false);
  const onProbe = (t: QualityTier) => {
    setProbed(true);
    if (t !== quality.tier) onTierSuggest?.(t);
  };
  // Context attributes are fixed for a canvas's life; key the canvas on antialias to change it.
  const gl = useMemo(() => ({ antialias: quality.antialias, powerPreference: "high-performance" as const, alpha: false, stencil: false }), [quality.antialias]);
  return (
    <Canvas
      key={quality.antialias ? "aa" : "no-aa"}
      className={className}
      style={{ touchAction: "none", ...style }}
      flat
      linear
      gl={gl}
      dpr={1}
      camera={{ fov: 55, near: 4, far: 30000, position: [0, 800, 1200] }}
    >
      <PixelBudget preset={quality} />
      {onTierSuggest && !probed ? <TierProbe tier={quality.tier} onResult={onProbe} /> : null}
      <ContextGuard onLost={onContextLost} onRestored={onContextRestored} onStalled={onContextStalled} />
      {children}
      <Scene {...scene} />
    </Canvas>
  );
}
