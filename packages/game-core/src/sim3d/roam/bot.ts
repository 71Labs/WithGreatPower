/**
 * A scripted player for free roam: the goldens, the movement tests and `?autopilot=1` hand it a
 * list of goals and it turns each into input frames, as a person on a stick would. It reads the
 * sim (where the hero is, what the body is doing) and writes only InputFrames, so a log it plays
 * replays exactly. It isn't clever: it follows the street grid to a building, climbs it with the
 * stick held into the wall, walks the roof, presses the buttons it's told to.
 */
import { BLOCK, GRID, HERO_RADIUS, PITCH, STREET } from "../constants";
import type { InputFrame } from "../contract";
import { dirIndex, len2 } from "../dmath";
import type { SimState } from "../types";
import { SHOT_ACT, SHOT_DROP, SHOT_JUMP, SHOT_SPRINT, SHOT_ZIP } from "./constants";
import { RELAY_HOLD } from "./task-crosschain";
import type { RoamRelay, RoamWorld } from "./types";

export type RoamBotGoal =
  /**
   * Run (sprinting if far) to a feet point, within `r` across (and, given `y`, at about that
   * height); `street` keeps to the street grid on the way and gets down off roofs to it.
   */
  | { kind: "go"; x: number; z: number; y?: number; r?: number; sprint?: boolean; street?: boolean; walk?: boolean; jog?: boolean }
  /**
   * Push the stick toward (x, z) until the body is on top of something at least `y` high (a climb,
   * a mantle); `sprint` climbs at the sprint's pace, `leap` jumps up the wall whenever it can.
   */
  | { kind: "climb"; x: number; z: number; y: number; sprint?: boolean; leap?: boolean }
  /** Press interact once (talk, photograph, sync), or (roam-3) hold it down `hold` ticks (a relay). */
  | { kind: "act"; hold?: number }
  /** Turn to face (x, z) on the spot. */
  | { kind: "face"; x: number; z: number }
  /** Hold the web for `ticks`, steering toward (x, z). */
  | { kind: "web"; x: number; z: number; ticks: number }
  /** One one-shot (jump, zip, drop) with the stick toward (x, z), or centred. */
  | { kind: "press"; shot: "jump" | "zip" | "drop"; x?: number; z?: number }
  /** Hold still. */
  | { kind: "wait"; ticks: number }
  /** Hold the stick toward (x, z) for `ticks` (sprinting if asked), whatever happens. */
  | { kind: "hold"; x: number; z: number; ticks: number; sprint?: boolean; mag?: 1 | 2 | 3 }
  /** Chase the pickpocket bot until it's caught (sprinting, climbing, zipping at it when it's up and away), for at most `ticks`. */
  | { kind: "chase"; ticks: number };

export interface RoamBotMemory {
  goals: RoamBotGoal[];
  i: number;
  /** Ticks into the current goal. */
  t: number;
  /** The street route for the current "go" goal. */
  route: { x: number; z: number }[] | null;
  stuck: number;
  lastX: number;
  lastZ: number;
}

export const newRoamBot = (goals: RoamBotGoal[]): RoamBotMemory => ({ goals, i: 0, t: 0, route: null, stuck: 0, lastX: 0, lastZ: 0 });

/**
 * The golden tour (src/golden-roam.ts) and `?autopilot=1`: from the spawn roof a walk, a run
 * and a sprint off its edge, down to Dev for the pickpocket chase over the roofs and back, a
 * Daily Rug page in the street, a swing on the web (held, then let go), a zip, and a dart
 * back and forth across the street in the traffic.
 */
export function roamTour(w: RoamWorld): RoamBotGoal[] {
  const s = w.spawn;
  const dev = w.folks.find((f) => f.key === "dev")!;
  const page = w.pages.find((p) => p.y === 0)!;
  const cross = streetLine(page.x);
  return [
    { kind: "hold", x: s.x - 2000, z: s.z - 120, ticks: 30, mag: 1 },
    { kind: "hold", x: s.x - 2000, z: s.z - 120, ticks: 30, mag: 3 },
    { kind: "hold", x: s.x - 2000, z: s.z - 120, ticks: 120, sprint: true },
    { kind: "wait", ticks: 30 },
    { kind: "go", x: dev.x, z: dev.z, r: 90, street: true },
    { kind: "act" },
    { kind: "wait", ticks: 30 },
    { kind: "chase", ticks: 60 * 90 },
    { kind: "go", x: dev.x, z: dev.z, r: 100, street: true },
    { kind: "act" },
    { kind: "go", x: page.x, z: page.z, r: 10, street: true },
    { kind: "web", x: page.x, z: page.z + 3000, ticks: 150 },
    { kind: "wait", ticks: 90 },
    { kind: "press", shot: "zip", x: page.x, z: page.z + 3000 },
    { kind: "wait", ticks: 60 },
    // roam-2: dart back and forth across the page's street in the traffic, so a car knocks him
    // down (and he gets up) whatever the pace of the moves before.
    { kind: "go", x: cross, z: page.z, r: 20, street: true },
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((k): RoamBotGoal => ({ kind: "hold", x: cross + (k % 2 ? -120 : 120), z: page.z + 2000, ticks: 60, sprint: true })),
    { kind: "wait", ticks: 120 },
  ];
}

