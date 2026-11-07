/**
 * Free roam's numbers (the City mode, `"roam"`). World units as everywhere in sim3d: one unit
 * is about one CSS pixel at 1×, the hero is about 88 tall (so a metre is about 49 units), Y is
 * up and the street is y = 0. Seconds and units per second.
 *
 * Patrol nights never read these: the roam sim has its own files and only runs when a run's
 * config asks for it (SimConfig.roam), under its own ruleset tag.
 */

/** The mode's id (runs, saves, the session). */
export const ROAM_MODE = "roam";
/**
 * The roam rules' version. Bump it with any change to the roam sim, its city or its content positions.
 * roam-2: everything the City draws in the hero's way is solid as drawn (roam/furniture.ts), and
 * the street traffic is in the sim (roam/traffic.ts): cars that stop at lights, queue, brake for
 * him standing in the road, and knock him flying when he isn't.
 * roam-3: interact is held over ticks (a talk, a photo or a sync takes a hold's first tick), and
 * Uncle Gen's side task, Cross-chain: Doc Octochain's relays on the city's highest points, solid
 * as drawn, unplugged by holding interact (task-crosschain.ts).
 */
export const ROAM_RULESET = "roam-3";
/**
 * The ruleset field a roam log carries (hex "F 001 3 04": free roam, city 001, rules rev 3, on
 * patrol ruleset 4), so a roam log never replays as a patrol night or a chapter, and neither of
 * those as a roam outing. Rev 2 (roam-2): the climb's pace, and the stick back climbing down a
 * wall instead of letting go. Rev 3 (roam-3): interact held, and the relays.
 */
export const ROAM_LOG_RULESET = 0x0f001304;
/** Older roam rules' log fields (roam-1's, roam-2's), refused as a stale outing (the server says start a fresh one). */
export const ROAM_OLD_LOG_RULESETS: readonly number[] = [0x0f001104, 0x0f001204];
/** The same list under the climbing branch's name (roam-run.ts). */
export const ROAM_LOG_RULESETS_PAST: readonly number[] = ROAM_OLD_LOG_RULESETS;

/** The one city free roam happens in: always the same, so progress has a place to live. */
export const ROAM_CITY_SEED = 0x0c17_0002;

/* ------------------------------------------------------------------ the one-shots */

/**
 * Free roam reads the input frame's one-shot as its own buttons (patrol's 1–4 powers and 5
 * Gwei mean nothing here, so patrol logs are untouched):
 * - 1 jump, 2 web-zip, 3 interact (talk, photograph, sync), 5 drop (let go of a wall or ledge).
 * - 4 sprint, sent every tick the sprint button is held; the sim keeps sprinting SPRINT_GRACE
 *   ticks past the last one, so a jump or a talk taking a tick doesn't break a sprint.
 * - roam-3: 3 interact is held the same way, sent every tick the button is down (a tap sends it
 *   for at least one tick). A run of 3s is one hold: its first tick is the press (a talk, a photo,
 *   a sync), and every tick of it holds a relay (task-crosschain.ts). Any other frame ends the
 *   hold, so a jump or a sprint tick in the middle lets go.
 */
export const SHOT_JUMP = 1;
export const SHOT_ZIP = 2;
export const SHOT_ACT = 3;
export const SHOT_SPRINT = 4;
export const SHOT_DROP = 5;
export const SPRINT_GRACE = 8;

/* ------------------------------------------------------------------ movement */

/** The movement set's numbers live with it (sim3d/parkour/constants.ts); free roam uses them as they are. */
export * from "../parkour/constants";

/* ------------------------------------------------------------------ people, tasks, collectibles */

/** Close enough to talk: across, and up or down. */
export const TALK_REACH = 140;
export const TALK_RISE = 120;
/** A photo: the subject within this range, in front (cos of the angle off the facing), in plain sight. */
export const PHOTO_RANGE = 560;
export const PHOTO_CONE = 0.55;
/** Picking something up (a page, a pixel, the pickpocket bot) by touching it. */
export const PICK_REACH = 70;
export const PICK_TALL = 1.4;
/** A viewpoint syncs from within this of its perch. */
export const SYNC_REACH = 80;

/** The pickpocket bot: its run, its panic near the hero, and where it stops to wait for him. */
export const BOT_RUN = 470;
export const BOT_PANIC = 600;
export const BOT_PANIC_NEAR = 300;
export const BOT_WAIT_FAR = 1300;
export const BOT_WAIT_BACK = 900;
export const BOT_CATCH = 80;
export const BOT_HOP_GRAVITY = 1750;

/** The XP each first completion pays (rewards are XP only: free roam is never ranked). */
export const TASK_XP = 40;
export const PAGE_XP = 5;
export const VIEW_XP = 15;

/* ------------------------------------------------------------------ traffic (roam-2, roam/traffic.ts) */

/**
 * A car in the City, as the sim and the scene both size it: this long, wide and tall (one box;
 * taller than STEP_UP, so it's walked into, not up onto, and lower than VAULT_MAX, so it's
 * vaulted). Lanes run this far either side of a street's (or the bridge deck's) centre line,
 * leaving room for the hero between a car and a facade or the deck's rail.
 */
export const CAR_LEN = 96;
export const CAR_WIDE = 39;
export const CAR_TALL = 46;
export const LANE = 29;
export const DECK_LANE = 30;
/** About one car per this much lane (each way), and the cruise speeds they pick from. */
export const CAR_SPACING = 600;
export const CAR_CRUISE_MIN = 250;
export const CAR_CRUISE_MAX = 330;
/** Pulling away, braking for a light or the car ahead, and an emergency stop. */
export const CAR_ACCEL = 260;
export const CAR_BRAKE = 700;
export const CAR_BRAKE_HARD = 1500;
/** The gap a car keeps to the one ahead, and the room it wants past a crossing before it enters. */
export const CAR_GAP = 22;
/** Where a car waits for a light: its front this far short of the crossing. */
export const STOP_SHORT = 6;
/** Where the lanes turn round: this far short of the river's bank (the banks a swimmer climbs out on stay clear). */
export const RIVER_TURN = 170;
/**
 * The lights at each crossing, in ticks: green one way, all red, green the other way, all red.
 * Each crossing starts its cycle at its own offset (a fixed hash of where it is).
 */
export const LIGHT_GREEN = 360;
export const LIGHT_CLEAR = 90;
/**
 * A driver brakes for the hero standing (or lying) in the road ahead, within this far of the
 * bumper; one who's moving (walking, running, jumping in) isn't seen in time.
 */
export const CAR_SEE = 240;
export const HERO_STILL = 70;
/** A car at least this fast that meets the hero knocks him down; slower, it shoves him. */
export const HIT_SPEED = 80;
/** After a hit the car stands this long (ticks) before it pulls away. */
export const HIT_HOLD = 100;

/* ------------------------------------------------------------------ knocked down (roam/knock.ts) */

/** Flung along the car's way (this share of its speed, plus a base) and a little off its line, and up. */
export const KNOCK_K = 0.95;
export const KNOCK_BASE = 150;
export const KNOCK_SIDE = 110;
export const KNOCK_UP = 250;
export const KNOCK_UP_K = 0.55;
/** Down on the ground: sliding to a stop this long, then getting up this long. Never any damage. */
export const KNOCK_DOWN = 0.5;
export const KNOCK_GETUP = 0.55;
/** No second hit this long after one (seconds), and a knock that's somehow still going after this ends. */
export const KNOCK_IMMUNE = 1.4;
export const KNOCK_MAX = 4;
