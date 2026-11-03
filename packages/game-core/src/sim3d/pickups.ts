/**
 * Ruleset 3: things to do between stops. Bits tokens line the streets each leg is best swung
 * down, at swing height, with a boost ring or two; the combo chains perfect releases and
 * pickups, and multiplies what pickups are worth.
 *
 * Placement is a pure function of the city (so of the night's seed and stops): each leg, from
 * the start or the last stop to the next, runs along the street grid in a Z: down the street
 * nearest the leg's start toward the stop, along the cross street halfway between them, and
 * down the street nearest the stop. Tokens sit every PICKUP_SPACING along it, at a height set
 * by the facades either side (where the swing anchors are), clear of arenas, the river and
 * every building; the middle of each long stretch gets a ring instead.
 *
 * Deterministic: + − × ÷ only, and a fixed order (leg, then along the path).
 */
import {
  BITS_POINTS,
  COMBO_GROUND_DRAIN,
  COMBO_MAX_MULT,
  COMBO_STEP,
  COMBO_TICKS,
  GRID,
  MAX_SPEED,
  PICKUP_END,
  PICKUP_REACH,
  PICKUP_SPACING,
  PICKUP_START,
  PITCH,
  REACH_TALL,
  RING_BOOST,
  RING_POINTS,
  RING_REACH,
  RING_SPEED,
  STREET,
} from "./constants";
import { groundBelow, type CityIndex } from "./city";
import type { City, Vec3 } from "./contract";
import { len2, len3 } from "./dmath";
import type { Pickup, SimState } from "./types";

/** A street centre line between block rows i − 1 and i (the grid's inner streets). */
const line = (i: number) => i * PITCH - STREET / 2;

