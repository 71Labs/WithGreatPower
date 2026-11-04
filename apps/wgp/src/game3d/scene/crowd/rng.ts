/**
 * The crowd's own seeded randomness (mulberry32): seeded from the night's city seed and a
 * salt per use, so the same night always places and dresses the same people. Never the
 * sim's Rng: nothing here may touch the deterministic run.
 */

/** A 32-bit hash of some integers (for salts and per-person picks). */
export function hash32(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= Math.floor(x) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** A float in [0, 1) from a few integers. */
export const hash01 = (...xs: number[]) => hash32(...xs) / 4294967296;

export class CrowdRng {
  private s: number;

  constructor(seed: number, salt = 0) {
    this.s = hash32(seed, salt, 0x6a09e667) || 1;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
