/**
 * Deterministic math for the 3D sim. Every function here uses only + − × ÷, Math.sqrt
 * and Math.floor, which IEEE-754 pins down bit for bit, so Node, Chromium, WebKit and
 * Firefox all get the same answer. Math.sin/cos/atan2/hypot/pow are banned in the core
 * (test/determinism-scan.test.ts) because engines are free to round them differently.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const INV_TWO_PI = 0.15915494309189535;
const PI_6 = 0.5235987755982989;
const SQRT3 = 1.7320508075688772;
/** tan(π/12): above it, atan is shifted by π/6 so the series converges fast. */
const TAN_PI_12 = 0.2679491924311227;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** x wrapped into [−π, π]. */
export function wrapAngle(x: number): number {
  return x - Math.floor(x * INV_TWO_PI + 0.5) * TWO_PI;
}

/** sin on [−π/4, π/4]: the Taylor series to t^15 (error under 1e-16). */
function sinCore(t: number): number {
  const t2 = t * t;
  return (
    t *
    (1 +
      t2 *
        (-0.16666666666666666 +
          t2 *
            (0.008333333333333333 +
              t2 *
                (-0.0001984126984126984 +
                  t2 * (0.0000027557319223985893 + t2 * (-2.505210838544172e-8 + t2 * (1.6059043836821613e-10 + t2 * -7.647163731819816e-13)))))))
  );
}

/** cos on [−π/4, π/4]: the Taylor series to t^16 (error under 1e-17). */
function cosCore(t: number): number {
  const t2 = t * t;
  return (
    1 +
    t2 *
      (-0.5 +
        t2 *
          (0.041666666666666664 +
            t2 *
              (-0.001388888888888889 +
                t2 *
                  (0.0000248015873015873 +
                    t2 * (-2.755731922398589e-7 + t2 * (2.08767569878681e-9 + t2 * (-1.1470745597729725e-11 + t2 * 4.779477332387385e-14)))))))
  );
}

/** x as a quarter-turn count k (0–3) and a remainder t in [−π/4, π/4]. */
function quadrant(x: number): [number, number] {
  const r = wrapAngle(x);
  const k = Math.floor(r / HALF_PI + 0.5);
  return [((k % 4) + 4) % 4, r - k * HALF_PI];
}

/** Polynomial sine: exact at multiples of π/2, about 1e-16 elsewhere for |x| up to thousands. */
export function dsin(x: number): number {
  const [k, t] = quadrant(x);
  return k === 0 ? sinCore(t) : k === 1 ? cosCore(t) : k === 2 ? -sinCore(t) : -cosCore(t);
}

/** Polynomial cosine, from the same reduction. */
export function dcos(x: number): number {
  const [k, t] = quadrant(x);
  return k === 0 ? cosCore(t) : k === 1 ? -sinCore(t) : k === 2 ? -cosCore(t) : sinCore(t);
}

/** atan on [−tan(π/12), tan(π/12)]: the series to u^21 (error under 1e-14). */
function atanCore(u: number): number {
  const u2 = u * u;
  return (
    u *
    (1 +
      u2 *
        (-1 / 3 +
          u2 *
            (1 / 5 +
              u2 * (-1 / 7 + u2 * (1 / 9 + u2 * (-1 / 11 + u2 * (1 / 13 + u2 * (-1 / 15 + u2 * (1 / 17 + u2 * (-1 / 19 + u2 * (1 / 21)))))))))))
  );
}

/** atan of t in [0, 1]. */
function atanUnit(t: number): number {
  if (t > TAN_PI_12) return PI_6 + atanCore((t * SQRT3 - 1) / (t + SQRT3));
  return atanCore(t);
}

