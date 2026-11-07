/**
 * Free roam's fifth side task (roam-3): "Front-run", Gwei Stacy's rooftop race against
 * Sandwich Man.
 *
 * - Stage 0 → 1: talk to Gwei at her Mempool Market stall (the sidewalk east of Mary Jpeg's
 *   block). She hands over a mempool order (the parcel he carries) for a buyer in Validator
 *   Heights, across the river, and the race starts at once.
 * - Stage 1, the race: six gates in order, then the buyer. A gate counts when the hero's centre
 *   passes within its reach, in turn (`items` holds them as bits). The gates ask for real
 *   moves: up a facade (a climb), up a step onto a setback, a leap over a street, over Sandwich
 *   Man's bread barricade (it spans the roof: a vault), across the river (a zip: no jump makes
 *   it, a fall is a splash), and a leap onto the last roof.
 * - Sandwich Man runs the same course on a fixed route at a fixed pace, a pure function of the
 *   race's clock (rivalAt): he waits a beat at the start ("reading the mempool"), runs up the
 *   facade, along the roofs, hops the barricade, leaps the river in one bound. He reaches the
 *   buyer `course.total` seconds after the go (about 11; the roam bot, running well, takes about 7).
 * - He arrives first, or the parcel goes in the river (a splash): the race is lost. A short hold
 *   (RACE_HOLD) shows it, then the hero is back beside Gwei's stall with a funny line, the
 *   gates cleared, the stage still 1: talk to her and the race goes again at once.
 * - All six gates and the buyer first: TASK_DONE (the buyer relays Gwei's compliment, in gwei).
 *
 * A race never carries over between outings: an outing that starts at stage 1 starts at 0
 * (Gwei asks again), with the gates cleared.
 *
 * The course is hand-laid on the roam city (always the same, ROAM_CITY_SEED), like a time
 * trial's (trial.ts), and checked by test/roam-frontrun.test.ts: every gate is in open air, every
 * roof spot is standable, Sandwich Man's hops clear what they cross, the bot wins and a slow
 * route loses. Deterministic: + − × ÷ and Math.sqrt only, a fixed order.
 */
import { DT, HERO_RADIUS } from "../constants";
import type { RaceFrame, RoamMark, Vec3 } from "../contract";
import { datan2, len2, len3 } from "../dmath";
import type { SimState } from "../types";
import type { SolidBox } from "./furniture";
import { TASK_DONE, TASK_IDS, type RoamEvent, type RoamFolk } from "./types";

const R = HERO_RADIUS;
const FR = TASK_IDS.indexOf("frontrun");

/* ------------------------------------------------------------------ numbers */

/** The finish: all six gates passed, then within this of the buyer (across, and up or down). */
export const FINISH_REACH = 100;
export const FINISH_RISE = 80;
/** After the race is over, this long (ticks) before the reset (lost) or the race closes (won). */
export const RACE_HOLD = 96;
/** Sandwich Man reads the mempool this long before he runs (seconds). */
export const RIVAL_WAIT = 1.5;
/** His pace: on a roof, up a facade, and across a hop (horizontal units a second). */
export const RIVAL_RUN = 430;
export const RIVAL_CLIMB = 300;
export const RIVAL_HOP = 520;
/** His hops fall under this, and his body's centre is this far over his feet (the patrol sim's radius for him). */
export const RIVAL_GRAVITY = 1750;
export const RIVAL_HIP = 44;

/* ------------------------------------------------------------------ the course */

/** The move a gate asks for (the HUD's hint, the tests' check). */
export type GateMove = "climb" | "step" | "leap" | "vault" | "zip";

/** A gate: its centre (in the air, where the hero's centre passes), its reach, and the move. */
export interface RaceGate {
  x: number;
  y: number;
  z: number;
  r: number;
  move: GateMove;
}

/**
 * A point on Sandwich Man's route (feet), how he gets there from the last one (a run along a
 * roof, a climb up a facade, a hop through the air clearing `lift` over the higher end), and the
 * gate he's through on reaching it (−1 none).
 */
