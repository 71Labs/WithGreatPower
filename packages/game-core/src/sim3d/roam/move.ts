/**
 * Free roam's body: walking, running and sprinting on any surface (the street included: the
 * ground is never lava), jumps, vaults, wall climbs, wall runs, ledge grabs and mantles, drops,
 * rolls on hard landings, the web-zip and, only while the web button says so, the swing.
 *
 * One state per tick (RoamBody.move), each its own step below. Moves that must look exact (a
 * vault, a mantle, a zip, climbing out of the river) are scripted paths checked clear before
 * they start; everything else is physics: the patrol's swing integrator and sphere collision
 * against roam's own CityIndex (its AC units, tanks, poles and masts included).
 *
 * The controls (constants.ts): the stick (a world heading and a tilt, as on a night), the web
 * held, and one-shots for jump, zip, interact, sprint (held) and drop.
 *
 * Deterministic: + − × ÷, Math.sqrt and Math.floor, dmath for angles, a fixed order everywhere.
 */
import { columnTop, ledgeOpen, ledgeSpot, wallSeek } from "./geometry";
import {
  ACCEL_TOP,
  CLIMB_ACCEL,
  CLIMB_DOWN,
  CLIMB_LEAP,
  CLIMB_LEAP_CD,
  CLIMB_LOSE,
  CLIMB_MIN,
  CLIMB_RUNUP,
  CLIMB_RUNUP_K,
  CLIMB_SIDE,
  CLIMB_UP,
  CLIMB_UP_SPRINT,
  COYOTE,
  EDGE_PUSH,
  EDGE_WALK,
  GRAB_CD,
  GRAB_HIGH,
  GRAB_LOW,
  GRAB_VY,
  GROUND_ACCEL,
  GROUND_BRAKE,
  GROUND_FRICTION,
  HANG_DOWN,
  HARD_LAND,
  JOG_SPEED,
  JUMP_BUFFER,
  JUMP_VY,
  LAUNCH_PUSH,
  LAUNCH_VY,
  LAUNCH_WINDOW,
  LEAP_SPEED,
  LEAP_VY,
  LET_GO,
  MANTLE_SECONDS,
  ROLL_CARRY,
  ROLL_IMPACT,
  ROLL_KEEP,
  ROLL_MIN_SPEED,
  ROLL_SECONDS,
  RUN_SPEED,
  SHIMMY,
  SKID_ANGLE,
  SKID_FRICTION,
  SOFT_LAND,
  SPLASH_SECONDS,
  SPRINT_ACCEL,
  SPRINT_JUMP,
  SPRINT_SPEED,
  STEP_RATE,
  STEP_UP,
  TURN_SPRINT,
  TURN_WALK,
  VAULT_CLEAR,
  VAULT_DEPTH,
  VAULT_MAX,
  VAULT_MAX_T,
  VAULT_MIN_T,
  VAULT_SPEED,
  WALK_SPEED,
  WALL_JUMP_OUT,
  WALL_JUMP_VY,
  WALLRUN_ANGLE,
  WALLRUN_CHAIN,
  WALLRUN_GRAVITY,
  WALLRUN_MIN,
  WALLRUN_SECONDS,
  WALLRUN_SPEED,
  WALLRUN_VY,
  ZIP_CD,
  ZIP_LAND_SPEED,
  ZIP_MIN_T,
  ZIP_SPEED,
} from "./constants";
import { collideSphere, groundBelow, overRiver, supported, type SphereHit } from "../city";
import { FIZZLE_COOLDOWN, GOOD_BOOST, GOOD_MIN_SPEED, GOOD_MIN_VY, HERO_RADIUS, HERO_TURN, MAX_SPEED, OVERSPEED_DECEL, PERFECT_BOOST, PERFECT_TAN_HI, REWEB_VY, ROPE_MIN, ANCHOR_RANGE_FAR, SUBSTEP_LEN, WEB_BUFFER, WEB_TAP } from "../constants";
import type { InputFrame } from "../contract";
import { clamp, datan2, dcos, DIR64, dsin, len2, len3, MAG_SCALE } from "../dmath";
import { flightStep, inReleaseWindow, launchFromGround, pickAnchor, wrapRope, type FlightInput } from "../swing";
import type { Hero, SimState } from "../types";
import { clearAt } from "./world";
import { zipTarget } from "./zip";
import type { RoamBody, RoamMove } from "./types";

const R = HERO_RADIUS;
/** cos SKID_ANGLE: the stick this far round from the motion at speed is a skid. */
const COS_SKID = dcos(SKID_ANGLE);
const hit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

/** The one-shots this tick, read off the frame (constants.ts SHOT_*). */
export interface Presses {
  jump: boolean;
  zip: boolean;
  act: boolean;
  drop: boolean;
}

/** The stick as a world direction (unit, or zero) and its tilt (0–1). */
interface Stick {
  x: number;
  z: number;
  tilt: number;
  mag: number;
}

function stickOf(input: InputFrame): Stick {
  if (input.mag <= 0) return { x: 0, z: 0, tilt: 0, mag: 0 };
  const d = DIR64[input.dir];
  return { x: d[0], z: d[1], tilt: MAG_SCALE[input.mag], mag: input.mag };
}

/* ------------------------------------------------------------------ small helpers */

const sprinting = (b: RoamBody) => b.sprintT > 0;
const feet = (h: Hero) => h.y - R;

function setMove(s: SimState, move: RoamMove) {
  const b = s.roam!.body;
  if (b.move === move) return;
  const h = s.hero;
  s.roam!.events.push({ type: "roam-move", move, from: b.move, x: h.x, y: h.y, z: h.z, speed: len3(h.vx, h.vy, h.vz) });
  b.move = move;
  b.moveT = 0;
  h.grounded = move === "ground" || move === "roll";
  if (move !== "swing") {
    h.rope = null;
    h.latched = false;
  }
  if (move === "ground" || move === "roll" || move === "climb" || move === "hang") b.wallruns = 0;
}

/** Turn the facing toward (wx, wz) by at most rate·dt radians. */
function turnFacing(h: Hero, wx: number, wz: number, dt: number, rate: number) {
  const wl = len2(wx, wz);
  if (wl < 1e-9) return;
  const ux = wx / wl;
  const uz = wz / wl;
  const angle = datan2(h.fx * uz - h.fz * ux, h.fx * ux + h.fz * uz);
  const max = rate * dt;
  if (angle <= max && angle >= -max) {
    h.fx = ux;
    h.fz = uz;
    return;
  }
  const step = angle > 0 ? max : -max;
  const c = dcos(step);
  const sn = dsin(step);
  const nx = h.fx * c - h.fz * sn;
  const nz = h.fx * sn + h.fz * c;
  const l = len2(nx, nz) || 1;
  h.fx = nx / l;
  h.fz = nz / l;
}

