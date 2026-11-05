/**
 * Free roam's state (the City mode): plain data on SimState.roam, mutated in place by
 * stepRoam at 60 Hz. The hero's position, velocity, rope and facing stay on SimState.hero
 * (so the swing integrator, the anchor choice and the render frame work as on a night);
 * everything parkour adds is on `body`, everything the city's people and collectibles add is
 * on `progress`, `bot` and `chat`. `world` is the city's fixed placements, built once.
 */
import type { CastId } from "../../rules/cast";
import type { DistrictId, RoamMoveName, Vec3 } from "../contract";

/** The tasks the city's people hand out, in their fixed order (progress arrays are indexed by it). */
export const TASK_IDS = ["bread", "pickpocket", "pixels", "graffiti"] as const;
export type TaskId = (typeof TASK_IDS)[number];

/** A task's stage: 0 not started, 1 and up under way (each task's own steps), TASK_DONE finished. */
export const TASK_DONE = 9;

/**
 * What the body is doing:
 * - ground: standing, walking, running, sprinting. air: jumping, falling, a leap off a roof.
 * - climb: on a wall. hang: from a ledge by the hands. mantle: pulling up over a ledge.
 * - vault: over (or up onto) something low. wallrun: along a facade at speed.
 * - roll: a hard landing carried through. zip: pulled along the web to a point.
 * - swing: on the web. splash: in the river, about to climb out.
 */
export type RoamMove = RoamMoveName;
export const ROAM_MOVES: readonly RoamMove[] = ["ground", "air", "climb", "hang", "mantle", "vault", "wallrun", "roll", "zip", "swing", "splash"];

/** The parkour state on top of the hero's (SimState.hero). */
export interface RoamBody {
  move: RoamMove;
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

/** Someone in the city to talk to. */
export interface RoamFolk {
  id: number;
  /** Key into the city content's lines (rules/city.ts FOLKS). */
  key: string;
  /** A civilian body (crowd/civilians.ts index 0–7), or an ally drawn as the cast member on their roof. */
  body: number;
  cast: CastId | null;
  /** Feet position and the way they face (radians, 0 = +z). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** The task they hand out, or hand in. */
  gives: TaskId | null;
  takes: TaskId | null;
}

/** A Daily Rug page or a pixel: feet-level spot. */
export interface RoamSpot {
  x: number;
  y: number;
  z: number;
  district: DistrictId;
}

/** A viewpoint: a mast on a tall roof with a perch on top. */
export interface RoamView {
  /** The perch's top (stand here to sync). */
  x: number;
  y: number;
  z: number;
  /** The mast's foot (its roof) and its height to the perch. */
  roof: number;
  district: DistrictId;
  building: number;
}

/** A roof on the bot's loop. */
export interface RoamRoof {
  x: number;
  y: number;
  z: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A Gas Goblin tag on a facade: its centre and the face's outward normal. */
export interface RoamTag {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}

/** The fixed placements free roam builds once from its city (roam/world.ts). Never hashed: it never changes. */
export interface RoamWorld {
  spawn: { x: number; y: number; z: number; fx: number; fz: number };
  folks: RoamFolk[];
  pages: RoamSpot[];
  views: RoamView[];
  /** Mary Jpeg's lost pixels. */
  pixels: RoamSpot[];
  /** Gas Goblin's tags for Bearson's photos. */
  tags: RoamTag[];
  /** The pickpocket bot's loop over the roofs: each roof's middle (feet) and its rectangle, in order round the loop. */
  botPath: RoamRoof[];
  /** The river's banks: where a swimmer climbs out. */
  banks: { x0: number; z0: number; x1: number; z1: number }[];
}

/** Progress through the city: what the save's CityRecord holds, plus this outing's working state. */
export interface RoamProgress {
  /** Per task (TASK_IDS order): its stage. */
  stage: number[];
  /** Per task: the items found so far (pixels, photos), as bits. */
  items: number[];
  /** Pages and viewpoints found, as bits. */
  pages: number;
  views: number;
  /** Talks so far per folk (by id), for their next line. */
  talks: number[];
  /** Seconds since Aunt Mainnet's bread came out of the oven (while it's being carried). */
  breadT: number;
}

/** The pickpocket bot. */
export interface RoamBot {
  /** 0 not out yet, 1 running, 2 waiting for the hero to catch up, 3 caught. */
  state: number;
  /** The leg it's on (from botPath[leg] to the next node, round the loop), and the leg's part: 0 out across the roof, 1 the hop, 2 in to the next roof's middle. */
  leg: number;
  part: number;
  /** Distance along a run part, or seconds into the hop. */
  u: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** The last thing said: who, which line, and for how long it shows (ticks). */
export interface RoamChat {
  folk: number;
  line: number;
  ticks: number;
}

export interface RoamState {
  body: RoamBody;
  world: RoamWorld;
  progress: RoamProgress;
  bot: RoamBot;
  chat: RoamChat | null;
  /** Roam's own events since the driver last drained them (the hero's web events go to SimState.events as on a night). */
  events: RoamEvent[];
}

/** Where an outing starts and what the city remembers (from the save's CityRecord). */
export interface RoamStart {
  stage: number[];
  items: number[];
  pages: number;
  views: number;
  talks: number[];
  /** Where the last outing ended (feet), or null for the spawn roof. */
  at: { x: number; y: number; z: number; fx: number; fz: number } | null;
}

export type RoamEvent =
  /** A jump: from the ground, off a roof's edge (a leap), off a wall, up a wall, or a point launch after a zip. */
  | { type: "roam-jump"; kind: "jump" | "leap" | "wall" | "climb" | "launch"; x: number; y: number; z: number }
  /** The body changed what it's doing (a vault, a grab, a roll…), for animation and sound. */
  | { type: "roam-move"; move: RoamMove; from: RoamMove; x: number; y: number; z: number; speed: number }
  /** A web-zip toward (tx, ty, tz). */
  | { type: "roam-zip"; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  /** Into the river, and out on the bank. */
  | { type: "roam-splash"; x: number; y: number; z: number }
  /** Talked to someone: their line (an index into their lines). */
  | { type: "roam-talk"; folk: number; line: number; task: TaskId | null }
  /** A task moved on: its new stage (TASK_DONE when finished; `xp` paid on the first finish). */
  | { type: "roam-task"; task: TaskId; stage: number; done: boolean }
  /** A task's item found (a pixel, a photo): which, and how many of how many. */
  | { type: "roam-item"; task: TaskId; item: number; got: number; of: number; x: number; y: number; z: number }
  /** A Daily Rug page found. */
  | { type: "roam-page"; page: number; got: number; of: number; x: number; y: number; z: number }
  /** A viewpoint synced. */
  | { type: "roam-sync"; view: number; x: number; y: number; z: number }
  /** The pickpocket bot: out (it ran), caught. */
  | { type: "roam-bot"; state: "out" | "caught"; x: number; y: number; z: number }
  /** Nothing to do with the interact button here (a photo with nothing in frame, a talk with nobody near). */
  | { type: "roam-nothing" };
