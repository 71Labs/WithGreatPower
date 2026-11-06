/**
 * Free roam's wall moves for the hero, as roam-pose.ts draws them: the climb's holds and its
 * gait, and the measures of the body they're placed for.
 *
 * The climb is a real reach → pull → step cycle on holds planted on the facade: one hand
 * reaches to a hold above while the other three limbs hold, then the opposite foot steps up,
 * then the other hand, then the other foot. Climbing fast it's a scramble (each hand with its
 * opposite foot); sideways the lead hand and foot go first; climbing down the feet lead. The
 * cycle advances by the distance actually climbed along the wall, so a planted hand or foot
 * stays exactly on its hold (no sliding, no moonwalking); a limb caught mid-move when the body
 * stops finishes the move on its own, so at rest all four hold. Any hold the body has left
 * behind (a corner turned, a leap up the wall) is re-planted with a move of its own.
 *
 * Pure presentation (three.js math only, no rig): unit tested in wall-pose.test.ts.
 */
import { Vector3 } from "three";

import type { Rig } from "../rig";
import { UP } from "./common";

/** The body's measures the wall poses are placed for (world units). */
export interface WallBody {
  /** Shoulders above the hips, and out from the centre line. */
  shoulderY: number;
  shoulderX: number;
  /** Shoulder to wrist at full stretch, and the forearm. */
  reach: number;
  forearm: number;
  /** Hip to ankle at full stretch; the ankle above the sole; the hips above the soles standing. */
  leg: number;
  ankle: number;
  hipH: number;
  /** Ankle to the ball of the foot, along the foot. */
  foot: number;
  /** Wrist to the middle knuckle. */
  hand: number;
}

export function wallBody(rig: Rig): WallBody {
  const hips = rig.joints.get("hips")!;
  const arm = rig.joints.get("armL")!;
  const ankle = rig.joints.get("footL")!;
  const ball = rig.joints.get("ball_l");
  const wrist = rig.joints.get("handL")!;
  const knuckle = rig.joints.get("middle_01_l");
  return {
    shoulderY: arm.y - hips.y,
    shoulderX: Math.abs(arm.x),
    reach: rig.arms[0].l1 + rig.arms[0].l2,
    forearm: rig.arms[0].l2,
    leg: rig.legs[0].l1 + rig.legs[0].l2,
    ankle: rig.spec.ankle,
    hipH: rig.hipHeight,
    foot: ball ? Math.hypot(ball.x - ankle.x, ball.z - ankle.z) : rig.hipHeight * 0.13,
    hand: knuckle ? knuckle.distanceTo(wrist) : rig.hipHeight * 0.11,
  };
}

/** How the body sits on a wall it climbs (shares of the forearm, so any body fits). */
export const CLIMB = {
  /** The hips this far off the face, the shoulders this far (the chest about a forearm off it). */
  hipOff: 0.8,
  shoulderOff: 1.1,
  /** A planted wrist's gap to the face (the palm on it, fingers over the hold). */
  handGap: 3,
  /** The extra gap past the foot's length for a planted ankle (the ball of the foot on the face). */
  footGap: 0.8,
  /** How far a moving hand and foot come off the face mid-move. */
  handLift: 5,
  footLift: 6,
  /** A move takes at least this long, and is finished within this long even if the body stops (s). */
  moveMin: 0.07,
  moveMax: 0.26,
  /** Climbing faster than this (along the wall, smoothed) is a scramble; back under `slow` it's the climb again. */
  fast: 200,
  slow: 160,
} as const;

/** Limbs: left hand, right hand, left foot, right foot (the pose's hand[0], hand[1], foot[0], foot[1]). */
export const LH = 0;
export const RH = 1;
export const LF = 2;
export const RF = 3;

export type GaitMode = "up" | "fast" | "down" | "left" | "right";

/**
 * A gait: the body's travel along the wall per cycle (L), each limb's share of the cycle on
 * its hold (stance), and where in the cycle its move starts (offset).
 */
