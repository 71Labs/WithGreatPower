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

export type RoamBotGoal =
  /**
   * Run (sprinting if far) to a feet point, within `r` across (and, given `y`, at about that
   * height); `street` keeps to the street grid on the way and gets down off roofs to it.
   */
  | { kind: "go"; x: number; z: number; y?: number; r?: number; sprint?: boolean; street?: boolean; walk?: boolean }
  /** Push the stick toward (x, z) until the body is on top of something at least `y` high (a climb, a mantle). */
  | { kind: "climb"; x: number; z: number; y: number }
  /** Press interact once (talk, photograph, sync). */
  | { kind: "act" }
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
      next(m);
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
      // Hanging: up and over.
      return { ...toward(s, g.x, g.z), web: false, shot: move === "hang" && m.t % 20 === 0 ? SHOT_JUMP : 0 };
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
      // On a wall or a ledge with somewhere lower to be: let go.
      if ((move === "hang" || move === "climb") && feet > want + 60 && s.roam.body.moveT > 0.6) return { ...IDLE, shot: SHOT_DROP };
      // Stuck against something: hop it.
      const moved = len2(h.x - m.lastX, h.z - m.lastZ);
      m.lastX = h.x;
      m.lastZ = h.z;
      m.stuck = moved < 1.5 && move === "ground" ? m.stuck + 1 : 0;
      const jump = m.stuck > 20 && m.stuck % 30 === 21;
      const sprint = g.sprint !== false && !g.walk && left > 260;
      return { ...toward(s, tx, tz, g.walk ? 1 : left < 120 ? 2 : 3), web: false, shot: jump ? SHOT_JUMP : sprint ? SHOT_SPRINT : 0 };
    }
  }
}
