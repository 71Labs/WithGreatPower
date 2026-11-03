/**
 * Standing still like a person, for the hero's lower body while the mocap idle moves the
 * rest of him:
 *
 * - Feet planted about hip-width apart, toes a little out. When the body turns, or stops
 *   mid-stride, small steps square them up under it: one foot at a time, the worse one
 *   first, never a stomp. Turning on the spot, the foot on the side of the turn opens first
 *   and each step turns at most STEP_TURN past the planted one, so a half turn is a few quick
 *   steps, never a spin on planted feet.
 * - Planted feet hold the pelvis: it turns at most HIP_TURN either side of a planted foot
 *   and never so far that a foot ends up across the body's midline (`clampYaw`); the torso
 *   and head lead the rest of the turn. A foot in the air is kept on its own side too.
 * - A pivot (a sharp start or a reversal): a short step plants the outer foot beside the
 *   hips (unless it's there already), then it turns where it stands while the body turns over
 *   it and the inner foot swings round with him to the new heading. The body is carried aside
 *   just enough (`shift`) that the pivot foot stays clear on its own side and never passes
 *   under him; if the sim runs him on out of its reach, the body waits for it a little and
 *   past that the foot skids after him. What's left of the carry fades as he runs on.
 * - Weight on one leg, drifting to the other every few seconds (contrapposto): the hips
 *   shift over the standing leg and tip up on its side, the free knee softens, and the
 *   shoulders tilt the other way. A step (or a pivot) puts the weight on the planted leg
 *   first, quickly.
 * - Glances: every few seconds the head turns a little somewhere else and back.
 */
import { Vector3 } from "three";

import { angleTo, clamp } from "./common";
import { Spring } from "../physics/spring";

const STEP_TIME = 0.32;
/** A step that turns the body (on the spot): quicker, and lifted a little higher. */
const TURN_STEP_TIME = 0.24;
const STEP_LIFT = 3.2;
/** After a stop the feet stay where the stride left them this long before squaring up (s). */
const SETTLE = 0.3;
/** The most a step turns a foot past the planted one (rad). */
const STEP_TURN = 1.25;
/** The most the pelvis turns past a planted foot (rad); the torso and head lead the rest. */
const HIP_TURN = 0.8;
/** Feet stay at least this far either side of the body's midline (units). */
const MIDLINE = 2.5;
/** A foot in the air keeps this far its own side: clear of the hips' sway over the other leg. */
const SWING_SIDE = 4.5;
/** A pivot's inner foot: how high it swings and how far ahead of the hips it lands. */
const PIVOT_LIFT = 5;
const PIVOT_AHEAD = 3;
/** The share of a pivot the outer foot takes to plant (when it has to step there first), and
 *  how far toward the new heading it plants (the body runs on over it). */
const PIVOT_PLANT = 0.3;
const PIVOT_LEAD = 4;
/** The pivot foot stays at least this far its own side of the body's centre line (units). */
const PIVOT_SIDE = 5;
/** The pivot foot reaches this far from under the hips; past it the body waits for it, up to
 *  PIVOT_LAG behind where the sim has him, and past that the foot skids after him. */
const PIVOT_REACH = 15;
const PIVOT_LAG = 12;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** The body's left (+x at yaw 0) and forward (+z) along the ground. */
const leftX = (yaw: number) => Math.cos(yaw);
const leftZ = (yaw: number) => -Math.sin(yaw);
const fwdX = (yaw: number) => Math.sin(yaw);
const fwdZ = (yaw: number) => Math.cos(yaw);

/** How far a point is to the body's left of its centre line (negative: to the right). */
function lateral(p: Vector3, body: Vector3, yaw: number): number {
  return (p.x - body.x) * leftX(yaw) + (p.z - body.z) * leftZ(yaw);
}

/**
 * From `a` toward `b` by `e` (0–1) round the body's centre `c` (on the ground): the angle and
 * the distance from the centre each eased, so a foot stepping round him sweeps an arc beside
 * him instead of cutting across under him. Straight across when either end is at the centre.
 */
