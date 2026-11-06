/**
 * Case File 003, "Fee Strike": the night's setup and its shared pieces (a leaf: nothing here
 * steps the sim). The flow is fee-strike-step.ts; the rooftop chase is fee-chase.ts.
 *
 * - The city is a patrol city with one stop in the Market District: Gas Goblin's arena, whose
 *   flat stage is Aunt Mainnet's bakery roof (feeCity, feeStops).
 * - Three clues on reachable roofs around the start, placed from the seed (placeFeeClues): a
 *   fee-bomb burn (the one toward the meter: its scorch trail leads there), the stuck pretzel
 *   cart and the florist. Found by coming within CLUE_REACH, in any order.
 * - The fee meter on a roof on the far side of a loop around the start; Gas Goblin's route runs
 *   from it most of the way round the loop and out to the bakery (buildRoute), every point on a
 *   roof where one fits (the chase's checkpoints).
 *
 * Patrol nights and Case File 001 never reach any of this: `state.fee` is absent or null there
 * and every branch checks it.
 *
 * Deterministic: the seeded Rng, dmath trig, + − × ÷ and Math.sqrt / Math.floor only.
 */
import type { FeeClueId } from "../rules/case-003";
import type { Stop } from "../rules/types";

import { generateCity, groundBelow, type CityIndex } from "./city";
import { HERO_RADIUS } from "./constants";
import type { City, Vec3, Zone } from "./contract";
import { datan2, dcos, dsin, len2 } from "./dmath";
import { mix, Rng } from "./rng";
import type { FeeClue, FeeState, FeeWaypoint, SimState } from "./types";

/** Gas Goblin's level tonight: mercy as on nights 3–4 (combat.ts mercy(2) = 2/3), damage 1.08×, 7 hits. */
export const FEE_LEVEL = 2;
/** A clue is found within this of the hero's centre across, and CLUE_TALL times that up and down (as Case File 001's). */
export const CLUE_REACH = 140;
export const CLUE_TALL = 1.5;
/** The loop round the start his route follows: its radius, how far round it goes (radians, plus up to FEE_SWEEP_SPREAD), and the step between route points. */
export const LOOP_R = 1450;
const LOOP_WOBBLE = 210;
export const FEE_SWEEP = 3.5;
const FEE_SWEEP_SPREAD = 0.5;
const ROUTE_STEP = 0.5;
/** The longest leg from the loop out to the bakery before another point goes in between. */
const EXIT_LEG = 950;
/** He flies this high over a route point's roof, and at least this high over anything along a leg. */
const FLY_UP = 230;
const FLY_CLEAR = 130;
/** Over the bakery roof, the route's last point. */
const BAKERY_UP = 300;
/** A route point snaps to a roof within this of where the loop puts it. */
const SNAP = 460;
/** Beside the meter (cooling range): within this across, and METER_RISE up and down. */
export const METER_REACH = 160;
export const METER_RISE = 140;
/** The meter stands this far from the bakery roof's middle once he plants it. */
export const METER_PLANT = 185;
/** Cooling it takes this many ticks of holding the web on it (3.5 s). */
export const COOL_TICKS = 210;
/** A meter-cool event every this many ticks of cooling. */
export const COOL_EVENT_TICKS = 15;
/** He grabs the meter and flees when the hero comes within this of it (across). */
export const GRAB_REACH = 520;
/** After the fees are cooled, this beat before the night ends. */
export const COOLED_SECONDS = 2.5;

/** The input log's ruleset field: 0x0C003100 + the patrol ruleset (hex "C 003 1 04": Case File 003, rules rev 1, ruleset 4), FEE_STRIKE_RULESET "c003-1". */
export const FEE_LOG_RULESET_BASE = 0x0c003100;

/** The case's one stop, as the city sees it: Gas Goblin's arena in the Market District, the stage Aunt Mainnet's roof. */
export function feeStops(): Stop[] {
  return [{ kind: "fight", villain: "gas-goblin", district: "mempool-market", level: FEE_LEVEL, boss: false, quest: false }];
}

/** The case's city from the run's seed. */
export function feeCity(seed: number): City {
  return generateCity(seed, feeStops());
}

/* ------------------------------------------------------------------ roofs */

interface Spot {
  x: number;
  y: number;
  z: number;
  dStart: number;
}

