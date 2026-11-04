/**
 * Every tunable number in the 3D swing sim, in world units (1 unit ≈ 1 CSS px at 1×, the
 * hero ~88 tall), seconds and units per second. Y is up; the street is y = 0. Most of the
 * 2D sim's numbers carried over; the 3D additions are marked, and ruleset 2's physics pass
 * is marked "v2" (with the v1 value where one changed), ruleset 3's controls and feel pass
 * "v3" (with the v2 value), and ruleset 4's grounded fights "v4" (with the v3 value).
 */

/**
 * The ruleset every input log is pinned to (score.ts re-exports it). Change any number in
 * the sim, the city, the engine or the scoring and bump it: old logs are then refused
 * instead of being mis-scored.
 */
export const RULESET_VERSION = 4;

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
/**
 * v2: a soft limit (v3: 1,800; v2: 1,650). Above it the hero bleeds speed at OVERSPEED_DECEL instead of being clamped
 * in one tick (v1 clamped). Air drag keeps free falls well under it anyway.
 */
export const MAX_SPEED = 1800;
export const OVERSPEED_DECEL = 2400;
/** Air control's acceleration (v3: 900; v2: 520)… */
export const AIR_CONTROL = 900;
/** …v2: up to this speed along the stick; beyond it the stick only steers, it adds nothing (v1 had no limit; v3: 640, v2: 520). */
export const AIR_STEER_SPEED = 640;
/**
 * v2: quadratic air drag, a = −k|v|v, with k = g / TERMINAL_SPEED², so a long fall levels off at
 * TERMINAL_SPEED (v1: a linear 0.04/s, which never really limited a fall).
 */
export const TERMINAL_SPEED = 3000;
export const AIR_DRAG = GRAVITY / (TERMINAL_SPEED * TERMINAL_SPEED);
/**
 * Running on a roof at this speed with the stick at two thirds (full tilt runs 1.25× it, a
 * third 0.6×). v3: only the stick runs; with it centred the hero brakes to a stop and stands
 * (v2 auto-ran toward the next stop).
 */
export const RUN_SPEED = 390;
/** v2: the run's push from a standstill, easing off to RUN_ACCEL_TOP of it at full speed (v1: a flat 1900; v3: 2,300). */
export const RUN_ACCEL = 2300;
export const RUN_ACCEL_TOP = 0.4;
/** v2: tyre-like grip: braking, and killing sideways slip, at this rate (v1 braked at RUN_ACCEL; v3: 2,900, v2: 2,200). */
export const RUN_BRAKE = 2900;
/** v3: with the stick centred on the ground, friction stops the hero at this rate (a full run stops in about 0.2 s)… */
export const GROUND_FRICTION = 2600;
/** …and faster than RUN_SPEED (a landing's skid) at this one, so a fast landing slides a little, then stops. */
export const SKID_FRICTION = 1700;
/** v3: the body turns to face the stick on the ground at this rate, radians a second (a turnaround takes about 0.17 s). */
export const HERO_TURN_GROUND = 19;
/** v2: a landing's friction impulse takes this × the impact speed off the horizontal speed (villains; the hero uses HERO_LAND_FRICTION)… */
export const LAND_FRICTION = 0.3;
/** …v3: the hero's (v2: 0.3), so a landing bleeds its momentum into a short skid… */
export const HERO_LAND_FRICTION = 0.5;
/** …and a hard landing costs up to this long of crouch (no run push, braking only). */
export const LAND_STOP = 0.22;
/**
 * v3: walking off a roof needs the stick pushed this far out over the edge (as a share of
 * full tilt, along the edge's outward normal); otherwise the hero stops at the edge. There is
 * no hop off an edge any more (v2 hopped at 520 whenever a run carried him off).
 */
