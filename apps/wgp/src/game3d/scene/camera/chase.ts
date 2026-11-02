/**
 * The swing chase camera: a spring arm behind the hero's velocity heading.
 *
 * - The arm hangs off a pivot just above the hero and points back along the heading,
 *   pitched a little above the horizon so the view looks out over the roofs. Heading comes
 *   from the horizontal velocity and holds when the hero slows, so a stop on a roof doesn't
 *   spin the view.
 * - Distance (about 420 → 620) and vertical FOV (55° → 65°) grow with speed. Portrait
 *   screens add FOV so the horizontal view stays wide enough to aim. Reduced motion keeps
 *   the FOV fixed.
 * - The look point leads the hero along its velocity and leans toward the web anchor.
 * - Collision: a ray from the pivot to the wanted camera spot; when a building is in the way
 *   the arm snaps in to just short of it and eases back out once clear.
 * - Arenas: with a rival and a zone, the camera frames both fighters from about 65° off
 *   their line (the side nearer the current view, so it never flips), backs off with their
 *   separation, and stays inside the zone bounds, climbing rather than closing in when the
 *   zone is small.
 * - Manual orbit: drag deltas add yaw and pitch; 1.5 s after the last input the offsets
 *   spring back to zero.
 *
 * Pure: no three.js or React, nothing allocates per frame. Unit tested in chase.test.ts.
 */
import type { Vec3, Zone } from "@wgp/game-core/sim3d/contract";

import { Smoothed, SmoothedAngle, SmoothedVec3, angleDelta, type MutableVec3 } from "./springs";

export const CHASE_TUNING = {
  /** Arm length at low and high speed (world units). */
  distSlow: 420,
  distFast: 620,
  /** Vertical FOV at low and high speed (degrees). */
  fovSlow: 55,
  fovFast: 65,
  /** Portrait screens widen the vertical FOV by up to this much (degrees). */
  portraitFovBoost: 14,
  /** Speeds (units/s) that map to the slow and fast ends. */
  speedSlow: 250,
  speedFast: 1400,
  /** Arm pitch above the horizon (radians): positive puts the camera above the hero. */
  pitch: 0.18,
  /** Pivot height above the hero's centre. */
  pivotLift: 36,
  /** Look-ahead along the velocity (seconds), capped (units). */
  lookAhead: 0.22,
  lookAheadMax: 240,
  /** How far the look point leans toward the web anchor (0–1). */
  anchorPull: 0.22,
  /** Heading spring (s), and the horizontal speed below which the heading holds. */
  headingTime: 0.55,
  minHeadingSpeed: 90,
  /** Pivot follow springs (s): horizontal, vertical. */
  followTime: 0.08,
  followTimeY: 0.18,
  /** Look-point springs (s). */
  targetTime: 0.08,
  targetTimeY: 0.15,
  /** Distance, FOV and pitch springs (s). */
  distTime: 0.6,
  fovTime: 0.6,
  pitchTime: 0.5,
  /** After a collision pull-in the arm eases back out with this smoothing (s). */
  armOutTime: 0.45,
  /** Shortest arm a collision can force, and the gap kept from what the ray hit. */
  minArm: 120,
  probePad: 24,
  /** The camera never goes below this height (the street is y = 0). */
  minCameraY: 18,
  /** Manual orbit: seconds of no input before recentring, the recentre spring and pitch limits. */
  orbitIdle: 1.5,
  orbitRecenterTime: 0.45,
  pitchMin: -0.25,
  pitchMax: 1.25,
  /** Arena two-shot: angle off the fighters' line (radians), distance range and margin inside the bounds. */
  arenaSide: 1.15,
  arenaMinDist: 460,
  arenaMaxDist: 1000,
  arenaPitch: 0.32,
  /** How steep the arm may climb when the arena's walls are close (radians). */
  arenaPitchMax: 1.05,
  arenaMargin: 30,
};

export type ChaseTuning = typeof CHASE_TUNING;

/** A ray cast against the city: distance to the first solid along `dir` (unit), or null. */
export type Raycast = (origin: Vec3, dir: Vec3, maxDist: number) => number | null;

export interface ChaseInput {
  hero: Vec3;
  vel: Vec3;
  anchor: Vec3 | null;
  /** The other fighter for the arena two-shot, or null outside fights. */
  rival: Vec3 | null;
  /** The arena the two-shot stays inside. */
  arena: Zone["bounds"] | null;
  /** Manual orbit this frame (radians, from drag deltas) and whether a pointer is down. */
  orbitYaw: number;
  orbitPitch: number;
  orbiting: boolean;
  /** Viewport width / height. */
  aspect: number;
  reducedMotion: boolean;
}

