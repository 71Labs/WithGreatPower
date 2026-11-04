/**
 * The chase camera's travel shots (everything outside an arena): what chase.ts asks for
 * while the hero swings, runs or stands between stops.
 *
 * - Standing still on a roof: a calm, slightly raised 3/4 shot over the right shoulder,
 *   turned toward the next stop, so the hero stands left of centre and the stop (and its
 *   waypoint pin) shows beside him rather than behind his back. It eases in after a moment
 *   of standing and out as soon as he moves.
 * - Moving: the travel heading, leaning toward the next stop when it lies roughly ahead
 *   (more so on the last stretch, which reveals the stop on the way in); a little lower and
 *   further back at speed, with a short, subtle FOV kick when the speed jumps (a perfect
 *   release, a boost ring), never under reduced motion (the Steady camera).
 * - The follow dead zone scales with the screen: a phone held upright sees about 35° across,
 *   wider than the old 20° dead zone each way, so the camera now turns before the way ahead
 *   leaves the screen.
 * - Running on a roof with the stick held: the camera eases behind the run while the stick
 *   keeps the heading it was pushed with (`steerYaw`), so the camera never turns the steering
 *   under the thumb. Mouse look still steers; turning or letting go of the stick picks up the
 *   camera's heading again. In the air, steering by hand still holds the camera (chase.ts).
 * - Collision: the pivot first (from the hero, who is never inside a solid, out to it: a ray
 *   that starts inside a box misses it, so a lagging pivot cut into a wall let the old arm
 *   through), then the arm, which changes length no faster than `armRate` (the old 0.08 s
 *   snap was a pop and a jolt) and so starts in early, from where the pivot is about to be,
 *   down to a floor. In a tight spot the camera climbs a little for room instead of closing
 *   right in on the hero.
 * - Narrow screens (a phone upright): the hero stays near the middle across because the
 *   camera slides with him (the pivot and the look point trail him less across, the look-ahead
 *   and the lean toward the anchor shrink across), never because it turns to chase him. The
 *   standing shot looks more level, so the stop sits below the tall top HUD.
 *
 * Pure: no three.js or React, nothing allocates per frame. Unit tested in chase.test.ts.
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { Smoothed, angleDelta, type MutableVec3, type SmoothedVec3 } from "./springs";

export const TRAVEL_TUNING = {
  /** Standing: seconds of standing before the shot eases in, and its ease in and out (s). */
  standDelay: 0.45,
  standIn: 0.9,
  standOut: 0.45,
  /** Standing counts below this horizontal speed (units/s). */
  standSpeed: 40,
  /** The standing shot: arm, pitch (radians above the hero) and where the hero stands across (NDC, negative is left). */
  standDist: 400,
  standPitch: 0.3,
  standShoulder: -0.2,
  /** On a portrait screen the hero stands a little further out: the waypoint pin is about as wide as he is, and the frame is narrow. */
  standShoulderPortrait: -0.28,
  /**
   * On a portrait screen the top HUD stack hides the top third, where a far stop sits when the
   * camera looks down: standing there, the view looks down at most this much (radians), the
   * hero lower in the frame instead.
   */
  standViewPortrait: 0.12,
  /** The standing turn toward the stop: dead zone, settle (radians), spring (s), rate cap (rad/s). */
  standDeadZone: 0.06,
  standSettle: 0.02,
  standYawTime: 0.7,
  standMaxRate: 0.9,
  /** Moving: how far the yaw leans toward the next stop when it's within `goalCone` (radians) of the heading. */
  goalLean: 0.3,
  goalCone: 1.2,
  /** The last stretch: from `revealFar` units out the lean grows, reaching `revealLean` at `revealNear`. */
  revealFar: 1600,
  revealNear: 500,
  revealLean: 0.6,
  /** Lower at speed: the pitch drops by this much (radians) at the fast end. */
  pitchDropFast: 0.06,
  /** The FOV kick: degrees per unit/s of speed above its slow average (s), the cap (degrees) and its spring (s). */
  kickPerSpeed: 0.006,
  kickAverage: 1,
  kickMax: 3.5,
  kickTime: 0.25,
  /** The follow dead zone and settle as shares of the horizontal half FOV (whichever is smaller wins). */
  deadZoneShare: 0.45,
  settleShare: 0.1,
  /** Running with the stick held: the follow's spring (s) and cap (rad/s); it holds while the run heads back past `runCone` (radians). */
  runYawTime: 0.6,
  runMaxRate: 1.2,
  runCone: 2.1,
  /** The stick counts as turned past this (radians), which picks up the camera's heading again. */
  steerRelatch: 0.5,
  /**
   * The arm's length changes no faster than this (units/s). The old arm snapped in on a 0.08 s
   * spring when a wall cut across it: a pop, and a jolt in the view's pitch (most of the
   * swing's angular jerk). The city shader fades a wall the arm is still easing past.
   */
  armRate: 500,
  /**
   * So the capped arm starts in early: the wall is also looked for from where the pivot will
   * be this far ahead (s) along the hero's velocity, its vertical part weighted by `armAheadY`
   * (the pivot follows the hero's height softly, so a fall moves it less than the hero).
   */
  armAhead: 0.2,
  armAheadY: 0.5,
  /** Collision: the sphere's radius (the climb's probes, the pivot's) and the shortest arm. */
  probeRadius: 16,
  minArm: 110,
  /** Boxed in (the room under this share of the arm wanted): climb up to `climbMax` radians; the want is low-passed (s), then sprung (s). */
  climbBelow: 0.6,
  climbMax: 0.45,
  climbSmooth: 0.3,
  climbTime: 0.5,
  /**
   * Narrow screens (a phone upright sees about a third as far across as 16:9): the hero is kept
   * near the middle across by the camera sliding with him, not turning. `narrowRef` is the
   * tangent of a 16:9 screen's half width at 55° (the share is that over this screen's, never
   * under `narrowMin`); the lag the pivot and the look point may trail the hero by across, the
   * look-ahead and the lean toward the anchor across all shrink by it.
   */
  narrowRef: 0.925,
  narrowMin: 0.4,
  /**
   * The frame's top and bottom edges, a last-resort net (shares of the half height): past `edgeSoft`
   * the view tilts after the hero along a smooth curve, never letting him past `edgeHard`. Only
   * a dive while the arm is short ever reaches it.
   */
  edgeSoft: 0.88,
  edgeHard: 0.97,
};

