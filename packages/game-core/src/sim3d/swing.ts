/**
 * Web-swinging (ruleset v2): the rope's integrator, the release window, and the anchor
 * choice, which predicts each candidate's swing before committing to it.
 *
 * - The rope is one-sided and exact: it never stretches, and once taut its tension does no
 *   work, so after each step the speed is what energy conservation says, plus the pump's
 *   work and minus drag's. Going taut from slack is an inelastic jerk (the outward speed is
 *   lost), as it is for a real rope.
 * - The pump (holding the web below the anchor) and the stick are the only energy in.
 * - v3: below the anchor a slack line takes itself up (ROPE_TAKEUP_MIN), and a web from the
 *   ground launches a jump into the swing (launchFromGround); the forecast does both too.
 * - Anchors sit on what you can see: a facade's roof edge or a point on its wall face, or a
 *   prop anchor (antenna tip, water-tower rim, billboard, crane, cable). They lie ahead of
 *   the heading, at most 45° to either side, never behind. Each candidate's swing is run
 *   forward through the same integrator; the pick is the one that carries you furthest
 *   along the heading by a release in the perfect window, with the arc clear of the street
 *   and of buildings, preferring the side opposite the last swing.
 *
 * Deterministic: + − × ÷ and Math.sqrt only, and a fixed candidate order for ties.
 */
import { collideSphere, lineBlocker, lineClear, type AnchorPick, type CityIndex, type SphereHit } from "./city";
import {
  AIR_CONTROL,
  AIR_DRAG,
  AIR_STEER_SPEED,
  ANCHOR_AHEAD,
  ANCHOR_AHEAD_MIN,
  ANCHOR_CONE,
  ANCHOR_MIN,
  ANCHOR_MIN_RISE,
  ANCHOR_RANGE,
  ANCHOR_RANGE_FAR,
  ANCHOR_UP,
  ARENA_ANCHOR_MARGIN,
  CLIMB_MAX_SPEED,
  CLIMB_SLIDE,
  GRAVITY,
  HERO_RADIUS,
  PERFECT_MIN_SPEED,
  PERFECT_MIN_VY,
  PERFECT_TAN_HI,
  PERFECT_TAN_LO,
  PREDICT_DT,
  PREDICT_SECONDS,
  PUMP_MAX_SPEED,
  ROPE_PUMP,
  ROPE_TAKEUP_MIN,
  SIDE_BONUS,
  SLAM_SPEED,
  STREET_Y,
  SWING_CLEAR,
  WEB_JUMP_PUSH,
  WEB_JUMP_VY,
} from "./constants";
import { docVulnerable, nearestTarget } from "./combat";
import { clamp, len2, len3, MAG_SCALE } from "./dmath";
import type { Rope, SimState } from "./types";

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/* ------------------------------------------------------------------ the release window */

/**
 * Rising at an angle between tan⁻¹(lo) and tan⁻¹(hi) above horizontal, at least `minSpeed`
 * fast: checked as lo·hs ≤ vy ≤ hi·hs on the horizontal speed hs (no atan2).
 */
export function inReleaseWindow(vx: number, vy: number, vz: number, lo = PERFECT_TAN_LO, hi = PERFECT_TAN_HI, minSpeed = PERFECT_MIN_SPEED, minVy = PERFECT_MIN_VY): boolean {
  if (vy <= minVy) return false;
  const hs = len2(vx, vz);
  if (hs <= 100 || len3(vx, vy, vz) <= minSpeed) return false;
  return vy >= hs * lo && vy <= hs * hi;
}

/* ------------------------------------------------------------------ the rope */

export interface FlightInput {
  /** The heading (unit xz), for the pump's forward bias. */
  hx: number;
  hz: number;
  /** Travelling: the pump pushes a backswing at a third (so swings carry you on). */
  bias: boolean;
  /** The stick as a world xz vector, its length the tilt (0–1). */
  sx: number;
  sz: number;
  /** Pump while on the rope and below the anchor. */
  pump: boolean;
}

