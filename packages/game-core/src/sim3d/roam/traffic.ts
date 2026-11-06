/**
 * Free roam's street traffic (roam-2): cars in the sim, so what the City draws is what hits the
 * hero. Patrol nights and chapters keep their decorative traffic (scene/city/traffic.ts); this
 * runs only on an outing's state.
 *
 * - Lanes: every street between the city's edge streets carries one lane each way, round a
 *   stadium loop (out on the right-hand lane, a half turn in the edge street, back on the
 *   other). A street the river crosses is two loops, each turning short of the bank; the street
 *   the river runs down has none. Doc's bridge deck has its own loop up top.
 * - Cars: about one every CAR_SPACING each way, each with its own cruise speed. Stepped state
 *   (how far round its loop, how fast, a hold after a hit), hashed with the outing. A car keeps
 *   its distance to the one ahead (they never pass), waits at its crossing's light, never enters
 *   a crossing a car the other way is in or that it can't get clear of, and brakes for the hero
 *   standing (or lying) in the road ahead. One who darts out isn't seen in time.
 * - The lights: each crossing cycles green one way, all red, green the other way, all red, from
 *   its own offset: a pure function of the tick.
 * - Solid: each car is a box in roam's CityIndex (a mover), so he collides with it, slides along
 *   it, vaults over it, stands on it (and rides it). A car at speed that meets him knocks him
 *   down (roam/knock.ts) and stands a while; a slow one only shoves him out of its way.
 *
 * Deterministic: + − × ÷, Math.sqrt/floor/ceil, dmath's sine and cosine, a fixed order.
 */
import { collideSphere, streetLine, type CityIndex, type SphereHit } from "../city";
import { DT, GRID, HERO_RADIUS, PITCH, STREET } from "../constants";
import type { City } from "../contract";
import { dcos, dsin, PI } from "../dmath";
import { mix } from "../rng";
import type { SimState } from "../types";
import {
  CAR_ACCEL,
  CAR_BRAKE,
  CAR_BRAKE_HARD,
  CAR_CRUISE_MAX,
  CAR_CRUISE_MIN,
  CAR_GAP,
  CAR_LEN,
  CAR_SEE,
  CAR_SPACING,
  CAR_TALL,
  CAR_WIDE,
  DECK_LANE,
  HERO_STILL,
  HIT_HOLD,
  HIT_SPEED,
  LANE,
  LIGHT_CLEAR,
  LIGHT_GREEN,
  RIVER_TURN,
  ROAM_CITY_SEED,
  STOP_SHORT,
} from "./constants";
import { knockDown } from "./knock";
import type { RoamCar, RoamLoop, RoamTraffic } from "./types";

const R = HERO_RADIUS;
const HALF_LEN = CAR_LEN / 2;
const HALF_WIDE = CAR_WIDE / 2;
/** A car's centre waits this far short of a crossing's centre line. */
const WAIT = STREET / 2 + STOP_SHORT + HALF_LEN;
/** How far a car's centre moves from its stop line to clear the crossing. */
const CLEAR = STREET + 2 * STOP_SHORT + CAR_LEN;
const CYCLE = 2 * (LIGHT_GREEN + LIGHT_CLEAR);
/** A car waiting at a light may roll this far past its stop line (its front still short of the crossing) and still wait. */
const PAST = STOP_SHORT;
const N = GRID + 1;

/* ------------------------------------------------------------------ the lanes */

