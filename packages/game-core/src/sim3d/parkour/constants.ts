/**
 * The parkour movement set's numbers (sim3d/parkour): on foot, jumps and the air, landings,
 * walls, the web and water. World units as everywhere in sim3d (the hero is about 88 tall, so a
 * metre is about 49 units), seconds and units per second.
 *
 * Free roam (the City mode, ruleset tag roam-2) is the only mode that moves with these today;
 * patrol nights never read them. Changing one changes every mode that uses the set: bump that
 * mode's ruleset with it.
 */

/* ------------------------------------------------------------------ on foot */

/** Ground speeds by tilt: a third walks, two thirds jogs, full tilt runs; sprint is its own button. */
export const WALK_SPEED = 120;
export const JOG_SPEED = 270;
export const RUN_SPEED = 410;
export const SPRINT_SPEED = 650;
/** The push from a standstill, easing to ACCEL_TOP of it at the target speed; past RUN_SPEED a sprint builds at SPRINT_ACCEL. */
export const GROUND_ACCEL = 2100;
export const ACCEL_TOP = 0.45;
export const SPRINT_ACCEL = 950;
/** Braking (the stick against the motion) and grip (killing sideways slip). */
export const GROUND_BRAKE = 2700;
/** The stick centred: friction stops a run in about 0.15 s, a sprint's skid a little longer. */
export const GROUND_FRICTION = 2600;
export const SKID_FRICTION = 1800;
/** How fast the body turns toward the stick, radians a second: quick at a walk, wide at a sprint. */
export const TURN_WALK = 18;
export const TURN_SPRINT = 7.5;
/** Turning further than this at more than RUN_SPEED is a skid: brake first, then turn. */
export const SKID_ANGLE = 2.3;
/** A ledge up to this much higher than the feet is stepped up smoothly, at STEP_RATE. */
export const STEP_UP = 40;
export const STEP_RATE = 900;
/** Walking (under this speed), the hero stops at a roof's edge unless the stick pushes out past EDGE_PUSH. */
export const EDGE_WALK = 200;
export const EDGE_PUSH = 0.9;
/** Running off a roof at this speed or more is a leap: a small hop that carries over an alley. */
export const LEAP_SPEED = 320;
export const LEAP_VY = 340;

/* ------------------------------------------------------------------ jumps and the air */

/** A jump's lift (about 2.4 m), a sprint's extra carry, and the windows that make it forgiving. */
export const JUMP_VY = 650;
export const SPRINT_JUMP = 1.1;
export const COYOTE = 0.12;
export const JUMP_BUFFER = 0.15;
/** Air control: acceleration along the stick, up to this speed along it (beyond, it only steers). */
export const AIR_ACCEL = 900;
export const AIR_STEER = 420;

/* ------------------------------------------------------------------ landings (never damage) */

/** Coming down at least this fast is a hard landing: a roll when moving, a three-point landing when not. */
export const ROLL_IMPACT = 900;
export const ROLL_MIN_SPEED = 150;
export const ROLL_SECONDS = 0.5;
/** The roll keeps this share of the run, and turns this share of the fall into it (up to RUN_SPEED). */
export const ROLL_KEEP = 0.95;
export const ROLL_CARRY = 0.18;
/** The three-point landing's crouch, and a soft landing's (scaled by the impact). */
export const HARD_LAND = 0.32;
export const SOFT_LAND = 0.1;

/* ------------------------------------------------------------------ walls */

/**
 * Climbing: up (a scramble, sprinting), down and sideways, reached at CLIMB_ACCEL. A climber's
 * pace (roam-2): about 2.5 m/s up, hand over hand, near 5 m/s scrambling; a run-up or a jump
 * up the wall carries faster for a moment. (Roam-1 slid up at 250, 360 sprinting.)
 */
