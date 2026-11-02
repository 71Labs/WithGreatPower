/**
 * Motion pieces every animator shares:
 *
 * - `Turn`: a rate-limited yaw, so nobody ever snaps round.
 * - `Orient`: a body rotation that eases toward a target (exponential slerp per sub-step).
 * - `Plant`: one foot (or hand) of a cyclic gait. Its phase advances with distance
 *   travelled, so a planted foot stays exactly where it landed (no sliding, even turning)
 *   and a swinging foot arcs to the spot it will land on.
 * - Small vector helpers that never allocate.
 */
import { Matrix4, Quaternion, Vector3 } from "three";

export const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The shortest signed turn from a to b. */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Yaw (about +y, 0 facing +z) of an xz direction. */
export const yawOf = (x: number, z: number) => Math.atan2(x, z);

/** A yaw that turns toward its target at most `rate` rad/s, easing in over `ease` seconds. */
export class Turn {
  value = 0;
  prev = 0;
  private vel = 0;
  started = false;

  constructor(
    public rate = 9,
    public ease = 0.08,
  ) {}

  snap(a: number): void {
    this.value = this.prev = a;
    this.vel = 0;
    this.started = true;
  }

  step(target: number, h: number): void {
    if (!this.started) this.snap(target);
    this.prev = this.value;
    const d = angleTo(this.value, target);
    // Wanted speed: proportional to the remaining turn, capped at the rate limit.
    const want = clamp(d / Math.max(this.ease, h), -this.rate, this.rate);
    const k = 1 - Math.exp(-h / Math.max(1e-3, this.ease * 0.5));
    this.vel += (want - this.vel) * k;
    this.value += this.vel * h;
  }

  lerp(alpha: number): number {
    return this.prev + angleTo(this.prev, this.value) * alpha;
  }
}

/** A rotation easing toward a target: slerp by 1 − e^(−k·h) each sub-step. */
export class Orient {
  readonly q = new Quaternion();
  readonly prev = new Quaternion();
  started = false;

  constructor(public k = 12) {}

  snap(q: Quaternion): void {
    this.q.copy(q);
    this.prev.copy(q);
    this.started = true;
  }

  step(target: Quaternion, h: number, k = this.k): void {
    if (!this.started) this.snap(target);
    this.prev.copy(this.q);
    this.q.slerp(target, 1 - Math.exp(-k * h));
  }

  lerp(alpha: number, out: Quaternion): Quaternion {
    return out.copy(this.prev).slerp(this.q, alpha);
  }
}

const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

/** The rotation whose +y is `up` and whose +z is as close to `fwd` as `up` allows. */
export function frameQuat(up: Vector3, fwd: Vector3, out: Quaternion): Quaternion {
  _y.copy(up).normalize();
  _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y));
  if (_z.lengthSq() < 1e-8) {
    // Forward along up: pick any perpendicular.
    _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    if (_z.lengthSq() < 1e-8) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  }
  _z.normalize();
  _x.copy(_y).cross(_z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export function yawQuat(yaw: number, out: Quaternion): Quaternion {
  return out.setFromAxisAngle(UP, yaw);
}

/** Body-frame offset (x left, y up, z forward) to world, by rotation q, added to `base`. */
export function bodyPoint(base: Vector3, q: Quaternion, x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, y, z).applyQuaternion(q).add(base);
}

/**
 * One limb of a cyclic gait. Phase runs 0–1 per cycle: stance for [0, stance), where the
 * limb holds a world point, then swing, where it arcs to the next landing spot, predicted
 * from the body's travel. Landing spots are projected onto a surface by the caller.
 */
export class Plant {
  readonly at = new Vector3();
  readonly from = new Vector3();
  readonly target = new Vector3();
  inStance = false;
  /** How far through the swing (0 in stance). */
  lift = 0;
  private started = false;

  /**
   * - body: where the body is now (the gait's reference point, on the surface).
   * - dir: the unit travel direction; L: distance per cycle; offset: this limb's place
   *   relative to the body (lateral, and up for hands on a wall).
   * - project: puts a point onto the surface (a roof, a wall).
   */
  update(phase: number, stance: number, body: Vector3, dir: Vector3, L: number, offset: Vector3, liftH: number, liftDir: Vector3, project: (p: Vector3) => Vector3): Vector3 {
    const p = ((phase % 1) + 1) % 1;
    if (!this.started) {
      this.started = true;
      project(this.at.copy(body).add(offset));
      this.inStance = true;
    }
    if (p < stance) {
      if (!this.inStance) {
        // Landing: the spot ahead the body will pass over at mid-stance.
        this.inStance = true;
        project(this.at.copy(body).add(offset).addScaledVector(dir, L * stance * 0.5));
      }
      this.lift = 0;
      return this.target.copy(this.at);
    }
    if (this.inStance) {
      this.inStance = false;
      this.from.copy(this.at);
    }
    const u = (p - stance) / (1 - stance);
    const e = u * u * (3 - 2 * u);
    project(_z.copy(body).add(offset).addScaledVector(dir, (1 - p) * L + L * stance * 0.5));
    this.lift = Math.sin(Math.PI * u);
    return this.target.copy(this.from).lerp(_z, e).addScaledVector(liftDir, this.lift * liftH);
  }

  /** Put the limb down at a spot now (a landing, a teleport). */
  plantAt(p: Vector3): void {
    this.at.copy(p);
    this.from.copy(p);
    this.target.copy(p);
    this.inStance = true;
    this.started = true;
    this.lift = 0;
  }
}