/** The lanes: a loop per street between the edge streets (split by the river), and the deck's. */
export function trafficLoops(city: City): RoamLoop[] {
  const loops: RoamLoop[] = [];
  const lo0 = streetLine(0);
  const hi0 = streetLine(GRID);
  const river = city.river;
  const riverAlongZ = river ? river.z1 - river.z0 > river.x1 - river.x0 : false;
  const add = (axis: 0 | 1, c: number, lo: number, hi: number, r: number, y: number, line: number) => {
    if (hi - lo < 200) return;
    loops.push({ axis, c, lo, hi, r, y, len: 2 * (hi - lo) + 2 * PI * r, line });
  };
  for (const axis of [0, 1] as const) {
    for (let line = 1; line < GRID; line++) {
      const c = streetLine(line);
      if (!river) {
        add(axis, c, lo0, hi0, LANE, 0, line);
        continue;
      }
      // Lanes along z run down the river when the river runs along z (and the same for x).
      const parallel = (axis === 1) === riverAlongZ;
      if (parallel) {
        const r0 = axis === 1 ? river.x0 : river.z0;
        const r1 = axis === 1 ? river.x1 : river.z1;
        if (c > r0 - STREET / 2 && c < r1 + STREET / 2) continue;
        add(axis, c, lo0, hi0, LANE, 0, line);
      } else {
        const r0 = axis === 0 ? river.x0 : river.z0;
        const r1 = axis === 0 ? river.x1 : river.z1;
        add(axis, c, lo0, r0 - RIVER_TURN, LANE, 0, line);
        add(axis, c, r1 + RIVER_TURN, hi0, LANE, 0, line);
      }
    }
  }
  const br = city.bridge;
  if (br) {
    const d = br.deck;
    const alongX = br.axis ? br.axis === "x" : d.x1 - d.x0 >= d.z1 - d.z0;
    const u0 = alongX ? d.x0 : d.z0;
    const u1 = alongX ? d.x1 : d.z1;
    add(alongX ? 0 : 1, alongX ? (d.z0 + d.z1) / 2 : (d.x0 + d.x1) / 2, u0 + 60 + HALF_LEN, u1 - 60 - HALF_LEN, DECK_LANE, d.y, -1);
  }
  return loops;
}

/** Where a car `s` round its loop is: centre (x, z), heading (hx, hz), its box's half sizes. Right-hand traffic on both axes. */
export function placeCar(loop: RoamLoop, s: number, out: { x: number; z: number; hx: number; hz: number; ex: number; ez: number }) {
  const L = loop.hi - loop.lo;
  const r = loop.r;
  const turn = PI * r;
  let along: number;
  let across: number;
  let da: number;
  let dc: number;
  if (s < L) {
    along = loop.lo + s;
    across = r;
    da = 1;
    dc = 0;
  } else if (s < L + turn) {
    const a = (s - L) / r;
    along = loop.hi + r * dsin(a);
    across = r * dcos(a);
    da = dcos(a);
    dc = -dsin(a);
  } else if (s < 2 * L + turn) {
    along = loop.hi - (s - L - turn);
    across = -r;
    da = -1;
    dc = 0;
  } else {
    const a = (s - 2 * L - turn) / r;
    along = loop.lo - r * dsin(a);
    across = -r * dcos(a);
    da = -dcos(a);
    dc = dsin(a);
  }
  if (loop.axis === 0) {
    out.x = along;
    out.z = loop.c + across;
    out.hx = da;
    out.hz = dc;
  } else {
    out.x = loop.c - across;
    out.z = along;
    out.hx = -dc;
    out.hz = da;
  }
  const ax = out.hx < 0 ? -out.hx : out.hx;
  const az = out.hz < 0 ? -out.hz : out.hz;
  out.ex = ax * HALF_LEN + az * HALF_WIDE;
  out.ez = az * HALF_LEN + ax * HALF_WIDE;
}

/* ------------------------------------------------------------------ the lights */

/** Ticks of green left at crossing (i, j) for traffic along `axis` (0 when it's red). A pure function of the tick. */
export function greenLeft(i: number, j: number, axis: number, tick: number): number {
  const off = ((i * 7 + j * 13) % 10) * (CYCLE / 10);
  const t = (tick + off) % CYCLE;
  if (axis === 0) return t < LIGHT_GREEN ? LIGHT_GREEN - t : 0;
  const g = LIGHT_GREEN + LIGHT_CLEAR;
  return t >= g && t < g + LIGHT_GREEN ? g + LIGHT_GREEN - t : 0;
}

/* ------------------------------------------------------------------ building it */

const scratch = { x: 0, z: 0, hx: 0, hz: 0, ex: 0, ez: 0 };