/**
 * Gwei Stacy's race (roam-3, task-frontrun.ts) from beside her stall: talk to her, then the
 * course the way a runner takes it (RaceCourse.runner). `good`: sprinting, leaping up the facade
 * (good movement, which wins); `jog`: at a jog, never sprinting (a slow route, which loses).
 */
export function frontrunRace(w: RoamWorld, pace: "good" | "jog" = "good"): RoamBotGoal[] {
  const good = pace === "good";
  const goals: RoamBotGoal[] = [{ kind: "act" }];
  for (const p of w.race.runner) {
    if (p.how === "climb") goals.push({ kind: "climb", x: p.x, z: p.z, y: p.y, sprint: good, leap: good });
    else if (p.how === "go") goals.push({ kind: "go", x: p.x, z: p.z, y: p.y, r: 40, sprint: good, jog: !good });
    else goals.push({ kind: "face", x: p.x, z: p.z }, { kind: "press", shot: "zip", x: p.x, z: p.z }, { kind: "wait", ticks: 50 });
  }
  return goals;
}

/**
 * roam-3: the climbs up to each of Doc Octochain's relays from the street, as a player would
 * (task-crosschain.ts places them; these are the roam city's fixed roofs and streets):
 * - crane: up the north face of the skyscraper its jib runs beside, both tiers, along the jib
 *   to the apex.
 * - antenna: up the tallest building's west face, both tiers, to the antenna's open side.
 * - bridge, deck: a scramble up the outer face of a tower's leg from the street, hanging from the cap.
 * Each ends within reach of its relay, before the hold.
 */
export function relayClimb(w: RoamWorld, key: RoamRelay["key"]): RoamBotGoal[] {
  const r = w.relays.find((q) => q.key === key)!;
  switch (key) {
    case "crane":
      return [
        // The crossing east of it, then along the street (the street grid's next line west is the river).
        { kind: "go", x: 5370, z: 690, r: 30, street: true },
        { kind: "go", x: r.x - 90, z: 740, r: 20 },
        { kind: "climb", x: r.x - 90, z: 1000, y: 638 },
        { kind: "climb", x: r.x - 90, z: 1000, y: 714 },
        { kind: "go", x: r.x - 45, z: 1020, r: 10, walk: true },
        { kind: "go", x: r.x, z: 1020, r: 6, walk: true },
        { kind: "go", x: r.x + r.fx * 45, z: r.z + r.fz * 45, r: 8, walk: true },
      ];
    case "antenna":
      return [
        { kind: "go", x: 6190, z: r.z, r: 30, street: true },
        { kind: "climb", x: 6400, z: r.z, y: 720 },
        { kind: "climb", x: 6400, z: r.z, y: 796 },
        { kind: "go", x: r.x + r.fx * 34, z: r.z + r.fz * 34, r: 8, walk: true },
      ];
    default:
      // Out in front of the leg in the street, then into it at a sprint: up it, onto the cap's lip.
      return [
        { kind: "go", x: r.x + r.fx * 170, z: r.z + r.fz * 170, r: 20, street: true },
        { kind: "hold", x: r.x - r.fx * 400, z: r.z - r.fz * 400, ticks: 60 * 7, sprint: true },
      ];
  }
}

/**
 * roam-3: Cross-chain start to finish in one outing, from beside Uncle Gen on his roof: his
 * briefing, the crane, the antenna, Doc's deck tower, a zip over the river between the two low
 * roofs that face each other across it, the bridge's west tower, back over, and up to him.
 */
