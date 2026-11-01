/**
 * Procedural terrain shared by Vessel's generative art: the CPU twin of the hero
 * shader. Layered ridged-noise mountain ranges, shaded by slope and rock strata,
 * returned as a tone in [0, 1] (0 = paper, 1 = deepest ink) for dithering or ASCII.
 */

/** FNV-1a: a stable 32-bit seed from any string (token id, address). */
export function seedFrom(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash(x: number, y: number): number {
  // Integer lattice hash → [0, 1).
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < octaves; i++) {
    s += a * noise(x, y);
    x = x * 2.02 + 3.1;
    y = y * 2.02 + 1.7;
    a *= 0.5;
  }
  return s;
}

function ridged(x: number, y: number, octaves: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x, y) * 2 - 1);
    s += a * n * n;
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
}

export interface TerrainOptions {
  seed?: number;
  /** Noise octaves; fewer is faster and softer. */
  octaves?: number;
  /** Number of mountain ranges, back to front. */
  layers?: number;
  /** Raises or lowers every range (0 = default horizon). */
  lift?: number;
}

/**
 * Tone of the landscape at (x, y): x grows right in "aspect units", y in [0, 1] grows
 * up from the bottom. `t` drifts the ranges at parallax speeds.
 */
export function terrainTone(x: number, y: number, t: number, opts: TerrainOptions = {}): number {
  const { seed = 0, octaves = 5, layers = 4, lift = 0 } = opts;
  const s = (seed % 9973) * 0.137;
  // Front range first: the first range that covers this point is the one we see.
  for (let i = layers - 1; i >= 0; i--) {
    const k = i;
    const drift = t * (0.004 + 0.006 * k);
    const f = 1.2 + k * 0.9;
    const base = 0.62 - k * 0.15 + lift;
    const amp = 0.3 - k * 0.03;
    const px = (x * 0.55 + drift) * f + s + k * 13.7;
    const h = base + amp * (ridged(px, k * 4.1, octaves) - 0.35);
    if (y < h) {
      const e = 0.01;
      const dh = ((ridged(px + e * f, k * 4.1, octaves) - ridged(px - e * f, k * 4.1, octaves)) * amp) / (2 * e);
      const depth = h - y;
      const light = Math.min(1, Math.max(0, 0.5 - dh * 0.35));
      const strata = ridged(x * 4 + drift * 3 + k * 7 + s, depth * 9 + k, Math.max(2, octaves - 2));
      const snow = Math.max(0, 1 - depth / 0.06);
      let tone = 0.22 + 0.62 * (1 - light) * strata + k * 0.07;
      tone = tone + (0.04 - tone) * snow * 0.65;
      return Math.min(1, tone * (0.55 + 0.15 * k));
    }
  }
  // Sky: a faint haze above the horizon.
  return Math.max(0, 0.1 * (1 - y / 0.75));
}

/** 8×8 Bayer threshold matrix in [0, 1). */
export const BAYER8: number[] = (() => {
  const m = [0];
  let size = 1;
  let cur = m;
  while (size < 8) {
    const next = new Array(size * 2 * size * 2).fill(0);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = cur[y * size + x] * 4;
        next[y * size * 2 + x] = v;
        next[y * size * 2 + x + size] = v + 2;
        next[(y + size) * size * 2 + x] = v + 3;
        next[(y + size) * size * 2 + x + size] = v + 1;
      }
    }
    cur = next;
    size *= 2;
  }
  return cur.map((v) => v / 64);
})();

const frac = (v: number) => v - Math.floor(v);
/** Continuous-input hash → [0, 1), for building ids that are whole numbers. */
const h2 = (x: number, y: number) => hash(Math.floor(x * 131.7), Math.floor(y * 97.3));

/**
 * The CPU twin of the skyline shader: three depths of towers with windows that light
 * up and go dark. Tone in [0, 1] (0 = sky); x runs left to right, y bottom to top.
 */
export function skylineTone(x: number, y: number, t: number, seed: number): number {
  let tone = Math.max(0, 0.06 * (1 - y / 0.75));
  for (let k = 0; k < 3; k++) {
    const w = 0.085 - k * 0.012;
    const px = x / w + t * (0.03 + k * 0.04) + k * 17 + seed;
    const id = Math.floor(px);
    const fx = frac(px);
    const gap = 0.04 + 0.12 * h2(id, k + 5);
    const tall = h2(id * 1.37, k * 3.1 + seed) > 0.86 ? 0.1 : 0;
    const h = 0.14 + 0.06 * (2 - k) + h2(id, k * 7.13 + seed) * 0.2 + tall;
    if (fx < gap || fx > 1 - gap || y > h) continue;
    const base = 0.3 + k * 0.24;
    const u = (fx - gap) / (1 - 2 * gap);
    const row = Math.floor(y / 0.05);
    const col = Math.floor(u * 3);
    const isWindow = y < h - 0.04 && frac(u * 3) > 0.25 && frac(u * 3) < 0.75 && frac(y / 0.05) > 0.3;
    const lit = h2(col + id * 8 + Math.floor(t * 0.12 + h2(col, row) * 7), row + k * 40) > 0.62;
    tone = isWindow ? (lit ? base - 0.28 : base + 0.08) : base + (fx > 0.62 ? 0.07 : 0);
  }
  return Math.min(1, Math.max(0, tone));
}