export interface RaceNode {
  x: number;
  y: number;
  z: number;
  how: "start" | "run" | "climb" | "hop";
  lift: number;
  gate: number;
}

/** A solid the race adds to roam's grid, drawn as it is: Sandwich Man's bread barricade, Gwei's fruit crates. */
export interface RaceSolid extends SolidBox {
  look: "bread" | "crate";
}

/** Gwei Stacy's race, built once (raceCourse). */
export interface RaceCourse {
  /** Gwei at her stall: feet, and the way she faces (radians, 0 = +z). */
  stall: { x: number; y: number; z: number; yaw: number };
  /** Where the hero is put back for another go (feet), facing the facade he climbs. */
  spot: { x: number; y: number; z: number; fx: number; fz: number };
  gates: RaceGate[];
  /** The buyer at the end: feet, facing. */
  buyer: { x: number; y: number; z: number; yaw: number };
  /** Sandwich Man's route, and the race clock (seconds from the go) he reaches each point at. */
  route: RaceNode[];
  times: number[];
  /** When he reaches the buyer: lose by then. */
  total: number;
  solids: RaceSolid[];
  /**
   * The way a runner takes it (the roam bot's race, bot.ts frontrunRace): up a facade to a roof
   * at least `y` high, on to a feet point (`y` its height), or a zip toward a point.
   */
  runner: { how: "climb" | "go" | "zip"; x: number; y: number; z: number }[];
}

const node = (x: number, y: number, z: number, how: RaceNode["how"], gate = -1, lift = 0): RaceNode => ({ x, y, z, how, lift, gate });

/**
 * The hand-laid course (roam city coordinates; a block is 600, a street 180–204):
 * - Gwei's stall on the sidewalk under the west facade of the Mempool Market block east of
 *   Mary's (x 3132, roof 370); her crates against the wall.
 * - Gate 1 halfway up that facade (a climb). Gate 2 up on the setback next door (roof 443, a
 *   step up). Gate 3 over the street east of it (a leap down to the roof at 245). Gate 4 over
 *   the bread barricade spanning that roof (a vault). Gate 5 on the far bank's tower roof (620),
 *   past the river (a zip from the barricade roof's far corner). Gate 6 on the next roof east
 *   (562, a leap over the street), and the buyer just past it.
 */
function layCourse(): Omit<RaceCourse, "times" | "total"> {
  const lane = 1320;
  const gates: RaceGate[] = [
    { x: 3104, y: 190, z: lane, r: 80, move: "climb" },
    { x: 3530, y: 443 + 44, z: lane, r: 80, move: "step" },
    { x: 3810, y: 425, z: lane, r: 80, move: "leap" },
    { x: 4165, y: 245 + 95, z: lane, r: 75, move: "vault" },
    { x: 4885, y: 620 + 44, z: 1640, r: 95, move: "zip" },
    { x: 5560, y: 562 + 44, z: 1990, r: 85, move: "leap" },
  ];
  const route: RaceNode[] = [
    // From the street corner south of the stall, up the facade beside the hero's way.
    node(3108, 0, 1400, "start"),
    node(3106, 0, 1346, "run"),
    node(3106, 384, 1346, "climb", 0),
    node(3170, 370, lane, "hop", -1, 24),
    node(3425, 370, lane, "run"),
    node(3492, 443, lane, "hop", -1, 30),
    node(3580, 443, lane, "run", 1),
    node(3630, 364, lane, "hop", -1, 10),
    node(3700, 364, lane, "run"),
    node(3990, 245, lane, "hop", 2, 20),
    node(4112, 245, lane, "run"),
    node(4226, 245, lane, "hop", 3, 85),
    node(4335, 245, 1340, "run"),
    node(4870, 620, 1630, "hop", 4, 60),
    node(5200, 620, 1790, "run"),
    node(5520, 562, 1985, "hop", 5, 20),
    node(5905, 562, 2045, "run"),
  ];
  return {
    stall: { x: 3098, y: 0, z: 1236, yaw: -1.5708 },
    spot: { x: 3106, y: 0, z: 1292, fx: 1, fz: 0 },
    gates,
    buyer: { x: 5950, y: 562, z: 2050, yaw: -1.5708 },
    route,
    runner: [
      { how: "climb", x: 3400, y: 368, z: 1292 },
      { how: "go", x: 3540, y: 443, z: lane },
      { how: "go", x: 4300, y: 245, z: lane },
      { how: "zip", x: 4836, y: 620, z: 1596 },
      { how: "go", x: 4890, y: 620, z: 1645 },
      { how: "go", x: 5180, y: 620, z: 1760 },
      { how: "go", x: 5940, y: 562, z: 2050 },
    ],
    solids: [
      // The bread barricade: loaves stacked across the whole roof (vault it; nothing goes round).
      { x0: 4150, y0: 245, z0: 792, x1: 4180, y1: 305, z1: 1368, look: "bread" },
      // Gwei's fruit crates against the wall (low enough to step onto).
      { x0: 3108, y0: 0, z0: 1180, x1: 3132, y1: 34, z1: 1214, look: "crate" },
    ],
  };
}