export const EDGE_PUSH = 0.25;
/** v3: a web from the ground is a jump into the swing: at least this fast upward… */
export const WEB_JUMP_VY = 430;
/** …and at least this fast along the heading (v2 hopped straight up at 260). */
export const WEB_JUMP_PUSH = 220;
/** 3D: running into a ledge up to this much higher than your roof, you hop up onto it (v2; v1 teleported up). */
export const STEP_UP = 40;
/** v2: the position update is split so no substep moves more than this (half a radius); v1 split in two above 1,200 u/s. */
export const SUBSTEP_LEN = 14;
/** v2: how fast the body turns to face where it's going in the air, radians a second (v1 snapped). */
export const HERO_TURN = 12;

/* ------------------------------------------------------------------ webs */

export const ANCHOR_RANGE = 420;
/** v2: with nothing in ANCHOR_RANGE (above the rooftops), a second look this far out before a fizzle. */
export const ANCHOR_RANGE_FAR = 600;
export const ANCHOR_MIN = 70;
/** Anchors must sit at least this far above you; a web only pulls. */
export const ANCHOR_MIN_RISE = 36;
/** v2: anchors lie ahead, at most 45° either side of the heading (lateral ≤ ahead × this), never behind. */
export const ANCHOR_CONE = 1;
/** v2: and at least this far ahead (an anchor straight overhead carries you nowhere). */
export const ANCHOR_AHEAD_MIN = 24;
export const ROPE_MIN = 110;
/** v3: below its anchor a slack line takes itself up, but not shorter than this (a tight circle is no swing). */
export const ROPE_TAKEUP_MIN = 170;
/** The rope length a swing is planned around (ANCHOR_AHEAD and ANCHOR_UP make about this). */
export const ROPE_COMFORT = 270;
/** v2: no automatic reel-in: the rope keeps its length, so only the pump adds energy (v1 reeled at 46 u/s). */
export const ROPE_REEL = 0;
/** Tangential push while swinging below the anchor: the pump, the swing's only energy source (v1: 280; v3: 400, v2: 320). */
export const ROPE_PUMP = 400;
/** The pump stops adding above this speed (v3: 1,400; v2: 1,250). */
export const PUMP_MAX_SPEED = 1400;
/** v3: fizzles (a web with nothing in reach) are reported at most this often; it no longer stops a held web retrying (v2 locked webs out for it). */
export const FIZZLE_COOLDOWN = 0.3;
/**
 * v3, the web button:
 * - A press is buffered for WEB_BUFFER: if nothing is in reach at the press, every tick in that
 *   time tries again, held or not (so a re-web straight after a release takes).
 * - A press let go within WEB_TAP of its web latching on is a tap: the swing carries on to its
 *   natural end, as if held.
 * - Held (or latched) through the end of a swing (rising past the top of the perfect window, or
 *   at the top of the arc), the web lets go by itself, ungraded; still held, the next web shoots
 *   once the hero has nearly stopped rising (vy under REWEB_VY). Holding the web chains swings.
 */
export const WEB_BUFFER = 0.15;
export const WEB_TAP = 0.18;
export const REWEB_VY = 140;
/** 3D: the ideal anchor sits about this far ahead along the heading… */
export const ANCHOR_AHEAD = 210;
/** …and this far above the hero (together about ROPE_COMFORT away). */
export const ANCHOR_UP = 240;
/** v2: a swing to the side opposite the last one scores this much more (left, right, left). */
export const SIDE_BONUS = 50;
/** v2: the anchor choice predicts each candidate's swing this far ahead, in steps of PREDICT_DT. */
export const PREDICT_SECONDS = 1.8;
export const PREDICT_DT = 1 / 45;
/** v2: a swing whose arc comes within this of the street (feet) is marked down (v1 marked down bottoms under 90). */
export const SWING_CLEAR = 90;
/**
 * 3D: climbing. Holding a web while pressed slowly against a wall (under CLIMB_MAX_SPEED) with
 * the web above, you climb it (v2: accelerating at CLIMB_ACCEL to CLIMB_SPEED; v1 reeled at 360
 * with jitter); at the top you mantle over on a hop that clears the edge by MANTLE_CLEAR, pushed
 * CLIMB_PUSH onto the roof. A climb lets go of the wall after CLIMB_LOSE seconds without it.
 */