function friction(h: Hero, decel: number, dt: number) {
  const hs = len2(h.vx, h.vz);
  if (hs <= 1e-9) return;
  const k = Math.max(0, hs - decel * dt) / hs;
  h.vx *= k;
  h.vz *= k;
}

/** The way webs and zips aim: the stick, else the way he's going, else the facing. */
function heading(h: Hero, st: Stick): { x: number; z: number } {
  if (st.mag > 0) return { x: st.x, z: st.z };
  const hs = len2(h.vx, h.vz);
  if (hs > 60) return { x: h.vx / hs, z: h.vz / hs };
  return { x: h.fx, z: h.fz };
}

/** The heading webs and zips would aim along with the last input (the reticle's). */
export const roamHeading = (s: SimState) => heading(s.hero, stickOf(s.input));

/* ------------------------------------------------------------------ the step */

/** One tick of the body. */
export function stepMove(s: SimState, input: InputFrame, press: Presses, dt: number) {
  const h = s.hero;
  const b = s.roam!.body;
  b.moveT += dt;
  b.jumpBuf = press.jump ? JUMP_BUFFER : Math.max(0, b.jumpBuf - dt);
  b.grabCd = Math.max(0, b.grabCd - dt);
  b.zipCd = Math.max(0, b.zipCd - dt);
  b.leapCd = Math.max(0, b.leapCd - dt);
  b.launchT = Math.max(0, b.launchT - dt);
  h.fizzleCd = Math.max(0, h.fizzleCd - dt);
  h.landT = Math.max(0, h.landT - dt);
  if (h.rope) h.ropeT += dt;
  h.idle = input.mag === 0 && !input.web;
  h.climbing = false;
  const st = stickOf(input);
  const webPressed = input.web && !b.webHeld;
  if (webPressed) h.webBuf = WEB_BUFFER;
  else h.webBuf = Math.max(0, h.webBuf - dt);
  if (b.move === "ground" || b.move === "roll") b.coyote = 0;
  else b.coyote += dt;

  // The web, wherever the body can let go to take it: a swing (or a fizzle).
  const free = b.move !== "mantle" && b.move !== "vault" && b.move !== "zip" && b.move !== "splash" && b.move !== "swing";
  // A press (buffered a moment), or the web still held after a swing ran out, at the top of the arc.
  if (!input.web) h.rewebWait = false;
  const chain = input.web && h.rewebWait && b.move === "air" && h.vy <= REWEB_VY;
  if (free && (webPressed || (input.web && h.webBuf > 0) || chain) && tryWeb(s, st, webPressed)) {
    // Swinging from this tick on.
  } else if (free && press.zip && b.zipCd <= 0 && startZip(s, st)) {
    // Zipping.
  }

  switch (b.move) {
    case "ground":
      stepGround(s, st, press, dt);
      break;
    case "roll":
      stepRoll(s, st, press, dt);
      break;
    case "air":
      stepAir(s, st, press, dt);
      break;
    case "swing":
      stepSwing(s, st, input, dt);
      break;
    case "climb":
      stepClimb(s, st, press, dt);
      break;
    case "hang":
      stepHang(s, st, press, dt);
      break;
    case "wallrun":
      stepWallrun(s, st, press, dt);
      break;
    case "mantle":
    case "vault":
    case "zip":
      stepScripted(s, dt);
      break;
    case "splash":
      stepSplash(s);
      break;
  }
  b.webHeld = input.web;
  h.holdPrev = input.web;
  confine(s);
  // Over the soft limit (a boosted release, a launch): bleed it off rather than clamp.
  const speed = len3(h.vx, h.vy, h.vz);
  if (speed > MAX_SPEED) {
    const k = Math.max(MAX_SPEED, speed - OVERSPEED_DECEL * dt) / speed;
    h.vx *= k;
    h.vy *= k;
    h.vz *= k;
  }
  face(s, st, dt);
}

/** Facing: the stick on foot (wide turns at a sprint), the wall on a wall, the motion elsewhere. */
function face(s: SimState, st: Stick, dt: number) {
  const h = s.hero;
  const b = s.roam!.body;
  switch (b.move) {
    case "ground": {
      // On foot the turn is the run's own (stepGround turns the body; the run follows it).
      if (st.mag === 0 && len2(h.vx, h.vz) > 30) turnFacing(h, h.vx, h.vz, dt, TURN_WALK);
      break;
    }
    case "climb":
    case "hang":
      turnFacing(h, -b.wnx, -b.wnz, dt, 22);
      break;
    case "wallrun":
      turnFacing(h, b.wdx, b.wdz, dt, 16);
      break;
    case "mantle":
      turnFacing(h, -b.wnx, -b.wnz, dt, 22);
      break;
    case "vault":
    case "zip":
      turnFacing(h, b.bx - b.ax, b.bz - b.az, dt, 20);
      break;
    case "roll":
      if (len2(h.vx, h.vz) > 40) turnFacing(h, h.vx, h.vz, dt, HERO_TURN);
      break;
    default:
      if (len2(h.vx, h.vz) > 40) turnFacing(h, h.vx, h.vz, dt, HERO_TURN);
  }
}

function confine(s: SimState) {
  const h = s.hero;
  const c = s.city.bounds;
  if (h.x < c.x0 + R) {
    h.x = c.x0 + R;
    if (h.vx < 0) h.vx = 0;
  } else if (h.x > c.x1 - R) {
    h.x = c.x1 - R;
    if (h.vx > 0) h.vx = 0;
  }
  if (h.z < c.z0 + R) {
    h.z = c.z0 + R;
    if (h.vz < 0) h.vz = 0;
  } else if (h.z > c.z1 - R) {
    h.z = c.z1 - R;
    if (h.vz > 0) h.vz = 0;
  }
}

/* ------------------------------------------------------------------ on foot */

/** Run along the facing toward `target`: pushed on an easing curve, braked, gripped sideways. */
function drive(h: Hero, target: number, crouched: boolean, dt: number) {
  const fx = h.fx;
  const fz = h.fz;
  let along = h.vx * fx + h.vz * fz;
  let side = -h.vx * fz + h.vz * fx;
  if (along < target) {
    if (crouched) {
      // Crouched after a landing: no push.
    } else if (along < 0) along = Math.min(target, along + GROUND_BRAKE * dt);
    else if (along < RUN_SPEED) {
      const push = GROUND_ACCEL * (1 - (1 - ACCEL_TOP) * Math.min(1, along / Math.max(1, Math.min(target, RUN_SPEED))));
      along = Math.min(target, along + push * dt);
    } else along = Math.min(target, along + SPRINT_ACCEL * dt);
  } else if (along > target) along = Math.max(target, along - GROUND_BRAKE * 0.55 * dt);
  side = side > 0 ? Math.max(0, side - GROUND_BRAKE * dt) : Math.min(0, side + GROUND_BRAKE * dt);
  h.vx = fx * along - fz * side;
  h.vz = fz * along + fx * side;
}