function around(a: Vector3, b: Vector3, c: Vector3, e: number, out: Vector3): Vector3 {
  const ax = a.x - c.x;
  const az = a.z - c.z;
  const bx = b.x - c.x;
  const bz = b.z - c.z;
  const ra = Math.hypot(ax, az);
  const rb = Math.hypot(bx, bz);
  if (ra < 1 || rb < 1) return out.copy(a).lerp(b, e);
  const t0 = Math.atan2(az, ax);
  const t = t0 + angleTo(t0, Math.atan2(bz, bx)) * e;
  const r = ra + (rb - ra) * e;
  return out.set(c.x + Math.cos(t) * r, a.y + (b.y - a.y) * e, c.z + Math.sin(t) * r);
}

/** Push a point out to `min` on side `s` (+1 left, −1 right) of the body's centre line, if it's nearer. */
function keepSide(p: Vector3, body: Vector3, yaw: number, s: number, min: number): Vector3 {
  const over = min - s * lateral(p, body, yaw);
  if (over > 0) {
    p.x += s * over * leftX(yaw);
    p.z += s * over * leftZ(yaw);
  }
  return p;
}

/** A pivot under way. */
interface Pivot {
  /** The planted (outer) foot, and the one swinging round. */
  outer: number;
  inner: number;
  t: number;
  dur: number;
  /** The body's yaw at the start and the turn (signed). */
  from: number;
  turn: number;
  /** The outer foot: where it was, where it plants, its yaw, and whether it steps there. */
  outerFrom: Vector3;
  ankle: Vector3;
  footYaw: number;
  plants: boolean;
  /** The inner foot's yaw, and its place in the body's frame at the start (lateral, forward). */
  innerYaw: number;
  ix: number;
  iz: number;
}

export class Stand {
  /** Planted ankle targets (world) and the feet's yaws. */
  readonly foot: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  readonly yaw: [number, number] = [0, 0];
  /** 0–1 while a foot is up (for its toe-down and the knee). */
  readonly lift: [number, number] = [0, 0];
  /** +1: weight on the left leg … −1: on the right. */
  readonly weight = new Spring(1.7, 1, 1);
  readonly glanceYaw = new Spring(5, 1);
  readonly glancePitch = new Spring(5, 1);
  /** Where the body's centre is carried by a pivot, from where the sim has it (world, y 0). */
  readonly shift = new Vector3();
  private side = 1;
  private nextShift = 5;
  private nextGlance = 2.5;
  private glance = [0, 0];
  private step = -1;
  private stepT = 0;
  private stepTime = STEP_TIME;
  private rest = 0;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private fromYaw = 0;
  private toYaw = 0;
  private readonly home = new Vector3();
  private started = false;
  private pv: Pivot | null = null;
  private readonly last = new Vector3();
  /** A foot to step down first thing (the one a stop caught in the air), or −1. */
  private pending = -1;
  /** Back on the ground since the last update: nothing to carry the feet by. */
  private fresh = true;

  constructor(
    /** Feet this far either side of the centre line, toes out by `toeOut` radians. */
    private readonly halfWidth: number,
    private readonly toeOut = 0.12,
  ) {}

  /** Where foot i belongs under a body at `body` (on the ground) facing `yaw`. */
  homeOf(i: number, body: Vector3, yaw: number, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    const x = s * this.halfWidth;
    const z = s * 0.7; // the left a touch ahead: never a parade-ground square
    return out.set(body.x + Math.cos(yaw) * x + Math.sin(yaw) * z, body.y, body.z - Math.sin(yaw) * x + Math.cos(yaw) * z);
  }

  /**
   * The feet just came down where they are (a stride's end): a foot still up (`lifted`, or
   * −1) steps down beside the other at once; otherwise the legs settle before squaring up.
   */
  settle(lifted = -1): void {
    this.step = -1;
    this.rest = lifted >= 0 ? 0 : SETTLE;
    this.pending = lifted;
  }