export const CLIMB_SPEED = 300;
/** v2: a climb starts only when stuck against the wall: sliding along it slower than this (v1: any contact under CLIMB_MAX_SPEED). */
export const CLIMB_SLIDE = 150;
export const CLIMB_ACCEL = 1400;
export const CLIMB_MAX_SPEED = 350;
export const CLIMB_PUSH = 220;
export const MANTLE_CLEAR = 20;
export const CLIMB_LOSE = 0.12;
/** 3D: in fights, anchors may sit this far outside the arena bounds. */
export const ARENA_ANCHOR_MARGIN = 40;

/* ------------------------------------------------------------------ release grading */

/** v3: 460 and 100 (v2: 520 and 120). */
export const PERFECT_MIN_SPEED = 460;
export const PERFECT_MIN_VY = 100;
/**
 * The perfect window, in degrees above horizontal (kept for reference; the sim uses the
 * tangents). v3: 15–65° (v2: 20–60°, v1: 16–74°), around where a pendulum's release carries
 * furthest and where the anchor choice plans each swing's release.
 */
export const PERFECT_MIN_ANGLE = 15;
export const PERFECT_MAX_ANGLE = 65;
/** tan 15° and tan 65°: vy must sit between these times the horizontal speed. No atan2 needed. */
export const PERFECT_TAN_LO = 0.2679491924311227;
export const PERFECT_TAN_HI = 2.1445069205095586;
/** v3: 1.15 (v2: 1.12). */
export const PERFECT_BOOST = 1.15;
/** A good release: rising faster than GOOD_MIN_VY and at least GOOD_MIN_SPEED fast. v3: it boosts too, a little. */
export const GOOD_MIN_VY = 50;
export const GOOD_MIN_SPEED = 300;
export const GOOD_BOOST = 1.05;

/* ------------------------------------------------------------------ the street */

export const STREET_Y = 0;
/** v3: touching the street costs a little (v2: 6) and the combo. */
export const MISS_DAMAGE = 3;
export const MISS_COOLDOWN = 1.2;
/** v2: 900 (v1: 880), so the bounce still peaks at STREET_BOUNCE_TOP under air drag. */
export const MISS_BOUNCE = 900;
/** v3: the bounce keeps most of the run-up (v2: 0.55), so a miss is a stumble, not a stop. */
export const MISS_DAMP = 0.8;
/** 3D: about where a miss's bounce peaks (with drag, plus the radius); the city keeps an anchor in reach of it on every street. */
export const STREET_BOUNCE_TOP = 240;

/* ------------------------------------------------------------------ pickups and the combo (v3) */

/**
 * v3: Bits tokens and boost rings along each leg's swing line (sim3d/pickups.ts places them
 * from the city). Touching one collects it: a token within PICKUP_REACH of the hero's centre
 * (REACH_TALL times that up and down), a ring within RING_REACH.
 */
export const PICKUP_REACH = 80;
export const RING_REACH = 110;
/** The reach is an upright ellipsoid this many times taller than wide, so a swing's arc through the line counts. */
export const REACH_TALL = 1.5;
/** Tokens sit about this far apart along a corridor… */
export const PICKUP_SPACING = 210;
/** …from this far past the leg's start to this far short of the stop. */
export const PICKUP_START = 420;
export const PICKUP_END = 520;
/** A ring sets the speed to at least RING_SPEED, and multiplies it by RING_BOOST (the soft limit then bleeds it). */
export const RING_BOOST = 1.2;
export const RING_SPEED = 1000;
/**
 * v3, the combo: perfect releases (+1), Bits (+1) and rings (+2) feed it; each feed refills
 * COMBO_TICKS. It drains a tick at a time, COMBO_GROUND_DRAIN times faster standing on a roof,
 * and touching the street ends it. Its multiplier, 1 + count / COMBO_STEP (whole steps, at
 * most COMBO_MAX_MULT), multiplies what pickups are worth.
 */