export type TravelTuning = typeof TRAVEL_TUNING;

/** A ray cast against the city: distance to the first solid along `dir` (unit), or null. */
export type Cast = (origin: Vec3, dir: Vec3, maxDist: number) => number | null;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lowPass = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-3, tau));

/** Half the horizontal field of view (radians) for a vertical FOV (degrees) and aspect. */
export function halfWidth(fov: number, aspect: number): number {
  return Math.atan(Math.tan((clamp(fov, 10, 150) * Math.PI) / 360) * Math.max(0.1, aspect));
}

/** How much a screen is portrait, 0 (square or wider) to 1 (a tall phone). */
export const portraitShare = (aspect: number) => clamp((1 - aspect) / 0.55, 0, 1);

/**
 * How far a sphere of `radius` can travel from `origin` along `dir` (unit) before it touches
 * the city, approximated by five rays: the centre and four on a ring at `radius` around it,
 * square to `dir`. Null when nothing is within `maxDist`.
 */
export function sphereCast(cast: Cast, origin: Vec3, dir: Vec3, maxDist: number, radius: number, scratch: MutableVec3 = { x: 0, y: 0, z: 0 }): number | null {
  let best = cast(origin, dir, maxDist + radius);
  // A ring square to dir: u = dir × up (or across x when dir is vertical), v = dir × u.
  let ux = -dir.z;
  let uy = 0;
  let uz = dir.x;
  let ul = Math.sqrt(ux * ux + uz * uz);
  if (ul < 1e-6) {
    ux = 0;
    uy = dir.z;
    uz = -dir.y;
    ul = Math.sqrt(uy * uy + uz * uz) || 1;
  }
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = dir.y * uz - dir.z * uy;
  const vy = dir.z * ux - dir.x * uz;
  const vz = dir.x * uy - dir.y * ux;
  for (let i = 0; i < 4; i++) {
    const a = i === 0 ? 1 : i === 1 ? -1 : 0;
    const b = i === 2 ? 1 : i === 3 ? -1 : 0;
    scratch.x = origin.x + (ux * a + vx * b) * radius;
    scratch.y = origin.y + (uy * a + vy * b) * radius;
    scratch.z = origin.z + (uz * a + vz * b) * radius;
    const hit = cast(scratch, dir, maxDist + radius);
    // A ring ray that meets a wall within a couple of radii of where it starts is the sphere
    // already brushing that wall (the pivot beside the wall the hero swings along), not a wall
    // ahead: it would fold the arm onto the hero. The centre ray still counts it.
    if (hit !== null && Number.isFinite(hit) && hit > 2 * radius && (best === null || hit < best)) best = hit;
  }
  if (best === null || !Number.isFinite(best)) return null;
  // The rays stop at the surface: the sphere's centre stops a radius short of it.
  return Math.max(0, best - radius);
}

