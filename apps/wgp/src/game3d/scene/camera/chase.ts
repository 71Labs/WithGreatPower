/**
 * The swing chase camera: a third-person spring arm in the style of Insomniac's Spider-Man.
 *
 * - Yaw follows the travel heading, never the instantaneous velocity. The horizontal
 *   velocity goes through two ~0.6 s low-pass stages, so a pendulum's back-and-forth and
 *   sideways swing cancels out. The camera turns only once that heading is more than 20°
 *   off, on a critically damped spring capped at 90°/s (so turns ease in and out without
 *   overshooting), and stops within 4°.
 * - Manual control wins. Mouse look, a drag or a two-finger orbit turns the camera
 *   directly, and holding the (camera-relative) stick anywhere but forward pauses
 *   auto-follow, so the camera never turns the steering under the player's thumb.
 *   Auto-follow comes back 2 s after the last manual input, easing in over a second; a
 *   manual pitch eases back to the automatic one at the same time.
 * - Vertical: the pivot follows the hero's height through a dead band and a soft spring, so
 *   a swing's rise and fall moves the hero in the frame instead of pumping the camera. The
 *   look point rides above the hero, which puts the hero in the lower-middle third. Pitch
 *   leans down a little when falling fast and up when climbing.
 * - Smoothing: critically damped springs throughout (pivot 0.2 s, look point 0.18 s), each
 *   kept within a short leash of its goal so speed never drags the hero out of frame; a
 *   look-ahead from the filtered velocity; and a small lean toward the web anchor that
 *   eases in and out instead of jumping when a web attaches.
 * - Distance (420 → 620) and vertical FOV (55° → 65°) grow with the filtered speed.
 *   Portrait screens add FOV. Reduced motion keeps the FOV fixed.
 * - Collision: a ray from the pivot to the wanted camera spot. When a building is in the
 *   way, the arm eases in fast (0.08 s, no snap), holds a moment once clear, then eases
 *   back out. The city shader fades whatever still sits between the camera and the hero,
 *   including a wall the camera is still easing out of.
 * - Travel shots (framing.ts): standing still, a calm shot over the shoulder toward the next
 *   stop; moving, a lean toward the stop, lower and wider at speed with a subtle FOV kick;
 *   a dead zone that fits the screen; the camera easing behind a run on a roof while the
 *   stick keeps its heading; on a phone, the camera sliding with the hero across rather than
 *   turning; a pivot kept out of the city and an arm that changes length smoothly.
 * - Arenas: a two-shot of both fighters.
 *   - Candidate sides around the fighters' line (low-passed, and held while they're close)
 *     are scored by their room: the arena bounds plus some slack, and the buildings.
 *   - The score prefers side-on views and the current side, and is re-picked four times a
 *     second.
 *   - The arm is the shortest that keeps both bodies inside a safe frame (clear of the HUD)
 *     from where the camera looks now, at its FOV and the screen's shape (`arenaFit`), now and
 *     a quarter second on along their velocities, so a close fight reads big, a flyer far
 *     overhead still fits, and the shot widens before a fighter leaves it. The fit widens
 *     within about a second and tightens slowly (slower still under reduced motion), through
 *     the arm's own spring: no breathing with every swing. Mouse look turns the camera as
 *     ever; the fit only changes how far back it sits. On a portrait screen the fit never
 *     sits further back than the roomy distance the sides are scored for.
 *   - The look point splits the angles down to each fighter, and a big height gap widens the
 *     FOV a little. Both take each fighter at a steadied height (a dead band, then a quick
 *     ease), so a hop or a flyer's bob doesn't move the shot; the fit takes them as they are.
 *   - A wall closer than the shortest two-shot arm pulls the arm in further at once (never
 *     inside a tower), and while one holds it short the side is re-picked and the camera climbs.
 *   - Pitch stays low (16°, easing up to 23° at most when boxed in) so the city stays behind
 *     the fighters. The arm shortens (never under 280) rather than climbing to a top-down
 *     view, and the shader fades a corner tower in the way.
 *
 * Pure: no three.js or React, nothing allocates per frame. Unit tested in chase.test.ts.
 */
import type { Vec3, Zone } from "@wgp/game-core/sim3d/contract";

