/**
 * The scene's camera without the scene: what scene/engine.ts does each frame between the
 * frame and the three.js camera (the chase, then the director's beats), for the metrics
 * script. Keep it in step with the engine.
 */
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { ChaseCamera, createChaseInput, type ChasePose } from "../../src/game3d/scene/camera/chase";
import { CameraDirector, type DirectorInput, type SceneCue } from "../../src/game3d/scene/camera/director";
import { createCityRaycast } from "../../src/game3d/scene/camera/raycast";

/** The loop's status, as far as the camera is concerned. */
export type RigStatus = "intro" | "live" | "outro" | "done";

/** The countdown's length (s), as the loop runs it. */
export const INTRO_SECONDS = 2.4;

export interface CameraRig {
  /** One frame: `introLeft` is what's left of the countdown (s). */
  update(frame: RenderFrame3D, status: RigStatus, width: number, height: number, dt: number, steer: { x: number; y: number }, introLeft?: number): ChasePose;
  /** A teleport: the loop's cut. */
  cut(): void;
  /** An event from the loop's bus. */
  event(ev: SimEvent | { type: "go" }): void;
}

export function createCameraRig(city: City, steady: boolean): CameraRig {
  const cast = createCityRaycast(city);
  const chase = new ChaseCamera(cast);
  const director = new CameraDirector(cast);
  const i = createChaseInput();
  const cue: SceneCue = { status: "intro", introLeft: INTRO_SECONDS, introTotal: INTRO_SECONDS };
  const b: DirectorInput = { cue, mode: "travel", hero: { x: 0, y: 0, z: 0 }, goal: null, ally: null, aspect: 1, reducedMotion: steady, input: false };
  return {
    update(frame, status, width, height, dt, steer, introLeft = 0) {
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
      i.goal = frame.mode === "travel" ? (frame.route?.[0] ?? null) : null;
      i.grounded = frame.hero.grounded;
      const pose = chase.update(i, dt);
      cue.status = status;
      cue.introLeft = status === "intro" ? introLeft : 0;
      b.mode = frame.mode;
      b.hero = frame.hero.pos;
      b.goal = (frame.mode === "errand" ? frame.route?.[1] : frame.route?.[0]) ?? null;
      b.ally = frame.mode === "errand" && zone?.kind === "errand" ? (zone.allyAt ?? zone.center) : null;
      b.aspect = i.aspect;
      b.input = steer.x * steer.x + steer.y * steer.y > 0.04;
      return director.update(pose, b, dt);
    },
    cut() {
      chase.reset();
      director.cut();
    },
    event() {},
  };
}
