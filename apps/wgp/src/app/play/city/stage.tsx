"use client";

/**
 * The 3D half of the City page, loaded with next/dynamic (ssr: false) so three.js stays out of
 * every other bundle: the scene canvas, and inside it the driver that advances the outing's
 * loop once per frame, before the scene reads the frame it writes.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, type RefObject } from "react";

import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import type { SuitColors } from "@/components/cast";
import type { FrameTap } from "@/game3d/nav/tap";
import type { RoamLoop } from "@/game3d/session/roam-loop";
import type { ChasePose } from "@/game3d/scene/camera/chase";
import type { QualityPreset, QualityTier } from "@/game3d/scene/quality";
import { SceneCanvas, type SceneHandle, type SceneStats } from "@/game3d/scene/Scene";

/** Priority −1: before the scene's own useFrame, without taking over rendering. */
function LoopDriver({ loop }: { loop: RoamLoop }) {
  useFrame((_, delta) => loop.advance(delta), -1);
  return null;
}

/** Paused (the pause sheet, the map): draw only when needed. */
function PauseGate({ paused }: { paused: boolean }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    setFrameloop(paused ? "demand" : "always");
    if (paused) invalidate();
  }, [paused, setFrameloop, invalidate]);
  return null;
}

export interface CityStageProps {
  loop: RoamLoop;
  city: City;
  handle: RefObject<SceneHandle | null>;
  quality: QualityPreset;
  heroColors: SuitColors;
  cast: CastId[];
  reducedMotion: boolean;
  onStats?(stats: SceneStats): void;
  onTierSuggest?(tier: QualityTier): void;
  onContextStalled?(): void;
  paused?: boolean;
  tap?: FrameTap;
}

export default function CityStage({ loop, city, handle, quality, heroColors, cast, reducedMotion, onStats, onTierSuggest, onContextStalled, tap, paused = false }: CityStageProps) {
  const frame = useMemo<RefObject<RenderFrame3D | null>>(() => ({ current: loop.view }), [loop]);
  const cue = useMemo(() => ({ current: loop.cue }), [loop]);
  const onFrame = useCallback((pose: ChasePose | null, width: number, height: number) => tap?.run(loop.view, pose, width, height), [tap, loop]);
  return (
    <SceneCanvas
      className="absolute inset-0"
      city={city}
      frame={frame}
      cue={cue}
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