import { TravelFraming, guardEdges } from "./framing";
import { Smoothed, SmoothedVec3, angleDelta, type MutableVec3 } from "./springs";

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
  /** Arm pitch above the horizon at rest (radians): positive puts the camera above the hero. */
  pitch: 0.2,
  /** Auto-pitch: radians per unit/s of filtered fall (falling looks further down), and its limits. */
  pitchPerFall: 0.00016,
  pitchFallMax: 0.18,
  pitchRiseMax: 0.08,
  /** Pivot height above the hero's centre, as a share of the arm (so a short arm frames the hero the same way). */
  pivotLift: 0.086,
  /** The look point sits this share of the arm above the hero: the hero lands in the lower-middle third. */
  frameLift: 0.12,
  /** Travel heading: two low-pass stages on the horizontal velocity (s each), and the speed below which it holds. */
  headingTime: 0.6,
  minHeadingSpeed: 120,
  /** Auto-follow: start turning past the dead zone, stop inside the settle angle (radians). */
  followDeadZone: 0.35,
  followSettle: 0.07,
  /** The yaw spring (s; critically damped, so turns ease in and out without overshoot) and its rate cap (rad/s). */
  followYawTime: 0.45,
  followMaxRate: Math.PI / 2,
  /** Auto-follow waits this long after the last manual look or steer (s), then eases back in over `manualEaseIn`. */
  manualHold: 2,
  manualEaseIn: 1,
  /** A stick past `steerMin` whose forward share is under `steerForward` counts as steering by hand. */
  steerMin: 0.2,
  steerForward: 0.8,
  /** Pivot springs (s): horizontal and vertical; and the vertical dead band (share of the arm: 50 at rest). */
  followTime: 0.2,
  followTimeY: 0.4,
  yDeadBand: 0.12,
  /** The most the springs may lag behind their goal, as shares of the arm: sideways (capped in units) and vertically. */
  lagArm: 0.22,
  lagMax: 90,
  lagArmY: 0.09,
  /** Look-ahead along the filtered velocity (s), its cap (share of the arm) and how fast it settles (s). */
  lookAhead: 0.25,
  lookAheadMax: 0.4,
  lookAheadTime: 0.5,
  /** How far the look point leans toward the web anchor (0–1), eased in and out (s). */
  anchorPull: 0.1,
  anchorTime: 0.6,
  /** Look-point springs (s): horizontal, vertical. */
  targetTime: 0.18,
  targetTimeY: 0.3,
  /** Low-pass on the speed that drives distance and FOV (s), and the distance, FOV and pitch springs (s). */
  speedTime: 0.5,
  distTime: 0.8,
  fovTime: 0.8,
  pitchTime: 0.6,
  /** Collision: ease in (s; the shader fades a wall the camera is still behind), hold once clear (s), ease out (s). */
  armInTime: 0.08,
  armHold: 0.35,
  armOutTime: 0.5,
  /**
   * On a wall (free roam's climb, hang and mantle): the arm at most this long and pitched this
   * little above the hero, so the climber fills the frame from behind with the wall above him,
   * and the camera stays in the street rather than climbing over the buildings across it.
   */
  wallDist: 300,
  wallPitch: 0.07,
  /** Shortest arm a collision can force (travel, arenas), and the gap kept from what the ray hit. */
  minArm: 120,
  arenaMinArm: 280,
  probePad: 24,
  /** The camera never goes below this height (the street is y = 0). */
  minCameraY: 18,
  /** Manual pitch: the spring back to the automatic pitch (s), and the limits. */
  orbitRecenterTime: 0.6,
  pitchMin: -0.25,
  pitchMax: 1.25,
  /** Arena two-shot: angles off the fighters' line to try (radians), distance range, pitch and its cap. */
  arenaSides: [1.15, 0.8, 0.5] as readonly number[],
  arenaMinDist: 400,
  arenaMaxDist: 1100,
  /** The least room a side is scored for (the fit itself may ask for less). */
  arenaRoomMin: 460,
  /** The two-shot fit: each fighter's half extent (a body, a glider, a reaching arm), and the share of the half frame both stay inside, across and up-down (the HUD sits at the edges). */
  arenaBody: 60,
  arenaSafeX: 0.66,
  arenaSafeY: 0.58,
  /** The fit's low-pass (s): widening, tightening, and tightening under reduced motion; and the arm's spring when a two-shot widens (s). */
  arenaFitOut: 0.2,
  arenaFitIn: 1.4,
  arenaFitInSteady: 2.6,
  arenaDistOutTime: 0.5,
  /** The fit also takes both fighters this far ahead along their velocities (s), but never more than `arenaLeadMax` units ahead. */
  arenaLead: 0.25,
  arenaLeadMax: 140,
  /** Extra vertical FOV (degrees) when the fighters are far apart in height, or the arm is boxed in (not under reduced motion). */
  arenaFovBoost: 8,
  arenaPitch: 0.28,
  arenaPitchMax: 0.4,
  /** The boxed-in climb's spring (s). */
  arenaClimbTime: 0.35,
  /** Margin inside the arena bounds, how far past them the camera may go, and how often to re-pick a side (s). */
  arenaMargin: 30,
  arenaSlack: 260,
  arenaPickEvery: 0.25,
  /** The fighters' line is low-passed (s) and holds while they are closer than this (units). */
  arenaLineTime: 0.5,
  arenaLineMin: 160,
  /** The arena's yaw: dead zone, settle (radians), spring (s) and rate cap (rad/s). */
  arenaDeadZone: 0.08,
  arenaSettle: 0.03,
  arenaYawTime: 0.35,
  arenaMaxRate: 2,
  /**
   * The two-shot frames each fighter at a steadied height: a hop or a flyer's bob inside this
   * dead band (units) moves nothing; past it, the height eases in over `arenaYTime` (s), or
   * `arenaYTimeSteady` under reduced motion or the steady camera.
   */
  arenaYBand: 50,
  arenaYTime: 0.15,
  arenaYTimeSteady: 0.45,
  /** In an arena a wall may pull the arm in this close (under `arenaMinArm`) rather than leave the camera inside it. */
  arenaWallArm: 180,
  /** Held short by a wall: how much of the climb to `arenaPitchMax` to take (0–1), and the most extra FOV (degrees; never under reduced motion). */
  arenaBoxedClimb: 0.5,
  arenaSqueeze: 14,
};

