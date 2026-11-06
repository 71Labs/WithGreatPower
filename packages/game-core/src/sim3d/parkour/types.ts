/**
 * The parkour movement set's state (sim3d/parkour): the body's move and its timers, plus what a
 * mode that uses the set hosts for it (ParkourHost). Plain data, mutated in place at 60 Hz.
 */
import type { RoamMoveName } from "../contract";

/**
 * What the body is doing:
 * - ground: standing, walking, running, sprinting. air: jumping, falling, a leap off a roof.
 * - climb: on a wall. hang: from a ledge by the hands. mantle: pulling up over a ledge.
 * - vault: over (or up onto) something low. wallrun: along a facade at speed.
 * - roll: a hard landing carried through. zip: pulled along the web to a point.
 * - swing: on the web. splash: in the river, about to climb out.
 */
export type ParkourMove = RoamMoveName;

/** The parkour state on top of the hero's (SimState.hero). */
export interface ParkourBody {
  move: ParkourMove;
  /** Seconds in `move`. */
  moveT: number;
  /** Ticks of sprint left (SPRINT_GRACE after the last sprint one-shot). */
  sprintT: number;
  /** A buffered jump press, seconds left. */
  jumpBuf: number;
  /** Seconds since last standing (or holding a wall), for a late jump. */
  coyote: number;
  /** Seconds before a wall or ledge may be grabbed again. */
  grabCd: number;
  /** Seconds before a zip may go again, and before another jump up a wall. */
  zipCd: number;
  leapCd: number;
  /** Seconds the stick has been held away from the wall (letting go). */
  awayT: number;
  /** Wall runs since last on the ground. */
  wallruns: number;
  /** The wall (climb, hang, wall run): its outward normal, the top of its face, and the face's plane. */
  wnx: number;
  wnz: number;
  wtop: number;
  wface: number;
  /** A wall run's direction along the wall (unit xz). */
  wdx: number;
  wdz: number;
  /** A scripted move (vault, mantle, zip, splash): from, to, how long, how high the arc. */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  dur: number;
  arc: number;
  /** The velocity a vault hands back at its end; a zip's landing: 0 on a roof edge, 1 a perch. */
  ex: number;
  ez: number;
  land: number;
  /** After a zip: seconds left for a point launch. */
  launchT: number;
  /** A swing's web button: held last tick (the hero's holdPrev is the input's). */
  webHeld: boolean;
}

/** What the movement set reports (the scene animates from these; free roam's driver passes them on). */
export type ParkourEvent =
  /** A jump: from the ground, off a roof's edge (a leap), off a wall, up a wall, or a point launch after a zip. */
  | { type: "roam-jump"; kind: "jump" | "leap" | "wall" | "climb" | "launch"; x: number; y: number; z: number }
  /** The body changed what it's doing (a vault, a grab, a roll…), for animation and sound. */
  | { type: "roam-move"; move: ParkourMove; from: ParkourMove; x: number; y: number; z: number; speed: number }
  /** A web-zip toward (tx, ty, tz). */
  | { type: "roam-zip"; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  /** Into the river, and out on the bank. */
  | { type: "roam-splash"; x: number; y: number; z: number };

/**
 * What a mode hosts for the movement set: the body, where its events go, and the places a
 * swimmer climbs out (and the spawn, if there are none). Free roam's RoamState is one; a future
 * ruleset of patrol nights would give its SimState another (see parkour/host.ts).
 */
export interface ParkourHost {
  body: ParkourBody;
  events: { push(e: ParkourEvent): unknown };
  world: {
    banks: { x0: number; z0: number; x1: number; z1: number }[];
    spawn: { x: number; y: number; z: number };
  };
}