  /** Put a foot down here now (a landing, the end of a stride). */
  plant(i: number, at: Vector3, yaw: number): void {
    this.foot[i].copy(at);
    this.yaw[i] = yaw;
    this.lift[i] = 0;
    if (this.step === i) this.step = -1;
    this.started = true;
  }

  /** Off the ground (a jump, a swing): no pivot, no carry; the next update starts afresh. */
  airborne(): void {
    this.cancelPivot();
    this.shift.set(0, 0, 0);
    this.fresh = true;
  }

  /** Whether a foot is mid-step. */
  get stepping(): boolean {
    return this.step >= 0;
  }

  /** Whether a pivot is under way, how far through (0–1), and the body's yaw in it. */
  get pivoting(): boolean {
    return this.pv !== null;
  }

  get pivotU(): number {
    return this.pv ? clamp(this.pv.t / this.pv.dur, 0, 1) : 0;
  }

  get pivotYaw(): number {
    const p = this.pv;
    return p ? p.from + p.turn * this.pivotEase() : 0;
  }

  /** The heading a pivot turns him to. */
  get pivotEnd(): number {
    const p = this.pv;
    return p ? p.from + p.turn : 0;
  }

  /** Off his feet mid-pivot (a jump, a hit): the swinging foot stays where it got to. */
  cancelPivot(): void {
    const p = this.pv;
    if (!p) return;
    this.pv = null;
    this.lift[p.inner] = 0;
  }

  /** The yaw the planted feet stand square to: the one between them, or the planted one's. */
  get stanceYaw(): number {
    if (this.step >= 0) return this.footFacing(1 - this.step);
    const a = this.footFacing(0);
    return a + angleTo(a, this.footFacing(1)) * 0.5;
  }

  /** Foot i's yaw without its toe-out: the body yaw it stands square to. */
  private footFacing(i: number): number {
    return this.yaw[i] - (i === 0 ? this.toeOut : -this.toeOut);
  }

  /**
   * The nearest pelvis yaw to `want` that the feet allow. Hard: never so far round that a
   * foot is within MIDLINE of the body's centre line (or across it). Soft (dropped if the two
   * can't both hold): within HIP_TURN of the way each foot points. A stepping foot counts
   * where it has got to, so the pelvis comes round with the step, not ahead of it. A foot too
   * near the centre to say is left out (a step is about to fix it).
   */
  clampYaw(want: number, body: Vector3): number {
    let lo = -Infinity;
    let hi = Infinity;
    let any = false;
    for (let i = 0; i < 2; i++) {
      if (this.pv?.inner === i) continue;
      const s = i === 0 ? 1 : -1;
      const dx = this.foot[i].x - body.x;
      const dz = this.foot[i].z - body.z;
      const r = Math.hypot(dx, dz);
      if (r < MIDLINE * 1.2) continue;
      // lateral(p) = r·cos(p + β): furthest to its side at p = −β (left) or π − β (right).
      const beta = Math.atan2(dz, dx);
      const c = angleTo(want, s > 0 ? -beta : Math.PI - beta);
      const half = Math.acos(clamp(MIDLINE / r, 0, 1));
      lo = Math.max(lo, c - half);
      hi = Math.min(hi, c + half);
      any = true;
    }
    if (!any) return want;
    if (lo > hi) return want + (lo + hi) * 0.5;
    let slo = lo;
    let shi = hi;
    for (let i = 0; i < 2; i++) {
      if (this.pv?.inner === i) continue;
      const c = angleTo(want, this.footFacing(i));
      slo = Math.max(slo, c - HIP_TURN);
      shi = Math.min(shi, c + HIP_TURN);
    }
    return slo <= shi ? want + clamp(0, slo, shi) : want + clamp(0, lo, hi);
  }