/** The inner street line nearest v, skipping the ones `avoid` rules out (the river). */
function nearestLine(v: number, avoid: (c: number) => boolean): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 1; i < GRID; i++) {
    const c = line(i);
    if (avoid(c)) continue;
    const d = c > v ? c - v : v - c;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Where a leg ends: the ally on an errand, the arena's centre in a fight. */
const legEnd = (city: City, k: number): Vec3 => {
  const z = city.zones[k];
  return z.kind === "errand" ? (z.allyAt ?? z.center) : z.center;
};
const legStart = (city: City, k: number): Vec3 => (k === 0 ? city.start : city.zones[k - 1].center);

/** Height for a token at (x, z) on a street along `axis` (0: along x): from the facades either side. */
function swingHeight(grid: CityIndex, x: number, z: number, axis: 0 | 1): number {
  const off = STREET / 2 + 40;
  const a = axis === 0 ? groundBelow(grid, x, z - off, 5000) : groundBelow(grid, x - off, z, 5000);
  const b = axis === 0 ? groundBelow(grid, x, z + off, 5000) : groundBelow(grid, x + off, z, 5000);
  const lo = a > 0 && b > 0 ? (a < b ? a : b) : a > 0 ? a : b;
  if (lo <= 0) return 230;
  const y = lo * 0.55;
  return y < 160 ? 160 : y > 300 ? 300 : y;
}

/** Whether a token at (x, y, z) sits clear: off the river and the arenas, above whatever is under it. */
function clearSpot(city: City, grid: CityIndex, x: number, y: number, z: number): boolean {
  const r = city.river;
  if (r && x > r.x0 - 60 && x < r.x1 + 60 && z > r.z0 - 60 && z < r.z1 + 60) return false;
  for (const zone of city.zones) {
    if (zone.kind !== "fight") continue;
    const b = zone.bounds;
    if (x > b.x0 - 80 && x < b.x1 + 80 && z > b.z0 - 80 && z < b.z1 + 80) return false;
  }
  if (x < city.bounds.x0 + 60 || x > city.bounds.x1 - 60 || z < city.bounds.z0 + 60 || z > city.bounds.z1 - 60) return false;
  // Nothing solid within reach of it (a building's wall or roof).
  for (const [ox, oz] of [
    [0, 0],
    [40, 0],
    [-40, 0],
    [0, 40],
    [0, -40],
  ]) {
    if (groundBelow(grid, x + ox, z + oz, 5000) > y - 50) return false;
  }
  return true;
}

/** The night's tokens and rings, in a fixed order: leg by leg, along each leg's path. */
export function placePickups(city: City, grid: CityIndex): Pickup[] {
  const out: Pickup[] = [];
  const river = city.river;
  // A street line the river runs along is water, not a street (axis 0: a line of constant z).
  const riverAlongX = !!river && river.x1 - river.x0 > river.z1 - river.z0;
  const wet = (axis: 0 | 1) => (c: number) =>
    !!river && (axis === 0 ? riverAlongX && c > river.z0 && c < river.z1 : !riverAlongX && c > river.x0 && c < river.x1);
  for (let k = 0; k < city.zones.length; k++) {
    const p = legStart(city, k);
    const q = legEnd(city, k);
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    // The leg's main direction picks the cross street (along it) and the two side streets (across).
    const alongX = (dx < 0 ? -dx : dx) >= (dz < 0 ? -dz : dz);
    const mid = alongX ? (p.z + q.z) / 2 : (p.x + q.x) / 2;
    const cross = nearestLine(mid, wet(alongX ? 0 : 1));
    const sideP = nearestLine(alongX ? p.x + (dx > 0 ? 200 : -200) : p.z + (dz > 0 ? 200 : -200), wet(alongX ? 1 : 0));
    const sideQ = nearestLine(alongX ? q.x - (dx > 0 ? 200 : -200) : q.z - (dz > 0 ? 200 : -200), wet(alongX ? 1 : 0));
    if (cross === null || sideP === null || sideQ === null) continue;
    // The Z: three stretches, as (x0, z0) → (x1, z1), each along one axis.
    const pts: [number, number][] = alongX
      ? [
          [sideP, p.z],
          [sideP, cross],
          [sideQ, cross],
          [sideQ, q.z],
        ]
      : [
          [p.x, sideP],
          [cross, sideP],
          [cross, sideQ],
          [q.x, sideQ],
        ];
    const legStartAt = out.length;
    const stretches: { first: number; count: number; length: number }[] = [];
    let carry = PICKUP_SPACING / 2;
    for (let s = 0; s < 3; s++) {
      const [x0, z0] = pts[s];
      const [x1, z1] = pts[s + 1];
      const length = len2(x1 - x0, z1 - z0);
      const axis: 0 | 1 = z0 === z1 ? 0 : 1;
      const first = out.length;
      let t = carry;
      for (; t < length; t += PICKUP_SPACING) {
        const u = t / length;
        const x = x0 + (x1 - x0) * u;
        const z = z0 + (z1 - z0) * u;
        if (len2(x - p.x, z - p.z) < PICKUP_START || len2(x - q.x, z - q.z) < PICKUP_END) continue;
        const y = swingHeight(grid, x, z, axis);
        if (!clearSpot(city, grid, x, y, z)) continue;
        out.push({ id: out.length, kind: "bits", x, y, z, leg: k, taken: false });
      }
      carry = t - length;
      stretches.push({ first, count: out.length - first, length });
    }
    // Rings: the middle token of each long stretch (the longest always, if it has tokens).
    let longest = -1;
    for (let s = 0; s < 3; s++) if (stretches[s].count > 0 && (longest < 0 || stretches[s].length > stretches[longest].length)) longest = s;
    for (let s = 0; s < 3; s++) {
      const st = stretches[s];
      if (st.count < 3 || (s !== longest && st.length < 1100)) continue;
      const ring = out[st.first + Math.floor(st.count / 2)];
      ring.kind = "ring";
      ring.y += 40;
    }
    // Ids are positions in the list.
    for (let i = legStartAt; i < out.length; i++) out[i].id = i;
  }
  return out;
}

/* ------------------------------------------------------------------ the combo */

/** The combo's multiplier: 1, then +1 every COMBO_STEP, at most COMBO_MAX_MULT. */
export function comboMultiplier(count: number): number {
  const m = 1 + Math.floor(count / COMBO_STEP);
  return m > COMBO_MAX_MULT ? COMBO_MAX_MULT : m < 1 ? 1 : m;
}

/** Add to the combo (a perfect release, a pickup) and refill its timer. */
export function feedCombo(s: SimState, n: number) {
  s.combo += n;
  if (s.combo > s.maxCombo) s.maxCombo = s.combo;
  s.comboT = COMBO_TICKS;
}

/** End the combo (the street, or its time ran out). */
export function breakCombo(s: SimState, reason: "time" | "street") {
  if (s.combo > 0) s.events.push({ type: "combo-end", count: s.combo, reason });
  s.combo = 0;
  s.comboT = 0;
}

/** One tick of the combo's timer: it drains, faster standing on a roof, and runs out at zero. */
export function stepCombo(s: SimState) {
  if (s.combo <= 0) return;
  s.comboT -= s.hero.grounded ? COMBO_GROUND_DRAIN : 1;
  if (s.comboT <= 0) breakCombo(s, "time");
}

/* ------------------------------------------------------------------ collecting */

/** Take any token or ring the hero is touching: points (× the multiplier), the combo, and a ring's boost. */
export function collectPickups(s: SimState) {
  const h = s.hero;
  for (const p of s.pickups) {
    if (p.taken) continue;
    const reach = p.kind === "ring" ? RING_REACH : PICKUP_REACH;
    const dx = p.x - h.x;
    const dz = p.z - h.z;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
    // An upright ellipsoid: REACH_TALL times as tall as it is wide, so an arc through the line counts.
    const dy = (p.y - h.y) / REACH_TALL;
    if (dx * dx + dz * dz + dy * dy > reach * reach) continue;
    p.taken = true;
    let points: number;
    if (p.kind === "ring") {
      s.rings += 1;
      points = RING_POINTS * comboMultiplier(s.combo);
      feedCombo(s, 2);
      // The boost: along the way you're going, to at least RING_SPEED (the soft limit bleeds it back).
      const speed = len3(h.vx, h.vy, h.vz);
      if (speed > 1) {
        const want = Math.min(MAX_SPEED * 1.15, Math.max(RING_SPEED, speed * RING_BOOST));
        const k = want / speed;
        h.vx *= k;
        h.vy *= k;
        h.vz *= k;
      }
    } else {
      s.bits += 1;
      points = BITS_POINTS * comboMultiplier(s.combo);
      feedCombo(s, 1);
    }
    s.pickupPoints += points;
    s.events.push({ type: "pickup", kind: p.kind, id: p.id, x: p.x, y: p.y, z: p.z, points, combo: s.combo, multiplier: comboMultiplier(s.combo) });
  }
}

/** The next token or ring on the current leg still to take, in order, or null. */
export function nextPickup(s: SimState): Pickup | null {
  for (const p of s.pickups) if (p.leg === s.index && !p.taken) return p;
  return null;
}