export type ChaseTuning = typeof CHASE_TUNING;

/** A ray cast against the city: distance to the first solid along `dir` (unit), or null. */
export type Raycast = (origin: Vec3, dir: Vec3, maxDist: number) => number | null;

export interface ChaseInput {
  hero: Vec3;
  vel: Vec3;
  anchor: Vec3 | null;
  /** The hero's facing (unit xz), for the first view when the run starts standing still. */
  facing: Vec3 | null;
  /** The other fighter for the arena two-shot, or null outside fights; and its velocity, when the frame has it. */
  rival: Vec3 | null;
  rivalVel: Vec3 | null;
  /** The arena the two-shot stays near. */
  arena: Zone["bounds"] | null;
  /** Manual orbit this frame (radians, from mouse look or drag deltas) and whether a pointer is down. */
  orbitYaw: number;
  orbitPitch: number;
  orbiting: boolean;
  /** The player's camera-relative stick (x right, y forward), or null (the autopilot). */
  steer: { x: number; y: number } | null;
  /** Viewport width / height. */
  aspect: number;
  reducedMotion: boolean;
  /** Travel: where the hero is headed (the next stop), and whether he stands or runs on something. */
  goal?: Vec3 | null;
  grounded?: boolean;
  /**
   * The travel shots (framing.ts), on unless this is false: off for a fight's encounter, its
   * end and a knockout, which keep the plain chase (the fight camera's to frame).
   */
  framing?: boolean;
  /** Free roam: the hero is on a wall (climbing, hanging, mantling); its velocity is the way into it. */
  wall?: boolean;
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
  /** The ground heading the stick is resolved against while it's held on a roof (a unit xz vector), or null for the view's. */
  steer?: { fx: number; fz: number } | null;
}

export function createChaseInput(): ChaseInput {
  return {
    hero: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    anchor: null,
    facing: null,
    rival: null,
    rivalVel: null,
    arena: null,
    orbitYaw: 0,
    orbitPitch: 0,
    orbiting: false,
    steer: null,
    aspect: 16 / 9,
    reducedMotion: false,
    goal: null,
    grounded: false,
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Two-shot candidates: either fighter's side of the line, either way round it. */
const BASES = [0, Math.PI] as const;
const SIGNS = [1, -1] as const;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Share of a first-order low-pass with time constant `tau` to take in a step of `dt`. */
const lowPass = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-3, tau));

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

/** Whether a camera-relative stick steers anything but straight ahead. */
export function steersByHand(steer: { x: number; y: number } | null, t: ChaseTuning = CHASE_TUNING): boolean {
  if (!steer) return false;
  const mag = Math.sqrt(steer.x * steer.x + steer.y * steer.y);
  return mag > t.steerMin && steer.y < t.steerForward * mag;
}

/**
 * The two-shot's arm: the shortest distance from `pivot` (back along `yaw`, up by `pitch`)
 * at which both fighters, each `arenaBody` round, sit inside the safe frame: across, each
 * within `arenaSafeX` of the half width of the view centred on the pivot; up and down, the
 * pair's angular spread within `arenaSafeY` of the half height (the look point centres that
 * spread). Perspective is exact: the nearer fighter counts bigger. Capped at `arenaMaxDist`.
 */
export function arenaFit(a: Vec3, b: Vec3, pivot: Vec3, yaw: number, pitch: number, fov: number, aspect: number, t: ChaseTuning = CHASE_TUNING): number {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const tanV = Math.tan((clamp(fov, 10, 150) * Math.PI) / 360);
  const tanX = tanV * Math.max(0.1, aspect) * t.arenaSafeX;
  const tanY = tanV * t.arenaSafeY;
  const r = t.arenaBody;
  // Each fighter against the arm (toward the camera), the view's right and its up.
  const ax = a.x - pivot.x;
  const ay = a.y - pivot.y;
  const az = a.z - pivot.z;
  const bx = b.x - pivot.x;
  const by = b.y - pivot.y;
  const bz = b.z - pivot.z;
  const depthA = -sy * cp * ax + sp * ay - cy * cp * az;
  const depthB = -sy * cp * bx + sp * by - cy * cp * bz;
  const latA = Math.abs(-cy * ax + sy * az);
  const latB = Math.abs(-cy * bx + sy * bz);
  const upA = sy * sp * ax + cp * ay + cy * sp * az;
  const upB = sy * sp * bx + cp * by + cy * sp * bz;
  // Across is linear in the distance.
  let lo = Math.max(depthA + (latA + r) / tanX, depthB + (latB + r) / tanX, 1);
  const hi = t.arenaMaxDist;
  if (!(lo < hi)) return hi;
  const fits = (d: number) => {
    const za = d - depthA;
    const zb = d - depthB;
    if (za < 1 || zb < 1) return false;
    const top = Math.max(Math.atan2(upA + r, za), Math.atan2(upB + r, zb));
    const bottom = Math.min(Math.atan2(upA - r, za), Math.atan2(upB - r, zb));
    return Math.tan((top - bottom) / 2) <= tanY;
  };
  if (fits(lo)) return lo;
  if (!fits(hi)) return hi;
  // Up and down: bisect (the spread shrinks as the arm grows).
  let up = hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + up) / 2;
    if (fits(mid)) up = mid;
    else lo = mid;
  }
  return up;
}

