/**
 * Case file 003's scene maths (no three.js): the fee meter's needle and glow from its heat, the
 * hanging meter's swing, the burn's scorch trail, the fee spike's ring, the puffs' rise and the
 * stalls' footprints. Tested in math.test.ts.
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { clamp01, hash01, lerp } from "../chapter/math";

export type RGB = [number, number, number];

/** The dial's sweep: the needle turns from this far left of straight up (cool) to as far right (MAX). */
export const NEEDLE_SWEEP = 2.1;
/** Heat at or over this reads as pegged at MAX: the needle trembles there. */
export const PEGGED = 0.97;
/** Puffs: how long one lives (s), and how far it rises in that time. */
export const PUFF_LIFE = 2.2;
export const PUFF_RISE = 120;

/**
 * The needle's angle (radians clockwise from straight up) for a heat of 1 (MAX, far right)
 * down to 0 (cool, far left). Pegged, it trembles against the stop, unless held still.
 */
export function needleAngle(heat: number, time: number, still: boolean): number {
  const h = clamp01(heat);
  const base = lerp(-NEEDLE_SWEEP, NEEDLE_SWEEP, h);
  if (still || h < PEGGED) return base;
  return base - 0.06 * (0.5 + 0.5 * Math.sin(time * 31)) - 0.03 * Math.sin(time * 17.3);
}

const GREEN: RGB = [0.31, 0.82, 0.54];
const AMBER: RGB = [1.0, 0.7, 0.24];
const RED: RGB = [1.0, 0.29, 0.23];

/** The meter's glow colour: green when cool, amber halfway, red from two-thirds hot. */
export function heatColour(heat: number): RGB {
  const h = clamp01(heat);
  const [a, b, t] = h < 0.5 ? [GREEN, AMBER, h / 0.5] : [AMBER, RED, Math.min(1, (h - 0.5) / 0.17)];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * The hanging meter's tilt (radians about the horizontal axes, x and z) as it swings under his
 * glider: it trails his velocity, a little, never more than MAX_SWING. Still: hangs straight.
 */
export const MAX_SWING = 0.4;
export function swingTilt(vel: Vec3 | undefined, still: boolean): { x: number; z: number } {
  if (still || !vel) return { x: 0, z: 0 };
  const k = 1 / 1400;
  const clamp = (v: number) => (v < -MAX_SWING ? -MAX_SWING : v > MAX_SWING ? MAX_SWING : v);
  // Moving +x, the meter lags behind: its bottom swings toward −x, a turn about +z by +angle.
  return { x: clamp(-vel.z * k), z: clamp(vel.x * k) };
}

/** One scorch on the burn's trail. */
export interface Scorch {
  x: number;
  z: number;
  size: number;
  /** Turn about the vertical, radians. */
  rot: number;
}

/**
 * The burn's trail: `n` smaller scorches leading from the big one at `from` toward `to` (the fee
 * meter's roof), `step` apart, starting `start` out, weaving a little either side. Each smaller
 * than the last.
 */
export function burnTrail(from: Vec3, to: Vec3, n: number, step = 85, start = 95): Scorch[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || n <= 0) return [];
  const ux = dx / d;
  const uz = dz / d;
  const out: Scorch[] = [];
  for (let i = 0; i < n; i++) {
    const along = start + i * step;
    if (along > d - 40) break;
    const side = (hash01(i * 7.31 + from.x * 0.013) - 0.5) * 44;
    out.push({ x: from.x + ux * along - uz * side, z: from.z + uz * along + ux * side, size: Math.max(22, 54 - i * 6), rot: hash01(i * 3.7 + from.z * 0.011) * Math.PI * 2 });
  }
  return out;
}

/** The fee spike's telegraph ring: how far its fill has spread (0–1 of the ring), and how strongly it shows. */
export function spikeRing(windup: number, time: number, still: boolean): { fill: number; alpha: number } {
  const p = clamp01(windup);
  const flick = still ? 0 : 0.12 * (0.5 + 0.5 * Math.sin(time * 24));
  return { fill: p, alpha: p <= 0 ? 0 : Math.min(1, 0.45 + 0.45 * p + flick) };
}

/** A spike's burst, `t` seconds after it went: the ring's radius as a share of the reach, and its opacity (0 once done). */
export const BURST_SECONDS = 0.45;
export function spikeBurst(t: number): { scale: number; alpha: number } {
  if (t < 0 || t >= BURST_SECONDS) return { scale: 1, alpha: 0 };
  const u = t / BURST_SECONDS;
  return { scale: 0.6 + 0.55 * (1 - (1 - u) * (1 - u)), alpha: 1 - u };
}

/** A puff `age` seconds old: how far it's risen, its size and opacity. Still: it barely rises. */
export function puffAt(age: number, size: number, still: boolean): { rise: number; size: number; alpha: number } {
  const u = clamp01(age / PUFF_LIFE);
  const rise = (still ? 0.25 : 1) * PUFF_RISE * (1 - (1 - u) * (1 - u));
  const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
  return { rise, size: size * (0.6 + 0.9 * u), alpha: Math.max(0, alpha) };
}

/** The yaw (radians, 0 along +z, turning toward +x) that faces from (x, z) toward (tx, tz). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/**
 * Where a market stall stands on a route roof: a spot `off` from the roof point that's on the
 * same roof all round its footprint (`flat(x, z)` says whether a point is). Tries four ways,
 * seeded; null when none fits (a narrow roof: no stall).
 */
export function stallSpot(at: Vec3, seed: number, off: number, half: number, flat: (x: number, z: number) => boolean): { x: number; z: number; yaw: number } | null {
  const first = Math.floor(hash01(seed) * 4);
  for (let k = 0; k < 4; k++) {
    const a = ((first + k) % 4) * (Math.PI / 2) + 0.4;
    const x = at.x + Math.sin(a) * off;
    const z = at.z + Math.cos(a) * off;
    const ok = [-1, 1].every((sx) => [-1, 1].every((sz) => flat(x + sx * half, z + sz * half)));
    if (ok) return { x, z, yaw: a + Math.PI };
  }
  return null;
}