  /**
   * Start a pivot: the body turns by `turn` (signed, rad) from `yaw` over `dur` seconds on the
   * `outer` foot, planted where it is; the other foot swings round from where it is.
   */
  startPivot(outer: number, yaw: number, turn: number, dur: number, body: Vector3, project: (p: Vector3) => Vector3): void {
    const inner = 1 - outer;
    const at = _b.copy(body).add(this.shift);
    // The outer foot plants beside the hips, a little toward the new heading.
    const end = yaw + turn;
    const spot = project(this.homeOf(outer, at, yaw, new Vector3()).add(_a.set(fwdX(end), 0, fwdZ(end)).multiplyScalar(PIVOT_LEAD)));
    const plants = Math.hypot(spot.x - this.foot[outer].x, spot.z - this.foot[outer].z) > 3;
    const fi = this.foot[inner];
    const dx = fi.x - at.x;
    const dz = fi.z - at.z;
    this.pv = {
      outer,
      inner,
      t: 0,
      dur: dur * (plants ? 1.15 : 1),
      from: yaw,
      turn,
      outerFrom: this.foot[outer].clone(),
      ankle: plants ? spot : this.foot[outer].clone(),
      footYaw: this.yaw[outer],
      plants,
      innerYaw: this.yaw[inner],
      ix: dx * leftX(yaw) + dz * leftZ(yaw),
      iz: dx * fwdX(yaw) + dz * fwdZ(yaw),
    };
    this.step = -1;
    this.lift[outer] = 0;
  }

  private pivotEase(): number {
    // Quick off the mark (the hips start round as the outer foot goes down), settling into
    // the new heading; the torso and head lead the hips.
    const u = clamp(this.pv!.t / this.pv!.dur, 0, 1);
    return 1 - (1 - u) * (1 - u);
  }