export class ChaseCamera {
  readonly pose: ChasePose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: CHASE_TUNING.fovSlow, arm: 0, want: 0, yaw: 0 };
  /** The yaw, unwrapped (a spring needs continuity). */
  private readonly yawS = new Smoothed();
  private following = false;
  private travelYaw = 0;
  /** The two low-pass stages of the horizontal velocity. */
  private readonly h1 = { x: 0, z: 0 };
  private readonly h2 = { x: 0, z: 0 };
  private speedAvg = 0;
  private vyAvg = 0;
  private sinceManual = Infinity;
  private readonly pitch = new Smoothed(CHASE_TUNING.pitch);
  private readonly manualPitch = new Smoothed();
  /** The extra pitch a boxed-in two-shot climbs by. */
  private readonly climb = new Smoothed();
  private readonly dist = new Smoothed(CHASE_TUNING.distSlow);
  private readonly fov = new Smoothed(CHASE_TUNING.fovSlow);
  private readonly arm = new Smoothed(CHASE_TUNING.distSlow);
  private clearFor = 0;
  private restY = 0;
  private readonly pivot = new SmoothedVec3();
  private readonly look = new SmoothedVec3();
  private readonly lead = new SmoothedVec3();
  private readonly lean = new SmoothedVec3();
  private arenaYaw = 0;
  private arenaLine = 0;
  private readonly sepAvg = { x: 0, z: 0 };
  private arenaPickIn = 0;
  /** The two-shot fit, low-passed (widening fast, tightening slowly). */
  private fitAvg = 0;
  /** Each fighter's steadied height for the two-shot: the dead band's rest, and the eased value. */
  private readonly heroRestY = { rest: 0, y: 0 };
  private readonly rivalRestY = { rest: 0, y: 0 };
  private readonly heroSteady: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly rivalSteady: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** In an arena, a wall held the arm short of the two-shot last frame. */
  private boxed = false;
  private inArena = false;
  private started = false;
  /** The travel shots (standing, the lean toward the stop, the held steering, collision). */
  readonly travel = new TravelFraming();
  // Scratch.
  private readonly pivotWant: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly lookWant: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly leadWant: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly leanWant: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly pivotNow: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly probe: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly leadNow: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly leanNow: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly dir: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly ahead: [MutableVec3, MutableVec3] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];
  private readonly travelBase = { dist: 0, pitch: 0, deadZone: 0, settle: 0, yawTime: 0, maxRate: 0, fov: 0, pivotLift: CHASE_TUNING.pivotLift, frameLift: CHASE_TUNING.frameLift };

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
    this.travel.reset();
  }

  update(input: ChaseInput, dt: number): ChasePose {
    const t = this.tuning;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const { hero, vel } = input;
    const first = !this.started;

    // The travel heading: horizontal velocity through two low-pass stages.
    if (first) {
      this.h1.x = this.h2.x = vel.x;
      this.h1.z = this.h2.z = vel.z;
      this.speedAvg = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      this.vyAvg = vel.y;
    } else {
      const k = lowPass(step, t.headingTime);
      this.h1.x += (vel.x - this.h1.x) * k;
      this.h1.z += (vel.z - this.h1.z) * k;
      this.h2.x += (this.h1.x - this.h2.x) * k;
      this.h2.z += (this.h1.z - this.h2.z) * k;
      const ks = lowPass(step, t.speedTime);
      this.speedAvg += (Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) - this.speedAvg) * ks;
      this.vyAvg += (vel.y - this.vyAvg) * ks;
    }
    const hs = Math.sqrt(this.h2.x * this.h2.x + this.h2.z * this.h2.z);
    if (hs > t.minHeadingSpeed) this.travelYaw = Math.atan2(this.h2.x, this.h2.z);
    else if (first) this.travelYaw = hs > 1e-3 ? Math.atan2(this.h2.x, this.h2.z) : input.facing ? Math.atan2(input.facing.x, input.facing.z) : this.travelYaw;

    // Manual control: looking or steering by hand holds auto-follow off for a while.
    const moved = input.orbitYaw !== 0 || input.orbitPitch !== 0;
    if (moved || input.orbiting || this.travel.manualSteer(steersByHand(input.steer, t), !!input.grounded, !!(input.rival && input.arena) || input.framing === false)) this.sinceManual = 0;
    else this.sinceManual += step;
    const auto = smoothstep(t.manualHold, t.manualHold + t.manualEaseIn, this.sinceManual);

    // Arena two-shot or travel.
    const arena = input.rival && input.arena ? input.arena : null;
    const shots = !arena && input.framing !== false;
    let yawTarget = this.travelYaw;
    let distWant = chaseDistance(this.speedAvg, t);
    let pitchWant = t.pitch + clamp(-this.vyAvg * t.pitchPerFall, -t.pitchRiseMax, t.pitchFallMax);
    // On a wall: close behind the climber, nearly level (tuning.wallDist, wallPitch).
    if (input.wall) {
      distWant = Math.min(distWant, t.wallDist);
      pitchWant = t.wallPitch;
    }
    let focusY = hero.y;
    let fovBoost = 0;
    let roomWant = distWant;
    if (arena && input.rival) {
      // Both fighters at steadied heights (a hop, a bob, a step: nothing; a climb or a dive eases in).
      const fresh = !this.inArena || first;
      const yTime = input.reducedMotion ? t.arenaYTimeSteady : t.arenaYTime;
      const hs0 = steadyY(this.heroRestY, hero.y, fresh, t.arenaYBand, lowPass(step, yTime));
      const rs0 = steadyY(this.rivalRestY, input.rival.y, fresh, t.arenaYBand, lowPass(step, yTime));
      const heroS = this.heroSteady;
      heroS.x = hero.x;
      heroS.y = hs0;
      heroS.z = hero.z;
      const r = this.rivalSteady;
      r.x = input.rival.x;
      r.y = rs0;
      r.z = input.rival.z;
      const dx = r.x - hero.x;
      const dy = r.y - heroS.y;
      const dz = r.z - hero.z;
      // Vertical separation counts more: the view is wider than it is tall. The sides are
      // scored for this much room (more than the fit asks), so the arm has some to spare.
      roomWant = clamp(Math.sqrt(dx * dx + dz * dz + dy * dy * 2.4) * 1.05 + 330, t.arenaRoomMin, t.arenaMaxDist);
      if (!input.reducedMotion) fovBoost = clamp((Math.abs(dy) - 200) / 400, 0, 1) * t.arenaFovBoost;
      pitchWant = t.arenaPitch;
      this.pivotWant.x = (hero.x + r.x) / 2;
      this.pivotWant.z = (hero.z + r.z) / 2;
      focusY = (heroS.y + r.y) / 2;
      // The arm that fits both, seen the way the camera looks now (the player's own look included).
      const o = this.probe;
      o.x = this.pivotWant.x;
      o.y = focusY + t.pivotLift * (this.started ? this.arm.value : t.arenaMinDist);
      o.z = this.pivotWant.z;
      const fitYaw = this.started ? this.yawS.value : this.travelYaw;
      const fitPitch = this.started ? this.pitch.value + this.manualPitch.value : t.arenaPitch;
      const fitFov = this.started ? this.fov.value : chaseFov(this.speedAvg, input.aspect, input.reducedMotion, t);
      // Where both will be a moment from now counts too, so the shot widens before a fighter leaves it.
      // The fit takes them where they really are (and a moment on), so a dive or a climb still fits.
      const ahead = this.ahead;
      leadInto(ahead[0], hero, vel, t);
      leadInto(ahead[1], input.rival, input.rivalVel, t);
      const fit = Math.max(
        arenaFit(hero, input.rival, o, fitYaw, fitPitch, fitFov, input.aspect, t),
        arenaFit(ahead[0], ahead[1], o, fitYaw, fitPitch, fitFov, input.aspect, t),
      );
      if (!this.inArena || first) this.fitAvg = fit;
      else this.fitAvg += (fit - this.fitAvg) * lowPass(step, fit > this.fitAvg ? t.arenaFitOut : input.reducedMotion ? t.arenaFitInSteady : t.arenaFitIn);
      // A portrait screen is narrow: the fit would back right off for a pair side by side.
      // There it never sits further back than the roomier distance the sides are scored for.
      const portrait = clamp((1 - input.aspect) / 0.55, 0, 1);
      distWant = clamp(Math.min(this.fitAvg, lerp(t.arenaMaxDist, roomWant, portrait)), t.arenaMinDist, t.arenaMaxDist);
      // The fighters' line, low-passed and held while they're close (it spins when they swap sides).
      if (!this.inArena || first) {
        this.sepAvg.x = dx;
        this.sepAvg.z = dz;
        this.arenaLine = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz) : this.travelYaw;
        this.arenaYaw = this.started ? wrapAngle(this.yawS.value) : this.travelYaw;
        this.arenaPickIn = 0;
      } else {
        const k = lowPass(step, t.arenaLineTime);
        this.sepAvg.x += (dx - this.sepAvg.x) * k;
        this.sepAvg.z += (dz - this.sepAvg.z) * k;
      }
      if (Math.hypot(this.sepAvg.x, this.sepAvg.z) > t.arenaLineMin) this.arenaLine = Math.atan2(this.sepAvg.x, this.sepAvg.z);
      const line = this.arenaLine;
      this.arenaPickIn -= step;
      this.arenaYaw = this.trackSide(line, this.arenaYaw);
      if (this.arenaPickIn <= 0) {
        this.arenaPickIn = t.arenaPickEvery;
        this.arenaYaw = this.pickSide(line, arena, focusY, roomWant);
      }
      yawTarget = this.arenaYaw;
    } else {
      // Travel: the shot (framing.ts) over the chase's own heading, distance, pitch and FOV.
      const b = this.travelBase;
      b.dist = distWant;
      b.pitch = pitchWant;
      b.deadZone = t.followDeadZone;
      b.settle = t.followSettle;
      b.yawTime = t.followYawTime;
      b.maxRate = t.followMaxRate;
      b.fov = this.started ? this.fov.value : t.fovSlow;
      const shot = shots ? this.travel.update(input, this.travelYaw, this.speedAvg, clamp((this.speedAvg - t.speedSlow) / (t.speedFast - t.speedSlow), 0, 1), b, this.pose, step) : this.travel.plain(this.travelYaw, b);
      yawTarget = shot.yaw;
      distWant = shot.dist;
      pitchWant = shot.pitch;
      fovBoost = shot.fovKick;
      // Standing, the heading is wherever the camera looks, so moving off starts from there.
      if (shot.stand > 0.5 && this.started) this.travelYaw = wrapAngle(this.yawS.value);
      // The shoulder: the pivot sits right of the hero across the view, (−cos, sin) of the yaw.
      const yawNow = this.started ? this.yawS.value : yawTarget;
      this.pivotWant.x = hero.x - Math.cos(yawNow) * shot.side;
      this.pivotWant.z = hero.z + Math.sin(yawNow) * shot.side;
    }
    this.inArena = !!arena;

    // The pivot's height: a dead band, then a soft spring.
    const band = t.yDeadBand * (this.started ? this.arm.value : distWant);
    if (first) this.restY = focusY;
    else if (focusY > this.restY + band) this.restY = focusY - band;
    else if (focusY < this.restY - band) this.restY = focusY + band;
    const lift = t.pivotLift * (this.started ? this.arm.value : distWant);
    this.pivotWant.y = this.restY + lift;

    const fovWant = chaseFov(this.speedAvg, input.aspect, input.reducedMotion, t) + fovBoost;

    if (first) {
      this.started = true;
      this.yawS.snap(yawTarget);
      this.following = false;
      this.pitch.snap(pitchWant);
      this.manualPitch.snap(0);
      this.dist.snap(distWant);
      this.fov.snap(fovWant);
      this.arm.snap(distWant);
      this.clearFor = t.armHold;
      this.pivot.snap(this.pivotWant);
      this.lead.snap({ x: 0, y: 0, z: 0 });
      this.lean.snap({ x: 0, y: 0, z: 0 });
      this.sinceManual = Infinity;
    }

    // Yaw: manual turns apply directly; auto-follow turns past a dead zone on a capped spring.
    const ys = this.yawS;
    const e = angleDelta(ys.value, yawTarget);
    const ts = this.travel.shot;
    const deadZone = arena ? t.arenaDeadZone : ts.deadZone;
    const settle = arena ? t.arenaSettle : ts.settle;
    const canFollow = !!arena || (hs > t.minHeadingSpeed && !ts.hold) || ts.follow;
    if (!this.following && Math.abs(e) > deadZone && canFollow) this.following = true;
    else if (this.following && (Math.abs(e) < settle || !canFollow)) this.following = false;
    // Not following, the goal is where the yaw is: a turn in progress comes to a soft stop.
    const before = ys.value;
    ys.step(before + (this.following ? e * auto : 0), arena ? t.arenaYawTime : ts.yawTime, step);
    const maxTurn = (arena ? t.arenaMaxRate : ts.maxRate) * step;
    if (Math.abs(ys.value - before) > maxTurn) {
      ys.value = before + Math.sign(ys.value - before) * maxTurn;
      ys.velocity = Math.sign(ys.velocity) * Math.min(Math.abs(ys.velocity), maxTurn / Math.max(step, 1e-6));
    }
    ys.value += input.orbitYaw;
    // Keep the unwrapped value near zero so precision never drifts.
    if (Math.abs(ys.value) > 64 * Math.PI) ys.value = wrapAngle(ys.value);
    const yaw = ys.value;

    // Pitch: automatic, plus a manual offset that eases back once auto-follow returns.
    if (moved) this.manualPitch.snap(clamp(this.manualPitch.value + input.orbitPitch, t.pitchMin - t.pitch, t.pitchMax - t.pitch));
    else if (this.sinceManual >= t.manualHold) this.manualPitch.step(0, t.orbitRecenterTime, step);
    let pitch = clamp(this.pitch.step(pitchWant, t.pitchTime, step) + this.manualPitch.value, t.pitchMin, t.pitchMax);
    // A two-shot widens on a quicker spring than it tightens (both critically damped).
    const want = this.dist.step(distWant, arena && distWant > this.dist.value ? t.arenaDistOutTime : t.distTime, step);
    const pivot = this.pivot.step(this.pivotWant, t.followTime, t.followTimeY, step, this.pivotNow);
    clampLag(this.pivot, pivot, this.pivotWant, Math.min(t.lagMax, t.lagArm * this.arm.value), t.lagArmY * this.arm.value);
    if (shots) {
      this.travel.tighten(this.pivot, pivot, this.pivotWant, yaw, Math.min(t.lagMax, t.lagArm * this.arm.value));
      this.travel.clearPivot(this.raycast, hero, pivot);
    }

    // Arenas: when the room behind is short, climb a little (never toward top-down) and let the
    // arm shorten. The climb eases in and out on its own spring: the room can change in a step
    // (a fighter crossing the arena's edge), and a step in pitch is a jolt.
    const slack = t.arenaSlack - t.arenaMargin;
    let climbWant = 0;
    if (arena) {
      this.dir.x = -Math.sin(yaw);
      this.dir.y = 0;
      this.dir.z = -Math.cos(yaw);
      const room = rayExit(pivot, this.dir, arena.x0 - slack, arena.x1 + slack, arena.z0 - slack, arena.z1 + slack);
      if (room < want * Math.cos(pitch)) climbWant = Math.max(0, Math.min(t.arenaPitchMax, Math.acos(clamp(room / want, 0, 1))) - pitch);
      // A wall held the arm short last frame: look for a side with room now, and climb over it meanwhile.
      if (this.boxed) {
        climbWant = Math.max(climbWant, t.arenaBoxedClimb * (t.arenaPitchMax - pitch));
        this.arenaPickIn = Math.min(this.arenaPickIn, 0);
      }
    }
    if (first) this.climb.snap(climbWant);
    pitch += Math.max(0, this.climb.step(climbWant, t.arenaClimbTime, step));
    // Travel: in a tight spot, climb for room rather than close right in on the hero.
    if (shots && !input.wall) pitch += this.travel.climbFor(this.raycast, pivot, yaw, pitch, want, t.probePad, step);

    // The arm points back along the yaw and up by the pitch.
    const cp = Math.cos(pitch);
    const d = this.dir;
    d.x = -Math.sin(yaw) * cp;
    d.y = Math.sin(pitch);
    d.z = -Math.cos(yaw) * cp;
    let reach = want;
    const minArm = arena ? t.arenaMinArm : t.minArm;
    if (arena) reach = Math.max(minArm, Math.min(reach, rayExit(pivot, d, arena.x0 - slack, arena.x1 + slack, arena.z0 - slack, arena.z1 + slack)));

    // Collision: ease in fast, hold a moment once clear, then ease back out.
    let limit = reach;
    const hit = this.raycast ? this.raycast(pivot, d, reach + t.probePad) : null;
    // In an arena a wall closer than the two-shot's shortest arm pulls it in further: never inside a tower.
    if (hit !== null && Number.isFinite(hit)) limit = Math.max(arena ? Math.min(minArm, Math.max(t.arenaWallArm, hit - t.probePad)) : minArm, Math.min(reach, hit - t.probePad));
    this.boxed = !!arena && limit < want - 40;
    // Travel: from the pivot cleared of the city, down to a floor (framing.ts).
    const room = shots ? this.travel.collide(this.raycast, pivot, d, reach, t.probePad, vel) : null;
    if (room !== null) limit = room;
    const armBefore = this.arm.value;
    if (limit < this.arm.value - 0.5) {
      this.clearFor = 0;
      this.arm.step(limit, t.armInTime, step);
    } else {
      this.clearFor += step;
      if (this.clearFor >= t.armHold) this.arm.step(limit, t.armOutTime, step);
      else this.arm.velocity = 0;
    }
    if (shots && !first) this.travel.capArm(this.arm, armBefore, step);
    // In an arena a wall cutting in shortens the arm at once (the spring eases it back out).
    const arm = Math.min(this.arm.value, reach, arena ? limit : Infinity);

    const p = this.pose;
    p.position.x = pivot.x + d.x * arm;
    p.position.y = Math.max(t.minCameraY, pivot.y + d.y * arm);
    p.position.z = pivot.z + d.z * arm;

    // The look point: ahead along the filtered velocity, leaning a little toward the web, above the hero.
    if (arena) {
      this.leadWant.x = this.leadWant.y = this.leadWant.z = 0;
    } else {
      const lead = Math.min(1, (t.lookAheadMax * arm) / Math.max(1e-3, hs * t.lookAhead));
      this.leadWant.x = this.h2.x * t.lookAhead * lead;
      this.leadWant.y = 0;
      this.leadWant.z = this.h2.z * t.lookAhead * lead;
    }
    const a = arena ? null : input.anchor;
    this.leanWant.x = a ? (a.x - hero.x) * t.anchorPull : 0;
    this.leanWant.y = a ? (a.y - hero.y) * t.anchorPull * 0.5 : 0;
    this.leanWant.z = a ? (a.z - hero.z) * t.anchorPull : 0;
    if (shots) this.travel.narrowAcross(this.leadWant, this.leanWant, yaw);
    const leadNow = this.lead.step(this.leadWant, t.lookAheadTime, t.lookAheadTime, step, this.leadNow);
    const leanNow = this.lean.step(this.leanWant, t.anchorTime, t.anchorTime, step, this.leanNow);
    this.lookWant.x = this.pivotWant.x + leadNow.x + leanNow.x;
    this.lookWant.y = this.restY + arm * t.frameLift + leanNow.y + (shots ? ts.raise : 0);
    this.lookWant.z = this.pivotWant.z + leadNow.z + leanNow.z;
    if (arena && input.rival) {
      // Two-shot: aim halfway between the angles down to each fighter, so the nearer one
      // (lower on screen from an over-the-shoulder angle) stays in frame with the other.
      const flat = Math.max(1, Math.hypot(this.lookWant.x - p.position.x, this.lookWant.z - p.position.z));
      this.lookWant.y = p.position.y - Math.tan((angleDown(p.position, this.heroSteady) + angleDown(p.position, this.rivalSteady)) / 2) * flat;
    }
    if (first) this.look.snap(this.lookWant);
    this.look.step(this.lookWant, t.targetTime, t.targetTimeY, step, p.target);
    clampLag(this.look, p.target, this.lookWant, Math.min(t.lagMax, t.lagArm * arm), t.lagArmY * arm);
    if (shots) {
      this.travel.tighten(this.look, p.target, this.lookWant, yaw, Math.min(t.lagMax, t.lagArm * arm));
      guardEdges(p.position, p.target, hero, this.fov.value);
    }
    // Boxed in (the arm well short of what the two-shot wants): widen a little instead.
    const squeeze = arena && !input.reducedMotion ? clamp((want - arm) / want, 0, 0.5) * 2 * t.arenaSqueeze : 0;
    p.fov = this.fov.step(fovWant + squeeze, t.fovTime, step);
    p.arm = arm;
    p.want = want;
    p.yaw = wrapAngle(yaw);
    p.steer = shots ? this.travel.steerView() : null;
    return p;
  }

  /** The two-shot candidate yaw nearest `prev`, for the fighters' line now (tracks the line as it turns). */
  private trackSide(line: number, prev: number): number {
    let best = prev;
    let bestD = Infinity;
    for (const side of this.tuning.arenaSides) {
      for (const base of BASES) {
        for (const s of SIGNS) {
          const c = line + base + s * side;
          const dd = Math.abs(angleDelta(prev, c));
          if (dd < bestD) {
            bestD = dd;
            best = c;
          }
        }
      }
    }
    return wrapAngle(best);
  }

  /**
   * Score every two-shot side for the room behind it (arena bounds plus slack, buildings),
   * preferring side-on views, then little turning, then the current side.
   */
  private pickSide(line: number, arena: NonNullable<ChaseInput["arena"]>, focusY: number, want: number): number {
    const t = this.tuning;
    const slack = t.arenaSlack - t.arenaMargin;
    const o = this.probe;
    o.x = this.pivotWant.x;
    o.y = focusY + t.pivotLift * want;
    o.z = this.pivotWant.z;
    const cp = Math.cos(t.arenaPitch);
    const sp = Math.sin(t.arenaPitch);
    const widest = t.arenaSides[0] ?? 1;
    let best = this.arenaYaw;
    let bestScore = -Infinity;
    for (const side of t.arenaSides) {
      for (const base of BASES) {
        for (const s of SIGNS) {
          const c = line + base + s * side;
          const d = this.dir;
          d.x = -Math.sin(c);
          d.y = 0;
          d.z = -Math.cos(c);
          let room = rayExit(o, d, arena.x0 - slack, arena.x1 + slack, arena.z0 - slack, arena.z1 + slack) / cp;
          d.x *= cp;
          d.y = sp;
          d.z *= cp;
          const hit = this.raycast ? this.raycast(o, d, want + t.probePad) : null;
          if (hit !== null && Number.isFinite(hit)) room = Math.min(room, hit - t.probePad);
          const fit = clamp(room / want, 0, 1);
          const turn = Math.abs(angleDelta(this.yawS.value, c)) / Math.PI;
          const current = Math.abs(angleDelta(this.arenaYaw, c)) < 0.05 ? 0.4 : 0;
          const score = fit * 3 + (side / widest) * 0.3 - turn * 0.6 + current;
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
      }
    }
    return wrapAngle(best);
  }
}