/** The bearing (atan2(x, z)) from one point to another, or null when one is above the other. */
export function bearing(from: Vec3, to: Vec3): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return dx * dx + dz * dz > 1 ? Math.atan2(dx, dz) : null;
}

/** What the travel shot asks of the chase this frame. */
export interface TravelShot {
  yaw: number;
  dist: number;
  pitch: number;
  /** How far the pivot sits right of the hero (units), for the shoulder shot. */
  side: number;
  /** Whether the yaw may follow while the travel heading is too slow to (the standing turn toward the stop). */
  follow: boolean;
  /** The run heads back toward the camera with the stick held: hold the yaw. */
  hold: boolean;
  deadZone: number;
  settle: number;
  yawTime: number;
  maxRate: number;
  /** Extra vertical FOV (degrees). */
  fovKick: number;
  /** 0 moving, 1 standing. */
  stand: number;
  /** Running on something with the stick held: the stick keeps its heading, the camera follows the run. */
  steering: boolean;
  /** How much the look point rises above the chase's (units): a phone's standing shot looks more level. */
  raise: number;
  /** How far this screen sees across against 16:9 (1 at 16:9 or wider). */
  narrow: number;
}

export interface TravelInput {
  hero: Vec3;
  vel: Vec3;
  grounded?: boolean;
  goal?: Vec3 | null;
  steer: { x: number; y: number } | null;
  /** Manual look this frame (radians). */
  orbitYaw: number;
  aspect: number;
  reducedMotion: boolean;
}

/** The chase's own values the travel shot starts from. */
export interface ChaseBase {
  dist: number;
  pitch: number;
  deadZone: number;
  settle: number;
  yawTime: number;
  maxRate: number;
  /** The camera's FOV now (degrees). */
  fov: number;
  /** The pivot's and the look point's heights above the hero, as shares of the arm. */
  pivotLift: number;
  frameLift: number;
}

/**
 * The state behind the travel shots: how much the hero is standing, the FOV kick, the climb
 * and the steering heading held for the stick.
 */
export class TravelFraming {
  readonly shot: TravelShot = { yaw: 0, dist: 0, pitch: 0, side: 0, follow: false, hold: false, deadZone: 0, settle: 0, yawTime: 0, maxRate: 0, fovKick: 0, stand: 0, steering: false, raise: 0, narrow: 1 };
  private readonly standS = new Smoothed();
  private stoodFor = 0;
  private readonly kick = new Smoothed();
  private slowSpeed = 0;
  private readonly climb = new Smoothed();
  private climbAvg = 0;
  /** The heading the stick is resolved against while held (radians), the stick's angle when it was taken, and whether it's held. */
  private steerYaw = 0;
  private steerAngle = 0;
  private steerHeld = false;
  private readonly steerOut = { fx: 0, fz: 1 };
  private started = false;
  // Scratch.
  private readonly ring: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly ahead: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly probeDir: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly up: MutableVec3 = { x: 0, y: 0, z: 0 };

  constructor(readonly tuning: TravelTuning = TRAVEL_TUNING) {}

  /** Start over (a cut). */
  reset(): void {
    this.started = false;
  }

  /**
   * Whether the stick counts as steering by hand (which holds the chase's auto-follow): in
   * the air or a fight, as ever; running on something in travel, no (the steering is held instead).
   */
  manualSteer(byHand: boolean, grounded: boolean, inArena: boolean): boolean {
    return byHand && (inArena || !grounded);
  }