/** Polynomial atan2(y, x), in (−π, π]. atan2(0, 0) is 0. */
export function datan2(y: number, x: number): number {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  if (ax === 0 && ay === 0) return 0;
  let a = ay > ax ? HALF_PI - atanUnit(ax / ay) : atanUnit(ay / ax);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export const len2 = (x: number, z: number) => Math.sqrt(x * x + z * z);
export const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

/**
 * The 64 stick headings as unit xz vectors, written out as literals so the sim never
 * evaluates trig. Index i faces angle i × 2π/64 from +x toward +z: 0 is +x, 16 is +z,
 * 32 is −x and 48 is −z. Generated once from one octant and filled by exact symmetry.
 */
export const DIR64: readonly (readonly [number, number])[] = [
  [1, 0], [0.9951847266721969, 0.0980171403295606], [0.9807852804032304, 0.19509032201612825], [0.9569403357322088, 0.29028467725446233],
  [0.9238795325112867, 0.3826834323650898], [0.881921264348355, 0.47139673682599764], [0.8314696123025452, 0.5555702330196022], [0.773010453362737, 0.6343932841636455],
  [0.7071067811865476, 0.7071067811865476], [0.6343932841636455, 0.773010453362737], [0.5555702330196022, 0.8314696123025452], [0.47139673682599764, 0.881921264348355],
  [0.3826834323650898, 0.9238795325112867], [0.29028467725446233, 0.9569403357322088], [0.19509032201612825, 0.9807852804032304], [0.0980171403295606, 0.9951847266721969],
  [0, 1], [-0.0980171403295606, 0.9951847266721969], [-0.19509032201612825, 0.9807852804032304], [-0.29028467725446233, 0.9569403357322088],
  [-0.3826834323650898, 0.9238795325112867], [-0.47139673682599764, 0.881921264348355], [-0.5555702330196022, 0.8314696123025452], [-0.6343932841636455, 0.773010453362737],
  [-0.7071067811865476, 0.7071067811865476], [-0.773010453362737, 0.6343932841636455], [-0.8314696123025452, 0.5555702330196022], [-0.881921264348355, 0.47139673682599764],
  [-0.9238795325112867, 0.3826834323650898], [-0.9569403357322088, 0.29028467725446233], [-0.9807852804032304, 0.19509032201612825], [-0.9951847266721969, 0.0980171403295606],
  [-1, 0], [-0.9951847266721969, -0.0980171403295606], [-0.9807852804032304, -0.19509032201612825], [-0.9569403357322088, -0.29028467725446233],
  [-0.9238795325112867, -0.3826834323650898], [-0.881921264348355, -0.47139673682599764], [-0.8314696123025452, -0.5555702330196022], [-0.773010453362737, -0.6343932841636455],
  [-0.7071067811865476, -0.7071067811865476], [-0.6343932841636455, -0.773010453362737], [-0.5555702330196022, -0.8314696123025452], [-0.47139673682599764, -0.881921264348355],
  [-0.3826834323650898, -0.9238795325112867], [-0.29028467725446233, -0.9569403357322088], [-0.19509032201612825, -0.9807852804032304], [-0.0980171403295606, -0.9951847266721969],
  [0, -1], [0.0980171403295606, -0.9951847266721969], [0.19509032201612825, -0.9807852804032304], [0.29028467725446233, -0.9569403357322088],
  [0.3826834323650898, -0.9238795325112867], [0.47139673682599764, -0.881921264348355], [0.5555702330196022, -0.8314696123025452], [0.6343932841636455, -0.773010453362737],
  [0.7071067811865476, -0.7071067811865476], [0.773010453362737, -0.6343932841636455], [0.8314696123025452, -0.5555702330196022], [0.881921264348355, -0.47139673682599764],
  [0.9238795325112867, -0.3826834323650898], [0.9569403357322088, -0.29028467725446233], [0.9807852804032304, -0.19509032201612825], [0.9951847266721969, -0.0980171403295606],
];

/** Stick magnitudes 0–3 as a fraction of full tilt. */
export const MAG_SCALE: readonly number[] = [0, 1 / 3, 2 / 3, 1];

/** The DIR64 index nearest a world xz direction (for clients turning a camera-relative stick into an input). */
export function dirIndex(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  const step = Math.floor(datan2(z, x) * (32 / PI) + 0.5);
  return ((step % 64) + 64) % 64;
}

/**
 * A stick (any length, world xz) as an InputFrame's dir and mag: under 0.15 is none,
 * then thirds. Keeps dir = 0 when mag = 0 so the input log stays canonical.
 */
export function quantizeStick(x: number, z: number): { dir: number; mag: number } {
  const m = len2(x, z);
  if (!(m >= 0.15)) return { dir: 0, mag: 0 };
  const mag = m >= 0.8 ? 3 : m >= 0.45 ? 2 : 1;
  return { dir: dirIndex(x, z), mag };
}
