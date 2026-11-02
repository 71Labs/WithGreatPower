/**
 * Every tunable number in the 3D swing sim, in world units (1 unit ≈ 1 CSS px at 1×, the
 * hero ~88 tall), seconds and units per second. Y is up; the street is y = 0. The 2D sim's
 * numbers carry over unchanged; the 3D additions are marked.
 */

/**
 * The ruleset every input log is pinned to (score.ts re-exports it). Change any number in
 * the sim, the city, the engine or the scoring and bump it: old logs are then refused
 * instead of being mis-scored.
 */
export const RULESET_VERSION = 1;

/** The sim steps at a fixed rate, whatever the display does. */
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
/** The longest run a log may hold: 15 minutes of ticks. */
export const MAX_TICKS = 54_000;

/* ------------------------------------------------------------------ the hero */

export const GRAVITY = 1750;
/** Collision radius. The sticker is drawn larger than this, so contact feels fair. */
export const HERO_RADIUS = 26;
/** The sticker's drawn size in world units. */
export const HERO_SIZE = 88;
export const MAX_SPEED = 1650;
export const AIR_CONTROL = 520;
export const AIR_DRAG = 0.04;
/** Auto-run on rooftops toward the heading; the stick nudges it. */
export const RUN_SPEED = 390;
export const RUN_ACCEL = 1900;
/** A little hop when you run off a roof edge, so a run flows into a swing. */
export const EDGE_HOP = 520;
/** 3D: running into a ledge up to this much higher than your roof, you step up onto it. */
export const STEP_UP = 40;
/** 3D: above this speed the position update runs in two halves, so walls can't be tunnelled. */
export const SUBSTEP_SPEED = 1200;

/* ------------------------------------------------------------------ webs */

export const ANCHOR_RANGE = 420;
export const ANCHOR_MIN = 70;
/** Anchors must sit at least this far above you; a web only pulls. */
export const ANCHOR_MIN_RISE = 36;
export const ROPE_MIN = 110;
/** The rope length the anchor choice prefers. */
export const ROPE_COMFORT = 270;
/** Reel-in while you hold, which speeds the swing up a little. */
export const ROPE_REEL = 46;
/** Tangential push while swinging forward below the anchor. */
export const ROPE_PUMP = 280;
export const FIZZLE_COOLDOWN = 0.3;
/** 3D: the desired anchor sits this far ahead along the heading… */
export const ANCHOR_AHEAD = 210;
/** …and this far above the hero (together about ROPE_COMFORT away). */
export const ANCHOR_UP = 240;
/** 3D: roof-edge anchors sit this far out from the facade (a cornice), so a swing clears the wall. */
export const EDGE_LIP = 30;
/** 3D: and this far above the roof, like the 2D corner anchors. */
export const EDGE_RISE = 10;
/**
 * 3D: climbing. Holding a web while pressed slowly against a wall (under CLIMB_MAX_SPEED)
 * reels you up it at CLIMB_SPEED, down to CLIMB_MIN of rope; once level with the anchor you
 * mantle over with an EDGE_HOP and a push of CLIMB_PUSH onto the roof. 2D had no walls.
 */
export const CLIMB_SPEED = 360;
export const CLIMB_MIN = 20;
export const CLIMB_MAX_SPEED = 350;
export const CLIMB_PUSH = 180;
/** 3D: in fights, anchors may sit this far outside the arena bounds. */
export const ARENA_ANCHOR_MARGIN = 40;

/* ------------------------------------------------------------------ release grading */

export const PERFECT_MIN_SPEED = 560;
export const PERFECT_MIN_VY = 140;
/** The forward window, in degrees above horizontal (kept for reference; the sim uses the tangents). */
export const PERFECT_MIN_ANGLE = 16;
export const PERFECT_MAX_ANGLE = 74;
/** tan 16° and tan 74°: vy must sit between these times the horizontal speed. No atan2 needed. */
export const TAN16 = 0.2867453857588079;
export const TAN74 = 3.4874144438409087;
export const PERFECT_BOOST = 1.12;
export const GOOD_MIN_VY = 50;

/* ------------------------------------------------------------------ the street */

export const STREET_Y = 0;
export const MISS_DAMAGE = 6;
export const MISS_COOLDOWN = 1.2;
export const MISS_BOUNCE = 880;
export const MISS_DAMP = 0.55;
/** 3D: about where a miss's bounce peaks (880²/2g + radius); the city keeps an anchor in reach of it on every street. */
export const STREET_BOUNCE_TOP = 240;

/* ------------------------------------------------------------------ fights */

/** Slamming into a villain at this speed or more lands a hit. */
export const SLAM_SPEED = 470;
export const HURT_INVULN = 1.0;
export const VILLAIN_HIT_INVULN = 0.55;
/** Fluid back per second while swinging or fighting (2.2/s). */
export const FLUID_REGEN = 2.2;
/** 3D: fluid is an integer; it regenerates FLUID_REGEN_NUM / FLUID_REGEN_DEN per tick (exactly 2.2/s). */
export const FLUID_REGEN_NUM = 11;
export const FLUID_REGEN_DEN = 300;
/** Seconds of the encounter banner before the villain acts. */
export const INTRO_SECONDS = 2.6;
/** The "WEBBED!" beat after a win, before the route moves on. */
export const WON_SECONDS = 2.1;
/** The knockout beat before the night's results. */
export const KO_SECONDS = 2.8;
export const SLOWMO_FACTOR = 0.35;
/** 3D: nobody flies above this inside an arena. */
export const ARENA_CEILING = 1020;

/* ------------------------------------------------------------------ the city (3D) */

/** A 9 × 9 grid of blocks: 600-unit blocks, 180-unit streets. */
export const GRID = 9;
export const BLOCK = 600;
export const STREET = 180;
export const PITCH = BLOCK + STREET;
/** 3D: the narrowest gap between buildings that isn't flush: wider than the hero, so nothing wedges. */
export const ALLEY_MIN = 70;
/** The spatial hash's cell size. */
export const CELL = 256;
/** Stops sit about this far apart. */
export const ZONE_SPACING = 3000;
/** Half the width of a fight arena (a block and half of each street around it). */
export const ARENA_HALF = (BLOCK + STREET) / 2;
/** Doc's bridge arena: half its length along the bridge, and half its width across. */
export const BRIDGE_HALF = 560;
export const BRIDGE_ACROSS = 300;
/** The river is a street widened to this. */
export const RIVER_WIDTH = 420;
/** Errands open when you get this close to the ally… */
export const ERRAND_REACH = 230;
/** …or this close to the ally's building (from any side, up to 500 above its roof). */
export const ERRAND_TOUCH = 80;
/** 3D: the city makes sure every roof has an anchor at least this far above it in reach. */
export const COVERAGE_RISE = 140;
/** The water tower's tank top above its roof. */
export const WATER_TOWER_TOP = 168;
/** Billboard legs, and the board's height. */
export const BILLBOARD_LEGS = 34;
export const BILLBOARD_H = 64;
