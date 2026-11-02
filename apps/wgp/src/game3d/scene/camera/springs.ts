/**
 * Critically damped springs (exact for any dt), the smoothing behind the chase camera and
 * the cards' lagging yaw. Ported from blastoff's camera-director `Smoothed`.
 */

export class Smoothed {
  velocity = 0;

  constructor(public value = 0) {}

  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }

  step(target: number, smoothTime: number, dt: number): number {
    if (!(dt > 0)) return this.value;
    const omega = 2 / Math.max(1e-3, smoothTime);
    const decay = Math.exp(-omega * dt);
    const change = this.value - target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * decay;
    this.value = target + (change + temp) * decay;
    return this.value;
  }
}

const TAU = Math.PI * 2;

/** The shortest signed turn from `a` to `b`, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** A spring on an angle that always takes the short way round. */
export class SmoothedAngle {
  private readonly s = new Smoothed();

  get value(): number {
    return this.s.value;
  }

  snap(value: number): void {
    this.s.snap(value);
  }

  step(target: number, smoothTime: number, dt: number): number {
    return this.s.step(this.s.value + angleDelta(this.s.value, target), smoothTime, dt);
  }

  /** Keep the angle within `max` radians of `target` (the spring's lag limit). */
  clampTo(target: number, max: number): void {
    const d = angleDelta(target, this.s.value);
    if (d > max) this.s.value = target + max;
    else if (d < -max) this.s.value = target - max;
  }
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** Three independent springs; separate vertical smoothing keeps hops from jerking the view. */
export class SmoothedVec3 {
  readonly x = new Smoothed();
  readonly y = new Smoothed();
  readonly z = new Smoothed();

  snap(v: MutableVec3): void {
    this.x.snap(v.x);
    this.y.snap(v.y);
    this.z.snap(v.z);
  }

  step(target: MutableVec3, smoothTime: number, smoothTimeY: number, dt: number, out: MutableVec3): MutableVec3 {
    out.x = this.x.step(target.x, smoothTime, dt);
    out.y = this.y.step(target.y, smoothTimeY, dt);
    out.z = this.z.step(target.z, smoothTime, dt);
    return out;
  }
}