  /**
   * The shot for this frame. `travelYaw` is the chase's travel heading, `speed` its filtered
   * speed and `share` where that sits between slow and fast; `view` the last frame's pose.
   */
  update(i: TravelInput, travelYaw: number, speed: number, share: number, base: ChaseBase, view: { position: Vec3; target: Vec3 }, dt: number): TravelShot {
    const t = this.tuning;
    const s = this.shot;
    const hs = Math.hypot(i.vel.x, i.vel.z);
    const first = !this.started;
    this.started = true;
    const held = stickHeld(i.steer);

    // Standing: still, on something, for a moment.
    const still = !!i.grounded && hs < t.standSpeed && !held;
    this.stoodFor = still ? this.stoodFor + dt : 0;
    const standWant = this.stoodFor >= t.standDelay || (first && still) ? 1 : 0;
    if (first) this.standS.snap(standWant);
    else this.standS.step(standWant, standWant > this.standS.value ? t.standIn : t.standOut, dt);
    const stand = clamp(this.standS.value, 0, 1);

    // The yaw: the travel heading, leaning toward the stop; standing, turned to face it.
    const goalYaw = i.goal ? bearing(i.hero, i.goal) : null;
    let yaw = travelYaw;
    if (goalYaw !== null && i.goal) {
      const off = angleDelta(travelYaw, goalYaw);
      const near = 1 - smoothstep(t.revealNear, t.revealFar, Math.hypot(i.goal.x - i.hero.x, i.goal.z - i.hero.z));
      const cone = 1 - smoothstep(t.goalCone * 0.6, t.goalCone, Math.abs(off));
      const lean = (t.goalLean + (t.revealLean - t.goalLean) * near) * cone;
      yaw = travelYaw + off * (lean + (1 - lean) * stand);
    }

    // Further back and lower at speed; nearer and a little higher standing.
    const dist = base.dist + (t.standDist - base.dist) * stand;
    const pitch = base.pitch - t.pitchDropFast * share * (1 - stand) + (t.standPitch - base.pitch) * stand;

    // The shoulder: the pivot moves right so the hero stands left of centre, by a share of the half width.
    const half = halfWidth(base.fov, i.aspect);
    const portrait = portraitShare(i.aspect);
    const ndc = t.standShoulder + (t.standShoulderPortrait - t.standShoulder) * portrait;
    const side = goalYaw === null ? 0 : -ndc * Math.tan(half) * dist * Math.cos(pitch) * stand;

    // A phone's standing shot: the look point rises until the view looks down no more than `standViewPortrait`.
    const camH = (base.pivotLift + Math.sin(pitch)) * dist;
    const flat = Math.cos(pitch) * dist;
    const raise = Math.max(0, camH - Math.tan(t.standViewPortrait) * flat - base.frameLift * dist) * stand * portrait;

    // The follow: dead zone and settle no wider than a share of the screen; standing, a calm turn to the stop.
    const deadZone = Math.min(base.deadZone, t.deadZoneShare * half);
    const settle = Math.min(base.settle, t.settleShare * half);

    // The stick's heading: taken from the view when the stick is pushed (or turned, or let go),
    // turned only by manual look while it's held.
    const viewYaw = Math.atan2(view.target.x - view.position.x, view.target.z - view.position.z);
    const steerAngle = held ? Math.atan2(i.steer!.x, i.steer!.y) : 0;
    if (first || !held || !this.steerHeld || Math.abs(angleDelta(this.steerAngle, steerAngle)) > t.steerRelatch) {
      this.steerYaw = Number.isFinite(viewYaw) ? viewYaw : travelYaw;
      this.steerAngle = steerAngle;
    } else this.steerYaw += i.orbitYaw;
    this.steerHeld = held;
    const steering = held && !!i.grounded;

    // The FOV kick: the speed against its slow average, only upward, never under reduced motion.
    this.slowSpeed = first ? speed : this.slowSpeed + (speed - this.slowSpeed) * lowPass(dt, t.kickAverage);
    const kickWant = i.reducedMotion ? 0 : clamp((speed - this.slowSpeed) * t.kickPerSpeed, 0, t.kickMax);
    if (first) this.kick.snap(kickWant);
    else this.kick.step(kickWant, t.kickTime, dt);

    s.yaw = yaw;
    s.dist = dist;
    s.pitch = pitch;
    s.side = side;
    s.stand = stand;
    s.follow = stand > 0.5 && goalYaw !== null;
    s.hold = steering && Math.abs(angleDelta(viewYaw, travelYaw)) > t.runCone;
    s.deadZone = deadZone + (t.standDeadZone - deadZone) * stand;
    s.settle = settle + (t.standSettle - settle) * stand;
    s.yawTime = steering ? t.runYawTime : base.yawTime + (t.standYawTime - base.yawTime) * stand;
    s.maxRate = steering ? t.runMaxRate : base.maxRate + (t.standMaxRate - base.maxRate) * stand;
    s.fovKick = i.reducedMotion ? 0 : Math.max(0, this.kick.value);
    s.steering = steering;
    s.raise = raise;
    s.narrow = clamp(Math.tan(half) / t.narrowRef, t.narrowMin, 1);
    return s;
  }