/** Roof spots: the top of every building a hero can land on, outside the arena, clear of its props. */
function roofSpots(city: City, zone: Zone | undefined): Spot[] {
  const out: Spot[] = [];
  const st = city.start;
  const b0 = zone?.bounds;
  const cb = city.bounds;
  for (const b of city.buildings) {
    const roof: { x0: number; z0: number; x1: number; z1: number } = b.top ?? b;
    const y = b.top ? b.top.h : b.h;
    if (roof.x1 - roof.x0 < 110 || roof.z1 - roof.z0 < 110 || y < 170 || y > 520) continue;
    const cx = (roof.x0 + roof.x1) / 2;
    const cz = (roof.z0 + roof.z1) / 2;
    if (b0 && cx > b0.x0 - 160 && cx < b0.x1 + 160 && cz > b0.z0 - 160 && cz < b0.z1 + 160) continue;
    if (cx < cb.x0 + 150 || cx > cb.x1 - 150 || cz < cb.z0 + 150 || cz > cb.z1 - 150) continue;
    const on = city.props.filter((p) => p.buildingId === b.id && p.at.y === y);
    const w = roof.x1 - roof.x0;
    const d = roof.z1 - roof.z0;
    const tries: [number, number][] = [
      [0.5, 0.5],
      [0.3, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
      [0.7, 0.3],
    ];
    let spot: { x: number; z: number } | null = null;
    for (const [fx, fz] of tries) {
      const x = roof.x0 + w * fx;
      const z = roof.z0 + d * fz;
      if (on.every((p) => len2(p.at.x - x, p.at.z - z) >= (p.w > p.d ? p.w : p.d) / 2 + 40)) {
        spot = { x, z };
        break;
      }
    }
    if (!spot) continue;
    out.push({ x: spot.x, y, z: spot.z, dStart: len2(spot.x - st.x, spot.z - st.z) });
  }
  return out;
}

/** The roof spot nearest (x, z) within `within`, not one of `taken`. */
function nearestSpot(spots: Spot[], x: number, z: number, within: number, taken: Set<Spot>): Spot | null {
  let best: Spot | null = null;
  let bestD = within;
  for (const a of spots) {
    if (taken.has(a)) continue;
    const d = len2(a.x - x, a.z - z);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ the route */

/** The highest thing under the leg from a to b (a few lines across its width), for his clearance. */
function legTop(grid: CityIndex, a: Vec3, b: Vec3): number {
  let top = 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = len2(dx, dz) || 1;
  const px = (-dz / l) * 50;
  const pz = (dx / l) * 50;
  const n = Math.max(4, Math.floor(l / 60));
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const x = a.x + dx * f;
    const z = a.z + dz * f;
    for (const s of [-1, 0, 1]) {
      const g = groundBelow(grid, x + px * s, z + pz * s, 5000);
      if (g > top) top = g;
    }
  }
  return top;
}

/**
 * Gas Goblin's route, meter to bakery: from the meter on the far side of the loop round the
 * start, most of the way round it (FEE_SWEEP radians and a seeded bit more, a seeded way
 * round), then out to the bakery roof. Each point snaps to a roof where one fits (a checkpoint)
 * and flies FLY_UP over it, never lower than FLY_CLEAR over anything along its legs.
 */
function buildRoute(city: City, grid: CityIndex, rng: Rng, spots: Spot[]): FeeWaypoint[] {
  const zone = city.zones[0];
  const st = city.start;
  const b = zone?.stage ? { x: (zone.stage.x0 + zone.stage.x1) / 2, y: zone.stage.y, z: (zone.stage.z0 + zone.stage.z1) / 2 } : (zone?.center ?? st);
  const thB = datan2(b.z - st.z, b.x - st.x);
  const way = rng.chance(0.5) ? 1 : -1;
  const sweep = FEE_SWEEP + rng.next() * FEE_SWEEP_SPREAD;
  const th0 = thB - way * sweep;
  const steps = Math.max(5, Math.floor(sweep / ROUTE_STEP + 0.5));
  const ideal: { x: number; z: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const th = th0 + (way * sweep * k) / steps;
    // In and out of the loop as it goes round, so the line weaves over the blocks.
    const r = LOOP_R + (k > 0 && k < steps ? (k % 2 === 0 ? 1 : -1) * LOOP_WOBBLE : 0) + (rng.next() - 0.5) * 120;
    ideal.push({ x: st.x + dcos(th) * r, z: st.z + dsin(th) * r });
  }
  // Out from the loop to the bakery, a point every EXIT_LEG or so.
  const last = ideal[ideal.length - 1];
  const exit = len2(b.x - last.x, b.z - last.z);
  const mids = Math.floor(exit / EXIT_LEG);
  for (let k = 1; k <= mids; k++) {
    const f = k / (mids + 1);
    ideal.push({ x: last.x + (b.x - last.x) * f, z: last.z + (b.z - last.z) * f });
  }
  const taken = new Set<Spot>();
  const pts: FeeWaypoint[] = ideal.map((p, i) => {
    const a = nearestSpot(spots, p.x, p.z, i === 0 ? SNAP * 2 : SNAP, taken);
    if (a) {
      taken.add(a);
      return { x: a.x, y: a.y + FLY_UP, z: a.z, rx: a.x, ry: a.y, rz: a.z, roof: true, at: 0 };
    }
    const g = groundBelow(grid, p.x, p.z, 5000);
    return { x: p.x, y: g + FLY_UP, z: p.z, rx: p.x, ry: g, rz: p.z, roof: false, at: 0 };
  });
  pts.push({ x: b.x, y: b.y + BAKERY_UP, z: b.z, rx: b.x, ry: b.y, rz: b.z, roof: false, at: 0 });
  // Clear of everything along each leg.
  for (let i = 0; i + 1 < pts.length; i++) {
    const need = legTop(grid, pts[i], pts[i + 1]) + FLY_CLEAR;
    if (pts[i].y < need) pts[i].y = need;
    if (pts[i + 1].y < need) pts[i + 1].y = need;
  }
  let at = 0;
  for (let i = 1; i < pts.length; i++) {
    at += len2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].at = at;
  }
  return pts;
}

/* ------------------------------------------------------------------ the clues */

/** How strict each pass is: the clues' distance from the start, their spacing, and how far from the meter. */
const PASSES: { near: [number, number]; spread: number; meter: number }[] = [
  { near: [450, 1150], spread: 650, meter: 550 },
  { near: [350, 1350], spread: 500, meter: 400 },
  { near: [0, 1e9], spread: 250, meter: 0 },
];

/**
 * The three clues, from the seed, on roofs round the start (inside the loop): the burn is the
 * one most toward the meter (its scorch marks lead off that way), then the pretzel cart and
 * the florist. Order: burn, pretzel, florist.
 */
function placeFeeClues(city: City, spots: Spot[], meter: Vec3, rng: Rng, avoid: Set<Spot>): FeeClue[] {
  const st = city.start;
  const pool = spots.filter((a) => !avoid.has(a));
  // A seeded shuffle, so ties go a different way each night.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  const mx = meter.x - st.x;
  const mz = meter.z - st.z;
  const ml = len2(mx, mz) || 1;
  for (const pass of PASSES) {
    const ok = (a: Spot, others: Spot[]) =>
      a.dStart >= pass.near[0] && a.dStart <= pass.near[1] && len2(a.x - meter.x, a.z - meter.z) >= pass.meter && others.every((o) => len2(o.x - a.x, o.z - a.z) >= pass.spread);
    const toward = (a: Spot) => ((a.x - st.x) * mx + (a.z - st.z) * mz) / (ml * (a.dStart || 1));
    const burns = pool.filter((a) => ok(a, [])).sort((a, c) => toward(c) - toward(a));
    const burn = burns[0];
    if (!burn) continue;
    const pretzel = pool.find((a) => a !== burn && ok(a, [burn]));
    if (!pretzel) continue;
    const florist = pool.find((a) => a !== burn && a !== pretzel && ok(a, [burn, pretzel]));
    if (!florist) continue;
    const clue = (id: FeeClueId, a: Spot): FeeClue => ({ id, x: a.x, y: a.y, z: a.z, found: false });
    return [clue("burn", burn), clue("pretzel", pretzel), clue("florist", florist)];
  }
  // A city with no roofs to spare (never seen): around the start roof.
  const y = st.y;
  return [
    { id: "burn", x: st.x + 160, y, z: st.z, found: false },
    { id: "pretzel", x: st.x - 120, y, z: st.z + 150, found: false },
    { id: "florist", x: st.x - 120, y, z: st.z - 150, found: false },
  ];
}

/** Where he plants the meter on the bakery roof: METER_PLANT from its middle, on the side toward the start. */
export function meterPlant(city: City): Vec3 {
  const zone = city.zones[0];
  const st = zone?.stage;
  if (!st) return zone?.center ?? city.start;
  const cx = (st.x0 + st.x1) / 2;
  const cz = (st.z0 + st.z1) / 2;
  const dx = city.start.x - cx;
  const dz = city.start.z - cz;
  const alongX = (dx < 0 ? -dx : dx) >= (dz < 0 ? -dz : dz);
  const sx = alongX ? (dx >= 0 ? 1 : -1) : 0;
  const sz = alongX ? 0 : dz >= 0 ? 1 : -1;
  return { x: cx + sx * METER_PLANT, y: st.y, z: cz + sz * METER_PLANT };
}

/** The case's opening state: the route, the meter on its roof, the clues round the start. */
export function setupFee(city: City, grid: CityIndex, seed: number): FeeState {
  const rng = new Rng(mix(seed, 0xc0031));
  const spots = roofSpots(city, city.zones[0]);
  const route = buildRoute(city, grid, rng, spots);
  const m = route[0];
  // The route's roofs are kept for the route; the clues go elsewhere.
  const used = new Set<Spot>(spots.filter((a) => route.some((p) => p.roof && p.rx === a.x && p.rz === a.z)));
  const clues = placeFeeClues(city, spots, { x: m.rx, y: m.ry, z: m.rz }, rng, used);
  return {
    id: "case-003",
    phase: "investigate",
    clues,
    meter: { x: m.rx, y: m.ry, z: m.rz, carried: false, cool: 0, cooled: false },
    route,
    next: 1,
    checkpoint: 0,
    progress: 0,
    escape: 0,
    losses: 0,
    holdT: 0,
    bombT: 0,
    chaseT: 0,
    coolT: 0,
    spikeT: 0,
    spikeWind: 0,
  };
}

/* ------------------------------------------------------------------ during the night */

/** Clues the hero is touching are found (fee-clue); true when that makes all three. */
export function findFeeClues(s: SimState): boolean {
  const f = s.fee;
  if (!f || f.phase !== "investigate") return false;
  const h = s.hero;
  const r = CLUE_REACH;
  let found = 0;
  for (const k of f.clues) {
    if (!k.found) {
      const dx = k.x - h.x;
      const dz = k.z - h.z;
      if (dx <= r && dx >= -r && dz <= r && dz >= -r) {
        const dy = (k.y + HERO_RADIUS - h.y) / CLUE_TALL;
        if (dx * dx + dz * dz + dy * dy <= r * r) {
          k.found = true;
          s.events.push({ type: "fee-clue", id: k.id, x: k.x, y: k.y, z: k.z, found: f.clues.filter((q) => q.found).length, of: f.clues.length });
        }
      }
    }
    if (k.found) found += 1;
  }
  return found === f.clues.length;
}

/** The nearest clue not yet found, while investigating. */
export function nextFeeClue(s: SimState): FeeClue | null {
  const f = s.fee;
  if (!f || f.phase !== "investigate") return null;
  const h = s.hero;
  let best: FeeClue | null = null;
  let bestD = Infinity;
  for (const k of f.clues) {
    if (k.found) continue;
    const d = len2(k.x - h.x, k.z - h.z);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Where the route sends the hero: the nearest clue, the meter, then Gas Goblin himself; null from the showdown on (the stop's own centre). */
export function feeTarget(s: SimState): Vec3 | null {
  const f = s.fee;
  if (!f) return null;
  switch (f.phase) {
    case "investigate":
      return nextFeeClue(s);
    case "meter":
      return f.meter;
    case "chase":
      return s.villain ?? f.route[f.next] ?? null;
    default:
      return null;
  }
}

/** Whether the hero stands beside the planted meter (cooling range). */
export function besideMeter(s: SimState): boolean {
  const f = s.fee;
  if (!f || f.meter.carried || f.meter.cooled) return false;
  const h = s.hero;
  const m = f.meter;
  const dy = h.y - (m.y + HERO_RADIUS);
  return len2(h.x - m.x, h.z - m.z) <= METER_REACH && dy <= METER_RISE && dy >= -METER_RISE;
}

/** The meter's heat, 1 (jammed at MAX) to 0 (cooled). */
export const meterHeat = (f: FeeState) => (f.meter.cooled ? 0 : 1 - f.meter.cool / COOL_TICKS);
