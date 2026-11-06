/**
 * Time trials (ruleset tag "trial-1"): a short course of gates through a fixed city, raced
 * against the clock on the patrol hero's own movement (hero.ts, swing.ts: unchanged). This
 * file is the trial's setup and its step (a leaf: it imports nothing that steps the sim).
 *
 * - Each course is hand-laid on its own city: a patrol city generated from the course's
 *   fixed seed and a stop list that shapes its districts (low brownstones for the sprint,
 *   the river and Doc's bridge for the bridge run, Validator Heights' towers for the canyon
 *   and the climb). The stops only shape the streets: a trial city has no zones, so nothing
 *   is fought or visited. Its start is the course's start roof.
 * - The gates are the city's boost rings (`state.pickups`, kind "ring", in course order), so
 *   the scene draws them with the rings it already has. They're taken one at a time, in
 *   order, within RING_REACH (REACH_TALL times that up and down), and each gives the ring's
 *   boost. A gate out of turn is just air.
 * - Through the last gate the clock stops: `trial-finish`, then `night-over`. Out of time
 *   (TRIAL_MAX_SECONDS) ends it unfinished.
 *
 * Patrol and chapter nights never reach any of this: `state.trial` is null (or absent) and
 * every branch checks it. Deterministic: + − × ÷ and Math.sqrt / Math.floor only.
 */
import type { Stop, TrialCourseId } from "../rules/types";

import { blockCenter, CityIndex, generateCity, groundBelow, streetLine } from "./city";
import { HERO_RADIUS, MAX_SPEED, REACH_TALL, RING_BOOST, RING_REACH, RING_SPEED, RULESET_VERSION, SIM_HZ } from "./constants";
import type { City, Vec3 } from "./contract";
import { len2, len3 } from "./dmath";
import type { Pickup, SimState, TrialState } from "./types";

/** The courses, in the order their log ruleset numbers them (append only). */
export const TRIAL_COURSE_IDS: readonly TrialCourseId[] = ["rooftop-sprint", "bridge-run", "canyon-swing", "tower-climb", "gauntlet"];

export const isTrialCourse = (v: unknown): v is TrialCourseId => typeof v === "string" && (TRIAL_COURSE_IDS as readonly string[]).includes(v);

/** A trial ends unfinished after this long. */
export const TRIAL_MAX_SECONDS = 240;
export const TRIAL_MAX_TICKS = TRIAL_MAX_SECONDS * SIM_HZ;

/**
 * The input log's ruleset field for a course: 0x07A10000 + its number (1–) × 0x100 + the
 * patrol ruleset it runs on, read as hex "7A1 01 04" (trial rules rev 1, course 1, ruleset 4).
 * A patrol log carries RULESET_VERSION (4) and a chapter's 0x0C0011xx, so no log replays as
 * another mode's, nor one course's as another's.
 */
export function trialLogRuleset(course: TrialCourseId): number {
  return 0x07a10000 + (TRIAL_COURSE_IDS.indexOf(course) + 1) * 0x100 + RULESET_VERSION;
}

/* ------------------------------------------------------------------ the courses */

const B = blockCenter;
const L = streetLine;

const errand = (district: Stop["district"]): Stop => ({ kind: "errand", ally: "aunt-mainnet", errand: "trial", district } as Stop);
const fight = (villain: "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil", district: Stop["district"]): Stop => ({
  kind: "fight",
  villain,
  district,
  level: 1,
  boss: false,
  quest: false,
});

/**
 * Where a gate (or the start) sits:
 * - `{ x, z, roof }`: `roof` above the roof under (x, z), or the nearest roof's centre over a street;
 * - `{ x, z, y }`: a fixed point in the air;
 * - `{ along, up }`: `up` above Doc's bridge deck, `along` −1…1 from one end to the other;
 * - `{ along, roof }`: over the roof nearest that point on the bridge's line (past ±1 is over a bank).
 */
type Spot = { x: number; z: number; roof: number } | { x: number; z: number; y: number } | { along: number; up: number } | { along: number; roof: number };

interface CourseGeometry {
  /** The city's seed (also the run's seed: a course is the same race every time). */
  seed: number;
  /** Shapes the city's districts (and the river); a trial city has no zones. */
  stops: Stop[];
  /** The start roof: the hero stands on the roof under (or nearest) this point. */
  start: Spot;
  gates: Spot[];
}

/**
 * The courses. Block and street helpers: B(i) is block i's centre, L(i) the street between
 * blocks i − 1 and i (a block is 600 wide, a street 180; the grid is 9 × 9). Hand-laid on
 * each course's own city and checked by test/trial.test.ts: every gate is in open air, the
 * bot finishes every course, and the medal times hold.
 */