/** Whether a car on a straight stretch at `along` sits in a crossing's box. */
function inCrossing(loop: RoamLoop, along: number): boolean {
  if (loop.line < 0) return false;
  for (let k = 1; k < GRID; k++) {
    const cc = streetLine(k);
    if (along > cc - STREET / 2 - HALF_LEN - 12 && along < cc + STREET / 2 + HALF_LEN + 12) return true;
  }
  return false;
}

/**
 * The traffic at an outing's start: the loops, and the cars spread round them from fixed
 * hashes (none starting in a crossing), each car a mover in `grid`, every one from a standstill;
 * those near the hero's start wait a second, so nothing hits him as he arrives.
 */
export function buildTraffic(city: City, grid: CityIndex, start: { x: number; y: number; z: number }): RoamTraffic {
  const loops = trafficLoops(city);
  const cars: RoamCar[] = [];
  loops.forEach((loop, li) => {
    const n = Math.max(1, Math.floor(loop.len / (2 * CAR_SPACING) + 0.5));
    const first = cars.length;
    const list: { s: number; cruise: number; kind: number }[] = [];
    for (let k = 0; k < n; k++) {
      const h = mix(ROAM_CITY_SEED ^ 0xca75, li * 131 + k);
      let s = ((k + 0.35 * ((h & 0xffff) / 0xffff)) / n) * loop.len;
      // Out of any crossing (a car the other way could be in it).
      for (let tries = 0; tries < 4; tries++) {
        const L = loop.hi - loop.lo;
        const turn = PI * loop.r;
        const straight = s < L || (s >= L + turn && s < 2 * L + turn);
        const along = s < L ? loop.lo + s : loop.hi - (s - L - turn);
        if (!straight || !inCrossing(loop, along)) break;
        s = (s + STREET + CAR_LEN + 40) % loop.len;
      }
      // Not on the hero where the outing starts (back down its lane a few lengths).
      for (let tries = 0; tries < 6; tries++) {
        placeCar(loop, s, scratch);
        const dx = start.x - scratch.x;
        const dz = start.z - scratch.z;
        const clear = start.y > loop.y + CAR_TALL + R || start.y < loop.y - R || dx > scratch.ex + R + 20 || dx < -scratch.ex - R - 20 || dz > scratch.ez + R + 20 || dz < -scratch.ez - R - 20;
        if (clear) break;
        s = (s - 2 * CAR_LEN + loop.len) % loop.len;
      }
      list.push({ s, cruise: CAR_CRUISE_MIN + (CAR_CRUISE_MAX - CAR_CRUISE_MIN) * (((h >>> 16) & 0xffff) / 0xffff), kind: (h >>> 8) & 7 });
    }
    list.sort((a, b) => a.s - b.s);
    list.forEach((c, k) => {
      placeCar(loop, c.s, scratch);
      const y = loop.y;
      const box = grid.addMover(scratch.x - scratch.ex, y, scratch.z - scratch.ez, scratch.x + scratch.ex, y + CAR_TALL, scratch.z + scratch.ez);
      const near = (scratch.x - start.x) * (scratch.x - start.x) + (scratch.z - start.z) * (scratch.z - start.z) < 260 * 260;
      // Every car starts from a standstill (none caught at a light it can't stop for).
      cars.push({ loop: li, s: c.s, v: 0, cruise: c.cruise, kind: c.kind, hold: near ? 60 : 0, lead: first + ((k + 1) % n), box, x: scratch.x, z: scratch.z, hx: scratch.hx, hz: scratch.hz, ex: scratch.ex, ez: scratch.ez, live: true });
    });
  });
  // Who's in which crossing at the start: nobody (no car starts in one).
  return { loops, cars, knock: { down: -1, dx: 0, dz: 1, immune: 0 }, occ: new Uint8Array(N * N), occNext: new Uint8Array(N * N) };
}

/* ------------------------------------------------------------------ the step */

const hit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