function doJump(s: SimState, st: Stick, kind: "jump" | "launch") {
  const h = s.hero;
  const b = s.roam!.body;
  const hs = len2(h.vx, h.vz);
  if (kind === "launch") {
    const d = len2(b.bx - b.ax, b.bz - b.az) || 1;
    const dx = st.mag > 0 ? st.x : (b.bx - b.ax) / d;
    const dz = st.mag > 0 ? st.z : (b.bz - b.az) / d;
    h.vx = dx * LAUNCH_PUSH;
    h.vz = dz * LAUNCH_PUSH;
    h.vy = LAUNCH_VY;
  } else {
    h.vy = JUMP_VY;
    if (sprinting(b) && hs > RUN_SPEED * 0.8) {
      const k = Math.min(SPRINT_JUMP, (SPRINT_SPEED * 1.12) / hs);
      h.vx *= k;
      h.vz *= k;
    } else if (hs < 60 && st.mag > 0) {
      // A standing jump goes where the stick points.
      h.vx += st.x * 140 * st.tilt;
      h.vz += st.z * 140 * st.tilt;
    }
  }
  b.jumpBuf = 0;
  b.coyote = COYOTE;
  b.launchT = 0;
  setMove(s, "air");
  s.roam!.events.push({ type: "roam-jump", kind, x: h.x, y: h.y, z: h.z });
}

/** Ground speed for the stick: walk, jog, run by tilt; sprint (held) at any tilt. */
function groundTarget(b: RoamBody, st: Stick): number {
  if (st.mag === 0) return 0;
  if (sprinting(b)) return SPRINT_SPEED;
  return st.mag === 1 ? WALK_SPEED : st.mag === 2 ? JOG_SPEED : RUN_SPEED;
}

/** The axis-aligned outward normal of the edge a grounded move from (gx, gz) went over, or (0, 0). */
function edgeOut(s: SimState, gx: number, gz: number): { x: number; z: number } {
  const h = s.hero;
  const g = s.grid;
  const backX = supported(g, gx, h.y, h.z, R);
  const backZ = supported(g, h.x, h.y, gz, R);
  const ox = backX || !backZ ? (h.x > gx ? 1 : h.x < gx ? -1 : 0) : 0;
  const oz = backZ || !backX ? (h.z > gz ? 1 : h.z < gz ? -1 : 0) : 0;
  return { x: ox, z: oz };
}

/** Standing on something: a top face under the feet, or the street. */
const onSomething = (s: SimState) => feet(s.hero) <= 0.5 || supported(s.grid, s.hero.x, s.hero.y, s.hero.z, R);

interface Contact {
  wall: boolean;
  nx: number;
  nz: number;
  top: number;
  /** The speed into the wall just before it stopped him. */
  into: number;
}

/**
 * Move a body on its feet (or rolling) for one tick: substeps, collision, smooth step-ups.
 * Returns the last wall it met (its normal and top), for vaults and climbs.
 */
function moveOnFoot(s: SimState, dt: number): Contact {
  const h = s.hero;
  const c: Contact = { wall: false, nx: 0, nz: 0, top: 0, into: 0 };
  const steps = clamp(Math.ceil((len2(h.vx, h.vz) * dt) / SUBSTEP_LEN), 1, 4);
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const pvx = h.vx;
    const pvz = h.vz;
    h.x += h.vx * sdt;
    h.z += h.vz * sdt;
    collideSphere(s.grid, h, R, hit);
    if (hit.wall) {
      const rise = hit.wallTop - feet(h);
      if (rise > 0 && rise <= STEP_UP) {
        // A kerb, a low unit: up it smoothly.
        h.y += Math.min(rise + 0.5, STEP_RATE * sdt);
        h.vx = pvx;
        h.vz = pvz;
        continue;
      }
      c.wall = true;
      c.nx = hit.wallNx;
      c.nz = hit.wallNz;
      c.top = hit.wallTop;
      c.into = Math.max(c.into, -(pvx * hit.wallNx + pvz * hit.wallNz));
    }
    if (hit.top) h.y = Math.max(h.y, hit.topY + R);
  }
  h.vy = 0;
  if (feet(h) < 0) h.y = R;
  return c;
}

function stepGround(s: SimState, st: Stick, press: Presses, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  if (b.launchT > 0 && b.jumpBuf > 0) return doJump(s, st, "launch"), stepAir(s, st, press, dt);
  if (b.jumpBuf > 0 && h.landT < HARD_LAND * 0.5) return doJump(s, st, "jump"), stepAir(s, st, press, dt);
  if (press.drop && dropToHang(s, st)) return;

  const target = groundTarget(b, st);
  const hs = len2(h.vx, h.vz);
  if (st.mag > 0) {
    // A sharp reversal at speed is a skid first (feet planted, sliding), then the turn.
    const dot = h.vx * st.x + h.vz * st.z;
    if (hs > RUN_SPEED * 0.85 && dot < hs * COS_SKID) friction(h, SKID_FRICTION, dt);
    else {
      const rate = TURN_WALK + (TURN_SPRINT - TURN_WALK) * clamp((hs - JOG_SPEED) / (SPRINT_SPEED - JOG_SPEED), 0, 1);
      turnFacing(h, st.x, st.z, dt, rate);
      drive(h, target, h.landT > 0, dt);
    }
  } else friction(h, hs > RUN_SPEED ? SKID_FRICTION : GROUND_FRICTION, dt);

  const gx = h.x;
  const gz = h.z;
  const c = moveOnFoot(s, dt);
  if (c.wall && wallAction(s, st, c)) return;
  if (onSomething(s)) {
    h.grounded = true;
    groundRiver(s);
    return;
  }
  // Over a roof's edge: a walk stops at it unless the stick pushes out; a run carries off it, a fast one in a leap.
  const out = edgeOut(s, gx, gz);
  const push = Math.max(out.x ? st.x * out.x * st.tilt : 0, out.z ? st.z * out.z * st.tilt : 0);
  const speed = len2(h.vx, h.vz);
  if (speed < EDGE_WALK && push < EDGE_PUSH && (out.x || out.z)) {
    if (out.x) {
      h.x = gx;
      h.vx = 0;
    }
    if (out.z) {
      h.z = gz;
      h.vz = 0;
    }
    if (!onSomething(s)) {
      h.x = gx;
      h.z = gz;
      h.vx = 0;
      h.vz = 0;
    }
    return;
  }
  if (speed >= LEAP_SPEED && st.mag > 0) {
    h.vy = LEAP_VY;
    s.roam!.events.push({ type: "roam-jump", kind: "leap", x: h.x, y: h.y, z: h.z });
  }
  setMove(s, "air");
}