export const COURSE_GEOMETRY: Record<TrialCourseId, CourseGeometry> = {
  // Queens Block's brownstones east from the start roof, roof to roof, up onto a setback at the end.
  "rooftop-sprint": {
    seed: 0x7a100001,
    stops: [errand("queens-block"), errand("queens-block"), errand("mempool-market"), errand("queens-block")],
    start: { x: B(4), z: B(4), roof: 0 },
    gates: [
      { x: 4024, z: 3420, roof: 90 },
      { x: 4775, z: 3420, roof: 90 },
      { x: 5576, z: 3420, roof: 90 },
      { x: 5864, z: 3555, roof: 90 },
      { x: 6361, z: 3290, roof: 90 },
      { x: 6649, z: 3420, roof: 80 },
    ],
  },
  // From the east bank onto Doc's bridge, between both pairs of his towers, over the river, and
  // up onto the far bank's roof.
  "bridge-run": {
    seed: 0x7a100002,
    stops: [errand("bridge-district"), fight("doc-octochain", "bridge-district"), errand("sector-7")],
    start: { along: 1.35, roof: 0 },
    gates: [
      { along: 0.95, up: 110 },
      { along: 0.689, up: 120 },
      { along: 0, up: 100 },
      { along: -0.689, up: 120 },
      { along: -1.05, up: 160 },
      { along: -1.6, roof: 80 },
    ],
  },
  // Down into the street canyon between Validator Heights' towers (roofs at 500–800), north low
  // along it, round the corner and east to its end.
  "canyon-swing": {
    seed: 0x7a100003,
    stops: [errand("validator-heights"), errand("validator-heights"), errand("validator-heights"), errand("validator-heights")],
    start: { x: B(4), z: B(4), roof: 0 },
    gates: [
      { x: L(5), z: B(3), y: 260 },
      { x: L(5), z: 1860, y: 250 },
      { x: 4150, z: L(2), y: 270 },
      { x: L(6), z: L(2), y: 250 },
      { x: 5100, z: L(2), y: 260 },
      { x: 5620, z: L(2), y: 300 },
    ],
  },
  // Up the Heights: roof to higher roof, a wall to climb, to the top of an 800-unit tower.
  "tower-climb": {
    seed: 0x7a100004,
    stops: [fight("sybil", "validator-heights"), errand("validator-heights"), errand("validator-heights")],
    start: { x: B(4), z: B(4), roof: 0 },
    gates: [
      { x: 4030, z: 2640, roof: 90 },
      { x: 4832, z: 2531, roof: 90 },
      { x: 4831, z: 2818, roof: 90 },
      { x: 5120, z: 2789, roof: 100 },
    ],
  },
  // All of it: a rooftop, a dive to the street, low between the blocks, across the city to Doc's
  // bridge, between his towers, and up onto the far bank.
  gauntlet: {
    seed: 0x7a100005,
    stops: [errand("mempool-market"), fight("doc-octochain", "bridge-district"), errand("validator-heights"), errand("sector-7")],
    start: { x: B(4), z: B(4), roof: 0 },
    gates: [
      { x: 4046, z: 3420, roof: 90 },
      { x: L(6), z: 3420, y: 150 },
      { x: L(6), z: 4200, y: 230 },
      { along: 0.95, up: 110 },
      { along: 0.2, up: 100 },
      { along: -0.689, up: 120 },
      { along: -1.5, roof: 90 },
    ],
  },
};

/** The roof at (x, z), or the nearest building's roof (its top face's centre) when (x, z) is over a street or an alley. */
export function roofAt(city: City, grid: CityIndex, x: number, z: number): Vec3 {
  const y = groundBelow(grid, x, z, 1e9);
  if (y > 0) return { x, y, z };
  let best: Vec3 = { x, y: 0, z };
  let bestD = Infinity;
  for (const b of city.buildings) {
    const box = b.top ?? b;
    const h = b.top ? b.top.h : b.h;
    const cx = (box.x0 + box.x1) / 2;
    const cz = (box.z0 + box.z1) / 2;
    const d = len2(cx - x, cz - z);
    if (d < bestD) {
      bestD = d;
      best = { x: cx, y: h, z: cz };
    }
  }
  return best;
}

/** A point on the bridge deck: `along` −1…1 from one end to the other (past ±1 is off the end, over the bank), `up` above the deck. */
function deckPoint(city: City, along: number, up: number): Vec3 | null {
  const br = city.bridge;
  if (!br) return null;
  const d = br.deck;
  const cx = (d.x0 + d.x1) / 2;
  const cz = (d.z0 + d.z1) / 2;
  const alongZ = br.axis === "z";
  const half = alongZ ? (d.z1 - d.z0) / 2 : (d.x1 - d.x0) / 2;
  return { x: alongZ ? cx : cx + along * half, y: d.y + up, z: alongZ ? cz + along * half : cz };
}