export interface ChasePose {
  position: MutableVec3;
  target: MutableVec3;
  /** Vertical FOV, degrees. */
  fov: number;
  /** Current arm length after collision. */
  arm: number;
  /** The arm wanted before collision. */
  want: number;
  /** Heading the arm points along (radians, atan2(x, z) convention). */
  yaw: number;
}

export function createChaseInput(): ChaseInput {
  return {
    hero: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    anchor: null,
    rival: null,
    arena: null,
    orbitYaw: 0,
    orbitPitch: 0,
    orbiting: false,
    aspect: 16 / 9,
    reducedMotion: false,
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Vertical FOV for a speed and aspect (degrees). */
export function chaseFov(speed: number, aspect: number, reducedMotion: boolean, t: ChaseTuning = CHASE_TUNING): number {
  const s = reducedMotion ? 0.5 : clamp((speed - t.speedSlow) / (t.speedFast - t.speedSlow), 0, 1);
  const portrait = clamp((1 - aspect) / 0.55, 0, 1);
  return lerp(t.fovSlow, t.fovFast, s) + portrait * t.portraitFovBoost;
}

/** Arm length for a speed (world units). */
export function chaseDistance(speed: number, t: ChaseTuning = CHASE_TUNING): number {
  return lerp(t.distSlow, t.distFast, clamp((speed - t.speedSlow) / (t.speedFast - t.speedSlow), 0, 1));
}

export class ChaseCamera {
  readonly pose: ChasePose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: CHASE_TUNING.fovSlow, arm: 0, want: 0, yaw: 0 };
  private readonly yaw = new SmoothedAngle();
  private readonly pitch = new Smoothed(CHASE_TUNING.pitch);
  private readonly dist = new Smoothed(CHASE_TUNING.distSlow);
  private readonly fov = new Smoothed(CHASE_TUNING.fovSlow);
  private readonly arm = new Smoothed(CHASE_TUNING.distSlow);
  private readonly pivot = new SmoothedVec3();
  private readonly look = new SmoothedVec3();
  private readonly orbitYaw = new Smoothed();
  private readonly orbitPitch = new Smoothed();
  private heading = 0;
  private idle = Infinity;
  private started = false;
  // Scratch.
  private readonly pivotWant: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly lookWant: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly pivotNow: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly dir: MutableVec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private raycast: Raycast | null = null,
    readonly tuning: ChaseTuning = CHASE_TUNING,
  ) {}

  setRaycast(raycast: Raycast | null): void {
    this.raycast = raycast;
  }

  /** Jump straight to the wanted pose on the next update (a cut, or a new run). */
  reset(): void {
    this.started = false;
  }

  update(input: ChaseInput, dt: number): ChasePose {
    const t = this.tuning;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const { hero, vel } = input;
    const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (hs > t.minHeadingSpeed || !this.started) this.heading = hs > 1e-3 ? Math.atan2(vel.x, vel.z) : this.heading;

    let yawWant = this.heading;
    let pitchWant = t.pitch;
    let distWant = chaseDistance(speed, t);
    const arena = input.rival && input.arena ? input.arena : null;
    if (arena && input.rival) {
      const r = input.rival;
      const dx = r.x - hero.x;
      const dy = r.y - hero.y;
      const dz = r.z - hero.z;
      // Vertical separation counts more: the view is wider than it is tall.
      const sep = Math.sqrt(dx * dx + dz * dz + dy * dy * 1.6);
      const line = sep > 1 ? Math.atan2(dx, dz) : this.heading;
      const a = line + t.arenaSide;
      const b = line - t.arenaSide;
      const cur = this.started ? this.yaw.value : this.heading;
      yawWant = Math.abs(angleDelta(cur, a)) <= Math.abs(angleDelta(cur, b)) ? a : b;
      pitchWant = t.arenaPitch;
      distWant = clamp(sep * 0.9 + 320, t.arenaMinDist, t.arenaMaxDist);
      this.pivotWant.x = (hero.x + r.x) / 2;
      this.pivotWant.y = (hero.y + r.y) / 2 + t.pivotLift;
      this.pivotWant.z = (hero.z + r.z) / 2;
      this.lookWant.x = this.pivotWant.x;
      this.lookWant.y = this.pivotWant.y - t.pivotLift;
      this.lookWant.z = this.pivotWant.z;
    } else {
      this.pivotWant.x = hero.x;
      this.pivotWant.y = hero.y + t.pivotLift;
      this.pivotWant.z = hero.z;
      const lead = Math.min(1, t.lookAheadMax / Math.max(1e-3, speed * t.lookAhead));
      this.lookWant.x = hero.x + vel.x * t.lookAhead * lead;
      this.lookWant.y = hero.y + vel.y * t.lookAhead * lead * 0.5;
      this.lookWant.z = hero.z + vel.z * t.lookAhead * lead;
      if (input.anchor) {
        this.lookWant.x = lerp(this.lookWant.x, input.anchor.x, t.anchorPull);
        this.lookWant.y = lerp(this.lookWant.y, input.anchor.y, t.anchorPull);
        this.lookWant.z = lerp(this.lookWant.z, input.anchor.z, t.anchorPull);
      }
    }
    const fovWant = chaseFov(speed, input.aspect, input.reducedMotion, t);

    if (!this.started) {
      this.started = true;
      this.yaw.snap(yawWant);
      this.pitch.snap(pitchWant);
      this.dist.snap(distWant);
      this.fov.snap(fovWant);
      this.arm.snap(distWant);
      this.pivot.snap(this.pivotWant);
      this.look.snap(this.lookWant);
      this.orbitYaw.snap(0);
      this.orbitPitch.snap(0);
      this.idle = Infinity;
    }

    // Manual orbit, recentring after a quiet spell.
    const moved = input.orbitYaw !== 0 || input.orbitPitch !== 0;
    if (moved || input.orbiting) {
      this.idle = 0;
      this.orbitYaw.snap(this.orbitYaw.value + input.orbitYaw);
      this.orbitPitch.snap(clamp(this.orbitPitch.value + input.orbitPitch, t.pitchMin - t.pitch, t.pitchMax - t.pitch));
    } else {
      this.idle += step;
      if (this.idle >= t.orbitIdle) {
        this.orbitYaw.step(0, t.orbitRecenterTime, step);
        this.orbitPitch.step(0, t.orbitRecenterTime, step);
      }
    }

    const yaw = this.yaw.step(yawWant, t.headingTime, step) + this.orbitYaw.value;
    let pitch = clamp(this.pitch.step(pitchWant, t.pitchTime, step) + this.orbitPitch.value, t.pitchMin, t.pitchMax);
    const want = this.dist.step(distWant, t.distTime, step);
    const pivot = this.pivot.step(this.pivotWant, t.followTime, t.followTimeY, step, this.pivotNow);

    // Arenas: when the zone's walls are closer than the arm reaches, climb instead of
    // closing in, so a small arena still frames both fighters (from higher up).
    if (arena) {
      const m = t.arenaMargin;
      this.dir.x = -Math.sin(yaw);
      this.dir.y = 0;
      this.dir.z = -Math.cos(yaw);
      const room = rayExit(pivot, this.dir, arena.x0 + m, arena.x1 - m, arena.z0 + m, arena.z1 - m);
      if (room < want * Math.cos(pitch)) pitch = Math.max(pitch, Math.min(t.arenaPitchMax, Math.acos(clamp(room / want, 0, 1))));
    }

    // The arm points back along the heading and up by the pitch.
    const cp = Math.cos(pitch);
    const d = this.dir;
    d.x = -Math.sin(yaw) * cp;
    d.y = Math.sin(pitch);
    d.z = -Math.cos(yaw) * cp;
    let reach = want;

    // Arenas: keep the camera inside the zone (shorten the arm until it is).
    if (arena) {
      const m = t.arenaMargin;
      reach = Math.min(reach, rayExit(pivot, d, arena.x0 + m, arena.x1 - m, arena.z0 + m, arena.z1 - m));
      reach = Math.max(reach, t.minArm);
    }

    // Collision: snap in to what the ray hits, ease back out once clear.
    let limit = reach;
    const hit = this.raycast ? this.raycast(pivot, d, reach + t.probePad) : null;
    if (hit !== null && Number.isFinite(hit)) limit = Math.max(t.minArm, Math.min(reach, hit - t.probePad));
    if (limit < this.arm.value) this.arm.snap(limit);
    else this.arm.step(limit, t.armOutTime, step);
    const arm = Math.min(this.arm.value, reach);

    const p = this.pose;
    p.position.x = pivot.x + d.x * arm;
    p.position.y = Math.max(t.minCameraY, pivot.y + d.y * arm);
    p.position.z = pivot.z + d.z * arm;
    this.look.step(this.lookWant, t.targetTime, t.targetTimeY, step, p.target);
    p.fov = this.fov.step(fovWant, t.fovTime, step);
    p.arm = arm;
    p.want = want;
    p.yaw = yaw;
    return p;
  }
}

/** Distance along a ray from inside an xz rectangle to where it leaves it (∞ if it never does). */
function rayExit(o: MutableVec3, d: MutableVec3, x0: number, x1: number, z0: number, z1: number): number {
  let t = Infinity;
  if (d.x > 1e-6) t = Math.min(t, (x1 - o.x) / d.x);
  else if (d.x < -1e-6) t = Math.min(t, (x0 - o.x) / d.x);
  if (d.z > 1e-6) t = Math.min(t, (z1 - o.z) / d.z);
  else if (d.z < -1e-6) t = Math.min(t, (z0 - o.z) / d.z);
  return Math.max(0, t);
}