  /**
   * Advance by dt with the body at `body` (x, z; y is the ground plus the ankle) facing
   * `yaw`, wanting to face `want`. `project` puts a point on the roof under it (keeping the
   * ankle height). `body` is where the sim has him; the pivot carries him round from there.
   * `planted`: the legs are on these feet (not running a cycle), so they may step.
   */
  update(dt: number, body: Vector3, yaw: number, project: (p: Vector3) => Vector3, want = yaw, planted = true): void {
    if (!this.started) {
      for (let i = 0; i < 2; i++) this.plant(i, project(this.homeOf(i, body, yaw, this.home)), yaw + (i === 0 ? this.toeOut : -this.toeOut));
    }
    // Weight from leg to leg, now and then; onto the planted one while the other steps.
    this.nextShift -= dt;
    if (this.nextShift <= 0) {
      this.side = -this.side;
      this.nextShift = 5 + Math.random() * 4;
    }
    const up = this.step >= 0 ? this.step : this.pv ? this.pv.inner : -1;
    this.weight.omega = up >= 0 ? 9 : 1.7;
    this.weight.step(up >= 0 ? (up === 0 ? -1 : 1) : this.side, dt);
    // A glance somewhere, then back.
    this.nextGlance -= dt;
    if (this.nextGlance <= 0) {
      const away = this.glance[0] === 0 && this.glance[1] === 0 && Math.random() < 0.75;
      this.glance = away ? [(Math.random() * 2 - 1) * 0.45, -0.04 + Math.random() * 0.12] : [0, 0];
      this.nextGlance = away ? 1.4 + Math.random() * 1.6 : 2.5 + Math.random() * 3;
    }
    this.glanceYaw.step(this.glance[0], dt);
    this.glancePitch.step(this.glance[1], dt);

    if (this.pv) {
      this.pivot(dt, body, project);
      this.last.copy(body).add(this.shift);
      this.fresh = false;
      return;
    }
    // What's left of the last pivot's carry fades as the feet square up under him.
    this.shift.multiplyScalar(Math.exp(-dt * 7));
    const at = _b.copy(body).add(this.shift);
    if (this.fresh) this.last.copy(at);
    this.fresh = false;
    const moved = _c.subVectors(at, this.last).setY(0);
    this.last.copy(at);

    if (!planted) {
      // On the run the stance isn't in use: the feet travel with him (so whatever is still
      // blending toward them, like the end of a pivot, isn't dragged back across the roof).
      this.step = -1;
      for (const f of this.foot) f.add(moved);
      return;
    }
    // A step under way: round from where the foot was to its spot, lifted, kept on its own side.
    if (this.step >= 0) {
      const i = this.step;
      this.stepT += dt / this.stepTime;
      const u = clamp(this.stepT, 0, 1);
      const e = u * u * (3 - 2 * u);
      around(this.from, this.to, at, e, this.foot[i]);
      keepSide(this.foot[i], at, yaw, i === 0 ? 1 : -1, SWING_SIDE);
      this.foot[i].y = this.from.y + (this.to.y - this.from.y) * e + Math.sin(Math.PI * u) * STEP_LIFT * (this.stepTime < STEP_TIME ? 1.4 : 1);
      this.yaw[i] = this.fromYaw + angleTo(this.fromYaw, this.toYaw) * e;
      this.lift[i] = Math.sin(Math.PI * u);
      if (u >= 1) {
        // Down where it got to (kept on its own side), at the spot's height.
        this.plant(i, this.foot[i].setY(this.to.y), this.toYaw);
        this.rest = this.stepTime < STEP_TIME ? 0.03 : 0.08;
      }
      return;
    }
    this.rest -= dt;
    if (this.rest > 0) return;
    // Turning on the spot: the foot on the side of the turn opens first, each step at most
    // STEP_TURN past the planted one; then square up whichever foot is furthest out.
    const turn = angleTo(this.stanceYaw, want);
    let worst = -1;
    let err = 3.2;
    let target = yaw;
    if (this.pending >= 0) {
      // The last stride's foot, put down beside the other.
      worst = this.pending;
      this.pending = -1;
      this.stepTime = TURN_STEP_TIME;
    } else if (Math.abs(turn) > 0.35) {
      const lead = turn > 0 ? 0 : 1;
      const other = 1 - lead;
      const behind = Math.abs(angleTo(this.footFacing(lead), want)) > Math.abs(angleTo(this.footFacing(other), want)) + 0.05;
      worst = behind || Math.abs(angleTo(this.footFacing(lead), this.footFacing(other))) < 0.2 ? lead : other;
      const stays = this.footFacing(1 - worst);
      target = stays + clamp(angleTo(stays, want), -STEP_TURN, STEP_TURN);
      this.stepTime = TURN_STEP_TIME;
    } else {
      for (let i = 0; i < 2; i++) {
        this.homeOf(i, at, yaw, this.home);
        const toe = yaw + (i === 0 ? this.toeOut : -this.toeOut);
        const e = Math.hypot(this.foot[i].x - this.home.x, this.foot[i].z - this.home.z) + 9 * Math.abs(angleTo(this.yaw[i], toe));
        if (e > err) {
          err = e;
          worst = i;
        }
      }
      this.stepTime = STEP_TIME;
    }
    if (worst < 0) return;
    this.step = worst;
    this.stepT = 0;
    this.from.copy(this.foot[worst]);
    project(this.homeOf(worst, at, target, this.to));
    this.fromYaw = this.yaw[worst];
    this.toYaw = target + (worst === 0 ? this.toeOut : -this.toeOut);
  }