  /**
   * Narrow screens: squeeze how far a spring (the pivot's, the look point's) trails its goal
   * across the view (`yaw` the view's heading) to `leash` × the narrow share, along a smooth
   * curve (tanh: no corner where the old leash's clamp had one). Both trail together, so the
   * camera slides with the hero instead of turning to keep him in. In place; none at 16:9.
   */
  tighten(spring: SmoothedVec3, now: MutableVec3, want: Vec3, yaw: number, leash: number): void {
    const k = this.shot.narrow;
    if (k >= 0.999 || leash <= 0) return;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const lat = (now.x - want.x) * rx + (now.z - want.z) * rz;
    const room = leash * k;
    const move = room * Math.tanh(lat / room) - lat;
    now.x = spring.x.value = now.x + rx * move;
    now.z = spring.z.value = now.z + rz * move;
  }

  /**
   * Keep the arm's change this frame (from `before`) under `armRate`, along a smooth curve
   * (tanh), and its spring's velocity to match, so a capped pull-in doesn't overshoot after.
   */
  capArm(arm: Smoothed, before: number, dt: number): void {
    if (!(dt > 0)) return;
    const most = this.tuning.armRate * dt;
    const d = arm.value - before;
    if (Math.abs(d) <= most * 0.5) return;
    const capped = most * Math.tanh(d / most);
    arm.value = before + capped;
    arm.velocity = capped / dt;
  }

  /** Narrow screens: shrink the across-the-view part of each vector (the look-ahead, the lean toward the anchor) by the narrow share. */
  narrowAcross(a: MutableVec3, b: MutableVec3, yaw: number): void {
    const k = this.shot.narrow;
    if (k >= 0.999) return;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    for (const v of [a, b]) {
      const lat = v.x * rx + v.z * rz;
      v.x -= rx * lat * (1 - k);
      v.z -= rz * lat * (1 - k);
    }
  }

  /**
   * The plain chase's shot (the travel shots off: a fight's encounter, its end, a knockout):
   * the chase's own heading, distance, pitch and follow, nothing added. The travel state is
   * left as it was, so the shots ease back in afterwards rather than jump.
   */
  plain(travelYaw: number, base: ChaseBase): TravelShot {
    const s = this.shot;
    s.yaw = travelYaw;
    s.dist = base.dist;
    s.pitch = base.pitch;
    s.side = 0;
    s.follow = false;
    s.hold = false;
    s.deadZone = base.deadZone;
    s.settle = base.settle;
    s.yawTime = base.yawTime;
    s.maxRate = base.maxRate;
    s.fovKick = 0;
    s.stand = 0;
    s.steering = false;
    s.raise = 0;
    s.narrow = 1;
    this.steerHeld = false;
    // The plain chase doesn't climb: start the climb from nothing when the shots come back.
    this.climb.snap(0);
    this.climbAvg = 0;
    return s;
  }

  /** The heading the stick is resolved against while it's held (a unit xz vector), else null (the view's). */
  steerView(): { fx: number; fz: number } | null {
    if (!this.steerHeld) return null;
    this.steerOut.fx = Math.sin(this.steerYaw);
    this.steerOut.fz = Math.cos(this.steerYaw);
    return this.steerOut;
  }

  /**
   * Keep the pivot out of the city: from the hero (never inside a solid) out to `pivot`, a
   * sphere cast; past a hit the pivot is pulled back toward the hero. In place.
   */
  clearPivot(cast: Cast | null, hero: Vec3, pivot: MutableVec3): void {
    if (!cast) return;
    const t = this.tuning;
    const d = this.up;
    d.x = pivot.x - hero.x;
    d.y = pivot.y - hero.y;
    d.z = pivot.z - hero.z;
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (len < 1) return;
    d.x /= len;
    d.y /= len;
    d.z /= len;
    const hit = sphereCast(cast, hero, d, len, t.probeRadius * 0.5, this.ring);
    if (hit === null || hit >= len) return;
    pivot.x = hero.x + d.x * hit;
    pivot.y = hero.y + d.y * hit;
    pivot.z = hero.z + d.z * hit;
  }