/** A hop's time: long enough to clear `lift` over the higher end, and no faster than RIVAL_HOP across. */
function hopTime(a: RaceNode, b: RaceNode): number {
  const g = RIVAL_GRAVITY;
  const up = Math.max(0, b.y - a.y) + b.lift;
  const t1 = Math.sqrt((2 * up) / g);
  const t2 = Math.sqrt((2 * (up - (b.y - a.y))) / g);
  return Math.max(t1 + t2, len2(b.x - a.x, b.z - a.z) / RIVAL_HOP, 0.25);
}

function segTime(a: RaceNode, b: RaceNode): number {
  if (b.how === "run") return Math.max(1e-3, len2(b.x - a.x, b.z - a.z) / RIVAL_RUN);
  if (b.how === "climb") return Math.max(1e-3, Math.abs(b.y - a.y) / RIVAL_CLIMB);
  return hopTime(a, b);
}

let course: RaceCourse | null = null;

/** The race course (built once: nothing mutates it). */
export function raceCourse(): RaceCourse {
  if (course) return course;
  const c = layCourse();
  const times = [RIVAL_WAIT];
  for (let i = 1; i < c.route.length; i++) times.push(times[i - 1] + segTime(c.route[i - 1], c.route[i]));
  course = { ...c, times, total: times[times.length - 1] };
  return course;
}

/** Spots no lamp, signal or roof door may stand on (world.ts keepClear): the stall, the gates' roofs, his route. */
export function raceKeepClear(c: RaceCourse): { x: number; y: number; z: number; r: number }[] {
  const out = [
    { x: c.spot.x, y: c.spot.y, z: c.spot.z, r: 50 },
    { x: c.buyer.x, y: c.buyer.y, z: c.buyer.z, r: 60 },
  ];
  for (const n of c.route) out.push({ x: n.x, y: n.y, z: n.z, r: 50 });
  for (const s of c.solids) out.push({ x: (s.x0 + s.x1) / 2, y: s.y0, z: (s.z0 + s.z1) / 2, r: Math.max(s.x1 - s.x0, s.z1 - s.z0) / 2 + 40 });
  return out;
}

/* ------------------------------------------------------------------ Sandwich Man */

/** Where Sandwich Man is at a race clock (seconds from the go): feet, velocity, the segment and what he's doing. */
export interface RivalPlace {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Facing (unit xz). */
  fx: number;
  fz: number;
  /** The route point he's heading for (route.length once there), and the gates he's through. */
  seg: number;
  gates: number;
  move: RaceFrame["rivalMove"];
}

const heading = (c: RaceCourse, i: number): { x: number; z: number } => {
  // The way the route goes from point i (a climb's is the way on over the top).
  for (let k = Math.max(1, i); k < c.route.length; k++) {
    const a = c.route[k - 1];
    const b = c.route[k];
    const d = len2(b.x - a.x, b.z - a.z);
    if (d > 1) return { x: (b.x - a.x) / d, z: (b.z - a.z) / d };
  }
  const a = c.route[c.route.length - 1];
  const d = len2(c.buyer.x - a.x, c.buyer.z - a.z) || 1;
  return { x: (c.buyer.x - a.x) / d, z: (c.buyer.z - a.z) / d };
};