// The step's numbers as plain locals (read in the hot loop, a couple of hundred cars a tick).
const K_GRID = GRID;
const K_PITCH = PITCH;
const K_HALF_STREET = STREET / 2;
const K_TALL = CAR_TALL;
const K_LEN = CAR_LEN;
const K_GAP = CAR_GAP;
const K_ACCEL = CAR_ACCEL * DT;
const K_BRAKE2 = 2 * CAR_BRAKE;
const K_HARD = CAR_BRAKE_HARD * DT;
const K_HARD2 = 2 * CAR_BRAKE_HARD;
const K_HIT = HIT_SPEED;
const K_HOLD = HIT_HOLD;
const K_SEE = CAR_SEE;
const K_STILL2 = HERO_STILL * HERO_STILL;
const K_CLEAR_LIGHT = LIGHT_CLEAR * 0.7;
const K_SIDE = HALF_WIDE + R + 4;
const K_PI = PI;
/** A car within this of the hero has its box where it is; further out it's parked off the map (nothing out there needs it). */
const ACTIVE = 1400;
const PARK = -1e6;
/** The street's centre line for grid line k (city.ts streetLine). */
const line = (k: number) => k * K_PITCH - K_HALF_STREET;

/** A car's along-the-street position and direction on a straight stretch (into `sa`); false in a half turn. */
const sa = { along: 0, d: 0 };
function straightAt(loop: RoamLoop, s: number): boolean {
  const L = loop.hi - loop.lo;
  if (s < L) {
    sa.along = loop.lo + s;
    sa.d = 1;
    return true;
  }
  const turn = K_PI * loop.r;
  if (s >= L + turn && s < 2 * L + turn) {
    sa.along = loop.hi - (s - L - turn);
    sa.d = -1;
    return true;
  }
  return false;
}

/** The crossing index for a car on `loop` at grid line `k` across it. */
const crossing = (loop: RoamLoop, k: number) => (loop.axis === 0 ? k * N + loop.line : loop.line * N + k);

/** Mark the crossings a car on a straight stretch at `along` is in (into `occ`). */
function occupy(occ: Uint8Array, loop: RoamLoop, along: number) {
  const kk = Math.floor((along + K_HALF_STREET) / K_PITCH + 0.5);
  for (let k = kk - 1; k <= kk + 1; k++) {
    if (k < 1 || k >= K_GRID) continue;
    const cc = line(k);
    if (along > cc - K_HALF_STREET - HALF_LEN && along < cc + K_HALF_STREET + HALF_LEN) occ[crossing(loop, k)] |= loop.axis === 0 ? 1 : 2;
  }
}

/** The car's own speed limit this tick from the light ahead (Infinity: go). */
function lightLimit(tick: number, t: RoamTraffic, car: RoamCar, index: number, loop: RoamLoop, along: number, d: number): number {
  // The first crossing whose stop line is still ahead (or just behind: a car that rolled a
  // little past it, its front still short of the crossing, still waits).
  const k = d > 0 ? Math.ceil((along + WAIT - PAST + K_HALF_STREET) / K_PITCH) : Math.floor((along - WAIT + PAST + K_HALF_STREET) / K_PITCH);
  if (k < 1 || k >= K_GRID) return Infinity;
  const cc = line(k);
  if (d > 0 ? cc > loop.hi : cc < loop.lo) return Infinity;
  const dist = (cc - d * WAIT - along) * d;
  if (dist < -PAST || dist > 600) return Infinity;
  const i = loop.axis === 0 ? k : loop.line;
  const j = loop.axis === 0 ? loop.line : k;
  const left = greenLeft(i, j, loop.axis, tick);
  const occ = t.occ[crossing(loop, k)] & (loop.axis === 0 ? 2 : 1);
  const lead = t.cars[car.lead];
  const leadGap = car.lead === index ? Infinity : gapTo(car, lead, loop);
  const v = car.v > 60 ? car.v : 60;
  const clearTicks = ((dist + CLEAR) / v) * 60;
  let go = left > 0 && occ === 0;
  // Room past it (don't block the crossing) unless the car ahead is on its way.
  if (go && leadGap < dist + CLEAR + K_GAP && lead.v < lead.cruise * 0.5) go = false;
  // Not enough green left to get clear: stop, if it still can.
  if (go && left + K_CLEAR_LIGHT < clearTicks) go = false;
  if (go) return Infinity;
  // Too close to stop even hard, the light just gone (the other way not green yet, nobody in
  // it): through it, clear in the all-red.
  if (occ === 0 && car.v * car.v > K_HARD2 * (dist + PAST) && greenLeft(i, j, 1 - loop.axis, tick) === 0) return Infinity;
  return Math.sqrt(K_BRAKE2 * (dist > 0 ? dist : 0));
}

