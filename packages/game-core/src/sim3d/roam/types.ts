/**
 * Free roam's state (the City mode): plain data on SimState.roam, mutated in place by
 * stepRoam at 60 Hz. The hero's position, velocity, rope and facing stay on SimState.hero
 * (so the swing integrator, the anchor choice and the render frame work as on a night);
 * everything parkour adds is on `body`, everything the city's people and collectibles add is
 * on `progress`, `bot` and `chat`. `world` is the city's fixed placements, built once.
 */
import type { CastId } from "../../rules/cast";
import type { DistrictId, RoamMoveName, Vec3 } from "../contract";
import type { ParkourBody, ParkourEvent } from "../parkour/types";
import type { RaceCourse, RaceEvent, RoamRace } from "./task-frontrun";

/**
 * The tasks the city's people hand out, in their fixed order (progress arrays are indexed by it;
 * append only: a save's record maps by id, so a record saved before a task existed starts it at
 * stage 0 with nothing found).
 * roam-3 adds "frontrun", Gwei Stacy's race (roam/task-frontrun.ts), and "crosschain", Uncle Gen's:
 * unplug Doc Octochain's relays (task-crosschain.ts).
 */
export const TASK_IDS = ["bread", "pickpocket", "pixels", "graffiti", "frontrun", "crosschain"] as const;
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
 * - knocked (roam-2): hit by a car: flung, down, getting up (roam/knock.ts).
 */
export type RoamMove = RoamMoveName;
export const ROAM_MOVES: readonly RoamMove[] = ["ground", "air", "climb", "hang", "mantle", "vault", "wallrun", "roll", "zip", "swing", "splash", "knocked"];

/** The parkour state on top of the hero's (sim3d/parkour/types.ts ParkourBody). */
export type RoamBody = ParkourBody;

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
  /** roam-3: Gwei Stacy's race course (roam/task-frontrun.ts). */
  race: RaceCourse;
  /** roam-3: Doc Octochain's cross-chain relays on the city's highest points (task-crosschain.ts), solid as drawn. */
  relays: RoamRelay[];
}

/**
 * roam-3: one of Doc Octochain's cross-chain relays (task-crosschain.ts): a box bolted to one of
 * the city's high points, solid as drawn, unplugged by holding interact within reach of it.
 */
export interface RoamRelay {
  /** Which high point: the crane's apex, the bridge's west tower, the tallest building's antenna, Doc's deck tower. */
  key: "crane" | "bridge" | "antenna" | "deck";
  /** The box's centre and half sizes. */
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** The way its front faces (unit xz): its light and its plug, toward where he reaches it from. */
  fx: number;
  fz: number;
  /** Where its chains are bolted on: a point on the structure below and behind it (the drawing's). */
  ax: number;
  ay: number;
  az: number;
}

/**
 * roam-3: interact held over ticks. `act`: interact was down last tick (a talk, a photo or a sync
 * takes only the first tick of a hold). `relay`: the relay being held (−1 none), for how many ticks.
 */
export interface RoamHold {
  act: boolean;
  relay: number;
  ticks: number;
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

/**
 * A street the traffic drives (roam/traffic.ts): one lane each way round a stadium loop, out
 * along `axis` on the +r side from `lo` to `hi`, a half turn, back on the −r side. Fixed.
 */
export interface RoamLoop {
  /** 0: the lanes run along x (the street's centre line is z = c); 1: along z (x = c). */
  axis: 0 | 1;
  c: number;
  lo: number;
  hi: number;
  /** Lane offset from the centre line (and the half turns' radius). */
  r: number;
  /** Street (0) or the bridge deck's height. */
  y: number;
  /** Its length round: 2 (hi − lo) + 2πr. */
  len: number;
  /** The street's grid line (the lights' crossings are found by it), or −1 for the deck. */
  line: number;
}

/** A car: which loop, how far round it, how fast; what it cruises at, its paint; ticks it stands after a hit. */
export interface RoamCar {
  loop: number;
  s: number;
  v: number;
  cruise: number;
  kind: number;
  hold: number;
  /** The car ahead on its loop (cars never pass on a loop, so it never changes). */
  lead: number;
  /** Its box in roam's CityIndex (a mover), and where it is now: centre, heading (unit xz), box half sizes. */
  box: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  ex: number;
  ez: number;
  /** Its box is where it is (near the hero), or parked off the map (far from him): derived from the places, never hashed. */
  live: boolean;
}

/** Knocked down (roam/knock.ts): seconds since landing (−1 while still flung), the push's way, and seconds of no second hit. */
export interface RoamKnock {
  down: number;
  dx: number;
  dz: number;
  immune: number;
}

/** The street traffic (roam-2). `loops` is fixed; the cars and the knock change, and are hashed. */
export interface RoamTraffic {
  loops: RoamLoop[];
  cars: RoamCar[];
  knock: RoamKnock;
  /**
   * Per crossing (i·(GRID+1) + j), which ways had a car in it after the last tick (bit 0 along x,
   * bit 1 along z), and the next tick's scratch: derived from the cars' places, never hashed.
   */
  occ: Uint8Array;
  occNext: Uint8Array;
}

export interface RoamState {
  body: RoamBody;
  world: RoamWorld;
  progress: RoamProgress;
  bot: RoamBot;
  chat: RoamChat | null;
  /** roam-2: the cars, and being knocked down by one. */
  traffic: RoamTraffic;
  /** roam-3: Gwei Stacy's race against Sandwich Man (roam/task-frontrun.ts). */
  race: RoamRace;
  /** roam-3: interact held (a relay being unplugged). */
  hold: RoamHold;
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
  /** The movement set's: jumps, moves, zips, splashes (parkour/types.ts). */
  | ParkourEvent
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
  | { type: "roam-nothing" }
  /** roam-2: a car hit him (its speed then; where he was): he's knocked down, the car stands. */
  | { type: "roam-car-hit"; speed: number; car: number; x: number; y: number; z: number }
  /** roam-3: Gwei Stacy's race (roam/task-frontrun.ts): the start, a gate, the finish, the reset. */
  | RaceEvent
  /**
   * roam-3: a relay held (task-crosschain.ts): the hold began, the relay sparked and shoved him,
   * he let go too soon (its progress gone), or it came unplugged. Where the relay is.
   */
  | { type: "roam-relay"; relay: number; state: "hold" | "spark" | "reset" | "unplugged"; x: number; y: number; z: number };