/** Sandwich Man at race clock `t` (a pure function of it: the same on every replay). */
export function rivalAt(c: RaceCourse, t: number, out: RivalPlace): RivalPlace {
  const route = c.route;
  const last = route.length - 1;
  out.vx = 0;
  out.vy = 0;
  out.vz = 0;
  let gates = 0;
  for (let i = 1; i <= last; i++) if (route[i].gate >= 0 && c.times[i] <= t) gates++;
  out.gates = gates;
  if (t <= c.times[0] || t >= c.times[last]) {
    const at = t <= c.times[0] ? route[0] : route[last];
    out.x = at.x;
    out.y = at.y;
    out.z = at.z;
    out.seg = t <= c.times[0] ? 1 : route.length;
    const f = t <= c.times[0] ? heading(c, 1) : heading(c, route.length);
    out.fx = f.x;
    out.fz = f.z;
    out.move = t <= c.times[0] ? "wait" : "won";
    return out;
  }
  let i = 1;
  while (i < last && c.times[i] <= t) i++;
  const a = route[i - 1];
  const b = route[i];
  const T = c.times[i] - c.times[i - 1];
  const tau = t - c.times[i - 1];
  const u = tau / T;
  out.seg = i;
  out.x = a.x + (b.x - a.x) * u;
  out.z = a.z + (b.z - a.z) * u;
  out.vx = (b.x - a.x) / T;
  out.vz = (b.z - a.z) / T;
  if (b.how === "hop") {
    const vy0 = (b.y - a.y) / T + 0.5 * RIVAL_GRAVITY * T;
    out.y = a.y + vy0 * tau - 0.5 * RIVAL_GRAVITY * tau * tau;
    out.vy = vy0 - RIVAL_GRAVITY * tau;
    out.move = "leap";
  } else {
    out.y = a.y + (b.y - a.y) * u;
    out.vy = (b.y - a.y) / T;
    out.move = b.how === "climb" ? "climb" : "run";
  }
  const f = heading(c, i);
  out.fx = f.x;
  out.fz = f.z;
  return out;
}

/* ------------------------------------------------------------------ the race's state and events */

/** The race (RoamState.race). Its clock is the rival's; nothing here carries over between outings. */
export interface RoamRace {
  /** 0 not on (before the first talk, after a loss, after the win), 1 running, 2 over (the hold). */
  state: number;
  /** Ticks since the go. */
  t: number;
  /** Ticks left of the hold. */
  hold: number;
  /** How it ended: 0 not yet, 1 won, 2 lost (he got there first), 3 lost (the river). */
  end: number;
}

export const newRace = (): RoamRace => ({ state: 0, t: 0, hold: 0, end: 0 });

export type RaceEvent =
  /** The race: off (Gwei's talk), won, lost (who or what beat him), and the reset at her stall. */
  | { type: "roam-race"; state: "start" | "won" | "lost" | "reset"; why: "rival" | "river" | null; x: number; y: number; z: number }
  /** A gate passed (the hero's), how many of how many. */
  | { type: "roam-gate"; gate: number; got: number; of: number; x: number; y: number; z: number };

const bits = (n: number) => {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c += 1;
  return c;
};

/** The gates passed so far (they're taken in order, so the bits run from 0). */
export const gatesPassed = (s: SimState) => bits(s.roam!.progress.items[FR]);

/** Gwei's lines (rules/city.ts FOLKS.gwei), by what's going on. */
export const GWEI_LINE = { start: 0, again: 1, hurry: 2, sandwiched: 3, river: 4, done: 5 } as const;
/** The buyer's thanks at the finish (FOLKS.buyer). */
export const BUYER_DONE_LINE = 2;

function emit(s: SimState, e: RoamEvent) {
  s.roam!.events.push(e);
}