/**
 * The gap from a car's front to the back of the one ahead on its loop. Round a half turn (a
 * car is longer than the turn is round) the one ahead counts a car length nearer, so two never
 * swing through it together.
 */
function gapTo(car: RoamCar, lead: RoamCar, loop: RoamLoop): number {
  let g = lead.s - car.s;
  if (g < 0) g += loop.len;
  const L = loop.hi - loop.lo;
  const s = lead.s;
  let turning = s < K_LEN;
  if (!turning && s > L - HALF_LEN) {
    const turn = K_PI * loop.r;
    turning = s < L + turn + K_LEN || s > 2 * L + turn - HALF_LEN;
  }
  return g - K_LEN - (turning ? K_LEN : 0);
}

/** A driver's limit for the hero stood in the lane ahead (Infinity: not in the way). */
function heroLimit(hx: number, hz: number, car: RoamCar, loop: RoamLoop, along: number, d: number): number {
  const across = loop.axis === 0 ? hz - car.z : hx - car.x;
  if (across > K_SIDE || across < -K_SIDE) return Infinity;
  const ahead = ((loop.axis === 0 ? hx : hz) - along) * d - HALF_LEN - R;
  if (ahead > K_SEE || ahead < -HALF_LEN - R) return Infinity;
  const room = ahead - 10;
  return Math.sqrt(K_BRAKE2 * (room > 0 ? room : 0));
}

/**
 * One tick of the traffic, before the hero moves: every car's speed (cruise, the car ahead,
 * the light, the hero in the road), its move round its loop and its box; then the hero, carried
 * by the car he stands on, knocked down by one that meets him at speed, shoved out of one that
 * doesn't.
 */
