"use client";

/**
 * The 3D half of the patrol page, loaded with next/dynamic (ssr: false) so three.js stays
 * out of every other bundle: the scene canvas, and inside it the driver that advances the
 * night's loop once per frame, before the scene reads the frame it writes.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, type RefObject } from "react";

import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import type { SuitColors } from "@/components/cast";
import type { FrameTap } from "@/game3d/nav/tap";
import type { RunLoop } from "@/game3d/session";
import type { ChasePose } from "@/game3d/scene/camera/chase";
import type { QualityPreset, QualityTier } from "@/game3d/scene/quality";
import { SceneCanvas, type SceneHandle, type SceneStats } from "@/game3d/scene/Scene";

/** Priority −1: before the scene's own useFrame, without taking over rendering. */
function LoopDriver({ loop }: { loop: RunLoop }) {
  useFrame((_, delta) => loop.advance(delta), -1);
  return null;
}

/**
 * While the night is paused (the pause sheet, the city map) the scene draws only when it
 * must (a resize, a restored context), not 60 times a second behind the sheet: a phone
 * stays cool and the battery lasts. One more frame on pausing lets the loop publish the
 * paused HUD; resuming picks up on the next frame (the loop and scene clamp its long delta).
 */
function PauseGate({ paused }: { paused: boolean }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    setFrameloop(paused ? "demand" : "always");
    if (paused) invalidate();
  }, [paused, setFrameloop, invalidate]);
  return null;
}

export interface StageProps {
  loop: RunLoop;
  city: City;
  handle: RefObject<SceneHandle | null>;
  quality: QualityPreset;
  heroColors: SuitColors;
  cast: CastId[];
  reducedMotion: boolean;
  onStats?(stats: SceneStats): void;
  onTierSuggest?(tier: QualityTier): void;
  onContextStalled?(): void;
  /** The night is paused (or the city map is open over it): draw only when needed. */
  paused?: boolean;
  /** Overlays placed from the camera (the waypoint, the minimap), run every frame after the camera moves. */
  tap?: FrameTap;
}

export default function Stage({ loop, city, handle, quality, heroColors, cast, reducedMotion, onStats, onTierSuggest, onContextStalled, tap, paused = false }: StageProps) {
  // The scene reads the loop's view through a ref; the view object never changes.
  const frame = useMemo<RefObject<RenderFrame3D | null>>(() => ({ current: loop.view }), [loop]);
  const onFrame = useCallback((pose: ChasePose | null, width: number, height: number) => tap?.run(loop.view, pose, width, height), [tap, loop]);
  return (
    <SceneCanvas
      className="absolute inset-0"
      city={city}
      frame={frame}
      quality={quality}
      handle={handle}
      heroColors={heroColors}
      cast={cast}
      reducedMotion={reducedMotion}
      onStats={onStats}
      onTierSuggest={onTierSuggest}
      onContextStalled={onContextStalled}
      onFrame={tap ? onFrame : undefined}
    >
      <LoopDriver loop={loop} />
      <PauseGate paused={paused} />
    </SceneCanvas>
  );
}