export const COMBO_TICKS = 360;
export const COMBO_GROUND_DRAIN = 4;
export const COMBO_STEP = 4;
export const COMBO_MAX_MULT = 4;
/** What a pickup is worth to the score, before the multiplier (integers). */
export const BITS_POINTS = 10;
export const RING_POINTS = 50;

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

/**
 * v4, the web button in a fight (ruleset 3 only swung, so the only free hit was a slam at
 * SLAM_SPEED, which kept the hero in the air 97% of a fight):
 * - With a villain body in reach (its surface within STRIKE_STEP, and its centre no more than
 *   STRIKE_RISE above or below), a press is a strike: a step in at up to STRIKE_LUNGE and a blow
 *   that connects across STRIKE_REACH between STRIKE_HIT_FROM and STRIKE_HIT_TO into it. The
 *   next can start STRIKE_CD after the last.
 * - Further out (within ZIP_RANGE, no more than ZIP_RISE above, in plain sight) it is a web-zip:
 *   the web pulls you at him at ZIP_SPEED (along the roof if he's down there, up to him if he
 *   flies low) for at most ZIP_TIME, into a strike. Once every ZIP_CD.
 * - With a body within ZIP_RANGE across the roof the web never swings: a press waits out a
 *   cooldown, and fizzles at a flyer over your head. Further out it is the web as ever, a swing.
 * A strike that lands knocks the villain back at STRIKE_KNOCK and flinches him for STRIKE_FLINCH.
 */
export const STRIKE_STEP = 130;
export const STRIKE_RISE = 150;
export const STRIKE_REACH = 64;
export const STRIKE_LUNGE = 560;
export const STRIKE_TIME = 0.26;
export const STRIKE_HIT_FROM = 0.05;
export const STRIKE_HIT_TO = 0.17;
export const STRIKE_CD = 0.36;
export const STRIKE_KNOCK = 300;
export const STRIKE_FLINCH = 0.3;
export const ZIP_RANGE = 660;
export const ZIP_RISE = 200;
export const ZIP_SPEED = 1050;
export const ZIP_TIME = 0.55;
export const ZIP_CD = 1.1;
/**
 * v4: getting hurt is a shove along the ground (HURT_SHOVE, sliding out at HURT_FRICTION while
 * staggered for HURT_STAGGER, no running), never a launch (v3 threw you 420 back and 120–420 up).
 * In the air, the hit pushes you sideways and stops a rise past HURT_AIR_VY.
 */
/** v4: on the first nights (combat.ts mercy()), up to this share off every hit, and this many more seconds untouchable after one. */
export const MERCY_DAMAGE = 0.1;
export const MERCY_GUARD = 1;
export const HURT_SHOVE = 380;
export const HURT_FRICTION = 900;
export const HURT_STAGGER = 0.3;
export const HURT_AIR_VY = 80;
/**
 * v4: a fight's stage. Fight arenas are one flat roof (v3: five low roofs at four heights with
 * 70-unit alleys and the streets between, which the hero fell into 17–25 times a minute) at
 * STAGE_H, the block inset by STAGE_INSET, with STAGE_TOWER-wide towers at its corners; Doc's
 * bridge deck is DECK_HALF either side of its line (v3: 90). In a fight the hero (and Sandwich
 * Man) stay on the stage; the flyers stay over it.
 */