export interface Gait {
  L: number;
  stance: readonly [number, number, number, number];
  offset: readonly [number, number, number, number];
}

export const GAITS: Readonly<Record<GaitMode, Gait>> = {
  // Right hand, left foot, left hand, right foot: one limb at a time.
  up: { L: 44, stance: [0.75, 0.75, 0.68, 0.68], offset: [0.5, 0, 0.25, 0.75] },
  // A scramble: each hand with its opposite foot.
  fast: { L: 72, stance: [0.55, 0.55, 0.42, 0.42], offset: [0.5, 0, 0, 0.5] },
  // Feet first: left foot, right hand, right foot, left hand.
  down: { L: 40, stance: [0.75, 0.75, 0.7, 0.7], offset: [0.75, 0.25, 0, 0.5] },
  // Sideways toward his left: left hand, left foot, right hand, right foot (and mirrored).
  left: { L: 28, stance: [0.75, 0.75, 0.75, 0.75], offset: [0, 0.5, 0.25, 0.75] },
  right: { L: 28, stance: [0.75, 0.75, 0.75, 0.75], offset: [0.5, 0, 0.75, 0.25] },
};

/** The face the body is on: its outward normal, a point on it, its top; the body's frame against it. */
export class WallFrame {
  readonly n = new Vector3(0, 0, 1);
  /** Into the wall, and the body's left along it (UP × fwd). */
  readonly fwd = new Vector3(0, 0, -1);
  readonly left = new Vector3(-1, 0, 0);
  /** A point on the face. */
  readonly at = new Vector3();
  top = 0;

  set(nx: number, nz: number, on: Vector3, top: number): this {
    this.n.set(nx, 0, nz).normalize();
    this.fwd.copy(this.n).negate();
    this.left.crossVectors(UP, this.fwd).normalize();
    this.at.copy(on);
    this.top = top;
    return this;
  }

  /** How far `q` stands off the face (out is positive). */
  off(q: Vector3): number {
    return (q.x - this.at.x) * this.n.x + (q.z - this.at.z) * this.n.z;
  }

  /** `q` moved along the normal to stand `gap` off the face. */
  onto(q: Vector3, gap: number): Vector3 {
    return q.addScaledVector(this.n, gap - this.off(q));
  }

  /** The point `u` to the body's left and `y` up from `base`, `gap` off the face. */
  point(base: Vector3, u: number, y: number, gap: number, out: Vector3): Vector3 {
    out.copy(base).addScaledVector(this.left, u);
    out.y += y;
    return this.onto(out, gap);
  }
}

/** One limb on the wall: its hold, and the move to the next one. */
export class Hold {
  /** Where it holds (world), while planted. */
  readonly at = new Vector3();
  /** A move: from, to (followed as the body moves until it lands), and how far through (0–1). */
  readonly from = new Vector3();
  readonly to = new Vector3();
  moving = false;
  u = 0;
  /** Where the limb is drawn this frame. */
  readonly pos = new Vector3();
  /** How high off the face mid-move (0 planted … 1). */
  lift = 0;
  /** Moves made (for the holds' small irregularity) and the gait cycle last seen. */
  moves = 0;
  cycle = 0;
}

const ease = (u: number) => u * u * (3 - 2 * u);
const frac = (x: number) => x - Math.floor(x);
/** A small, repeatable irregularity for hold k's n-th placement (−1 … 1). */
const jitter = (k: number, n: number, salt: number) => frac(Math.sin(k * 12.9898 + n * 78.233 + salt * 37.719) * 43758.5453) * 2 - 1;

const _home = new Vector3();
const _p = new Vector3();

/**
 * The climb's holds and gait. step() takes the body's travel along the wall this frame (the
 * sim's own, measured from its drawn position) and places the four limbs: planted ones exactly
 * where they hold, moving ones on their way to the next hold.
 */
