/**
 * The scene's camera without the scene: what scene/engine.ts does each frame between the
 * frame and the three.js camera, for the metrics script. Keep it in step with the engine.
 */
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { ChaseCamera, createChaseInput, type ChasePose } from "../../src/game3d/scene/camera/chase";
import { createCityRaycast } from "../../src/game3d/scene/camera/raycast";

/** The loop's status, as far as the camera is concerned. */
export type RigStatus = "intro" | "live" | "outro" | "done";

export interface CameraRig {
  update(frame: RenderFrame3D, status: RigStatus, width: number, height: number, dt: number, steer: { x: number; y: number }): ChasePose;
  /** A teleport: the loop's cut. */
  cut(): void;
  /** An event from the loop's bus. */
  event(ev: SimEvent | { type: "go" }): void;
}

export function createCameraRig(city: City, steady: boolean): CameraRig {
  const chase = new ChaseCamera(createCityRaycast(city));
  const i = createChaseInput();
  return {
    update(frame, _status, width, height, dt, steer) {
      i.hero = frame.hero.pos;
      i.vel = frame.hero.vel;
      i.anchor = frame.hero.anchor;
      i.facing = frame.hero.facing ?? null;
      i.steer = steer;
      const zone = city.zones[frame.stop];
      const rival = frame.mode === "fight" ? (frame.villains.find((v) => !v.copy) ?? frame.villains[0]) : undefined;
      i.rival = rival && zone ? rival.pos : null;
      i.rivalVel = rival && zone ? (rival.vel ?? null) : null;
      i.arena = rival && zone ? zone.bounds : null;
      i.orbitYaw = 0;
      i.orbitPitch = 0;
      i.orbiting = false;
      i.aspect = width / Math.max(1, height);
      i.reducedMotion = steady;
      return chase.update(i, dt);
    },
    cut() {
      chase.reset();
    },
    event() {},
  };
}