function setStage(s: SimState, stage: number) {
  s.roam!.progress.stage[FR] = stage;
  emit(s, { type: "roam-task", task: "frontrun", stage, done: stage === TASK_DONE });
}

function startRace(s: SimState) {
  const r = s.roam!;
  r.race.state = 1;
  r.race.t = 0;
  r.race.hold = 0;
  r.race.end = 0;
  r.progress.items[FR] = 0;
  emit(s, { type: "roam-race", state: "start", why: null, x: s.hero.x, y: s.hero.y - R, z: s.hero.z });
}

/**
 * Talking to Gwei or the buyer (tasks.ts talk): the line to say, and the race's moves. Gwei at
 * stage 0 hands over the order (stage 1, the race is on); at stage 1 with no race on, again at
 * once; mid-race she hurries him on. The buyer only talks (the finish is arriving).
 */
export function talkFrontrun(s: SimState, f: RoamFolk, line: number): number {
  const r = s.roam!;
  const stage = r.progress.stage[FR];
  if (f.gives !== "frontrun") return line;
  if (stage === 0) {
    setStage(s, 1);
    startRace(s);
    return GWEI_LINE.start;
  }
  if (stage === 1 && r.race.state === 0) {
    startRace(s);
    return GWEI_LINE.again;
  }
  if (stage === 1) return GWEI_LINE.hurry;
  return line;
}

/** Into a move without the parkour set's step (the reset's): its bookkeeping, as knock.ts does it. */
function standAt(s: SimState, x: number, y: number, z: number, fx: number, fz: number) {
  const r = s.roam!;
  const b = r.body;
  const h = s.hero;
  if (b.move !== "ground") r.events.push({ type: "roam-move", move: "ground", from: b.move, x: h.x, y: h.y, z: h.z, speed: len3(h.vx, h.vy, h.vz) });
  h.x = x;
  h.y = y + R;
  h.z = z;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.fx = fx;
  h.fz = fz;
  h.rope = null;
  h.latched = false;
  h.grounded = true;
  b.move = "ground";
  b.moveT = 0;
  b.jumpBuf = 0;
  b.coyote = 0;
  b.wallruns = 0;
  b.launchT = 0;
  r.traffic.knock.down = 0;
}

/** One tick of the race (tasks.ts stepPeople, after the move): gates, the finish, and losing. */
export function stepRace(s: SimState) {
  const r = s.roam!;
  const race = r.race;
  if (race.state === 0) return;
  const c = r.world.race;
  const h = s.hero;
  if (race.state === 2) {
    race.hold -= 1;
    if (race.hold > 0) return;
    race.state = 0;
    if (race.end === 1) return;
    // Back at Gwei's stall for another go: the gates cleared, her line for how it went.
    const why = race.end === 3 ? "river" : "rival";
    r.progress.items[FR] = 0;
    standAt(s, c.spot.x, c.spot.y, c.spot.z, c.spot.fx, c.spot.fz);
    const gwei = r.world.folks.find((f) => f.gives === "frontrun");
    if (gwei) r.chat = { folk: gwei.id, line: why === "river" ? GWEI_LINE.river : GWEI_LINE.sandwiched, ticks: 300 };
    emit(s, { type: "roam-race", state: "reset", why, x: c.spot.x, y: c.spot.y, z: c.spot.z });
    return;
  }
  race.t += 1;
  const p = r.progress;
  const next = bits(p.items[FR]);
  if (next < c.gates.length) {
    const g = c.gates[next];
    if (len3(h.x - g.x, h.y - g.y, h.z - g.z) < g.r) {
      p.items[FR] |= 1 << next;
      emit(s, { type: "roam-gate", gate: next, got: next + 1, of: c.gates.length, x: g.x, y: g.y, z: g.z });
    }
  }
  const time = race.t * DT;
  const feet = h.y - R;
  if (bits(p.items[FR]) >= c.gates.length && len2(h.x - c.buyer.x, h.z - c.buyer.z) < FINISH_REACH && Math.abs(feet - c.buyer.y) < FINISH_RISE) {
    // Filled first: the task's done, and the buyer says so.
    race.state = 2;
    race.end = 1;
    race.hold = RACE_HOLD;
    setStage(s, TASK_DONE);
    const buyer = r.world.folks.find((f) => f.takes === "frontrun");
    if (buyer) r.chat = { folk: buyer.id, line: BUYER_DONE_LINE, ticks: 300 };
    emit(s, { type: "roam-race", state: "won", why: null, x: c.buyer.x, y: c.buyer.y, z: c.buyer.z });
    return;
  }
  const river = r.body.move === "splash";
  if (time >= c.total || river) {
    race.state = 2;
    race.end = river ? 3 : 2;
    race.hold = RACE_HOLD;
    const at = river ? { x: h.x, y: 0, z: h.z } : c.route[c.route.length - 1];
    emit(s, { type: "roam-race", state: "lost", why: river ? "river" : "rival", x: at.x, y: at.y, z: at.z });
  }
}