function spotPoint(city: City, grid: CityIndex, s: Spot): Vec3 {
  if ("along" in s) {
    const p = deckPoint(city, s.along, "up" in s ? s.up : 0) ?? { x: city.start.x, y: city.start.y, z: city.start.z };
    if ("up" in s) return p;
    const r = roofAt(city, grid, p.x, p.z);
    return { x: r.x, y: r.y + s.roof, z: r.z };
  }
  if ("roof" in s) {
    const r = roofAt(city, grid, s.x, s.z);
    return { x: r.x, y: r.y + s.roof, z: r.z };
  }
  return { x: s.x, y: s.y, z: s.z };
}

/** A course's city: the patrol city of its seed and stops, with no zones, starting on the course's start roof. */
export function trialCity(course: TrialCourseId): City {
  const g = COURSE_GEOMETRY[course];
  const city = generateCity(g.seed, g.stops);
  city.zones = [];
  const grid = new CityIndex(city);
  const p = spotPoint(city, grid, g.start);
  const r = roofAt(city, grid, p.x, p.z);
  city.start = { x: r.x, y: r.y, z: r.z };
  return city;
}

/** The course's gates as the night's rings, in order (ids are the order). */
export function trialGates(course: TrialCourseId, city: City, grid: CityIndex): Pickup[] {
  return COURSE_GEOMETRY[course].gates.map((s, i) => {
    const p = spotPoint(city, grid, s);
    return { id: i, kind: "ring", x: p.x, y: p.y, z: p.z, leg: 0, taken: false };
  });
}

/** A trial's opening state: no gate passed, the clock at zero. */
export function setupTrial(course: TrialCourseId): TrialState {
  return { course, next: 0, splits: [], finished: false, endTick: -1 };
}

/** The gate to pass next, or null once the trial is over. */
export function nextGate(s: SimState): Pickup | null {
  const t = s.trial;
  if (!t || t.endTick >= 0) return null;
  return s.pickups[t.next] ?? null;
}

/** End the trial: through the finish (`finished`) or out of time. */
function endTrial(s: SimState, finished: boolean) {
  const t = s.trial!;
  t.finished = finished;
  t.endTick = s.tick;
  s.mode = "done";
  s.villain = null;
  s.events.push({ type: "trial-finish", course: t.course, finished, ticks: s.tick });
  s.events.push({ type: "night-over", reason: "route" });
}

/**
 * One tick of the trial, after the hero has moved (travel mode): the next gate, if the hero
 * is through it (the ring's reach), with the ring's boost; the finish; the time limit.
 */
export function stepTrial(s: SimState) {
  const t = s.trial;
  if (!t || t.endTick >= 0) return;
  const g = s.pickups[t.next];
  const h = s.hero;
  if (g && !g.taken) {
    const r = RING_REACH;
    const dx = g.x - h.x;
    const dz = g.z - h.z;
    if (dx <= r && dx >= -r && dz <= r && dz >= -r) {
      const dy = (g.y - h.y) / REACH_TALL;
      if (dx * dx + dz * dz + dy * dy <= r * r) {
        g.taken = true;
        t.splits.push(s.tick);
        t.next += 1;
        // The ring's boost, as on a patrol night (pickups.ts): along the way you're going.
        const speed = len3(h.vx, h.vy, h.vz);
        if (speed > 1) {
          const want = Math.min(MAX_SPEED * 1.15, Math.max(RING_SPEED, speed * RING_BOOST));
          const k = want / speed;
          h.vx *= k;
          h.vy *= k;
          h.vz *= k;
        }
        // The ring's pop and sound (the scene's own), worth nothing here; then the split.
        s.events.push({ type: "pickup", kind: "ring", id: g.id, x: g.x, y: g.y, z: g.z, points: 0, combo: s.combo, multiplier: 1 });
        s.events.push({ type: "trial-gate", index: t.next - 1, of: s.pickups.length, ticks: s.tick, x: g.x, y: g.y, z: g.z });
        if (t.next >= s.pickups.length) {
          endTrial(s, true);
          return;
        }
      }
    }
  }
  if (s.tick >= TRIAL_MAX_TICKS) endTrial(s, false);
}

/** Whether a point is in open air: nothing solid within `clear` of it (a gate must be flown through, not dug for). */
export function openAir(grid: CityIndex, p: Vec3, clear = HERO_RADIUS + 14): boolean {
  const ids: number[] = [];
  const n = grid.queryBoxes(p.x - clear, p.z - clear, p.x + clear, p.z + clear, ids);
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[ids[k]];
    const dx = p.x < b.x0 ? b.x0 - p.x : p.x > b.x1 ? p.x - b.x1 : 0;
    const dy = p.y < b.y0 ? b.y0 - p.y : p.y > b.y1 ? p.y - b.y1 : 0;
    const dz = p.z < b.z0 ? b.z0 - p.z : p.z > b.z1 ? p.z - b.z1 : 0;
    if (dx * dx + dy * dy + dz * dz < clear * clear) return false;
  }
  return true;
}