  /** A pivot's frame: the outer foot plants and turns where it stands, the body over it, the inner foot swings round with him. */
  private pivot(dt: number, body: Vector3, project: (p: Vector3) => Vector3): void {
    const p = this.pv!;
    p.t += dt;
    const u = clamp(p.t / p.dur, 0, 1);
    const e = this.pivotEase();
    const yaw = p.from + p.turn * e;
    const end = p.from + p.turn;
    const at = _b.copy(body).add(this.shift);
    // The outer foot: a quick step down beside the hips, then planted, turning with the body.
    const o = p.outer;
    const so = o === 0 ? 1 : -1;
    const k0 = p.plants ? clamp(u / PIVOT_PLANT, 0, 1) : 1;
    if (k0 < 1) {
      const ke = k0 * k0 * (3 - 2 * k0);
      around(p.outerFrom, p.ankle, at, ke, this.foot[o]);
      keepSide(this.foot[o], at, yaw, so, SWING_SIDE);
      this.foot[o].y = p.outerFrom.y + (p.ankle.y - p.outerFrom.y) * ke + Math.sin(Math.PI * k0) * STEP_LIFT;
      this.lift[o] = Math.sin(Math.PI * k0);
    } else {
      this.foot[o].copy(p.ankle);
      this.lift[o] = 0;
    }
    this.yaw[o] = p.footYaw + p.turn * e;
    // Once it's down, the body is carried aside just enough that it stays clear on its own
    // side (it never passes under him), and waits for it if the sim runs him out of its reach.
    if (k0 >= 1) {
      const sh = this.shift;
      const over = PIVOT_SIDE - so * lateral(this.foot[o], at, yaw);
      if (over > 0) {
        sh.x -= so * over * leftX(yaw);
        sh.z -= so * over * leftZ(yaw);
      }
      at.copy(body).add(sh);
      const gx = at.x - p.ankle.x;
      const gz = at.z - p.ankle.z;
      const d = Math.hypot(gx, gz);
      if (d > PIVOT_REACH) {
        sh.x -= (gx / d) * (d - PIVOT_REACH);
        sh.z -= (gz / d) * (d - PIVOT_REACH);
        const l = Math.hypot(sh.x, sh.z);
        if (l > PIVOT_LAG) sh.multiplyScalar(PIVOT_LAG / l);
        at.copy(body).add(sh);
        // Still out of reach: the foot skids after him, along his heading, keeping its place
        // at his side.
        const dx = p.ankle.x - at.x;
        const dz = p.ankle.z - at.z;
        if (Math.hypot(dx, dz) > PIVOT_REACH) {
          const lx = so * Math.max(PIVOT_SIDE, so * (dx * leftX(yaw) + dz * leftZ(yaw)));
          const fz = dx * fwdX(yaw) + dz * fwdZ(yaw);
          const reach = Math.sqrt(Math.max(0, PIVOT_REACH * PIVOT_REACH - lx * lx));
          const lz = clamp(fz, -reach, reach);
          p.ankle.x = at.x + lx * leftX(yaw) + lz * fwdX(yaw);
          p.ankle.z = at.z + lx * leftZ(yaw) + lz * fwdZ(yaw);
          project(p.ankle);
        }
      }
      this.foot[o].copy(p.ankle);
    }
    // The inner foot swings round with him: its place beside the body eases from where it
    // was to its spot under the new heading (a little ahead), turning as the body turns.
    const i = p.inner;
    const s = i === 0 ? 1 : -1;
    const k = clamp(u * 1.15, 0, 1);
    const ke = k * k * (3 - 2 * k);
    const lx = p.ix + (s * this.halfWidth - p.ix) * ke;
    const lz = p.iz + (s * 0.7 + PIVOT_AHEAD - p.iz) * ke;
    const f = this.foot[i].set(at.x + lx * leftX(yaw) + lz * fwdX(yaw), 0, at.z + lx * leftZ(yaw) + lz * fwdZ(yaw));
    keepSide(f, at, yaw, s, SWING_SIDE);
    const ground = project(this.home.copy(f)).y;
    f.y = ground + Math.sin(Math.PI * k) * PIVOT_LIFT;
    this.yaw[i] = p.innerYaw + angleTo(p.innerYaw, end + s * this.toeOut) * ke;
    this.lift[i] = Math.sin(Math.PI * k);
    if (u >= 1) {
      this.pv = null;
      this.plant(i, f.setY(ground), this.yaw[i]);
      this.rest = 0.1;
    }
  }
}
