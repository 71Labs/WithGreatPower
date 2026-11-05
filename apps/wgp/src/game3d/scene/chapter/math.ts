/**
 * The chapter scene's pure maths (no three.js): the SCREENSHOT cone, the flash and its
 * reduced-motion pulse, Mary's compression from her restore, the paper copies' wobble, the
 * clues' glow, the pixel trail's crumbs and the confetti's flight. Tested in math.test.ts.
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

/** Sim ticks a second. */
export const TICK_HZ = 60;
/** The SCREENSHOT's aim, about 0.9 s (the spec's), in ticks. */
export const AIM_TICKS = 54;
/** How far the cone's decal reaches (world units; the hero is 88 tall). */
export const CONE_RANGE = 760;
/** The flash: peak opacity and how long it takes to clear (s). */
export const FLASH_PEAK = 0.85;
export const FLASH_SECONDS = 0.32;
/** The reduced-motion outline pulse's length (s). */
export const PULSE_SECONDS = 0.6;
/** "SAVED!": how long the hero stays framed and frozen (s), as the sim's freeze. */
export const SAVED_SECONDS = 1.0;
/** A found clue's glow keeps this much of its light. */
export const GLOW_FOUND = 0.22;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** A stable hash of a number to 0–1 (the 2D renderer's). */
export function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Yaw (radians, 0 along +z, turning toward +x) of an xz direction. */
export function yawOfDir(x: number, z: number): number {
  return Math.atan2(x, z);
}

/**
 * Whether `p` lies in the cone from `origin` along `dir` (on the floor: xz only), within
 * `half` radians of its axis and `range` units.
 */
export function inCone(origin: Vec3, dir: Vec3, half: number, p: Vec3, range = CONE_RANGE): boolean {
  const dx = p.x - origin.x;
  const dz = p.z - origin.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 1e-6) return true;
  const l = Math.hypot(dir.x, dir.z);
  if (l < 1e-9) return false;
  const cos = (dx * dir.x + dz * dir.z) / (d * l);
  return cos >= Math.cos(half);
}

/** How far an aim has charged: 0 when it starts … 1 when the flash goes. */
export function aimCharge(stateTicks: number, aimTicks = AIM_TICKS): number {
  return clamp01(stateTicks / Math.max(1, aimTicks));
}

/** The full-screen flash's opacity `t` seconds after it fires (0 once it has cleared). */
export function flashAlpha(t: number): number {
  if (t < 0 || t >= FLASH_SECONDS) return 0;
  const u = 1 - t / FLASH_SECONDS;
  return FLASH_PEAK * u * u;
}

/** The reduced-motion pulse instead: one swell of the outline, 0 … 1 … 0 over its length. */
export function pulseAlpha(t: number): number {
  if (t < 0 || t >= PULSE_SECONDS) return 0;
  return Math.sin((Math.PI * t) / PULSE_SECONDS);
}

/** Mary's compression from her restore: what the JPEG shader draws. */
export interface JpegLook {
  /** 0 clean … 1 fully compressed (the shader's uJpeg). */
  strength: number;
  /** Colour levels per channel after quantising. */
  levels: number;
  /** Her height in the "image's" pixels (the 8×8 blocks are 8 of these). */
  pixelsTall: number;
  /** World units her vertices snap to (the blocky silhouette). */
  snap: number;
}

export function jpegLook(restore: number): JpegLook {
  const s = clamp01(1 - restore);
  return { strength: s, levels: lerp(40, 4, s), pixelsTall: lerp(220, 40, s), snap: lerp(0, 5.5, s) };
}

/**
 * A paper copy's wobble at time `t`: a lean about its base (forward and back, radians) and a
 * sway about its upright axis, each on its own slow beat per copy, so a row never moves as one.
 */