/**
 * An outing's start (step.ts createRoamSim): a race can't carry over, so a stage 1 starts at 0
 * (Gwei asks again), and the gates are cleared unless the task's done.
 */
export function startFrontrun(stage: number[], items: number[]) {
  if (stage[FR] === 1) stage[FR] = 0;
  if (stage[FR] !== TASK_DONE) items[FR] = 0;
}

/* ------------------------------------------------------------------ render and hash */

const place: RivalPlace = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 1, fz: 0, seg: 0, gates: 0, move: "wait" };

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

/** The race's part of the frame (render.ts): RoamFrame.race while it's on or just over, else null. */
export function fillRaceFrame(s: SimState, prev: RaceFrame | null): RaceFrame | null {
  const r = s.roam!;
  const race = r.race;
  if (race.state === 0) return null;
  const c = r.world.race;
  rivalAt(c, race.t * DT, place);
  const f = prev ?? { rival: v3(), rivalVel: v3(), rivalYaw: 0, rivalMove: "wait", rivalGate: 0, heroGate: 0, of: c.gates.length, ticks: 0, left: 0, over: null, why: null };
  f.rival.x = place.x;
  f.rival.y = place.y;
  f.rival.z = place.z;
  // Held still once it's over (won: he stops where the hero beat him; lost: he's at the buyer).
  const still = race.state === 2;
  f.rivalVel.x = still ? 0 : place.vx;
  f.rivalVel.y = still ? 0 : place.vy;
  f.rivalVel.z = still ? 0 : place.vz;
  f.rivalYaw = datan2(place.fx, place.fz);
  f.rivalMove = still && race.end === 1 ? "beaten" : place.move;
  f.rivalGate = place.gates;
  f.heroGate = gatesPassed(s);
  f.of = c.gates.length;
  f.ticks = race.t;
  f.left = Math.max(0, c.total - race.t * DT);
  f.over = race.state === 2 ? (race.end === 1 ? "won" : "lost") : null;
  f.why = race.end === 2 ? "rival" : race.end === 3 ? "river" : null;
  return f;
}

/** The gates as map marks (RoamFrame.marks, from index `n`; returns the next free index): only while the race runs. */
export function fillRaceMarks(s: SimState, marks: RoamMark[], n: number): number {
  const r = s.roam!;
  if (r.race.state !== 1) return n;
  const got = gatesPassed(s);
  const gates = r.world.race.gates;
  for (let i = 0; i < gates.length; i++) {
    const m = marks[n] ?? (marks[n] = { task: "frontrun", kind: "gate", pos: v3(), done: false, next: false });
    m.task = "frontrun";
    m.kind = "gate";
    m.pos.x = gates[i].x;
    m.pos.y = gates[i].y;
    m.pos.z = gates[i].z;
    m.done = i < got;
    m.next = i === got;
    n++;
  }
  return n;
}

/** The race's state, for the outing's hash (hash.ts), in a fixed order. */
export function hashRace(race: RoamRace, num: (v: number) => void) {
  num(race.state);
  num(race.t);
  num(race.hold);
  num(race.end);
}