export class ClimbGait {
  readonly holds = [new Hold(), new Hold(), new Hold(), new Hold()];
  /** The gait's phase (cycles climbed), and the gait it's in. */
  phase = 0;
  mode: GaitMode = "up";
  /** The travel direction along the wall (u: toward his left, v: up), smoothed, and the speed along it. */
  readonly dir = { u: 0, v: 1 };
  speed = 0;
  private readonly travel = { u: 0, v: 0 };
  private started = false;

  constructor(private readonly body: WallBody) {}

  /** Start over: the next step places every hold fresh. */
  reset(): void {
    this.started = false;
    this.travel.u = this.travel.v = 0;
    this.dir.u = 0;
    this.dir.v = 1;
    this.speed = 0;
  }

  /** Whether each limb (LH, RH, LF, RF) is on its hold. */
  planted(): [boolean, boolean, boolean, boolean] {
    const h = this.holds;
    return [!h[0].moving, !h[1].moving, !h[2].moving, !h[3].moving];
  }

  /** A limb's home on the wall, from the hips (u to his left, y up). */
  home(k: number): { u: number; y: number } {
    const b = this.body;
    const s = k === LH || k === LF ? 1 : -1;
    if (k <= RH) return { u: s * (b.shoulderX + 3), y: b.shoulderY + 1.5 };
    return { u: s * 9.5, y: -b.leg * 0.585 };
  }

  /** A limb's gap to the face when planted (a wrist; an ankle, the ball of the foot on the face). */
  gap(k: number): number {
    return k <= RH ? CLIMB.handGap : this.body.foot + CLIMB.footGap;
  }

  /**
   * Where limb k lands on a move made now: its home, ahead along the travel by half its
   * stance (so the body passes over it mid-stance), a little irregular, on the face.
   */
  private landing(k: number, w: WallFrame, base: Vector3, n: number, out: Vector3): Vector3 {
    const g = GAITS[this.mode];
    const h = this.home(k);
    const ahead = g.stance[k] * g.L * 0.5;
    const ju = jitter(k, n, 1) * (k <= RH ? 2.5 : 2);
    const jv = jitter(k, n, 2) * (k <= RH ? 3 : 2.5);
    return w.point(base, h.u + this.dir.u * ahead + ju, h.y + this.dir.v * ahead + jv, this.gap(k), out);
  }

  /** How far a planted limb may sit from its home before it must move (a corner, a leap, a stall). */
  private reachOf(k: number): number {
    const g = GAITS[this.mode];
    return g.stance[k] * g.L * 0.5 + 6;
  }

  private startMove(k: number): void {
    const h = this.holds[k];
    h.from.copy(h.moving ? h.pos : h.at);
    h.moving = true;
    h.u = 0;
    h.moves += 1;
  }