/** The pump's push on a backswing while travelling, as a share of the full push. */
const BACKSWING = 0.35;

/**
 * One substep of flight. The stick (air control, up to AIR_STEER_SPEED along it; on a taut
 * rope, within the swing's tangent plane), the pump, quadratic air drag; then gravity and the
 * move, exact for constant gravity over the step; then the rope. Returns whether the rope
 * held the body this step. `drag` is the quadratic coefficient (tests pass 0).
 *
 * v3: below the anchor the line takes up its slack (down to ROPE_TAKEUP_MIN), as v2 did only
 * on a roof: a web shot while jumping or rising toward its anchor swings on the line you'd
 * reach it with, not on one long enough to drag you into the street. Taking up slack does no work.
 */
export function flightStep(b: Body, rope: Rope | null, dt: number, f: FlightInput, drag = AIR_DRAG): boolean {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let taut = false;
  if (rope) {
    const dx = b.x - rope.x;
    const dy = b.y - rope.y;
    const dz = b.z - rope.z;
    const d = len3(dx, dy, dz);
    if (d > 1e-9) {
      nx = dx / d;
      ny = dy / d;
      nz = dz / d;
    }
    if (dy < 0 && d < rope.len) rope.len = Math.max(d, Math.min(rope.len, ROPE_TAKEUP_MIN));
    taut = d >= rope.len - 0.01;
  }
  // The stick: build speed along it, but only up to AIR_STEER_SPEED; past that it adds nothing.
  const tilt = len2(f.sx, f.sz);
  if (tilt > 1e-9) {
    let wx = f.sx / tilt;
    let wy = 0;
    let wz = f.sz / tilt;
    if (taut) {
      const wn = wx * nx + wz * nz;
      wx -= wn * nx;
      wy -= wn * ny;
      wz -= wn * nz;
    }
    const wl = len3(wx, wy, wz);
    if (wl > 1e-6) {
      wx /= wl;
      wy /= wl;
      wz /= wl;
      const along = b.vx * wx + b.vy * wy + b.vz * wz;
      const add = clamp(AIR_STEER_SPEED * tilt - along, 0, AIR_CONTROL * tilt * dt);
      b.vx += wx * add;
      b.vy += wy * add;
      b.vz += wz * add;
    }
  }
  // The pump: a push along the swing while below the anchor.
  if (rope && f.pump && b.y < rope.y) {
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    let tx = b.vx - vn * nx;
    let ty = b.vy - vn * ny;
    let tz = b.vz - vn * nz;
    const tl = len3(tx, ty, tz);
    const speed = len3(b.vx, b.vy, b.vz);
    if (tl > 1e-6 && speed > 40 && speed < PUMP_MAX_SPEED) {
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const push = ROPE_PUMP * (f.bias && tx * f.hx + tz * f.hz <= 0 ? BACKSWING : 1) * dt;
      b.vx += tx * push;
      b.vy += ty * push;
      b.vz += tz * push;
    }
  }
  // Drag: v ← v / (1 + k|v|dt), the implicit form of a = −k|v|v (never reverses, never overshoots).
  const sp = len3(b.vx, b.vy, b.vz);
  const k = 1 / (1 + drag * sp * dt);
  b.vx *= k;
  b.vy *= k;
  b.vz *= k;
  // The energy the step must end with: gravity conserves it, the rope (taut) does no work.
  const energy = 0.5 * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) + GRAVITY * b.y;
  // Gravity and the move: exact for a constant acceleration.
  b.x += b.vx * dt;
  b.y += b.vy * dt - 0.5 * GRAVITY * dt * dt;
  b.z += b.vz * dt;
  b.vy -= GRAVITY * dt;
  if (!rope) return false;
  const dx = b.x - rope.x;
  const dy = b.y - rope.y;
  const dz = b.z - rope.z;
  const d = len3(dx, dy, dz);
  if (d <= rope.len || d < 1e-9) return false;
  // Back onto the sphere, and no speed away from the anchor.
  nx = dx / d;
  ny = dy / d;
  nz = dz / d;
  b.x = rope.x + nx * rope.len;
  b.y = rope.y + ny * rope.len;
  b.z = rope.z + nz * rope.len;
  const vr = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vr > 0) {
    b.vx -= vr * nx;
    b.vy -= vr * ny;
    b.vz -= vr * nz;
  }
  // Already swinging: the speed energy conservation gives (the projection's error removed).
  if (taut) {
    const want = 2 * (energy - GRAVITY * b.y);
    const have = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    if (have > 1e-9) {
      const s = want > 0 ? Math.sqrt(want / have) : 0;
      b.vx *= s;
      b.vy *= s;
      b.vz *= s;
    }
  }
  return true;
}