  /**
   * How long the arm may be along `dir` (unit) from `pivot`, which the arm eases toward: rays
   * from the pivot now and from where it will be half and all of `armAhead` seconds on, kept
   * `pad` short of what they meet; never under `minArm` (shorter, the hero fills the frame: the
   * city shader fades the wall instead).
   */
  collide(cast: Cast | null, pivot: Vec3, dir: Vec3, reach: number, pad: number, vel: Vec3 | null = null): number {
    if (!cast) return reach;
    const t = this.tuning;
    const floor = Math.min(t.minArm, reach);
    const room = (o: Vec3) => {
      const hit = cast(o, dir, reach + pad);
      return hit === null || !Number.isFinite(hit) ? reach : clamp(hit - pad, floor, reach);
    };
    let limit = room(pivot);
    if (vel && t.armAhead > 0) {
      const a = this.ahead;
      for (const k of [0.5, 1]) {
        a.x = pivot.x + vel.x * t.armAhead * k;
        a.y = pivot.y + vel.y * t.armAhead * k * t.armAheadY;
        a.z = pivot.z + vel.z * t.armAhead * k;
        limit = Math.min(limit, room(a));
      }
    }
    return limit;
  }

  /**
   * In a tight spot (the room behind well short of the arm wanted), how much to climb: the
   * least of a few raised pitches that gives the arm its room, on its own spring.
   */
  climbFor(cast: Cast | null, pivot: Vec3, yaw: number, pitch: number, want: number, pad: number, dt: number): number {
    const t = this.tuning;
    let climbWant = 0;
    if (cast && want > 1) {
      const room = (p: number) => {
        const cp = Math.cos(p);
        const d = this.probeDir;
        d.x = -Math.sin(yaw) * cp;
        d.y = Math.sin(p);
        d.z = -Math.cos(yaw) * cp;
        const hit = sphereCast(cast, pivot, d, want + pad, t.probeRadius, this.ring);
        return hit === null ? want : Math.min(want, hit - pad);
      };
      let best = room(pitch);
      if (best < want * t.climbBelow) {
        for (const up of [0.15, 0.3, t.climbMax]) {
          const r = room(pitch + up);
          if (r > best + want * 0.1) {
            best = r;
            climbWant = up;
            if (r >= want * t.climbBelow) break;
          }
        }
      }
    }
    // The want steps between a few pitches: low-pass it first, so the climb never jolts.
    this.climbAvg += (climbWant - this.climbAvg) * lowPass(dt, t.climbSmooth);
    return Math.max(0, this.climb.step(this.climbAvg, t.climbTime, dt));
  }
}

/**
 * The last-resort net at the frame's top and bottom: once the hero sits past `edgeSoft` of the
 * half height, the view tilts toward him so he's squeezed (tanh, no corner) short of `edgeHard`.
 * Moves `target` up or down only.
 */
export function guardEdges(position: Vec3, target: MutableVec3, hero: Vec3, fov: number, t: TravelTuning = TRAVEL_TUNING): void {
  let fx = target.x - position.x;
  let fy = target.y - position.y;
  let fz = target.z - position.z;
  const flat = Math.hypot(fx, fz);
  const fl = Math.hypot(flat, fy);
  if (flat < 1e-3) return;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // Right = forward × up, up' = right × forward.
  const rl = Math.hypot(fz, fx);
  const rx = -fz / rl;
  const rz = fx / rl;
  const hx = hero.x - position.x;
  const hy = hero.y - position.y;
  const hz = hero.z - position.z;
  const depth = hx * fx + hy * fy + hz * fz;
  if (depth < 1) return;
  const tanV = Math.tan((fov * Math.PI) / 360);
  const y = (hx * -rz * fy + hy * (rz * fx - rx * fz) + hz * rx * fy) / (depth * tanV);
  const ay = Math.abs(y);
  if (ay <= t.edgeSoft) return;
  const room = t.edgeHard - t.edgeSoft;
  const want = Math.sign(y) * (t.edgeSoft + room * Math.tanh((ay - t.edgeSoft) / room));
  // Tilt the view by the difference in angle: down (further below the horizon) to lift a hero who sits too low.
  const down = Math.atan2(-fy, Math.hypot(fx, fz)) + Math.atan(want * tanV) - Math.atan(y * tanV);
  target.y = position.y - Math.tan(clamp(down, -1.4, 1.4)) * flat;
}

/** Whether the player is holding the stick past its dead zone. */
function stickHeld(steer: { x: number; y: number } | null): boolean {
  return !!steer && steer.x * steer.x + steer.y * steer.y > 0.04;
}