export function crosschainTour(w: RoamWorld): RoamBotGoal[] {
  const uncle = w.folks.find((f) => f.key === "uncle")!;
  const unplug: RoamBotGoal[] = [{ kind: "act", hold: RELAY_HOLD + 5 }];
  const offWall: RoamBotGoal[] = [{ kind: "press", shot: "drop" }, { kind: "wait", ticks: 90 }];
  const crane = w.relays.find((q) => q.key === "crane")!;
  return [
    { kind: "act" },
    { kind: "wait", ticks: 20 },
    ...relayClimb(w, "crane"),
    ...unplug,
    // Back along the jib onto the skyscraper's tier before heading down.
    { kind: "go", x: crane.x - 45, z: 1020, r: 10, walk: true },
    ...relayClimb(w, "antenna"),
    ...unplug,
    ...relayClimb(w, "deck"),
    ...unplug,
    ...offWall,
    // Over the river: up the low roof on the east bank, and a zip across to the one facing it.
    { kind: "go", x: 5000, z: 2290, r: 20, street: true },
    { kind: "climb", x: 5000, z: 2450, y: 233 },
    { kind: "go", x: 4845, z: 2450, r: 8, walk: true },
    { kind: "face", x: 4000, z: 2450 },
    { kind: "press", shot: "zip", x: 4000, z: 2450 },
    { kind: "wait", ticks: 60 },
    ...relayClimb(w, "bridge"),
    ...unplug,
    ...offWall,
    // Back over the same way, then up Uncle Gen's building from the street north of it.
    { kind: "go", x: 4100, z: 2290, r: 20, street: true },
    { kind: "climb", x: 4100, z: 2450, y: 278 },
    { kind: "go", x: 4335, z: 2450, r: 8, walk: true },
    { kind: "face", x: 5200, z: 2450 },
    { kind: "press", shot: "zip", x: 5200, z: 2450 },
    { kind: "wait", ticks: 60 },
    { kind: "go", x: uncle.x, z: uncle.z - 360, r: 20, street: true },
    { kind: "climb", x: uncle.x, z: uncle.z, y: uncle.y },
    { kind: "go", x: uncle.x, z: uncle.z - 60, r: 40 },
    { kind: "act" },
    { kind: "wait", ticks: 10 },
  ];
}

const IDLE: InputFrame = { dir: 0, mag: 0, web: false, shot: 0 };
const SHOTS = { jump: SHOT_JUMP, zip: SHOT_ZIP, drop: SHOT_DROP } as const;

/** The street line nearest a coordinate (streets run between blocks: i·PITCH − STREET/2). */
function streetLine(v: number): number {
  const i = Math.max(0, Math.min(GRID, Math.floor((v + STREET / 2 + PITCH / 2) / PITCH)));
  return i * PITCH - STREET / 2;
}

/** A route along the street grid: out to the nearest street, along it, round the corner, in to the goal. */
export function streetRoute(fx: number, fz: number, tx: number, tz: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  // Which way to leave: along whichever street line is nearer.
  const sxa = streetLine(fx);
  const sza = streetLine(fz);
  const sxb = streetLine(tx);
  const szb = streetLine(tz);
  const onX = Math.abs(fz - sza) < Math.abs(fx - sxa);
  if (onX) {
    pts.push({ x: fx, z: sza });
    pts.push({ x: sxb, z: sza });
    pts.push({ x: sxb, z: tz });
  } else {
    pts.push({ x: sxa, z: fz });
    pts.push({ x: sxa, z: szb });
    pts.push({ x: tx, z: szb });
  }
  pts.push({ x: tx, z: tz });
  void BLOCK;
  return pts;
}

function toward(s: SimState, x: number, z: number, mag: 1 | 2 | 3 = 3): { dir: number; mag: number } {
  const dx = x - s.hero.x;
  const dz = z - s.hero.z;
  if (len2(dx, dz) < 1) return { dir: 0, mag: 0 };
  return { dir: dirIndex(dx, dz), mag };
}

function next(m: RoamBotMemory) {
  m.i += 1;
  m.t = 0;
  m.route = null;
  m.stuck = 0;
}

