/**
 * Every tunable number in the swing sim, in world units (1 unit ≈ 1 CSS px at 1× zoom),
 * seconds and units per second. World y points up; the street is y = 0.
 */

/** The sim steps at a fixed rate, whatever the display does. */
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

/* ------------------------------------------------------------------ the hero */

export const GRAVITY = 1750;
/** Collision radius. The sticker is drawn larger than this, so contact feels fair. */
export const HERO_RADIUS = 26;
/** The sticker's drawn size in world units. */
export const HERO_SIZE = 88;
export const MAX_SPEED = 1650;
export const AIR_CONTROL = 520;
export const AIR_DRAG = 0.04;
/** Auto-run on rooftops, to the right; A/D nudge it. */
export const RUN_SPEED = 390;
export const RUN_ACCEL = 1900;
/** A little hop when you run off a roof edge, so a run flows into a swing. */
export const EDGE_HOP = 520;

/* ------------------------------------------------------------------ webs */

export const ANCHOR_RANGE = 420;
export const ANCHOR_MIN = 70;
/** Anchors must sit at least this far above you; a web only pulls. */
export const ANCHOR_MIN_RISE = 36;
export const ROPE_MIN = 110;
/** The rope length the anchor scoring prefers. */
export const ROPE_COMFORT = 270;
/** Reel-in while you hold, which speeds the swing up a little. */
export const ROPE_REEL = 46;
/** Tangential push while swinging forward below the anchor. */
export const ROPE_PUMP = 280;
export const FIZZLE_COOLDOWN = 0.3;

/* ------------------------------------------------------------------ release grading */

export const PERFECT_MIN_SPEED = 560;
export const PERFECT_MIN_VY = 140;
/** The forward window, in degrees above horizontal. */
export const PERFECT_MIN_ANGLE = 16;
export const PERFECT_MAX_ANGLE = 74;
export const PERFECT_BOOST = 1.12;
export const GOOD_MIN_VY = 50;

/* ------------------------------------------------------------------ the street */

export const STREET_Y = 0;
export const MISS_DAMAGE = 6;
export const MISS_COOLDOWN = 1.2;
export const MISS_BOUNCE = 880;
export const MISS_DAMP = 0.55;

/* ------------------------------------------------------------------ fights */

/** Slamming into a villain at this speed or more lands a hit. */
export const SLAM_SPEED = 470;
export const HURT_INVULN = 1.0;
export const VILLAIN_HIT_INVULN = 0.55;
export const FLUID_REGEN = 2.2;
/** Seconds of the encounter banner before the villain acts. */
export const INTRO_SECONDS = 2.6;
/** The "WEBBED!" beat after a win, before the route moves on. */
export const WON_SECONDS = 2.1;
/** The knockout beat before the night's results. */
export const KO_SECONDS = 2.8;
export const SLOWMO_FACTOR = 0.35;

/* ------------------------------------------------------------------ the route */

export const START_X = 0;
export const ZONE_SPACING = 3000;
/** Half the width inside an arena, between its two towers. */
export const ARENA_HALF = 560;
/** Errands open when you get this close to the ally. */
export const ERRAND_REACH = 230;