/**
 * A fighter's steadied height: `s.rest` follows `y` only past `band` (a dead band), and `s.y`
 * eases toward it by `k` (a low-pass share). `reset` starts both at `y`.
 */
function steadyY(s: { rest: number; y: number }, y: number, reset: boolean, band: number, k: number): number {
  if (reset || !Number.isFinite(s.y)) {
    s.rest = y;
    s.y = y;
    return y;
  }
  if (y > s.rest + band) s.rest = y - band;
  else if (y < s.rest - band) s.rest = y + band;
  s.y += (s.rest - s.y) * k;
  return s.y;
}

/** Where a fighter will be `arenaLead` seconds on (at most `arenaLeadMax` away), into `out`. */
function leadInto(out: MutableVec3, p: Vec3, v: Vec3 | null, t: ChaseTuning): void {
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  if (!v) return;
  const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (!(sp > 1e-3) || !Number.isFinite(sp)) return;
  const k = Math.min(t.arenaLead, t.arenaLeadMax / sp);
  out.x += v.x * k;
  out.y += v.y * k;
  out.z += v.z * k;
}

/**
 * Keep a spring within `maxH` (horizontally) and `maxY` of where it's heading: at speed a
 * spring trails by speed × its time, which would let the hero slide out of the frame.
 */
function clampLag(spring: SmoothedVec3, now: MutableVec3, want: MutableVec3, maxH: number, maxY: number): void {
  const dx = now.x - want.x;
  const dz = now.z - want.z;
  const h = Math.sqrt(dx * dx + dz * dz);
  if (h > maxH) {
    const k = maxH / h;
    now.x = spring.x.value = want.x + dx * k;
    now.z = spring.z.value = want.z + dz * k;
  }
  const dy = now.y - want.y;
  if (Math.abs(dy) > maxY) now.y = spring.y.value = want.y + Math.sign(dy) * maxY;
}

/** How far below the horizontal `f` is, seen from `from` (radians). */
function angleDown(from: MutableVec3, f: Vec3): number {
  return Math.atan2(from.y - f.y, Math.max(1, Math.hypot(f.x - from.x, f.z - from.z)));
}

/** An angle in (−π, π]. */
function wrapAngle(a: number): number {
  return angleDelta(0, a);
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