  /**
   * One frame. `base`: the hips on the wall (without the drawn surge); `du`, `dv`: the body's
   * travel along the wall this frame (u toward his left, v up), in world units; `dt` seconds.
   */
  step(w: WallFrame, base: Vector3, du: number, dv: number, dt: number): void {
    const ds = Math.hypot(du, dv);
    const k = 1 - Math.exp(-dt / 0.12);
    this.speed += (ds / Math.max(dt, 1e-4) - this.speed) * k;
    if (ds > 1e-3) {
      // The travel, low-passed as a velocity (so a reversal passes through zero rather than
      // snapping back), and its direction from that.
      const kd = 1 - Math.exp(-dt / 0.08);
      const t = this.travel;
      t.u += (du / dt - t.u) * kd;
      t.v += (dv / dt - t.v) * kd;
      const l = Math.hypot(t.u, t.v);
      if (l > 1) {
        this.dir.u = t.u / l;
        this.dir.v = t.v / l;
      }
    }
    if (!this.started) {
      this.started = true;
      this.phase = 0;
      this.mode = this.pick(this.mode);
      this.placeAll(w, base);
      return;
    }
    // The gait: by the way he's going (only re-picked on the move, so a stop keeps it).
    if (ds > 0.05) {
      const mode = this.pick(this.mode);
      if (mode !== this.mode) {
        this.mode = mode;
        const g = GAITS[mode];
        for (let i = 0; i < 4; i++) this.holds[i].cycle = Math.floor(this.phase - g.offset[i]);
      }
    }
    const g = GAITS[this.mode];
    const dPhase = ds / g.L;
    this.phase += dPhase;
    for (let i = 0; i < 4; i++) {
      const h = this.holds[i];
      const c = Math.floor(this.phase - g.offset[i]);
      if (c > h.cycle) {
        h.cycle = c;
        if (h.moving) this.land(i, w, base);
        this.startMove(i);
      } else if (!h.moving) {
        // Left behind (a corner, a leap, a long stall in one gait): move it now.
        const home = this.home(i);
        w.point(base, home.u, home.y, this.gap(i), _home);
        if (h.at.distanceTo(_home) > this.reachOf(i) || Math.abs(w.off(h.at) - this.gap(i)) > 4) this.startMove(i);
      }
      if (h.moving) {
        const window = 1 - g.stance[i];
        h.u += Math.min(dt / CLIMB.moveMin, Math.max(dPhase / window, dt / CLIMB.moveMax));
        this.landing(i, w, base, h.moves, h.to);
        if (h.u >= 1) this.land(i, w, base);
        else {
          const e = ease(h.u);
          h.lift = Math.sin(Math.PI * h.u);
          h.pos.copy(h.from).lerp(h.to, e).addScaledVector(w.n, h.lift * (i <= RH ? CLIMB.handLift : CLIMB.footLift));
        }
      }
      if (!h.moving) {
        h.lift = 0;
        h.pos.copy(h.at);
      }
    }
  }

  private land(i: number, w: WallFrame, base: Vector3): void {
    const h = this.holds[i];
    this.landing(i, w, base, h.moves, h.at);
    h.moving = false;
    h.u = 0;
    h.lift = 0;
    h.pos.copy(h.at);
  }

  /**
   * Every limb where the phase says it is (a fresh climb): on its hold, as far through its
   * stance as the cycle has gone; or, in its move's share of the cycle, on the way from the hold
   * it's leaving (the low end of its stance) to the next.
   */
  private placeAll(w: WallFrame, base: Vector3): void {
    const g = GAITS[this.mode];
    for (let i = 0; i < 4; i++) {
      const h = this.holds[i];
      const p = frac(this.phase - g.offset[i]);
      const window = 1 - g.stance[i];
      const moving = p < window;
      const back = moving ? g.stance[i] * g.L : (p - window) * g.L;
      this.landing(i, w, base, h.moves, _p);
      h.at.copy(_p).addScaledVector(w.left, -this.dir.u * back);
      h.at.y -= this.dir.v * back;
      w.onto(h.at, this.gap(i));
      h.cycle = Math.floor(this.phase - g.offset[i]);
      h.lift = 0;
      h.pos.copy(h.at);
      h.moving = false;
      h.u = 0;
      if (moving) {
        // Mid-move: from that hold, as far along as the phase is into the move.
        this.startMove(i);
        h.u = p / window;
        this.landing(i, w, base, h.moves, h.to);
        h.lift = Math.sin(Math.PI * h.u);
        h.pos.copy(h.from).lerp(h.to, ease(h.u)).addScaledVector(w.n, h.lift * (i <= RH ? CLIMB.handLift : CLIMB.footLift));
      }
    }
  }

  private pick(was: GaitMode): GaitMode {
    const { u, v } = this.dir;
    if (Math.abs(u) > (was === "left" || was === "right" ? 0.6 : 0.8)) return u > 0 ? "left" : "right";
    if (v < (was === "down" ? -0.2 : -0.4)) return "down";
    return this.speed > (was === "fast" ? CLIMB.slow : CLIMB.fast) ? "fast" : "up";
  }
}