/**
 * A web whose line a building now cuts bends round that building's corner instead of passing
 * through it: the anchor moves to the point on the corner edge where the shortest path from
 * the body to the anchor wraps (still on solid geometry), and the rope keeps the length laid
 * from there. True if the line is clear or wrapped; false if no corner gives a clear path
 * (the web snaps).
 */
export function wrapRope(grid: CityIndex, b: Body, rope: Rope): boolean {
  const k = lineBlocker(grid, b.x, b.y, b.z, rope.x, rope.y, rope.z);
  if (k < 0) return true;
  const box = grid.boxes[k];
  const dx = rope.x - b.x;
  const dy = rope.y - b.y;
  const dz = rope.z - b.z;
  const h2 = dx * dx + dz * dz;
  let best = Infinity;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let c = 0; c < 4; c++) {
    const cx = c & 1 ? box.x1 : box.x0;
    const cz = c & 2 ? box.z1 : box.z0;
    // The height where the straight line passes the corner, kept on the corner's edge.
    const t = h2 > 1e-9 ? clamp(((cx - b.x) * dx + (cz - b.z) * dz) / h2, 0, 1) : 0;
    const cy = clamp(b.y + dy * t, box.y0, box.y1);
    // Only a bend above the body still holds it up; lower, the web slips off and snaps.
    if (cy < b.y + ANCHOR_MIN_RISE) continue;
    const path = len3(cx - b.x, cy - b.y, cz - b.z) + len3(rope.x - cx, rope.y - cy, rope.z - cz);
    if (path >= best) continue;
    if (!lineClear(grid, b.x, b.y, b.z, cx, cy, cz) || !lineClear(grid, cx, cy, cz, rope.x, rope.y, rope.z)) continue;
    best = path;
    px = cx;
    py = cy;
    pz = cz;
  }
  if (best === Infinity) return false;
  const laid = len3(rope.x - px, rope.y - py, rope.z - pz);
  rope.x = px;
  rope.y = py;
  rope.z = pz;
  rope.len = Math.max(len3(px - b.x, py - b.y, pz - b.z), rope.len - laid);
  return true;
}

/** The specific energy (per unit mass) of a body: ½v² + g·y. */
export const bodyEnergy = (b: Body) => 0.5 * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) + GRAVITY * b.y;

/* ------------------------------------------------------------------ predicting a swing */

/** The best ballistic carry counted after a release, so one big leap doesn't outscore everything. */
const CARRY_MAX = 500;
/** A swing that never reaches the window scores this much less… */
const NO_WINDOW = 160;
/**
 * …one that ends early less again: landing on a roof (you run on), stuck against a wall (you
 * climb it), or a web cut by a building with no corner to wrap round (you fall); held past
 * the window, an end costs BLOCKED_LATE. Sliding along a wall only costs the speed it loses.
 */
const LANDED = 70;
const STUCK = 150;
const SNAPPED = 320;
const BLOCKED_LATE = 70;
const STREET = 1000;
const STREET_LATE = 300;
/** Per unit of speed lost to walls along the way. */
const SCRAPE = 0.4;
/** Per unit the arc's lowest point (feet) comes under SWING_CLEAR above the street. */
const CLEAR_WEIGHT = 6;
/** A rope whose sphere reaches within this of the street (feet) is marked down, however the swing starts. */
const SPHERE_CLEAR = 6;

