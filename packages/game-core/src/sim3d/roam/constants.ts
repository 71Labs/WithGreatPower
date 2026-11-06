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
/** The roam rules' version. Bump it with any change to the roam sim, its city or its content positions. */
export const ROAM_RULESET = "roam-1";
/**
 * The ruleset field a roam log carries (hex "F 001 1 04": free roam, city 001, rules rev 1, on
 * patrol ruleset 4), so a roam log never replays as a patrol night or a chapter, and neither of
 * those as a roam outing.
 */
export const ROAM_LOG_RULESET = 0x0f001104;

/** The one city free roam happens in: always the same, so progress has a place to live. */
export const ROAM_CITY_SEED = 0x0c17_0002;

/* ------------------------------------------------------------------ the one-shots */

/**
 * Free roam reads the input frame's one-shot as its own buttons (patrol's 1–4 powers and 5
 * Gwei mean nothing here, so patrol logs are untouched):
 * - 1 jump, 2 web-zip, 3 interact (talk, photograph, sync), 5 drop (let go of a wall or ledge).
 * - 4 sprint, sent every tick the sprint button is held; the sim keeps sprinting SPRINT_GRACE
 *   ticks past the last one, so a jump or a talk taking a tick doesn't break a sprint.
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