export function copyWobble(id: number, t: number): [number, number] {
  const a = hash01(id * 3.1 + 1) * Math.PI * 2;
  const b = hash01(id * 7.7 + 2) * Math.PI * 2;
  const fa = 1.6 + hash01(id + 5) * 0.9;
  const fb = 1.1 + hash01(id + 9) * 0.6;
  return [Math.sin(t * fa + a) * 0.07, Math.sin(t * fb + b) * 0.09];
}

/** A clue's glow: full until found, dimming to GLOW_FOUND over 0.6 s after. */
export function clueGlow(found: boolean, sinceFound: number): number {
  if (!found) return 1;
  return lerp(1, GLOW_FOUND, smooth(sinceFound / 0.6));
}

/** One crumb of the pixel trail, on the floor (xz), its cube size and colour slot. */
export interface Crumb {
  x: number;
  z: number;
  size: number;
  /** 0 hair red, 1 dark red, 2 light red, 3 shirt teal. */
  colour: number;
  /** How far along the trail, 0 at the clue … 1 at its end. */
  along: number;
}

/**
 * The pixel trail: `n` crumbs from `from` toward `to` over `length` units, bunched near the
 * clue and thinning out toward the bridge, scattered across a narrow band, deterministic per
 * `seed`. Sizes shrink along the trail; about a third are the shirt's teal.
 */
export function pixelTrail(from: Vec3, to: Vec3, n: number, length: number, seed: number): Crumb[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  const reach = Math.min(length, l);
  const out: Crumb[] = [];
  for (let i = 0; i < n; i++) {
    const h0 = hash01(seed * 0.37 + i * 1.913);
    const h1 = hash01(seed * 0.71 + i * 4.127 + 3);
    const h2 = hash01(seed * 1.31 + i * 2.333 + 7);
    // Bunched near the clue: a square-root spread along, plus a jitter.
    const along = clamp01(Math.pow((i + h0 * 0.8) / Math.max(1, n), 1.6));
    const d = along * reach;
    const side = (h1 - 0.5) * (18 + 40 * along);
    out.push({
      x: from.x + ux * d - uz * side,
      z: from.z + uz * d + ux * side,
      size: lerp(13, 6, along) * (0.8 + h2 * 0.4),
      colour: h2 < 0.34 ? 3 : h2 < 0.55 ? 1 : h2 < 0.7 ? 2 : 0,
      along,
    });
  }
  return out;
}

/** A confetti piece in flight: offset from where it popped, its turn, and whether it's still up. */
export interface Flake {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  alive: boolean;
}

/** Seconds a flake lives. */
export const FLAKE_LIFE = 1.4;

/**
 * Piece `i` of a pop `seed`, `t` seconds after: thrown up and out, fluttering down under a
 * light gravity with air drag (paper), spinning. `burst` scales the throw (a pixel burst
 * throws harder than a cut-out).
 */
export function flakeAt(i: number, seed: number, t: number, burst = 1, out: Flake = { x: 0, y: 0, z: 0, rx: 0, ry: 0, alive: false }): Flake {
  if (t < 0 || t >= FLAKE_LIFE) {
    out.alive = false;
    return out;
  }
  const a = hash01(seed + i * 1.37) * Math.PI * 2;
  const up = 0.55 + hash01(seed * 2 + i * 2.11) * 0.6;
  const speed = (150 + hash01(seed * 3 + i * 3.7) * 170) * burst;
  const drag = 2.4;
  // Velocity decays as e^(−drag·t): distance = v (1 − e^(−drag·t)) / drag.
  const k = (1 - Math.exp(-drag * t)) / drag;
  const g = 260;
  out.x = Math.cos(a) * speed * k;
  out.z = Math.sin(a) * speed * k;
  out.y = speed * up * k - 0.5 * g * t * t * 0.6;
  out.rx = t * (6 + hash01(seed + i) * 8);
  out.ry = t * (4 + hash01(seed * 5 + i) * 6) + a;
  out.alive = true;
  return out;
}