export const STAGE_H = 240;
export const STAGE_INSET = 30;
export const STAGE_TOWER = 100;
export const DECK_HALF = 120;

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
/** Doc's bridge arena: half its length along the bridge, and half its width across (v2: 680; v1: 560, inside the tower legs). */
export const BRIDGE_HALF = 680;
export const BRIDGE_ACROSS = 300;
/** v2: the bridge's tower legs stand this far along from the centre (v1: 470, 140 inside Doc's reach) and the deck runs this far. */
export const BRIDGE_TOWER = 620;
export const BRIDGE_DECK = 900;
/** The river is a street widened to this. */
export const RIVER_WIDTH = 420;
/** Errands open when you get this close to the ally… */
export const ERRAND_REACH = 230;
/** …or this close to the ally's building (from any side, up to 500 above its roof). */
export const ERRAND_TOUCH = 80;
/** 3D: the city makes sure every roof has an anchor at least this far above it in reach (v2: 110; v1: 140, before wall anchors). */
export const COVERAGE_RISE = 110;
/** The water tower's tank top above its roof. */
export const WATER_TOWER_TOP = 168;
/** Billboard legs, and the board's height. */
export const BILLBOARD_LEGS = 34;
export const BILLBOARD_H = 64;

/* ------------------------------------------------------------------ villain motion (v2) */

/**
 * v2: every villain moves by steering: a wanted velocity, reached with at most an
 * acceleration, under a top speed. Nothing teleports or sets a velocity outright, except a
 * launch (a jump or a dive's push-off), which is an impulse. v1 eased positions toward a path.
 */
/** Gas Goblin's glider: cruise speed, thrust along the flight path, the sideways (banking) limit, and climb/sink. */
export const GOBLIN_SPEED = 320;
export const GOBLIN_THRUST = 520;
export const GOBLIN_TURN_ACCEL = 900;
export const GOBLIN_CLIMB_ACCEL = 700;
/** His dive: top speed and push. The dive only steers with GOBLIN_TURN_ACCEL, so a sidestep dodges it. */
export const GOBLIN_DIVE_SPEED = 820;
export const GOBLIN_DIVE_ACCEL = 2400;
/** Sandwich Man runs the roofs at this × his rate, accelerating and braking at these. */
export const SANDWICH_RUN = 250;
export const SANDWICH_ACCEL = 1300;
export const SANDWICH_BRAKE = 1800;
/** His jumps are true parabolas under this gravity, peaking this far above the higher end and the highest roof between. */
export const SANDWICH_GRAVITY = GRAVITY;
export const SANDWICH_APEX = 70;
/** The front-run lunge: a ballistic leap at where you'll be, taking between these many seconds. */
export const LUNGE_TIME_MIN = 0.28;
export const LUNGE_TIME_MAX = 0.6;
/** Doc's body: hover speed and push. His arms: angular speed and acceleration, sweeping and slamming; extension speed and acceleration. */
export const DOC_SPEED = 240;
export const DOC_ACCEL = 520;
export const ARM_SPEED = 3.2;
export const ARM_ACCEL = 14;
export const ARM_SLAM_SPEED = 8;
export const ARM_SLAM_ACCEL = 40;
export const ARM_EXTEND_SPEED = 900;
export const ARM_EXTEND_ACCEL = 4200;
/** The Sybil: the swarm's centre, and each body seeking its orbit slot. */
export const SYBIL_CENTER_SPEED = 300;
export const SYBIL_CENTER_ACCEL = 420;
export const SYBIL_BODY_SPEED = 560;
export const SYBIL_BODY_ACCEL = 1100;
/** A hit knocks a villain back by this × the hero's closing speed (capped at KNOCK_MAX); it decays through his own steering. */
export const KNOCK_TRANSFER = 0.45;
export const KNOCK_MAX = 520;
/** Stunned or webbed, a flyer loses its steering: air drag at this rate (1/s), and a glider sinks at up to this. */
export const STUN_DRAG = 1.6;
export const STUN_SINK = 220;
/** Yank: a pull of this speed toward the hero (it was a 220-unit teleport in v1), decaying at STUN_DRAG. */
export const YANK_SPEED = 600;