const pb: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const phit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };
const pr: Rope = { x: 0, y: 0, z: 0, len: 0 };
const pin: FlightInput = { hx: 1, hz: 0, bias: false, sx: 0, sz: 0, pump: true };

export interface SwingForecast {
  /** Forward progress along the heading at the best release, plus half the leap after it. */
  score: number;
  /** The swing passes through the perfect window. */
  window: boolean;
  /** It stops dead against a building or lands on a roof first, or hits the street. */
  blocked: boolean;
  street: boolean;
  /** It drags you into the street before any release point: never worth taking. */
  doomed: boolean;
  /** The lowest the feet come to the street, units. */
  clear: number;
  /** In a fight: it carries you through the target fast enough to land a slam. */
  slam: boolean;
}

/** A villain to swing through, for the forecast in fights. */
export interface SwingTarget {
  x: number;
  y: number;
  z: number;
  /** Contact distance (his radius plus yours, and the slam's generosity). */
  r: number;
  /** His velocity: the forecast leads him along it (for up to a second). */
  vx: number;
  vy: number;
  vz: number;
  /** The slam speed that hits him (Doc with his arms in takes a lighter one). */
  speed: number;
}

/** In a fight, a swing that slams through the villain scores this much more. */
const SLAM_BONUS = 600;

/**
 * Run a swing from body `b` on a rope to (ax, ay, az) of length `len` forward through the
 * same integrator and collision response the sim uses (with the pump, no stick), and score it.
 */
export function predictSwing(
  grid: CityIndex,
  b: Body,
  ax: number,
  ay: number,
  az: number,
  len: number,
  hx: number,
  hz: number,
  bias: boolean,
  target: SwingTarget | null = null,
  tilt = 0,
): SwingForecast {
  pb.x = b.x;
  pb.y = b.y;
  pb.z = b.z;
  pb.vx = b.vx;
  pb.vy = b.vy;
  pb.vz = b.vz;
  pr.x = ax;
  pr.y = ay;
  pr.z = az;
  pr.len = len;
  pin.hx = hx;
  pin.hz = hz;
  pin.bias = bias;
  // A held stick points along the heading: its air control shapes the swing as it will in the sim.
  pin.sx = hx * tilt;
  pin.sz = hz * tilt;
  const steps = Math.floor(PREDICT_SECONDS / PREDICT_DT + 0.5);
  let best = -Infinity;
  let fallback = -Infinity;
  let window = false;
  let blocked = false;
  let street = false;
  let late = false;
  let fell = false;
  let rose = false;
  let clear = Infinity;
  let scraped = 0;
  let end = 0;
  let slam = false;
  for (let i = 0; i < steps; i++) {
    flightStep(pb, pr, PREDICT_DT, pin);
    const feet = pb.y - HERO_RADIUS - STREET_Y;
    if (feet < clear) clear = feet;
    if (feet <= 0) {
      street = true;
      break;
    }
    const before = len3(pb.vx, pb.vy, pb.vz);
    collideSphere(grid, pb, HERO_RADIUS, phit);
    if (phit.hit) {
      // Landing on a roof, or stuck against a wall under the sim's climb conditions (it starts a
      // climb): the swing is over.
      if (phit.top && pb.vy <= 0) {
        blocked = true;
        end = LANDED;
        break;
      }
      if (phit.wall) {
        const vn = pb.vx * phit.wallNx + pb.vz * phit.wallNz;
        const slide = len2(pb.vx - vn * phit.wallNx, pb.vz - vn * phit.wallNz);
        if (slide < CLIMB_SLIDE && pr.y - pb.y > HERO_RADIUS && len3(pb.vx, pb.vy, pb.vz) < CLIMB_MAX_SPEED) {
          blocked = true;
          end = STUCK;
          break;
        }
      }
      scraped += before - len3(pb.vx, pb.vy, pb.vz);
      // Against a building with the line cut: the web wraps round its corner, or snaps, and
      // then you fall: onto a roof, or into the street.
      if (!wrapRope(grid, pb, pr)) {
        blocked = true;
        end = SNAPPED;
        if (fallsToStreet(grid, steps - i - 1)) {
          street = true;
          clear = 0;
        }
        break;
      }
    }
    if (target && !slam) {
      const lead = Math.min(1, (i + 1) * PREDICT_DT);
      const d = len3(pb.x - target.x - target.vx * lead, pb.y - target.y - target.vy * lead, pb.z - target.z - target.vz * lead);
      if (d < target.r && len3(pb.vx, pb.vy, pb.vz) >= target.speed) slam = true;
    }
    if (pb.vy < -60) fell = true;
    const progress = (pb.x - b.x) * hx + (pb.z - b.z) * hz;
    if (pb.vy > 0) {
      if (fell) rose = true;
      const fwd = pb.vx * hx + pb.vz * hz;
      const carry = fwd > 0 ? Math.min(CARRY_MAX, (fwd * 2 * pb.vy) / GRAVITY) : 0;
      const value = progress + 0.5 * carry;
      if (!late && inReleaseWindow(pb.vx, pb.vy, pb.vz)) {
        window = true;
        if (value > best) best = value;
      } else if (window) late = true; // past the window: still check the arc up to its apex
      else if (value > fallback) fallback = value;
    } else {
      if (window) late = true;
      if (!window && progress > fallback) fallback = progress;
      // The apex after the swing's rise ends it.
      if (rose) break;
    }
  }
  let score = window ? best : fallback - NO_WINDOW;
  if (!Number.isFinite(score)) score = -NO_WINDOW;
  if (blocked) score -= late ? BLOCKED_LATE : end;
  if (street) score -= late ? STREET_LATE : STREET;
  if (clear < SWING_CLEAR) score -= CLEAR_WEIGHT * (SWING_CLEAR - clear);
  score -= SCRAPE * scraped;
  // Hold on past the window and the swing comes back down: the rope's sphere must clear the street.
  const sphere = ay - len - HERO_RADIUS - STREET_Y;
  if (sphere < SPHERE_CLEAR) score -= 300 + 4 * (SPHERE_CLEAR - sphere);
  if (slam) score += SLAM_BONUS;
  return { score, window, blocked, street, clear, doomed: street && !late, slam };
}