export function stepTraffic(s: SimState): void {
  const r = s.roam!;
  const t = r.traffic;
  const h = s.hero;
  const b = r.body;
  const grid = s.grid;
  const dt = DT;
  const cars = t.cars;
  const n = cars.length;
  t.knock.immune = t.knock.immune > dt ? t.knock.immune - dt : 0;

  // The hero: where, and whether a driver sees him stood (or lying) in the road at street or
  // deck level (not up on a car's roof: a car he rides doesn't stop for him).
  const hx = h.x;
  const hz = h.z;
  const feet = h.y - R;
  const slow = h.vx * h.vx + h.vz * h.vz < K_STILL2;
  const deckY = t.loops.length ? t.loops[t.loops.length - 1].y : 0;
  const stillStreet = slow && feet > -10 && feet < K_TALL - 6;
  const stillDeck = slow && deckY > 0 && feet > deckY - 10 && feet < deckY + K_TALL - 6;

  // The car he's standing on (he rides it).
  let ride = -1;
  if ((b.move === "ground" || b.move === "roll") && ((feet > K_TALL - 3 && feet < K_TALL + 3) || (deckY > 0 && feet > deckY + K_TALL - 3 && feet < deckY + K_TALL + 3))) {
    for (let i = 0; i < n; i++) {
      const car = cars[i];
      const top = t.loops[car.loop].y + K_TALL;
      if (feet > top - 3 && feet < top + 3 && hx > car.x - car.ex - 4 && hx < car.x + car.ex + 4 && hz > car.z - car.ez - 4 && hz < car.z + car.ez + 4) {
        ride = i;
        break;
      }
    }
  }

  // Who's in which crossing after this tick goes to `next` (the lights read the last tick's).
  const next = t.occNext;
  next.fill(0);
  for (let i = 0; i < n; i++) {
    const car = cars[i];
    const loop = t.loops[car.loop];
    let target = car.cruise;
    if (car.lead !== i) {
      const g = gapTo(car, cars[car.lead], loop) - K_GAP;
      const lim = Math.sqrt(K_BRAKE2 * (g > 0 ? g : 0));
      if (lim < target) target = lim;
    }
    if (straightAt(loop, car.s)) {
      const along = sa.along;
      const d = sa.d;
      if (loop.line >= 0) {
        const lim = lightLimit(s.tick, t, car, i, loop, along, d);
        if (lim < target) target = lim;
      }
      if (loop.y > 0 ? stillDeck : stillStreet) {
        const lim = heroLimit(hx, hz, car, loop, along, d);
        if (lim < target) target = lim;
      }
    }
    if (car.hold > 0) {
      car.hold -= 1;
      target = 0;
    }
    const v0 = car.v;
    if (v0 < target) car.v = v0 + K_ACCEL < target ? v0 + K_ACCEL : target;
    else car.v = v0 - K_HARD > target ? v0 - K_HARD : target;
    const px = car.x;
    const pz = car.z;
    if (car.v > 0) {
      car.s += car.v * dt;
      if (car.s >= loop.len) car.s -= loop.len;
      placeCar(loop, car.s, car);
    }
    if (loop.line >= 0 && straightAt(loop, car.s)) occupy(next, loop, sa.along);
    // Its box: where it is near the hero, parked off the map far from him.
    const ddx = car.x - hx;
    const ddz = car.z - hz;
    if (ddx < ACTIVE && ddx > -ACTIVE && ddz < ACTIVE && ddz > -ACTIVE) {
      if (car.v > 0 || !car.live) grid.moveSolid(car.box, car.x - car.ex, loop.y, car.z - car.ez, car.x + car.ex, loop.y + K_TALL, car.z + car.ez);
      car.live = true;
    } else if (car.live) {
      grid.moveSolid(car.box, PARK, PARK, PARK, PARK + 1, PARK + 1, PARK + 1);
      car.live = false;
    }
    if (i === ride) {
      h.x += car.x - px;
      h.z += car.z - pz;
    }
  }
  t.occNext = t.occ;
  t.occ = next;

  // Meeting the hero: at speed a car knocks him down; slower, it shoves him clear.
  for (let i = 0; i < n; i++) {
    if (i === ride) continue;
    const car = cars[i];
    const dx = h.x - car.x;
    const dz = h.z - car.z;
    if (dx > car.ex + R || dx < -car.ex - R || dz > car.ez + R || dz < -car.ez - R) continue;
    const bx = grid.boxes[car.box];
    if (h.y - R >= bx.y1 || h.y + R <= bx.y0) continue;
    const qx = h.x < bx.x0 ? bx.x0 : h.x > bx.x1 ? bx.x1 : h.x;
    const qy = h.y < bx.y0 ? bx.y0 : h.y > bx.y1 ? bx.y1 : h.y;
    const qz = h.z < bx.z0 ? bx.z0 : h.z > bx.z1 ? bx.z1 : h.z;
    if ((h.x - qx) * (h.x - qx) + (h.y - qy) * (h.y - qy) + (h.z - qz) * (h.z - qz) >= R * R) continue;
    if (car.v >= K_HIT && t.knock.immune <= 0 && b.move !== "splash") {
      knockDown(s, car, i);
      car.hold = K_HOLD;
    }
    // Out of its box (the rest of the city too), this tick: never a frame inside a car.
    collideSphere(grid, h, R, hit);
  }
}

/** The car boxes' hash order: s, v and hold for each car, then the knock. */
export function hashTraffic(t: RoamTraffic, num: (v: number) => void): void {
  num(t.cars.length);
  for (const c of t.cars) {
    num(c.s);
    num(c.v);
    num(c.hold);
  }
  num(t.knock.down);
  num(t.knock.dx);
  num(t.knock.dz);
  num(t.knock.immune);
}
