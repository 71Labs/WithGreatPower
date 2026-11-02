/**
 * Damped springs for presentation physics: x'' = −ω²(x − target) − 2ζω·x' (+ a constant
 * acceleration). Each step uses the exact closed-form solution, so a spring is stable for
 * any dt and settles the same at 30 or 240 Hz; ζ = 1 is critically damped (the fastest
 * approach with no overshoot), ζ < 1 overshoots and rings, ζ > 1 creeps.
 *
 * The coefficients for one (ω, ζ, dt) are cached, so a spring stepped at the kit's fixed
 * sub-step costs a handful of multiplies. Every spring keeps the value before its last step
 * (`prev`) for drawing between sub-steps (`lerp`).
 */

/** The 2×2 step matrix [e', v'] = M·[e, v], with e = x − target. */
export interface SpringCoeffs {
  omega: number;
  zeta: number;
  dt: number;
  ee: number;
  ev: number;
  ve: number;
  vv: number;
}

/** Coefficients of one exact step for a spring with angular frequency ω (rad/s) and damping ratio ζ. */
export function springCoeffs(omega: number, zeta: number, dt: number, out?: SpringCoeffs): SpringCoeffs {
  const c = out ?? { omega, zeta, dt, ee: 1, ev: 0, ve: 0, vv: 1 };
  c.omega = omega;
  c.zeta = zeta;
  c.dt = dt;
  const w = Math.max(1e-4, omega);
  const z = Math.max(0, zeta);
  if (!(dt > 0)) {
    c.ee = 1;
    c.ev = 0;
    c.ve = 0;
    c.vv = 1;
    return c;
  }
  if (Math.abs(z - 1) < 1e-4) {
    // Critical: e(t) = (e0 + (v0 + ω e0) t) e^{−ωt}.
    const k = Math.exp(-w * dt);
    c.ee = (1 + w * dt) * k;
    c.ev = dt * k;
    c.ve = -w * w * dt * k;
    c.vv = (1 - w * dt) * k;
  } else if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const k = Math.exp(-z * w * dt);
    const cs = Math.cos(wd * dt);
    const sn = Math.sin(wd * dt);
    c.ee = k * (cs + ((z * w) / wd) * sn);
    c.ev = (k * sn) / wd;
    c.ve = (-k * (w * w) * sn) / wd;
    c.vv = k * (cs - ((z * w) / wd) * sn);
  } else {
    const s = Math.sqrt(z * z - 1);
    const r1 = -w * (z - s);
    const r2 = -w * (z + s);
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    const d = r2 - r1;
    // e = c1 e^{r1 t} + c2 e^{r2 t}, c2 = (v0 − r1 e0)/(r2 − r1), c1 = e0 − c2.
    c.ee = (r2 * e1 - r1 * e2) / d;
    c.ev = (e2 - e1) / d;
    c.ve = (r1 * r2 * (e1 - e2)) / d;
    c.vv = (r2 * e2 - r1 * e1) / d;
  }
  return c;
}

/** A scalar spring. */
export class Spring {
  value: number;
  velocity = 0;
  prev: number;
  private coeffs: SpringCoeffs | null = null;

  constructor(
    public omega: number,
    public zeta = 1,
    value = 0,
  ) {
    this.value = value;
    this.prev = value;
  }

  private c(dt: number): SpringCoeffs {
    const c = this.coeffs;
    if (c && c.dt === dt && c.omega === this.omega && c.zeta === this.zeta) return c;
    this.coeffs = springCoeffs(this.omega, this.zeta, dt, c ?? undefined);
    return this.coeffs;
  }

  /** Advance by dt toward `target`, with an optional constant acceleration. */
  step(target: number, dt: number, accel = 0): number {
    const c = this.c(dt);
    const t = target + accel / (this.omega * this.omega);
    const e = this.value - t;
    const v = this.velocity;
    this.prev = this.value;
    this.value = t + c.ee * e + c.ev * v;
    this.velocity = c.ve * e + c.vv * v;
    return this.value;
  }

  snap(value: number): void {
    this.value = value;
    this.prev = value;
    this.velocity = 0;
  }

  /** Add velocity (a kick). */
  impulse(dv: number): void {
    this.velocity += dv;
  }

  /** The value `alpha` of the way through the last step. */
  lerp(alpha: number): number {
    return this.prev + (this.value - this.prev) * alpha;
  }
}

/** Three springs sharing ω and ζ: a point that chases a target. */
export class Spring3 {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  px = 0;
  py = 0;
  pz = 0;
  private coeffs: SpringCoeffs | null = null;

  constructor(
    public omega: number,
    public zeta = 1,
  ) {}

  private c(dt: number): SpringCoeffs {
    const c = this.coeffs;
    if (c && c.dt === dt && c.omega === this.omega && c.zeta === this.zeta) return c;
    this.coeffs = springCoeffs(this.omega, this.zeta, dt, c ?? undefined);
    return this.coeffs;
  }

  /** Advance by dt toward (tx, ty, tz) under a constant acceleration (gravity, an inertial pull). */
  step(tx: number, ty: number, tz: number, dt: number, ax = 0, ay = 0, az = 0): void {
    const c = this.c(dt);
    const k = 1 / (this.omega * this.omega);
    const gx = tx + ax * k;
    const gy = ty + ay * k;
    const gz = tz + az * k;
    const ex = this.x - gx;
    const ey = this.y - gy;
    const ez = this.z - gz;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.x = gx + c.ee * ex + c.ev * this.vx;
    this.y = gy + c.ee * ey + c.ev * this.vy;
    this.z = gz + c.ee * ez + c.ev * this.vz;
    this.vx = c.ve * ex + c.vv * this.vx;
    this.vy = c.ve * ey + c.vv * this.vy;
    this.vz = c.ve * ez + c.vv * this.vz;
  }

  snap(x: number, y: number, z: number): void {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
  }

  impulse(dx: number, dy: number, dz: number): void {
    this.vx += dx;
    this.vy += dy;
    this.vz += dz;
  }

  /** Write the point `alpha` of the way through the last step into `out`. */
  lerp<T extends { x: number; y: number; z: number }>(alpha: number, out: T): T {
    out.x = this.px + (this.x - this.px) * alpha;
    out.y = this.py + (this.y - this.py) * alpha;
    out.z = this.pz + (this.z - this.pz) * alpha;
    return out;
  }
}