/** After a snapped web: free fall from the forecast body for up to `steps`; true if it reaches the street before a roof. */
function fallsToStreet(grid: CityIndex, steps: number): boolean {
  for (let i = 0; i < steps; i++) {
    flightStep(pb, null, PREDICT_DT, pin);
    if (pb.y - HERO_RADIUS - STREET_Y <= 0) return true;
    collideSphere(grid, pb, HERO_RADIUS, phit);
    if (phit.top && pb.vy <= 0) return false;
  }
  return false;
}

/* ------------------------------------------------------------------ choosing an anchor */

interface Candidate {
  cheap: number;
  rank: number;
  x: number;
  y: number;
  z: number;
  kind: AnchorPick["kind"];
}

const pool: Candidate[] = [];
const ids: number[] = [];
/** How many of the best-looking candidates get a full forecast (and a line-of-sight check). */
const FORECASTS = 8;
/** Along a facade, candidates at these multiples of ANCHOR_AHEAD (and the furthest point in reach). */
const AHEAD_STEPS: readonly number[] = [0.45, 1, 1.5];
/** cos 40° and sin 40°: where the cheap estimate puts a swing's release. */
const COS40 = 0.766044443118978;
const SIN40 = 0.6427876096865394;
/**
 * A web from the ground is a jump into the swing (v3; v2 hopped straight up at 260): at least
 * WEB_JUMP_VY up and WEB_JUMP_PUSH along the heading (hx, hz). The hero's attach and the
 * forecast below both launch this way.
 */
export function launchFromGround(b: Body, hx: number, hz: number) {
  if (b.vy < WEB_JUMP_VY) b.vy = WEB_JUMP_VY;
  const along = b.vx * hx + b.vz * hz;
  if (along < WEB_JUMP_PUSH) {
    b.vx += hx * (WEB_JUMP_PUSH - along);
    b.vz += hz * (WEB_JUMP_PUSH - along);
  }
}