/** The bot's input for this tick. */
export function roamBotFrame(s: SimState, m: RoamBotMemory): InputFrame {
  const g = m.goals[m.i];
  if (!g || !s.roam) return IDLE;
  const h = s.hero;
  const move = s.roam.body.move;
  m.t += 1;
  switch (g.kind) {
    case "wait":
      if (m.t >= g.ticks) next(m);
      return IDLE;
    case "act":
      // roam-3: held, interact goes every tick (as sprint does); a press is one tick of it.
      if (m.t >= (g.hold ?? 1)) next(m);
      return { ...IDLE, shot: SHOT_ACT };
    case "press": {
      next(m);
      const st = g.x !== undefined && g.z !== undefined ? toward(s, g.x, g.z) : { dir: 0, mag: 0 };
      return { ...st, web: false, shot: SHOTS[g.shot] };
    }
    case "face": {
      const d = len2(g.x - h.x, g.z - h.z) || 1;
      if (((g.x - h.x) * h.fx + (g.z - h.z) * h.fz) / d > 0.995 || m.t > 40) {
        next(m);
        return IDLE;
      }
      return { ...toward(s, g.x, g.z, 1), web: false, shot: 0 };
    }
    case "web": {
      if (m.t >= g.ticks) {
        next(m);
        return IDLE;
      }
      return { ...toward(s, g.x, g.z), web: true, shot: 0 };
    }
    case "hold": {
      if (m.t >= g.ticks) next(m);
      return { ...toward(s, g.x, g.z, g.mag ?? 3), web: false, shot: g.sprint ? SHOT_SPRINT : 0 };
    }
    case "climb": {
      const feet = h.y - HERO_RADIUS;
      if ((move === "ground" && feet >= g.y - 2) || m.t > 60 * 20) {
        next(m);
        return IDLE;
      }
      // Hanging: up and over. On the wall, a leap up it every so often if asked, else the sprint held if asked.
      if (move === "hang" && m.t % 20 === 0) return { ...toward(s, g.x, g.z), web: false, shot: SHOT_JUMP };
      if (g.leap && move === "climb" && m.t % 28 === 0) return { ...toward(s, g.x, g.z), web: false, shot: SHOT_JUMP };
      return { ...toward(s, g.x, g.z), web: false, shot: g.sprint ? SHOT_SPRINT : 0 };
    }
    case "chase": {
      const b = s.roam.bot;
      if (b.state === 3 || b.state === 0 || m.t > g.ticks) {
        next(m);
        return IDLE;
      }
      const dx = b.x - h.x;
      const dz = b.z - h.z;
      const d = len2(dx, dz);
      const up = b.y - (h.y - HERO_RADIUS);
      // On a wall with it behind him: let go (the stick back only climbs down, roam-2).
      const body = s.roam.body;
      if ((move === "climb" || move === "hang") && body.moveT > 0.3 && -(dx * body.wnx + dz * body.wnz) < -0.3 * d) return { ...IDLE, shot: SHOT_DROP };
      // Up and away: zip at it (the zip finds the roof edge nearest the way to it).
      const zip = (up > 80 || d > 380) && d < 760 && move !== "climb" && move !== "hang" && m.t % 45 === 0;
      // Stuck: hop.
      const moved = len2(h.x - m.lastX, h.z - m.lastZ);
      m.lastX = h.x;
      m.lastZ = h.z;
      m.stuck = moved < 1.5 && move === "ground" ? m.stuck + 1 : 0;
      const jump = m.stuck > 20 && m.stuck % 30 === 21;
      return { ...toward(s, b.x, b.z), web: false, shot: zip ? SHOT_ZIP : jump ? SHOT_JUMP : SHOT_SPRINT };
    }
    case "go": {
      if (g.street && !m.route) m.route = streetRoute(h.x, h.z, g.x, g.z);
      const r = g.r ?? 30;
      let tx = g.x;
      let tz = g.z;
      if (m.route) {
        while (m.route.length > 1 && len2(m.route[0].x - h.x, m.route[0].z - h.z) < 40) m.route.shift();
        tx = m.route[0].x;
        tz = m.route[0].z;
      }
      const left = len2(g.x - h.x, g.z - h.z);
      const feet = h.y - HERO_RADIUS;
      const want = g.y ?? (g.street ? 0 : feet);
      if (left < r && (!m.route || m.route.length <= 1) && Math.abs(feet - want) < 60 && (move === "ground" || move === "roll")) {
        next(m);
        return IDLE;
      }
      // Hanging under a lip it can't pull up over (something stands on the roof at the edge) with
      // the way on over that roof: shimmy along the wall a while, then try the pull-up again, as a
      // player would, rather than letting go and climbing straight back up.
      const b = s.roam.body;
      const over = (tx - h.x) * -b.wnx + (tz - h.z) * -b.wnz > 0;
      if (move === "hang" && over && b.moveT > 0.8) {
        const shimmy = Math.floor((b.moveT - 0.8) / 1.2) % 2 === 0;
        if (shimmy) return { ...toward(s, h.x - b.wnz * 400, h.z + b.wnx * 400, 2), web: false, shot: 0 };
        return { ...toward(s, h.x - b.wnx * 400, h.z - b.wnz * 400, 2), web: false, shot: 0 };
      }
      // On a wall or a ledge with somewhere lower to be: let go.
      if ((move === "hang" || move === "climb") && !(move === "hang" && over) && feet > want + 60 && b.moveT > 0.6) return { ...IDLE, shot: SHOT_DROP };
      // Stuck against something: hop it.
      const moved = len2(h.x - m.lastX, h.z - m.lastZ);
      m.lastX = h.x;
      m.lastZ = h.z;
      m.stuck = moved < 1.5 && move === "ground" ? m.stuck + 1 : 0;
      const jump = m.stuck > 20 && m.stuck % 30 === 21;
      const sprint = g.sprint !== false && !g.walk && !g.jog && left > 260;
      return { ...toward(s, tx, tz, g.walk ? 1 : g.jog || left < 120 ? 2 : 3), web: false, shot: jump ? SHOT_JUMP : sprint ? SHOT_SPRINT : 0 };
    }
  }
}