export const CLIMB_UP = 120;
export const CLIMB_UP_SPRINT = 230;
export const CLIMB_DOWN = 110;
export const CLIMB_SIDE = 100;
export const CLIMB_ACCEL = 1800;
/** Running into a wall from the street, the first steps carry up it: CLIMB_RUNUP plus this share of the speed into it. */
export const CLIMB_RUNUP = 300;
export const CLIMB_RUNUP_K = 0.35;
/** Off the wall without it this long, a climb lets go (a corner climbed past, a wall that ended). */
export const CLIMB_LOSE = 0.1;
/** A jump up the wall (the stick into it): this fast, once every CLIMB_LEAP_CD. */
export const CLIMB_LEAP = 560;
export const CLIMB_LEAP_CD = 0.45;
/** A wall jump (the stick off the wall): out along the stick, and up. */
export const WALL_JUMP_OUT = 430;
export const WALL_JUMP_VY = 600;
/** After letting go of a wall or a ledge, nothing is grabbed for this long. */
export const GRAB_CD = 0.35;
/**
 * The stick held away from a ledge this long lets go of it. On a wall the stick back climbs
 * down instead (roam-2): letting go is the drop button, or a jump off.
 */
export const LET_GO = 0.14;
/** A wall counts for climbing when its top stands at least this far above the feet (lower is a vault or a step). */
export const CLIMB_MIN = 100;

/** Hanging from a ledge: the centre this far under its top, this far out from the face. */
export const HANG_DOWN = 50;
/** Hands catch a ledge whose top is between this far above the centre… */
export const GRAB_HIGH = 74;
/** …and this far below it, falling or rising slower than GRAB_VY. */
export const GRAB_LOW = -6;
export const GRAB_VY = 300;
/** Shuffling along a ledge. */
export const SHIMMY = 120;
/** The pull-up onto a roof, ending this far in from the edge. */
export const MANTLE_SECONDS = 0.42;
export const MANTLE_IN = 44;

/** Vaulting: an obstacle rising STEP_UP to VAULT_MAX above the feet, taken at VAULT_SPEED or more. */
export const VAULT_MAX = 120;
export const VAULT_SPEED = 170;
/** Over it when it's at most VAULT_DEPTH deep along the run and the far side is clear; else up onto it. */
export const VAULT_DEPTH = 200;
/** The vault's arc clears the top by this much; it takes between these times. */
export const VAULT_CLEAR = 14;
export const VAULT_MIN_T = 0.28;
export const VAULT_MAX_T = 0.55;

/**
 * Wall-running: at this speed or more, meeting a tall wall at a glancing angle: the motion within
 * about 49° of the wall's plane (|cos| to its normal under WALLRUN_ANGLE), so a sprint-jump at a
 * wall on a diagonal runs along it and a head-on one climbs it.
 */
export const WALLRUN_SPEED = 430;
export const WALLRUN_ANGLE = 0.75;
/** Along the wall at least this fast, lifted to WALLRUN_VY, under lighter gravity, for at most WALLRUN_SECONDS. */
export const WALLRUN_MIN = 520;
export const WALLRUN_VY = 260;
export const WALLRUN_GRAVITY = 640;
export const WALLRUN_SECONDS = 1.0;
/** Two wall runs at most between touching the ground (or grabbing anything). */
export const WALLRUN_CHAIN = 2;

/* ------------------------------------------------------------------ the web */

/** The web-zip: to a point on a roof edge or a perch ahead, within ZIP_RANGE and ZIP_CONE (cos) of the heading. */
export const ZIP_RANGE = 780;
export const ZIP_MIN = 120;
export const ZIP_CONE = 0.8;
/** It may reach this far below the hero (down to a lower roof), and no higher than ZIP_RISE above. */
export const ZIP_DROP = 160;
export const ZIP_RISE = 520;
export const ZIP_SPEED = 1300;
export const ZIP_MIN_T = 0.18;
/** At the end of a zip, a jump within this long is a point launch: up and on. */
export const LAUNCH_WINDOW = 0.3;
export const LAUNCH_VY = 780;
export const LAUNCH_PUSH = 560;
/** A zip lands this far in from the edge it reached, moving in at ZIP_LAND_SPEED. */
export const ZIP_LAND_IN = 34;
export const ZIP_LAND_SPEED = 220;
/** A zip can't go again for this long. */
export const ZIP_CD = 0.35;

/* ------------------------------------------------------------------ the river */

/** Into the river: a splash, and after this long the hero climbs out on the nearest bank. */
export const SPLASH_SECONDS = 0.7;