interface PickCache {
  key: number[];
  found: Found | null;
}
const caches = new WeakMap<SimState, PickCache>();

/** The arena (plus a margin) a fight confines webs to, or null. */
function webArea(s: SimState): { x0: number; z0: number; x1: number; z1: number } | null {
  if (!(s.mode === "intro" || s.mode === "fight" || s.mode === "won" || s.mode === "ko")) return null;
  const zone = s.city.zones[s.index];
  if (!zone) return null;
  const m = ARENA_ANCHOR_MARGIN;
  return { x0: zone.bounds.x0 - m, z0: zone.bounds.z0 - m, x1: zone.bounds.x1 + m, z1: zone.bounds.z1 + m };
}

/**
 * The anchor for a web right now, heading (hx, hz): see the file comment. Null if nothing
 * fits (a fizzle). A pure function of the hero, the heading, the stop and the city, cached
 * for the tick so the bot and the sim asking the same question pay once.
 */
export function pickAnchor(s: SimState, hx: number, hz: number): AnchorPick | null {
  const f = pickForecast(s, hx, hz);
  return f ? { x: f.x, y: f.y, z: f.z, kind: f.kind } : null;
}

/** The anchor pickAnchor would take, with its forecast: its score, and in a fight whether it slams through him. */
export function pickForecast(s: SimState, hx: number, hz: number): Readonly<Found> | null {
  const h = s.hero;
  const t = s.mode === "fight" ? nearestTarget(s, h.x, h.y, h.z) : null;
  const vm = t && s.villain ? (t.body >= 0 ? s.villain.bodies[t.body] : s.villain) : null;
  const key = [
    h.x, h.y, h.z, h.vx, h.vy, h.vz, hx, hz, h.side, h.grounded ? 1 : 0, s.index, webArea(s) ? 1 : 0, s.mode === "travel" ? 1 : 0, s.input.mag,
    t ? t.x : 0, t ? t.y : 0, t ? t.z : 0, t ? t.r : -1, vm ? vm.vx : 0, vm ? vm.vy : 0, vm ? vm.vz : 0, s.villain && s.villain.kind === "doc-octochain" && docVulnerable(s.villain) ? 1 : 0,
  ];
  const c = caches.get(s);
  if (c && c.key.length === key.length && c.key.every((v, i) => v === key[i])) return c.found;
  const area = webArea(s);
  const v = s.villain;
  let target: SwingTarget | null = null;
  if (t && v) {
    const m = t.body >= 0 ? v.bodies[t.body] : v;
    const open = v.kind !== "doc-octochain" || docVulnerable(v);
    target = { x: t.x, y: t.y, z: t.z, r: t.r + HERO_RADIUS + 10, vx: m.vx, vy: m.vy, vz: m.vz, speed: open ? (v.kind === "doc-octochain" ? SLAM_SPEED * 0.6 : SLAM_SPEED) : Infinity };
  }
  // Within 45° of the heading; with nothing in reach (above the rooftops), a longer look.
  let found = search(s, hx, hz, ANCHOR_RANGE, area, ANCHOR_CONE, false, target);
  if (!found) found = search(s, hx, hz, ANCHOR_RANGE_FAR, area, ANCHOR_CONE, true, target);
  caches.set(s, { key, found });
  return found;
}


const start: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

export interface Found extends AnchorPick {
  score: number;
  slam: boolean;
}

