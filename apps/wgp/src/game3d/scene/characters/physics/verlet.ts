/**
 * Position-based Verlet particles with distance constraints: ropes, chains, web strands and
 * a light ragdoll. Positions live in flat Float32Arrays (x, y, z per particle) so a system
 * costs no allocation per step. Each step integrates (inertia + gravity, with a little
 * velocity damping), then relaxes the constraints a few times; pinned particles (inverse
 * mass 0) are moved by the caller and never by the solver. An optional floor keeps
 * particles above a height function (a roof, the street).
 *
 * Purely visual: nothing here is ever read back by the game sim.
 */

export interface VerletOptions {
  /** World units per second squared, along −y. */
  gravity?: number;
  /** Fraction of velocity lost per step (0–1). */
  damping?: number;
  /** Constraint relaxation passes per step. */
  iterations?: number;
}

export class Verlet {
  readonly n: number;
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  readonly invMass: Float32Array;
  /** Constraint endpoints (pairs of particle indices), rest lengths and stiffness (0–1). */
  private ca = new Int32Array(16);
  private cb = new Int32Array(16);
  private rest = new Float32Array(16);
  private stiff = new Float32Array(16);
  private count = 0;
  gravity: number;
  damping: number;
  iterations: number;
  /** Highest surface under (x, z) at or below y, or null for none. Particles stay at or above it + `radius`. */
  floor: ((x: number, z: number, y: number) => number) | null = null;
  radius = 0;
  /** Friction against the floor: fraction of tangential motion kept on contact. */
  friction = 0.6;

  constructor(n: number, opts: VerletOptions = {}) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.invMass = new Float32Array(n).fill(1);
    this.gravity = opts.gravity ?? 1750;
    this.damping = opts.damping ?? 0.02;
    this.iterations = opts.iterations ?? 6;
  }

  get constraints(): number {
    return this.count;
  }

  /** Link particles a and b at `rest` (defaults to their current distance). Returns the constraint index. */
  link(a: number, b: number, rest?: number, stiffness = 1): number {
    if (this.count === this.ca.length) {
      const grow = <T extends Int32Array | Float32Array>(arr: T, make: (n: number) => T) => {
        const next = make(arr.length * 2);
        next.set(arr);
        return next;
      };
      this.ca = grow(this.ca, (k) => new Int32Array(k));
      this.cb = grow(this.cb, (k) => new Int32Array(k));
      this.rest = grow(this.rest, (k) => new Float32Array(k));
      this.stiff = grow(this.stiff, (k) => new Float32Array(k));
    }
    const i = this.count++;
    this.ca[i] = a;
    this.cb[i] = b;
    this.rest[i] = rest ?? this.distance(a, b);
    this.stiff[i] = stiffness;
    return i;
  }

  setRest(constraint: number, rest: number): void {
    this.rest[constraint] = rest;
  }

  restOf(constraint: number): number {
    return this.rest[constraint];
  }

  distance(a: number, b: number): number {
    const p = this.pos;
    const dx = p[b * 3] - p[a * 3];
    const dy = p[b * 3 + 1] - p[a * 3 + 1];
    const dz = p[b * 3 + 2] - p[a * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Place particle i (and zero its velocity). */
  place(i: number, x: number, y: number, z: number): void {
    const k = i * 3;
    this.pos[k] = this.prev[k] = x;
    this.pos[k + 1] = this.prev[k + 1] = y;
    this.pos[k + 2] = this.prev[k + 2] = z;
  }

  /** Move particle i, keeping its velocity (prev moves with it) or not. */
  moveTo(i: number, x: number, y: number, z: number, keepVelocity = false): void {
    const k = i * 3;
    if (keepVelocity) {
      this.prev[k] += x - this.pos[k];
      this.prev[k + 1] += y - this.pos[k + 1];
      this.prev[k + 2] += z - this.pos[k + 2];
    }
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
  }

  /** Give particle i a velocity (units per second) over a step of h seconds. */
  setVelocity(i: number, vx: number, vy: number, vz: number, h: number): void {
    const k = i * 3;
    this.prev[k] = this.pos[k] - vx * h;
    this.prev[k + 1] = this.pos[k + 1] - vy * h;
    this.prev[k + 2] = this.pos[k + 2] - vz * h;
  }

  pin(i: number, pinned = true): void {
    this.invMass[i] = pinned ? 0 : 1;
  }

  /** Integrate one step of h seconds (no constraints). */
  integrate(h: number): void {
    const p = this.pos;
    const q = this.prev;
    const keep = 1 - this.damping;
    const g = -this.gravity * h * h;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (this.invMass[i] === 0) {
        q[k] = p[k];
        q[k + 1] = p[k + 1];
        q[k + 2] = p[k + 2];
        continue;
      }
      const x = p[k];
      const y = p[k + 1];
      const z = p[k + 2];
      p[k] = x + (x - q[k]) * keep;
      p[k + 1] = y + (y - q[k + 1]) * keep + g;
      p[k + 2] = z + (z - q[k + 2]) * keep;
      q[k] = x;
      q[k + 1] = y;
      q[k + 2] = z;
    }
  }

  /** Relax every constraint `iterations` times, then apply the floor. */
  solve(iterations = this.iterations): void {
    const p = this.pos;
    const w = this.invMass;
    for (let it = 0; it < iterations; it++) {
      for (let c = 0; c < this.count; c++) {
        const a = this.ca[c];
        const b = this.cb[c];
        const wa = w[a];
        const wb = w[b];
        const ws = wa + wb;
        if (ws === 0) continue;
        const ka = a * 3;
        const kb = b * 3;
        const dx = p[kb] - p[ka];
        const dy = p[kb + 1] - p[ka + 1];
        const dz = p[kb + 2] - p[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) continue;
        const f = ((d - this.rest[c]) / (d * ws)) * this.stiff[c];
        p[ka] += dx * f * wa;
        p[ka + 1] += dy * f * wa;
        p[ka + 2] += dz * f * wa;
        p[kb] -= dx * f * wb;
        p[kb + 1] -= dy * f * wb;
        p[kb + 2] -= dz * f * wb;
      }
    }
    if (this.floor) this.collideFloor();
  }

  private collideFloor(): void {
    const p = this.pos;
    const q = this.prev;
    const floor = this.floor!;
    for (let i = 0; i < this.n; i++) {
      if (this.invMass[i] === 0) continue;
      const k = i * 3;
      const top = floor(p[k], p[k + 2], Math.max(p[k + 1], q[k + 1]) + this.radius) + this.radius;
      if (p[k + 1] < top) {
        p[k + 1] = top;
        // Friction: keep only part of the sliding motion this step.
        q[k] = p[k] - (p[k] - q[k]) * this.friction;
        q[k + 2] = p[k + 2] - (p[k + 2] - q[k + 2]) * this.friction;
        if (q[k + 1] < top) q[k + 1] = top;
      }
    }
  }

  /** One full step: integrate, then solve. */
  step(h: number): void {
    this.integrate(h);
    this.solve();
  }

  /** Particle i drawn `alpha` of the way through the last step. */
  sample<T extends { x: number; y: number; z: number }>(i: number, alpha: number, out: T): T {
    const k = i * 3;
    out.x = this.prev[k] + (this.pos[k] - this.prev[k]) * alpha;
    out.y = this.prev[k + 1] + (this.pos[k + 1] - this.prev[k + 1]) * alpha;
    out.z = this.prev[k + 2] + (this.pos[k + 2] - this.prev[k + 2]) * alpha;
    return out;
  }
}