/** On the street over the river: in it. */
function groundRiver(s: SimState) {
  const h = s.hero;
  if (feet(h) <= 0.5 && overRiver(s.city, h.x, h.z)) startSplash(s);
}

/**
 * On foot against a wall: vault it (low, taken at a run), climb it (tall, the stick into it),
 * or slide along it. True when the body moved on to another state.
 */
function wallAction(s: SimState, st: Stick, c: Contact): boolean {
  const h = s.hero;
  const into = st.mag > 0 ? -(st.x * c.nx + st.z * c.nz) : 0;
  const rise = c.top - feet(h);
  const speed = Math.max(len2(h.vx, h.vz), c.into);
  // Low: over it at a run, else up onto it.
  if (rise > STEP_UP && rise <= VAULT_MAX && into > 0.5 && tryVault(s, c, speed, speed >= VAULT_SPEED)) return true;
  if (rise >= CLIMB_MIN && into > 0.55 && s.roam!.body.grabCd <= 0) {
    startClimb(s, c.nx, c.nz, CLIMB_RUNUP + CLIMB_RUNUP_K * c.into);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ landings */

/** Down on a top face (or the street): a roll, a three-point landing, or a soft one. Never damage. */
function land(s: SimState, impact: number) {
  const h = s.hero;
  const b = s.roam!.body;
  const hs = len2(h.vx, h.vz);
  s.events.push({ type: "land", x: h.x, y: feet(h), z: h.z, speed: len3(h.vx, impact, h.vz) });
  h.vy = 0;
  if (impact >= ROLL_IMPACT && hs >= ROLL_MIN_SPEED) {
    // Carried through in a roll: the run kept, some of the fall turned into it.
    const k = Math.min(Math.max(hs * ROLL_KEEP + impact * ROLL_CARRY, hs * ROLL_KEEP), Math.max(hs, RUN_SPEED)) / hs;
    h.vx *= k;
    h.vz *= k;
    setMove(s, "roll");
  } else {
    if (impact >= ROLL_IMPACT) {
      h.landT = HARD_LAND;
      friction(h, hs, 1);
    } else {
      h.landT = SOFT_LAND * Math.min(1, impact / ROLL_IMPACT);
      friction(h, impact * 0.25, 1);
    }
    setMove(s, "ground");
  }
  b.wallruns = 0;
  groundRiver(s);
}

function stepRoll(s: SimState, st: Stick, press: Presses, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  if (b.jumpBuf > 0 && b.moveT > 0.12) return doJump(s, st, "jump"), stepAir(s, st, press, dt);
  // A little steering through the roll, and almost no friction.
  if (st.mag > 0 && b.moveT > ROLL_SECONDS * 0.5) turnFacing(h, st.x, st.z, dt, 4);
  friction(h, 120, dt);
  moveOnFoot(s, dt);
  if (!onSomething(s)) {
    setMove(s, "air");
    return;
  }
  groundRiver(s);
  if (b.move === "roll" && b.moveT >= ROLL_SECONDS) {
    // Up and running in the way he rolled.
    const hs = len2(h.vx, h.vz);
    if (hs > 1) {
      h.fx = h.vx / hs;
      h.fz = h.vz / hs;
    }
    setMove(s, "ground");
  }
}

/* ------------------------------------------------------------------ the air */

function stepAir(s: SimState, st: Stick, press: Presses, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  // A point launch off the end of a zip, or a late jump just off an edge.
  if (b.launchT > 0 && b.jumpBuf > 0) return doJump(s, st, "launch"), stepAir(s, st, press, dt);
  if (b.jumpBuf > 0 && b.coyote < COYOTE && h.vy <= LEAP_VY + 1) return doJump(s, st, "jump"), stepAir(s, st, press, dt);
  const head = heading(h, st);
  const fin: FlightInput = { hx: head.x, hz: head.z, bias: false, sx: st.x * st.tilt, sz: st.z * st.tilt, pump: false };
  const steps = clamp(Math.ceil((len3(h.vx, h.vy, h.vz) * dt) / SUBSTEP_LEN), 1, 4);
  const sdt = dt / steps;
  let wall: Contact | null = null;
  for (let i = 0; i < steps; i++) {
    const pvx = h.vx;
    const pvz = h.vz;
    const pvy = h.vy;
    flightStep(h, null, sdt, fin);
    collideSphere(s.grid, h, R, hit);
    if (hit.wall) wall = { wall: true, nx: hit.wallNx, nz: hit.wallNz, top: hit.wallTop, into: Math.max(0, -(pvx * hit.wallNx + pvz * hit.wallNz)) };
    if (hit.top && h.vy <= 0) {
      h.y = hit.topY + R;
      land(s, Math.max(0, -pvy));
      return;
    }
    if (feet(h) <= 0) {
      h.y = R;
      land(s, Math.max(0, -pvy));
      return;
    }
  }
  if (wall) airWall(s, st, wall);
}

/** In the air against a wall: catch its ledge, run along it, or climb it. */
function airWall(s: SimState, st: Stick, c: Contact) {
  const h = s.hero;
  const b = s.roam!.body;
  if (b.grabCd > 0) return;
  const into = st.mag > 0 ? -(st.x * c.nx + st.z * c.nz) : 0;
  const top = columnTop(s.grid, h.x - c.nx * (R + 2), h.z - c.nz * (R + 2), h.y) ;
  const ledge = top - h.y;
  // Hands on a ledge: falling (or barely rising) with its top within reach.
  if (ledge >= GRAB_LOW && ledge <= GRAB_HIGH && h.vy < GRAB_VY && (into > 0.1 || c.into > 40) && ledgeOpen(s.grid, h.x, h.z, c.nx, c.nz, top)) {
    startHang(s, c.nx, c.nz, top);
    return;
  }
  const hs = len2(h.vx, h.vz);
  const along = hs > 1 ? Math.abs(h.vx * c.nx + h.vz * c.nz) / hs : 1;
  if (hs + c.into >= WALLRUN_SPEED && along < WALLRUN_ANGLE && top > h.y + 40 && b.wallruns < WALLRUN_CHAIN && into > -0.3) {
    startWallrun(s, c);
    return;
  }
  if ((into > 0.5 || c.into > 150) && top - feet(h) >= CLIMB_MIN * 0.5) startClimb(s, c.nx, c.nz, Math.max(h.vy, 0));
}

/* ------------------------------------------------------------------ the web */

/**
 * The web button: a swing toward an anchor ahead (as on a night, the patrol's anchor choice),
 * a jump into it from the ground. Nothing in reach: the strand flies out and drops.
 */
function tryWeb(s: SimState, st: Stick, pressed: boolean): boolean {
  const h = s.hero;
  const b = s.roam!.body;
  const head = heading(h, st);
  // The anchor choice reads the hero as a night's does: on his feet, or in the air.
  h.grounded = b.move === "ground" || b.move === "roll";
  const a = pickAnchor(s, head.x, head.z);
  if (!a) {
    if (pressed && h.fizzleCd <= 0) {
      h.fizzleCd = FIZZLE_COOLDOWN;
      s.events.push({ type: "fizzle", x: h.x, y: h.y, z: h.z });
    }
    return false;
  }
  if (h.grounded) launchFromGround(h, head.x, head.z);
  else if (b.move === "climb" || b.move === "hang") {
    // Off the wall first.
    h.vx = b.wnx * 160;
    h.vz = b.wnz * 160;
    h.vy = Math.max(h.vy, 200);
  }
  h.grounded = false;
  const d = len3(a.x - h.x, a.y - h.y, a.z - h.z);
  setMove(s, "swing");
  h.rope = { x: a.x, y: a.y, z: a.z, len: clamp(d, ROPE_MIN, ANCHOR_RANGE_FAR) };
  h.ropeT = 0;
  h.latched = !s.input.web;
  h.webBuf = 0;
  h.rewebWait = false;
  const lat = -(a.x - h.x) * head.z + (a.z - h.z) * head.x;
  h.side = lat > 30 ? 1 : lat < -30 ? -1 : 0;
  s.events.push({ type: "thwip", x: h.x, y: h.y, z: h.z, ax: a.x, ay: a.y, az: a.z });
  return true;
}

/** A swing's natural end (as on a night): past the bottom and rising steeply, or out of steam with room below. */
function swingDone(s: SimState, hx: number, hz: number): boolean {
  const h = s.hero;
  const rope = h.rope;
  if (!rope || h.ropeT < 0.25) return false;
  const hs = len2(h.vx, h.vz);
  if (h.ropeT > 1.5 && h.vy > -60 && h.vx * hx + h.vz * hz > 0.8 * hs && hs > 200) return true;
  if (h.vy <= 0 || (h.x - rope.x) * h.vx + (h.z - rope.z) * h.vz <= 0) return false;
  if (h.vy >= hs * PERFECT_TAN_HI) return true;
  return len3(h.vx, h.vy, h.vz) < 240 && feet(h) - groundBelow(s.grid, h.x, h.z, h.y) > 160;
}

/** Let go of the web: a release in the window boosts (perfect, good), as on a night; no combo here. */
function letGoWeb(s: SimState, graded: boolean) {
  const h = s.hero;
  if (!h.rope) return;
  h.rope = null;
  h.latched = false;
  let grade: "perfect" | "good" | null = null;
  if (graded) {
    const speed = len3(h.vx, h.vy, h.vz);
    if (inReleaseWindow(h.vx, h.vy, h.vz)) {
      grade = "perfect";
      boost(h, PERFECT_BOOST);
      s.total.perfect += 1;
    } else if (h.vy > GOOD_MIN_VY && speed > GOOD_MIN_SPEED) {
      grade = "good";
      boost(h, GOOD_BOOST);
      s.total.good += 1;
    }
  }
  s.events.push({ type: "release", grade, x: h.x, y: h.y, z: h.z, combo: 0, ...(graded ? {} : { auto: true }) });
}

function boost(h: Hero, k: number) {
  const speed = len3(h.vx, h.vy, h.vz);
  if (speed <= 1e-9) return;
  const m = Math.max(speed, Math.min(MAX_SPEED, speed * k)) / speed;
  h.vx *= m;
  h.vy *= m;
  h.vz *= m;
}

function stepSwing(s: SimState, st: Stick, input: InputFrame, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  const head = heading(h, st);
  if (h.rope) {
    const pressed = input.web && !b.webHeld;
    if (pressed && h.latched) h.latched = false;
    else if (!input.web && !h.latched) {
      if (h.ropeT < WEB_TAP) h.latched = true;
      else {
        letGoWeb(s, true);
        setMove(s, "air");
        return stepAir(s, st, { jump: false, zip: false, act: false, drop: false }, dt);
      }
    }
    if (h.rope && swingDone(s, head.x, head.z)) {
      // The swing ran its course: the web lets go; still held, the next one shoots at the top of the arc.
      letGoWeb(s, false);
      h.rewebWait = input.web;
      setMove(s, "air");
      return stepAir(s, st, { jump: false, zip: false, act: false, drop: false }, dt);
    }
  }
  if (!h.rope) {
    setMove(s, "air");
    return stepAir(s, st, { jump: false, zip: false, act: false, drop: false }, dt);
  }
  const rope = h.rope!;
  const fin: FlightInput = { hx: head.x, hz: head.z, bias: false, sx: st.x * st.tilt, sz: st.z * st.tilt, pump: true };
  const steps = clamp(Math.ceil((len3(h.vx, h.vy, h.vz) * dt) / SUBSTEP_LEN), 1, 4);
  const sdt = dt / steps;
  let touched = false;
  for (let i = 0; i < steps; i++) {
    const pvy = h.vy;
    flightStep(h, rope, sdt, fin);
    collideSphere(s.grid, h, R, hit);
    if (hit.hit) touched = true;
    if ((hit.top && h.vy <= 0) || feet(h) <= 0) {
      if (feet(h) <= 0) h.y = R;
      else h.y = hit.topY + R;
      letGoWeb(s, false);
      h.rewebWait = false;
      land(s, Math.max(0, -pvy));
      return;
    }
    if (hit.wall && len3(h.vx, h.vy, h.vz) < 420 && columnTop(s.grid, h.x - hit.wallNx * (R + 2), h.z - hit.wallNz * (R + 2), h.y) - feet(h) >= CLIMB_MIN * 0.5) {
      // Swung into a wall: onto it.
      letGoWeb(s, false);
      startClimb(s, hit.wallNx, hit.wallNz, Math.max(0, pvy));
      return;
    }
  }
  if (touched && h.rope && !wrapRope(s.grid, h, h.rope)) {
    letGoWeb(s, false);
    setMove(s, "air");
  }
}

/* ------------------------------------------------------------------ walls */

function startClimb(s: SimState, nx: number, nz: number, vy: number) {
  const h = s.hero;
  const b = s.roam!.body;
  b.wnx = nx;
  b.wnz = nz;
  b.awayT = 0;
  b.wface = 0;
  h.vx = -nx * 40;
  h.vz = -nz * 40;
  h.vy = clamp(vy, 0, CLIMB_LEAP);
  setMove(s, "climb");
}

function letGo(s: SimState, push: number) {
  const h = s.hero;
  const b = s.roam!.body;
  h.vx = b.wnx * push;
  h.vz = b.wnz * push;
  h.vy = Math.min(h.vy, 0);
  b.grabCd = GRAB_CD;
  setMove(s, "air");
}

/** Off a wall on a jump: out along the stick (or straight out), and up. */
function wallJump(s: SimState, st: Stick, alongX = 0, alongZ = 0) {
  const h = s.hero;
  const b = s.roam!.body;
  let dx = b.wnx;
  let dz = b.wnz;
  if (st.mag > 0) {
    // The stick, kept off the wall.
    const into = st.x * b.wnx + st.z * b.wnz;
    dx = st.x + b.wnx * Math.max(0, 0.6 - into);
    dz = st.z + b.wnz * Math.max(0, 0.6 - into);
    const l = len2(dx, dz) || 1;
    dx /= l;
    dz /= l;
  }
  h.vx = dx * WALL_JUMP_OUT + alongX;
  h.vz = dz * WALL_JUMP_OUT + alongZ;
  h.vy = WALL_JUMP_VY;
  h.fx = dx;
  h.fz = dz;
  b.grabCd = GRAB_CD * 0.7;
  b.jumpBuf = 0;
  setMove(s, "air");
  s.roam!.events.push({ type: "roam-jump", kind: "wall", x: h.x, y: h.y, z: h.z });
}

function stepClimb(s: SimState, st: Stick, press: Presses, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  const nx = b.wnx;
  const nz = b.wnz;
  const tx = -nz;
  const tz = nx;
  const into = st.mag > 0 ? -(st.x * nx + st.z * nz) : 0;
  const side = st.mag > 0 ? st.x * tx + st.z * tz : 0;
  if (press.drop) return letGo(s, 90);
  if (b.jumpBuf > 0) {
    if (into < -0.3 || side > 0.6 || side < -0.6) return wallJump(s, st);
    if (b.leapCd <= 0) {
      h.vy = CLIMB_LEAP;
      b.leapCd = CLIMB_LEAP_CD;
      b.jumpBuf = 0;
      s.roam!.events.push({ type: "roam-jump", kind: "climb", x: h.x, y: h.y, z: h.z });
    }
  }
  b.awayT = into < -0.5 ? b.awayT + dt : 0;
  if (b.awayT > LET_GO) {
    if (feet(h) <= 2) {
      setMove(s, "ground");
      return;
    }
    return letGo(s, 120);
  }
  const up = sprinting(b) ? CLIMB_UP_SPRINT : CLIMB_UP;
  const want = into > 0.25 ? up * Math.min(1, into * 1.3) : into < -0.25 ? -CLIMB_DOWN : 0;
  // A leap up the wall carries, then eases back to the climb.
  h.vy += clamp(want - h.vy, -CLIMB_ACCEL * dt * (h.vy > want ? 0.55 : 1), CLIMB_ACCEL * dt);
  const vt = side > 0.3 || side < -0.3 ? side * CLIMB_SIDE : 0;
  h.vx = tx * vt - nx * 40;
  h.vz = tz * vt - nz * 40;
  h.x += h.vx * dt;
  h.y += h.vy * dt;
  h.z += h.vz * dt;
  collideSphere(s.grid, h, R, hit);
  if (hit.wall) {
    b.wnx = hit.wallNx;
    b.wnz = hit.wallNz;
    b.wface = 0;
  } else {
    // Off the end of a face: find the next one round the corner or up a setback; else let go.
    const seek = wallSeek(s.grid, h, b.wnx, b.wnz, 90);
    if (seek) {
      b.wnx = seek.nx;
      b.wnz = seek.nz;
      const k = Math.min(1, (300 * dt) / Math.max(1, seek.d - R - 0.5));
      h.x -= seek.nx * (seek.d - R - 0.5) * k;
      h.z -= seek.nz * (seek.d - R - 0.5) * k;
      b.wface = 0;
    } else {
      b.wface += dt;
      if (b.wface > CLIMB_LOSE) return letGo(s, 60);
    }
  }
  if (hit.ceiling && h.vy > 0) h.vy = 0;
  if (hit.top && h.vy <= 0 && !hit.wall) {
    // Climbed (or slid) onto something.
    h.y = hit.topY + R;
    setMove(s, "ground");
    return;
  }
  if (feet(h) <= 0) {
    h.y = R;
    h.vy = 0;
    if (into <= 0.25) setMove(s, "ground");
    return;
  }
  // The top of this face: over it when there's room, else keep climbing (a flush tier goes on up).
  const top = columnTop(s.grid, h.x - b.wnx * (R + 2), h.z - b.wnz * (R + 2), h.y);
  b.wtop = top;
  if (top > 0 && h.y >= top - HANG_DOWN) {
    if (ledgeOpen(s.grid, h.x, h.z, b.wnx, b.wnz, top)) {
      if (into > 0.25) startMantle(s, top);
      else startHang(s, b.wnx, b.wnz, top);
      return;
    }
    if (h.y >= top + R && !wallSeek(s.grid, h, b.wnx, b.wnz, 90)) startHang(s, b.wnx, b.wnz, top);
  }
}

function startHang(s: SimState, nx: number, nz: number, top: number) {
  const h = s.hero;
  const b = s.roam!.body;
  b.wnx = nx;
  b.wnz = nz;
  b.wtop = top;
  b.awayT = 0;
  h.y = top - HANG_DOWN;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  setMove(s, "hang");
}

function stepHang(s: SimState, st: Stick, press: Presses, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  const nx = b.wnx;
  const nz = b.wnz;
  const tx = -nz;
  const tz = nx;
  const into = st.mag > 0 ? -(st.x * nx + st.z * nz) : 0;
  const side = st.mag > 0 ? st.x * tx + st.z * tz : 0;
  if (press.drop) return letGo(s, 60);
  if (b.jumpBuf > 0) {
    if (into < -0.3) return wallJump(s, st);
    if (b.moveT > 0.08 && ledgeOpen(s.grid, h.x, h.z, nx, nz, b.wtop)) return startMantle(s, b.wtop);
  }
  if (into > 0.3 && b.moveT > 0.15 && ledgeOpen(s.grid, h.x, h.z, nx, nz, b.wtop)) return startMantle(s, b.wtop);
  b.awayT = into < -0.5 ? b.awayT + dt : 0;
  if (b.awayT > LET_GO * 1.5) return letGo(s, 80);
  // Shuffle along while the ledge goes on.
  if (side > 0.3 || side < -0.3) {
    const step = side * SHIMMY * dt;
    const x = h.x + tx * step;
    const z = h.z + tz * step;
    const t = columnTop(s.grid, x - nx * (R + 2), z - nz * (R + 2), b.wtop - 4);
    if (t > b.wtop - 3 && t < b.wtop + 3 && clearAt(s.grid, x, b.wtop - HANG_DOWN, z, R - 2)) {
      h.x = x;
      h.z = z;
    }
  }
  // Held to the wall, under the ledge.
  h.vx = -nx * 20;
  h.vz = -nz * 20;
  h.vy = 0;
  h.y = b.wtop - HANG_DOWN;
  collideSphere(s.grid, h, R, hit);
  h.y = b.wtop - HANG_DOWN;
  h.vx = 0;
  h.vz = 0;
}

/** From the street or a roof, the drop button at an edge: over it, turned round, hanging by the hands. */
function dropToHang(s: SimState, st: Stick): boolean {
  const h = s.hero;
  const spot = ledgeSpot(s.grid, h, st.mag > 0 ? st.x : h.fx, st.mag > 0 ? st.z : h.fz);
  if (!spot) return false;
  h.x = spot.x;
  h.z = spot.z;
  h.fx = -spot.nx;
  h.fz = -spot.nz;
  startHang(s, spot.nx, spot.nz, spot.top);
  return true;
}

/** Up over a ledge whose top is at `top`: a scripted pull-up to MANTLE_IN in from the edge (the middle of a perch). */
function startMantle(s: SimState, top: number) {
  const h = s.hero;
  const b = s.roam!.body;
  const to = ledgeOpen(s.grid, h.x, h.z, b.wnx, b.wnz, top, true);
  if (!to) return;
  b.ax = h.x;
  b.ay = h.y;
  b.az = h.z;
  b.bx = to.x;
  b.by = top + R;
  b.bz = to.z;
  b.dur = MANTLE_SECONDS;
  b.arc = 0;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  setMove(s, "mantle");
}

function startWallrun(s: SimState, c: Contact) {
  const h = s.hero;
  const b = s.roam!.body;
  b.wnx = c.nx;
  b.wnz = c.nz;
  // Along the wall, the way he was going.
  let tx = -c.nz;
  let tz = c.nx;
  if (h.vx * tx + h.vz * tz < 0) {
    tx = -tx;
    tz = -tz;
  }
  b.wdx = tx;
  b.wdz = tz;
  b.wallruns += 1;
  b.wface = 0;
  const along = Math.max(WALLRUN_MIN, h.vx * tx + h.vz * tz);
  h.vx = tx * along;
  h.vz = tz * along;
  h.vy = Math.max(h.vy, WALLRUN_VY);
  setMove(s, "wallrun");
}

function stepWallrun(s: SimState, st: Stick, press: Presses, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  const into = st.mag > 0 ? -(st.x * b.wnx + st.z * b.wnz) : 0;
  const along = h.vx * b.wdx + h.vz * b.wdz;
  if (b.jumpBuf > 0) return wallJump(s, st, b.wdx * along * 0.85, b.wdz * along * 0.85);
  if (press.drop || into < -0.5 || b.moveT > WALLRUN_SECONDS || h.vy < -420) {
    h.vx = b.wdx * along + b.wnx * 90;
    h.vz = b.wdz * along + b.wnz * 90;
    b.grabCd = GRAB_CD * 0.5;
    setMove(s, "air");
    return;
  }
  h.vy -= WALLRUN_GRAVITY * dt;
  const sp = Math.max(along, WALLRUN_MIN * 0.9);
  h.vx = b.wdx * sp - b.wnx * 30;
  h.vz = b.wdz * sp - b.wnz * 30;
  const steps = clamp(Math.ceil((sp * dt) / SUBSTEP_LEN), 1, 4);
  const sdt = dt / steps;
  let onWall = false;
  for (let i = 0; i < steps; i++) {
    h.x += h.vx * sdt;
    h.y += h.vy * sdt;
    h.z += h.vz * sdt;
    collideSphere(s.grid, h, R, hit);
    if (hit.wall) {
      // A corner turned the wall more than a little: the run ends there.
      if (hit.wallNx * b.wnx + hit.wallNz * b.wnz < 0.9) {
        b.grabCd = GRAB_CD * 0.5;
        setMove(s, "air");
        return;
      }
      onWall = true;
    }
    if ((hit.top && h.vy <= 0) || feet(h) <= 0) {
      if (feet(h) <= 0) h.y = R;
      else h.y = hit.topY + R;
      land(s, Math.max(0, -h.vy));
      return;
    }
  }
  h.vx = b.wdx * sp;
  h.vz = b.wdz * sp;
  b.wface = onWall ? 0 : b.wface + dt;
  if (b.wface > 0.05) {
    setMove(s, "air");
    return;
  }
  // A ledge comes into reach on the way: grab it.
  const top = columnTop(s.grid, h.x - b.wnx * (R + 2), h.z - b.wnz * (R + 2), h.y);
  if (top - h.y >= GRAB_LOW && top - h.y <= GRAB_HIGH * 0.6 && h.vy < GRAB_VY && ledgeOpen(s.grid, h.x, h.z, b.wnx, b.wnz, top)) startHang(s, b.wnx, b.wnz, top);
}

/* ------------------------------------------------------------------ vaults */

/**
 * The vault's path at u (0–1): the body rises first and travels on a smoothstep, so it lifts
 * clear of the near edge before it moves over (the arc peaks `arc` above the straight line).
 */
export function vaultPoint(ax: number, ay: number, az: number, bx: number, by: number, bz: number, arc: number, u: number, out: { x: number; y: number; z: number }) {
  const e = u * u * (3 - 2 * u);
  out.x = ax + (bx - ax) * e;
  out.z = az + (bz - az) * e;
  out.y = ay + (by - ay) * u + arc * 4 * u * (1 - u);
  return out;
}

const vp = { x: 0, y: 0, z: 0 };

/** Whether the vault path from the hero to (tx, ty, tz) over an obstacle topped at `top` is clear; its arc, or −1. */
function vaultArc(s: SimState, tx: number, ty: number, tz: number, top: number): number {
  const h = s.hero;
  const mid = (h.y + ty) / 2;
  const arc = Math.max(8, top + R + VAULT_CLEAR - mid);
  for (let k = 1; k < 8; k++) {
    vaultPoint(h.x, h.y, h.z, tx, ty, tz, arc, k / 8, vp);
    if (!clearAt(s.grid, vp.x, vp.y, vp.z, R - 10)) return -1;
  }
  return arc;
}

/**
 * Over a low obstacle at a run (`over`), else up onto it (a ledge, something deep, something
 * standing behind it): a scripted hop whose arc clears its top, every point of it checked first.
 */
function tryVault(s: SimState, c: Contact, speed: number, over: boolean): boolean {
  const h = s.hero;
  const b = s.roam!.body;
  const g = s.grid;
  const dx = -c.nx;
  const dz = -c.nz;
  const f0 = feet(h);
  const top = c.top;
  // How deep it is along the run: walk across its top until it ends.
  let depth = 0;
  while (depth < VAULT_DEPTH + 20) {
    const t = columnTop(g, h.x + dx * (R + 4 + depth + 6), h.z + dz * (R + 4 + depth + 6), top - 2);
    if (t < top - 3) break;
    depth += 6;
  }
  let tx = 0;
  let ty = 0;
  let tz = 0;
  let arc = -1;
  let clean = false;
  if (over && depth <= VAULT_DEPTH) {
    // Over: land past it on the ground there (no higher than where he took off).
    tx = h.x + dx * (2 * R + 8 + depth + 24);
    tz = h.z + dz * (2 * R + 8 + depth + 24);
    const ground = groundBelow(g, tx, tz, f0 + 6);
    ty = ground + R;
    if (ground <= f0 + 6 && clearAt(g, tx, ty + 1, tz, R)) arc = vaultArc(s, tx, ty, tz, top);
    clean = arc >= 0;
  }
  if (arc < 0) {
    // Up onto it.
    tx = h.x + dx * (R + 4 + Math.min(depth, 40) + 4);
    tz = h.z + dz * (R + 4 + Math.min(depth, 40) + 4);
    ty = top + R;
    if (!clearAt(g, tx, ty + 1, tz, R)) return false;
    arc = vaultArc(s, tx, ty, tz, top);
    if (arc < 0) return false;
  }
  const dist = len2(tx - h.x, tz - h.z);
  b.ax = h.x;
  b.ay = h.y;
  b.az = h.z;
  b.bx = tx;
  b.by = ty;
  b.bz = tz;
  b.dur = clamp(dist / Math.max(speed, 320), VAULT_MIN_T, VAULT_MAX_T);
  b.arc = arc;
  const out = clean ? Math.max(speed, 320) * 0.95 : Math.max(speed * 0.6, 120);
  b.ex = dx * out;
  b.ez = dz * out;
  h.vx = 0;
  h.vz = 0;
  h.vy = 0;
  setMove(s, "vault");
  return true;
}

/* ------------------------------------------------------------------ scripted moves */

function stepScripted(s: SimState, dt: number): void {
  const h = s.hero;
  const b = s.roam!.body;
  const u = Math.min(1, b.moveT / b.dur);
  const px = h.x;
  const py = h.y;
  const pz = h.z;
  if (b.move === "mantle") {
    // Up first, then over and in.
    const up = Math.min(1, u / 0.6);
    const over = u <= 0.55 ? 0 : (u - 0.55) / 0.45;
    const eu = 1 - (1 - up) * (1 - up);
    const eo = over * over * (3 - 2 * over);
    h.x = b.ax + (b.bx - b.ax) * eo;
    h.z = b.az + (b.bz - b.az) * eo;
    h.y = b.ay + (b.by - b.ay) * eu;
  } else if (b.move === "vault") {
    vaultPoint(b.ax, b.ay, b.az, b.bx, b.by, b.bz, b.arc, u, h);
  } else {
    // The zip: a pull that builds, a small lift on the way.
    const e = u * u * (3 - 2 * u);
    h.x = b.ax + (b.bx - b.ax) * e;
    h.z = b.az + (b.bz - b.az) * e;
    h.y = b.ay + (b.by - b.ay) * e + b.arc * 4 * u * (1 - u);
  }
  h.vx = (h.x - px) / dt;
  h.vy = (h.y - py) / dt;
  h.vz = (h.z - pz) / dt;
  if (u < 1) return;
  h.x = b.bx;
  h.y = b.by;
  h.z = b.bz;
  h.vy = 0;
  if (b.move === "mantle") {
    h.vx = -b.wnx * 90;
    h.vz = -b.wnz * 90;
    setMove(s, "ground");
  } else if (b.move === "vault") {
    h.vx = b.ex;
    h.vz = b.ez;
    setMove(s, onSomething(s) ? "ground" : "air");
  } else {
    // At the end of the zip, a beat to launch on: stood on a perch, or over an edge and on in.
    b.launchT = LAUNCH_WINDOW;
    b.zipCd = ZIP_CD;
    if (b.land === 1) {
      h.vx = 0;
      h.vz = 0;
      setMove(s, onSomething(s) ? "ground" : "air");
    } else {
      h.vx = -b.wnx * ZIP_LAND_SPEED;
      h.vz = -b.wnz * ZIP_LAND_SPEED;
      h.vy = 160;
      setMove(s, "air");
    }
  }
}

/** The web-zip toward the point zipTarget picks for this heading; false (a fizzle) with nothing there. */
function startZip(s: SimState, st: Stick): boolean {
  const h = s.hero;
  const b = s.roam!.body;
  const head = heading(h, st);
  const t = zipTarget(s, head.x, head.z);
  if (!t) {
    if (h.fizzleCd <= 0) {
      h.fizzleCd = FIZZLE_COOLDOWN;
      s.events.push({ type: "fizzle", x: h.x, y: h.y, z: h.z });
    }
    return false;
  }
  b.ax = h.x;
  b.ay = h.y;
  b.az = h.z;
  b.bx = t.lx;
  b.by = t.ly;
  b.bz = t.lz;
  b.land = t.perch ? 1 : 0;
  b.wnx = t.nx;
  b.wnz = t.nz;
  const d = len3(t.lx - h.x, t.ly - h.y, t.lz - h.z);
  b.dur = Math.max(ZIP_MIN_T, d / ZIP_SPEED);
  b.arc = Math.min(40, d * 0.05);
  b.zipCd = ZIP_CD;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  s.roam!.events.push({ type: "roam-zip", x: h.x, y: h.y, z: h.z, tx: t.x, ty: t.y, tz: t.z });
  setMove(s, "zip");
  return true;
}

/* ------------------------------------------------------------------ the river */

function startSplash(s: SimState) {
  const h = s.hero;
  const b = s.roam!.body;
  s.roam!.events.push({ type: "roam-splash", x: h.x, y: 0, z: h.z });
  b.ax = h.x;
  b.az = h.z;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.y = R - 30;
  setMove(s, "splash");
}

function stepSplash(s: SimState): void {
  const h = s.hero;
  const b = s.roam!.body;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  if (b.moveT < SPLASH_SECONDS) return;
  // Out on the nearest bank.
  let best = -1;
  let bd = Infinity;
  const banks = s.roam!.world.banks;
  for (let i = 0; i < banks.length; i++) {
    const d = len2(banks[i].x0 - b.ax, banks[i].z0 - b.az);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const spot = best >= 0 ? { x: banks[best].x0, z: banks[best].z0 } : { x: s.roam!.world.spawn.x, z: s.roam!.world.spawn.z };
  h.x = spot.x;
  h.z = spot.z;
  h.y = best >= 0 ? R : s.roam!.world.spawn.y + R;
  const fx = spot.x - b.ax;
  const fz = spot.z - b.az;
  const fl = len2(fx, fz);
  if (fl > 1) {
    h.fx = fx / fl;
    h.fz = fz / fl;
  }
  setMove(s, "ground");
}

/** Whether the hero is in a move a talk can happen in (on his feet, or hanging still). */
export const canTalk = (s: SimState) => s.roam!.body.move === "ground" || s.roam!.body.move === "hang" || s.roam!.body.move === "climb";