function search(
  s: SimState,
  hx: number,
  hz: number,
  range: number,
  area: { x0: number; z0: number; x1: number; z1: number } | null,
  cone: number,
  far: boolean,
  target: SwingTarget | null,
): Found | null {
  const h = s.hero;
  const grid = s.grid;
  const r2 = range * range;
  const min2 = ANCHOR_MIN * ANCHOR_MIN;
  // The lateral axis: the heading turned 90° (from +x toward +z).
  const lx = -hz;
  const lz = hx;
  start.x = h.x;
  start.y = h.y;
  start.z = h.z;
  start.vx = h.vx;
  start.vy = h.vy;
  start.vz = h.vz;
  if (h.grounded) launchFromGround(start, hx, hz);
  const v2 = start.vx * start.vx + start.vy * start.vy + start.vz * start.vz;
  const wantV2 = PERFECT_MIN_SPEED * PERFECT_MIN_SPEED;
  let count = 0;

  const add = (x: number, y: number, z: number, rank: number, kind: AnchorPick["kind"]) => {
    // One candidate per point (a corner belongs to two facades).
    for (let i = 0; i < count; i++) if (pool[i].x === x && pool[i].y === y && pool[i].z === z) return;
    const dx = x - h.x;
    const dy = y - h.y;
    const dz = z - h.z;
    if (dy < ANCHOR_MIN_RISE) return;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2 + 1e-6 || d2 < min2) return;
    const along = dx * hx + dz * hz;
    const lat = dx * lx + dz * lz;
    if (along < ANCHOR_AHEAD_MIN || lat > along * cone + 1e-9 || -lat > along * cone + 1e-9) return;
    if (area && (x < area.x0 || x > area.x1 || z < area.z0 || z > area.z1)) return;
    // The cheap estimate: forward to the anchor plus the arc beyond it to a 40° release, if the
    // energy is there; marked down when the bottom of the arc nears the street.
    const L = Math.sqrt(d2);
    // A long web from far off must leave the street clear however the swing goes.
    if (far && y - L - HERO_RADIUS - STREET_Y < SPHERE_CLEAR) return;
    const vr2 = v2 + 2 * GRAVITY * (h.y - (y - L * COS40));
    const energy = vr2 <= 0 ? 0 : vr2 >= wantV2 ? 1 : vr2 / wantV2;
    const bottom = y - L - HERO_RADIUS - STREET_Y;
    let cheap = along + L * SIN40 * energy;
    if (bottom < SWING_CLEAR) cheap -= CLEAR_WEIGHT * (SWING_CLEAR - bottom);
    if (h.side !== 0 && lat * h.side < -30) cheap += SIDE_BONUS;
    const c = pool[count] ?? (pool[count] = { cheap: 0, rank: 0, x: 0, y: 0, z: 0, kind: "edge" });
    c.cheap = cheap;
    c.rank = rank;
    c.x = x;
    c.y = y;
    c.z = z;
    c.kind = kind;
    count += 1;
  };

  // Facades: per height (the roof edge, and the wall at the ideal height), the point nearest
  // the ideal spot ahead and the furthest-forward point, inside reach and the cone.
  const n = grid.queryEdges(h.x - range, h.z - range, h.x + range, h.z + range, ids);
  for (let k = 0; k < n; k++) {
    const e = grid.edges[ids[k]];
    const perpH = e.axis === 0 ? h.z : h.x;
    if ((perpH - e.c) * e.n <= 0) continue;
    if (area && (e.axis === 0 ? e.c < area.z0 || e.c > area.z1 : e.c < area.x0 || e.c > area.x1)) continue;
    const dPerp = e.c - perpH;
    const alongH = e.axis === 0 ? h.x : h.z;
    // Along the facade line t, the hero-relative offset is (t − alongH) on one axis and dPerp on the other.
    const ax = e.axis === 0 ? 1 : 0;
    const az = e.axis === 0 ? 0 : 1;
    const px = e.axis === 0 ? 0 : dPerp;
    const pz = e.axis === 0 ? dPerp : 0;
    // along(t) = (t − alongH)·sa + pa, lat(t) = (t − alongH)·sl + pl
    const sa = ax * hx + az * hz;
    const pa = px * hx + pz * hz;
    const sl = ax * lx + az * lz;
    const pl = px * lx + pz * lz;
    const wallLo = Math.max(e.y0, h.y + ANCHOR_MIN_RISE);
    for (let pass = 0; pass < 3; pass++) {
      // The roof edge, then the wall at the ideal height and lower down.
      const y = pass === 0 ? e.y : clamp(h.y + (pass === 1 ? ANCHOR_UP : ANCHOR_UP * 0.6), wallLo, e.y);
      if (pass > 0 && y > e.y - 20) continue;
      const rise = y - h.y;
      if (rise < ANCHOR_MIN_RISE) continue;
      const left = r2 - rise * rise - dPerp * dPerp;
      if (left < 0) continue;
      const w = Math.sqrt(left);
      let lo = Math.max(e.lo, alongH - w) - alongH;
      let hi = Math.min(e.hi, alongH + w) - alongH;
      if (area) {
        lo = Math.max(lo, (e.axis === 0 ? area.x0 : area.z0) - alongH);
        hi = Math.min(hi, (e.axis === 0 ? area.x1 : area.z1) - alongH);
      }
      // Each cone side and "ahead" is a linear bound on u = t − alongH: a·u + b ≥ 0.
      const bound = (a: number, b: number) => {
        if (a > 1e-12) lo = Math.max(lo, -b / a);
        else if (a < -1e-12) hi = Math.min(hi, -b / a);
        else if (b < 0) hi = lo - 1;
      };
      bound(sa - sl * cone, pa - pl * cone);
      bound(sa + sl * cone, pa + pl * cone);
      bound(sa, pa - ANCHOR_AHEAD_MIN);
      if (lo > hi) continue;
      // Points at a few distances ahead along the heading, and the furthest forward.
      const kind = pass === 0 ? "edge" : "wall";
      let last = Infinity;
      for (let j = 0; j <= AHEAD_STEPS.length; j++) {
        const u =
          j < AHEAD_STEPS.length ? clamp((e.axis === 0 ? h.x + hx * ANCHOR_AHEAD * AHEAD_STEPS[j] : h.z + hz * ANCHOR_AHEAD * AHEAD_STEPS[j]) - alongH, lo, hi) : sa > 0 ? hi : lo;
        if (u - last < 30 && last - u < 30) continue;
        last = u;
        const t = alongH + u;
        add(e.axis === 0 ? t : e.c, y, e.axis === 0 ? e.c : t, ids[k] * 16 + pass * 5 + j, kind);
      }
    }
  }
  // Prop anchors.
  const m = grid.queryAnchors(h.x - range, h.z - range, h.x + range, h.z + range, ids);
  for (let k = 0; k < m; k++) {
    const a = grid.anchors[ids[k]];
    add(a.at.x, a.at.y, a.at.z, 1e9 + ids[k], a.kind);
  }
  if (!count) return null;

  // The best-looking few, best first: a full forecast for each in plain sight.
  const bias = s.mode === "travel";
  const tilt = s.input.mag > 0 ? MAG_SCALE[s.input.mag] : 0;
  let best: Candidate | null = null;
  let bestScore = -Infinity;
  let bestSlam = false;
  let tried = 0;
  for (let i = 0; i < count && tried < FORECASTS; i++) {
    let bi = i;
    for (let j = i + 1; j < count; j++) {
      const a = pool[j];
      const b = pool[bi];
      if (a.cheap > b.cheap || (a.cheap === b.cheap && a.rank < b.rank)) bi = j;
    }
    const c = pool[bi];
    pool[bi] = pool[i];
    pool[i] = c;
    if (!lineClear(grid, h.x, h.y, h.z, c.x, c.y, c.z)) continue;
    tried += 1;
    const len = len3(c.x - h.x, c.y - h.y, c.z - h.z);
    const f = predictSwing(grid, start, c.x, c.y, c.z, len, hx, hz, bias, target, tilt);
    if (f.doomed) continue;
    const lat = (c.x - h.x) * lx + (c.z - h.z) * lz;
    const score = f.score + (h.side !== 0 && lat * h.side < -30 ? SIDE_BONUS : 0);
    if (score > bestScore || (score === bestScore && best && c.rank < best.rank)) {
      bestScore = score;
      best = c;
      bestSlam = f.slam;
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z, kind: best.kind, score: bestScore, slam: bestSlam } : null;
}
