/**
 * Seeded randomness for the sim, built on the engine's mulberry32 step so a night's city
 * and every fight replay the same way from `patrol.seed`.
 */
import { rand } from "@/game/engine";

import type { SimState } from "./types";

/** A stateful wrapper for world generation, where the state never leaves the function. */
export class Rng {
  constructor(public s: number) {}
  next(): number {
    const [v, n] = rand(this.s);
    this.s = n;
    return v;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

/** One draw from the sim's own stream (kept in state, so a state copy replays exactly). */
export function roll(s: SimState): number {
  const [v, n] = rand(s.rng);
  s.rng = n;
  return v;
}

export function rollRange(s: SimState, a: number, b: number): number {
  return a + (b - a) * roll(s);
}

/** A stable 32-bit mix, for seeds derived from other seeds. */
export function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
