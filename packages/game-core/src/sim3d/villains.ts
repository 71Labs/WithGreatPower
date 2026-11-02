/**
 * The four villains as real-time encounters in 3D, plus their hazards. Every joke from 2D
 * survives:
 *
 * - Gas Goblin glides a looping figure-eight over the arena, dropping fee bombs (they hurt
 *   and burn fluid) and now and then diving at you.
 * - Sandwich Man runs the arena roofs, front-runs you by lunging at where you're about to
 *   be, hops over webs he sees coming, and drops bread-slab traps that clap shut.
 * - Doc Octochain hovers over his bridge; four chain arms sweep and slam in the bridge's
 *   vertical plane. His body only takes a direct hit in the open window, arms pulled in.
 * - The Sybil hides among copies orbiting in xz that shoot goo. Every hit pops a copy; the
 *   real one is last.
 *
 * Ruleset v2 motion: nobody teleports or snaps. Flyers steer: a wanted velocity reached with
 * at most an acceleration, under a top speed. Gas Goblin's glider thrusts along its path and
 * turns with a sideways limit, banking into turns. Sandwich Man runs with acceleration and
 * braking, and every jump (roof hops, the lunge, the dodge) is a true parabola under gravity.
 * Doc's arms swing with angular speed and acceleration limits. Sybil's copies steer to their
 * orbit slots. Hits, yanks and stuns are impulses that the villain's own steering (or
 * drag) wears off.
 */
import { VILLAINS } from "../rules/data";
import type { Stop } from "../rules/types";

import { collideSphere, groundBelow, type SphereHit } from "./city";
import {
  ARM_ACCEL,
  ARM_EXTEND_ACCEL,
  ARM_EXTEND_SPEED,
  ARM_SLAM_ACCEL,
  ARM_SLAM_SPEED,
  ARM_SPEED,
  DOC_ACCEL,
  DOC_SPEED,
  GOBLIN_CLIMB_ACCEL,
  GOBLIN_DIVE_ACCEL,
  GOBLIN_DIVE_SPEED,
  GOBLIN_SPEED,
  GOBLIN_THRUST,
  GOBLIN_TURN_ACCEL,
  GRAVITY,
  HERO_RADIUS,
  KNOCK_MAX,
  KNOCK_TRANSFER,
  LAND_FRICTION,
  LUNGE_TIME_MAX,
  LUNGE_TIME_MIN,
  SANDWICH_ACCEL,
  SANDWICH_APEX,
  SANDWICH_BRAKE,
  SANDWICH_GRAVITY,
  SANDWICH_RUN,
  SLAM_SPEED,
  SLOWMO_FACTOR,
  STREET_Y,
  STUN_DRAG,
  STUN_SINK,
  SYBIL_BODY_ACCEL,
  SYBIL_BODY_SPEED,
  SYBIL_CENTER_ACCEL,
  SYBIL_CENTER_SPEED,
} from "./constants";
import { docVulnerable, hitVillain, hurtHero, moveDamage, villainHits, villainTargets } from "./combat";
import type { Zone } from "./contract";
import { clamp, datan2, dcos, dsin, len2, len3, PI } from "./dmath";
import { roll } from "./rng";
import type { Hazard, SimState, Villain } from "./types";

export function spawnVillain(s: SimState, zone: Zone): Villain {
  const stop = s.config.stops[zone.index] as Extract<Stop, { kind: "fight" }>;
  const hits = villainHits(stop.level, stop.boss);
  const rate = 1 + 0.08 * (stop.level - 1) + (stop.boss ? 0.15 : 0);
  const c = zone.center;
  const v: Villain = {
    kind: stop.villain,
    cast: stop.villain,
    level: stop.level,
    boss: stop.boss,
    quest: stop.quest,
    x: c.x,
    y: 600,
    z: c.z,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: 46,
    hits,
    hitsMax: hits,
    invuln: 0,
    stun: 0,
    t: 0,
    phase: "enter",
    phaseT: 1.6,
    attackT: 2.2 / rate,
    attack2T: 5.5 / rate,
    rate,
    grounded: false,
    dashToX: c.x,
    dashToZ: c.z,
    dashHit: false,
    arms: [],
    bodies: [],
    cx: c.x,
    cy: 520,
    cz: c.z,
    cycle: 0,
    home: { x: c.x, y: 560, z: c.z },
    ax: 1,
    az: 0,
    fleeT: 0,
    dodgeT: 0,
    cvx: 0,
    cvy: 0,
    cvz: 0,
    diveX: 0,
    diveY: 0,
    diveZ: 0,
    bank: 0,
  };
  switch (v.kind) {
    case "gas-goblin":
      // He swoops in from outside the arena, already flying.
      v.x = zone.bounds.x1 + 200;
      v.y = 900;
      v.vx = -GOBLIN_SPEED;
      break;
    case "sandwich-man":
      v.radius = 44;
      v.x = c.x + 250;
      v.y = 760;
      v.home = { x: c.x, y: 220, z: c.z };
      v.attackT = 3 / rate;
      v.attack2T = 2.2 / rate;
      break;
    case "doc-octochain":
      v.radius = 50;
      v.y = 1050;
      v.home = { x: c.x, y: 480, z: c.z };
      if (s.city.bridge?.axis === "z") {
        v.ax = 0;
        v.az = 1;
      }
      v.arms = [-2.55, -1.95, -1.19, -0.59].map((base) => ({ base, angle: base, len: 40, w: 0, lv: 0 }));
      break;
    case "sybil": {
      v.radius = 40;
      v.y = 1000;
      v.home = { x: c.x, y: 520, z: c.z };
      v.cy = 1000;
      const copies = hits - 1;
      for (let i = 0; i <= copies; i++) {
        v.bodies.push({ x: c.x, y: 1000, z: c.z, real: i === 0, alive: true, slot: i, shootT: 1.2 + i * 0.7, vx: 0, vy: 0, vz: 0 });
      }
      break;
    }
  }
  return v;
}

/** Where villains aim: at you (with a lead), unless you're cloaked. */
function aim(s: SimState, lead = 0): { x: number; y: number; z: number } {
  const h = s.hero;
  if (h.cloakT > 0) return { x: h.x + dsin(s.time * 1.7) * 320, y: h.y + 180, z: h.z + dcos(s.time * 1.7) * 320 };
  return { x: h.x + h.vx * lead, y: h.y + h.vy * lead * 0.6, z: h.z + h.vz * lead };
}

function spawnHazard(s: SimState, hz: Partial<Hazard> & Pick<Hazard, "kind" | "x" | "y" | "z">) {
  s.hazards.push({ vx: 0, vy: 0, vz: 0, r: 16, t: 0, damage: 10, burn: 0, big: false, state: "open", dead: false, ...hz });
}

const inside = (zone: Zone, inset: number) => ({
  x0: zone.bounds.x0 + inset,
  z0: zone.bounds.z0 + inset,
  x1: zone.bounds.x1 - inset,
  z1: zone.bounds.z1 - inset,
});

/* ------------------------------------------------------------------ steering */

export interface Mover {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Steer toward the wanted velocity (wx, wy, wz): the velocity changes by at most
 * maxAccel·dt, then the mover moves. The new velocity lies between the old one and the
 * wanted one, so with both under a top speed it stays under it. Returns the acceleration used.
 */
export function steer(m: Mover, wx: number, wy: number, wz: number, maxAccel: number, dt: number): number {
  let ax = wx - m.vx;
  let ay = wy - m.vy;
  let az = wz - m.vz;
  const dv = len3(ax, ay, az);
  const max = maxAccel * dt;
  if (dv > max) {
    const k = max / dv;
    ax *= k;
    ay *= k;
    az *= k;
  }
  m.vx += ax;
  m.vy += ay;
  m.vz += az;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
  return dt > 0 ? len3(ax, ay, az) / dt : 0;
}

/**
 * The velocity to want to arrive at (tx, ty, tz), which itself moves at (fx, fy, fz): that
 * motion, plus a closing speed that can still brake to a stop in the distance left (at 80% of
 * maxAccel), all under maxSpeed. Written into `out`.
 */
export function arrive(
  m: Mover,
  tx: number,
  ty: number,
  tz: number,
  fx: number,
  fy: number,
  fz: number,
  maxSpeed: number,
  maxAccel: number,
  out: { x: number; y: number; z: number },
) {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const dz = tz - m.z;
  const d = len3(dx, dy, dz);
  const close = d > 1e-9 ? Math.min(maxSpeed, Math.sqrt(1.6 * maxAccel * d)) / d : 0;
  let wx = fx + dx * close;
  let wy = fy + dy * close;
  let wz = fz + dz * close;
  const w = len3(wx, wy, wz);
  if (w > maxSpeed) {
    const k = maxSpeed / w;
    wx *= k;
    wy *= k;
    wz *= k;
  }
  out.x = wx;
  out.y = wy;
  out.z = wz;
}

const want = { x: 0, y: 0, z: 0 };

/** Drag at `rate` (1/s): no steering, the velocity just dies away (stunned, webbed). */
function drift(m: Mover, rate: number, dt: number) {
  const k = 1 / (1 + rate * dt);
  m.vx *= k;
  m.vy *= k;
  m.vz *= k;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
}

/** Hard arena walls for a steered body: stop the velocity into a wall instead of snapping back. */
function keepIn(m: Mover, box: { x0: number; z0: number; x1: number; z1: number }, y0: number, y1: number) {
  if (m.x < box.x0) {
    m.x = box.x0;
    if (m.vx < 0) m.vx = 0;
  } else if (m.x > box.x1) {
    m.x = box.x1;
    if (m.vx > 0) m.vx = 0;
  }
  if (m.z < box.z0) {
    m.z = box.z0;
    if (m.vz < 0) m.vz = 0;
  } else if (m.z > box.z1) {
    m.z = box.z1;
    if (m.vz > 0) m.vz = 0;
  }
  if (m.y < y0) {
    m.y = y0;
    if (m.vy < 0) m.vy = 0;
  } else if (m.y > y1) {
    m.y = y1;
    if (m.vy > 0) m.vy = 0;
  }
}

/** A wanted velocity that also leans back inside the box when near its walls. */
function inward(box: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, out: { x: number; y: number; z: number }, margin: number, push: number) {
  if (x < box.x0 + margin) out.x += push * (1 - (x - box.x0) / margin);
  else if (x > box.x1 - margin) out.x -= push * (1 - (box.x1 - x) / margin);
  if (z < box.z0 + margin) out.z += push * (1 - (z - box.z0) / margin);
  else if (z > box.z1 - margin) out.z -= push * (1 - (box.z1 - z) / margin);
}

/**
 * Hit by the hero: an impulse along (nx, ny, nz) of `speed`, capped at KNOCK_MAX, on the
 * villain or one of Sybil's bodies. It wears off through their steering, drag or friction.
 */
export function knockVillain(v: Villain, body: number, nx: number, ny: number, nz: number, speed: number) {
  const k = Math.min(KNOCK_MAX, speed) * (v.kind === "doc-octochain" ? 0.5 : 1);
  if (k <= 0) return;
  const m: Mover = body >= 0 && v.bodies[body] ? v.bodies[body] : v;
  m.vx += nx * k;
  m.vy += ny * k;
  m.vz += nz * k;
  if (v.kind === "sandwich-man") {
    // Knocked off his feet: a little pop up, and he flies a parabola.
    m.vy = Math.max(m.vy, 0) + 180;
    v.grounded = false;
  }
  if (v.kind === "sybil" && v.bodies[body]?.real) {
    v.cvx += nx * k * 0.5;
    v.cvz += nz * k * 0.5;
  }
}

/* ------------------------------------------------------------------ Gas Goblin */

/**
 * The glider: thrust along the flight path up to `thrust`, the sideways and up-down turn up
 * to `turn` (and climbing within GOBLIN_CLIMB_ACCEL), toward the wanted velocity. Sets his bank:
 * a coordinated turn rolls by tan⁻¹(sideways acceleration / g).
 */
function glide(v: Villain, wx: number, wy: number, wz: number, thrust: number, turn: number, dt: number) {
  let ax = (wx - v.vx) / dt;
  let ay = (wy - v.vy) / dt;
  let az = (wz - v.vz) / dt;
  const sp = len3(v.vx, v.vy, v.vz);
  const al = len3(ax, ay, az);
  let tx: number;
  let ty: number;
  let tz: number;
  if (sp > 1) {
    tx = v.vx / sp;
    ty = v.vy / sp;
    tz = v.vz / sp;
  } else if (al > 1e-9) {
    tx = ax / al;
    ty = ay / al;
    tz = az / al;
  } else {
    tx = 1;
    ty = 0;
    tz = 0;
  }
  const at = clamp(ax * tx + ay * ty + az * tz, -thrust, thrust);
  let nx = ax - (ax * tx + ay * ty + az * tz) * tx;
  let ny = ay - (ax * tx + ay * ty + az * tz) * ty;
  let nz = az - (ax * tx + ay * ty + az * tz) * tz;
  ny = clamp(ny, -GOBLIN_CLIMB_ACCEL, GOBLIN_CLIMB_ACCEL);
  const nl = len3(nx, ny, nz);
  if (nl > turn) {
    const k = turn / nl;
    nx *= k;
    ny *= k;
    nz *= k;
  }
  ax = tx * at + nx;
  ay = ty * at + ny;
  az = tz * at + nz;
  v.vx += ax * dt;
  v.vy += ay * dt;
  v.vz += az * dt;
  v.x += v.vx * dt;
  v.y += v.vy * dt;
  v.z += v.vz * dt;
  // The bank: sideways acceleration relative to the horizontal heading (L = heading turned 90°, +x toward +z).
  const hs = len2(v.vx, v.vz);
  const lat = hs > 1 ? (ax * -v.vz + az * v.vx) / hs : 0;
  v.bank = datan2(lat, GRAVITY);
}

/** The dive's push-off: a launch impulse along the dive line (the thrust takes it from there). */
const DIVE_PUSH = 420;

function stepGoblin(s: SimState, v: Villain, dt: number, zone: Zone) {
  // A looping figure-eight in xz, bobbing; hit, he climbs out of reach for a moment, cackling.
  // The path point moves; he flies after it with its own velocity plus a correction.
  const t = v.t;
  const flee = Math.min(1, v.fleeT);
  const pathX = v.home.x + 270 * dsin(0.55 * t);
  const pathY = v.home.y + 80 * dsin(1.1 * t + 1.2) + 170 * flee;
  const pathZ = v.home.z + 210 * dsin(1.1 * t);
  const pvx = 270 * 0.55 * dcos(0.55 * t);
  const pvy = 80 * 1.1 * dcos(1.1 * t + 1.2) - (v.fleeT > 0 && v.fleeT < 1 ? 170 : 0);
  const pvz = 210 * 1.1 * dcos(1.1 * t);
  const box = inside(zone, 40);
  const cruise = (fast: number) => {
    want.x = pvx + (pathX - v.x) * 1.4;
    want.y = pvy + (pathY - v.y) * 1.4;
    want.z = pvz + (pathZ - v.z) * 1.4;
    if (v.phase !== "enter") inward(box, v.x, v.z, want, 120, 260);
    const top = GOBLIN_SPEED * fast;
    const w = len3(want.x, want.y, want.z);
    if (w > top) {
      want.x *= top / w;
      want.y *= top / w;
      want.z *= top / w;
    }
    glide(v, want.x, want.y, want.z, GOBLIN_THRUST, GOBLIN_TURN_ACCEL, dt);
  };
  if (v.phase === "enter") {
    cruise(1.6);
    return;
  }
  if (v.stun > 0) {
    // No lift: the glider coasts down, slowing.
    const k = 1 / (1 + STUN_DRAG * dt);
    v.vx *= k;
    v.vz *= k;
    v.vy = Math.max(-STUN_SINK, v.vy - 400 * dt);
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.z += v.vz * dt;
    v.bank *= k;
    keepIn(v, box, 240, 900);
    return;
  }
  if (v.phase === "telegraph") {
    // Wind-up: pull up and bleed speed.
    v.phaseT -= dt;
    const sp = len2(v.vx, v.vz) || 1;
    glide(v, (v.vx / sp) * 140, 120, (v.vz / sp) * 140, GOBLIN_THRUST, GOBLIN_TURN_ACCEL, dt);
    keepIn(v, box, 150, 900);
    if (v.phaseT <= 0) {
      // Push off down the line to where you'll be when he gets there: a launch impulse, then thrust.
      const h = s.hero;
      const lead = clamp(len3(h.x - v.x, h.y - v.y, h.z - v.z) / GOBLIN_DIVE_SPEED, 0.2, 0.7);
      const a = aim(s, lead);
      const dx = a.x - v.x;
      const dy = a.y - v.y;
      const dz = a.z - v.z;
      const d = len3(dx, dy, dz) || 1;
      v.diveX = dx / d;
      v.diveY = dy / d;
      v.diveZ = dz / d;
      v.vx += v.diveX * DIVE_PUSH;
      v.vy += v.diveY * DIVE_PUSH;
      v.vz += v.diveZ * DIVE_PUSH;
      v.phase = "dash";
      v.phaseT = 0.85;
      v.dashHit = false;
    }
    return;
  }
  if (v.phase === "dash") {
    // The dive: hard thrust down the line fixed at push-off, turning only GOBLIN_TURN_ACCEL (so a sidestep dodges it).
    v.phaseT -= dt;
    glide(v, v.diveX * GOBLIN_DIVE_SPEED, v.diveY * GOBLIN_DIVE_SPEED, v.diveZ * GOBLIN_DIVE_SPEED, GOBLIN_DIVE_ACCEL, GOBLIN_TURN_ACCEL, dt);
    keepIn(v, box, 150, 900);
    const h = s.hero;
    if (!v.dashHit && len3(h.x - v.x, h.y - v.y, h.z - v.z) < v.radius + HERO_RADIUS) {
      v.dashHit = hurtHero(s, moveDamage(v, "Glider dive"), "Glider dive", v.x, v.y, v.z);
    }
    if (v.phaseT <= 0) {
      v.phase = "recover";
      v.phaseT = 1.1;
    }
    return;
  }
  // Glide the path (pulling out of a dive back onto it).
  cruise(v.phase === "recover" ? 1.4 : 1.2);
  keepIn(v, box, 150, 900);
  if (v.phase === "recover") {
    v.phaseT -= dt;
    if (v.phaseT <= 0) v.phase = "idle";
  }
  v.attackT -= dt;
  if (v.attackT <= 0) {
    v.attackT = (1.65 + roll(s) * 0.5) / v.rate;
    spawnHazard(s, { kind: "bomb", x: v.x, y: v.y - 34, z: v.z, vx: v.vx * 0.35, vy: 40, vz: v.vz * 0.35, r: 17, damage: moveDamage(v, "Fee bomb"), burn: 10 });
    s.events.push({ type: "villain-attack", label: "Fee bomb", x: v.x, y: v.y, z: v.z });
  }
  v.attack2T -= dt;
  if (v.attack2T <= 0 && v.phase === "idle") {
    v.attack2T = (5.5 + roll(s) * 2) / v.rate;
    v.phase = "telegraph";
    v.phaseT = 0.75;
    s.events.push({ type: "villain-attack", label: "Glider dive", x: v.x, y: v.y, z: v.z });
  }
}

/* ------------------------------------------------------------------ Sandwich Man */

const vhit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

/** One step of free flight under gravity g, exact for the constant acceleration (no drag): a true parabola. */
export function ballisticStep(m: Mover, g: number, dt: number) {
  m.x += m.vx * dt;
  m.y += m.vy * dt - 0.5 * g * dt * dt;
  m.z += m.vz * dt;
  m.vy -= g * dt;
}

/**
 * The launch velocity for a jump from (x0, y0, z0) to (x1, y1, z1) that peaks at height
 * `apex` (at least both ends), under gravity g, and its flight time.
 */
export function jumpVelocity(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, apex: number, g: number) {
  const top = Math.max(apex, y0, y1);
  const vy = Math.sqrt(2 * g * (top - y0));
  const t = vy / g + Math.sqrt((2 * (top - y1)) / g);
  return { vx: (x1 - x0) / t, vy, vz: (z1 - z0) / t, t };
}

/** The launch velocity that reaches (x1, y1, z1) from (x0, y0, z0) in exactly `t` seconds under gravity g. */
export function leapVelocity(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, g: number) {
  return { vx: (x1 - x0) / t, vy: (y1 - y0) / t + 0.5 * g * t, vz: (z1 - z0) / t };
}

/** The fastest a roof hop may cross the ground. */
const HOP_MAX = 760;

/**
 * Plan a hop to a roof at (tx, tz): a parabola peaking SANDWICH_APEX over the higher end and
 * every roof on the way, if that's a jump a person could make. Launches him and returns true.
 */
function hopTo(s: SimState, v: Villain, tx: number, tz: number): boolean {
  const g = SANDWICH_GRAVITY;
  const foot = v.y - v.radius;
  const land = groundBelow(s.grid, tx, tz, foot + 360);
  if (land <= STREET_Y + 1) return false;
  let top = Math.max(foot, land);
  for (let k = 1; k < 8; k++) {
    const f = k / 8;
    top = Math.max(top, groundBelow(s.grid, v.x + (tx - v.x) * f, v.z + (tz - v.z) * f, foot + 360));
  }
  if (top > foot + 340) return false;
  const j = jumpVelocity(v.x, foot, v.z, tx, land, tz, top + SANDWICH_APEX, g);
  if (len2(j.vx, j.vz) > HOP_MAX) return false;
  v.vx = j.vx;
  v.vy = j.vy;
  v.vz = j.vz;
  v.grounded = false;
  return true;
}

/** A hop to some roof in the run box: the run target if it's on one, else a few seeded tries. */
function hopSomewhere(s: SimState, v: Villain, run: { x0: number; z0: number; x1: number; z1: number }): boolean {
  if (hopTo(s, v, v.dashToX, v.dashToZ)) return true;
  for (let k = 0; k < 5; k++) {
    const x = run.x0 + roll(s) * (run.x1 - run.x0);
    const z = run.z0 + roll(s) * (run.z1 - run.z0);
    if (hopTo(s, v, x, z)) {
      v.dashToX = x;
      v.dashToZ = z;
      return true;
    }
  }
  return false;
}

function stepSandwich(s: SimState, v: Villain, dt: number, zone: Zone) {
  const h = s.hero;
  const g = SANDWICH_GRAVITY;
  const box = inside(zone, 40);
  const run = inside(zone, 90);
  const prevFoot = v.y - v.radius;
  let blocked = false;
  if (!v.grounded) {
    // In the air: a true parabola, sliding off walls, landing on a roof (or the street).
    const vyBefore = v.vy;
    ballisticStep(v, g, dt);
    keepIn(v, box, STREET_Y + v.radius, 2000);
    collideSphere(s.grid, v, v.radius, vhit);
    if (vhit.wall) blocked = true;
    const top = groundBelow(s.grid, v.x, v.z, prevFoot + 0.5);
    if (v.vy <= 0 && (v.y - v.radius <= top || (vhit.top && v.vy <= 0))) {
      v.y = Math.max(top, vhit.top ? vhit.topY : top) + v.radius;
      v.vy = 0;
      v.grounded = true;
      // The landing's friction takes speed off the run.
      const impact = vyBefore < 0 ? -vyBefore : 0;
      const hs = len2(v.vx, v.vz);
      if (hs > 1e-9) {
        const k = Math.max(0, hs - impact * LAND_FRICTION) / hs;
        v.vx *= k;
        v.vz *= k;
      }
      if (v.phase === "dash") {
        v.phase = "recover";
        v.phaseT = 0.5;
      }
    }
  } else {
    const below = groundBelow(s.grid, v.x, v.z, v.y - v.radius + 1);
    if (v.y - v.radius - below > 2) v.grounded = false;
  }
  if (v.phase === "enter") {
    if (v.grounded) v.phaseT = Math.min(v.phaseT, 0.2);
    return;
  }
  if (v.phase === "dash") {
    // The front-run lunge, in flight: it hurts on contact.
    v.phaseT -= dt;
    if (!v.dashHit && len3(h.x - v.x, h.y - v.y, h.z - v.z) < v.radius + HERO_RADIUS + 6) {
      v.dashHit = hurtHero(s, moveDamage(v, "Front-run"), "Front-run", v.x, v.y, v.z);
    }
    if (v.phaseT <= -1.5) {
      v.phase = "recover";
      v.phaseT = 0.5;
    }
    return;
  }
  /** Run toward a wanted ground velocity: accelerate at SANDWICH_ACCEL, brake at SANDWICH_BRAKE. */
  const runTo = (wx: number, wz: number) => {
    const faster = len2(wx, wz) > len2(v.vx, v.vz);
    let ax = wx - v.vx;
    let az = wz - v.vz;
    const dv = len2(ax, az);
    const max = (faster ? SANDWICH_ACCEL : SANDWICH_BRAKE) * dt;
    if (dv > max) {
      ax *= max / dv;
      az *= max / dv;
    }
    v.vx += ax;
    v.vz += az;
    v.x += v.vx * dt;
    v.z += v.vz * dt;
    keepIn(v, box, STREET_Y + v.radius, 2000);
    collideSphere(s.grid, v, v.radius, vhit);
    if (vhit.wall) blocked = true;
  };
  if (v.stun > 0) {
    if (v.grounded) runTo(0, 0);
    return;
  }
  if (v.phase === "telegraph") {
    // Crouch for the lunge: brake to a stop.
    if (v.grounded) runTo(0, 0);
    v.phaseT -= dt;
    if (v.phaseT <= 0) {
      // Front-run: a ballistic leap that meets you where you're about to be.
      const a = aim(s, 0.45);
      const d = len3(a.x - v.x, a.y - v.y, a.z - v.z);
      const t = clamp(d / 1150, LUNGE_TIME_MIN, LUNGE_TIME_MAX);
      const l = leapVelocity(v.x, v.y, v.z, a.x, a.y, a.z, t, g);
      const sp = len3(l.vx, l.vy, l.vz);
      const k = sp > 1500 ? 1500 / sp : 1;
      v.vx = l.vx * k;
      v.vy = l.vy * k;
      v.vz = l.vz * k;
      v.phase = "dash";
      v.phaseT = t + 0.1;
      v.dashHit = false;
      v.grounded = false;
    }
    return;
  }
  if (v.phase === "recover") {
    v.phaseT -= dt;
    if (v.phaseT <= 0 && v.grounded) v.phase = "idle";
  }
  // He front-runs your web too: hop sideways over a sling he sees coming.
  v.dodgeT = Math.max(0, v.dodgeT - dt);
  if (v.grounded && v.dodgeT <= 0 && v.phase === "idle") {
    const incoming = s.shots.find(
      (x) => x.kind === "sling" && len3(x.x - v.x, x.y - v.y, x.z - v.z) < 260 && (v.x - x.x) * x.vx + (v.y - x.y) * x.vy + (v.z - x.z) * x.vz > 0,
    );
    if (incoming) {
      v.dodgeT = 2.2 / v.rate;
      if (roll(s) < 0.55) {
        const hs = len2(incoming.vx, incoming.vz) || 1;
        v.vy = 840;
        v.vx += (-incoming.vz / hs) * 260;
        v.vz += (incoming.vx / hs) * 260;
        v.grounded = false;
        s.events.push({ type: "villain-attack", label: "Front-runs your web", x: v.x, y: v.y, z: v.z });
      }
    }
  }
  // Run the rooftops toward a spot, hopping gaps and walls on planned parabolas.
  if (v.grounded) {
    if (v.fleeT > 1.7) {
      // Just hit: run for the far side from you.
      const c = zone.center;
      const dx = c.x - h.x;
      const dz = c.z - h.z;
      const d = len2(dx, dz) || 1;
      v.dashToX = clamp(c.x + (dx / d) * 300, run.x0, run.x1);
      v.dashToZ = clamp(c.z + (dz / d) * 300, run.z0, run.z1);
    } else if (len2(v.dashToX - v.x, v.dashToZ - v.z) < 24 || v.dashToX < run.x0 || v.dashToX > run.x1 || v.dashToZ < run.z0 || v.dashToZ > run.z1) {
      v.dashToX = run.x0 + roll(s) * (run.x1 - run.x0);
      v.dashToZ = run.z0 + roll(s) * (run.z1 - run.z0);
    }
    const dx = v.dashToX - v.x;
    const dz = v.dashToZ - v.z;
    const d = len2(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    // Arrive: full speed, easing to a stop he can brake into.
    const speed = Math.min(SANDWICH_RUN * v.rate, Math.sqrt(1.6 * SANDWICH_BRAKE * d));
    runTo(ux * speed, uz * speed);
    // About to run off a roof, up against a wall, or down in the street: hop (or turn back).
    const foot = v.y - v.radius;
    const ahead = groundBelow(s.grid, v.x + ux * 34, v.z + uz * 34, foot + 1);
    const street = foot <= STREET_Y + 1;
    if (v.grounded && (ahead < foot - 4 || street || blocked)) {
      if (!hopSomewhere(s, v, run)) {
        if (!street) {
          // No jump he can make: stop at the edge and pick somewhere else.
          v.vx = 0;
          v.vz = 0;
          v.dashToX = v.x - ux * 120;
          v.dashToZ = v.z - uz * 120;
        } else {
          // Stuck in the street: a straight-up spring, and try again from the top.
          v.vy = 980;
          v.grounded = false;
        }
      }
    }
  }
  v.attack2T -= dt;
  if (v.attack2T <= 0 && v.grounded && v.y - v.radius > STREET_Y + 10) {
    v.attack2T = (3.2 + roll(s)) / v.rate;
    if (s.hazards.filter((z) => z.kind === "trap" && !z.dead).length < 3) {
      spawnHazard(s, { kind: "trap", x: v.x, y: v.y - v.radius, z: v.z, r: 52, damage: moveDamage(v, "Squeeze") });
      s.events.push({ type: "villain-attack", label: "Bread trap", x: v.x, y: v.y, z: v.z });
    }
  }
  v.attackT -= dt;
  if (v.attackT <= 0 && v.phase === "idle" && v.grounded && len3(h.x - v.x, h.y - v.y, h.z - v.z) < 700) {
    v.attackT = (3.8 + roll(s) * 1.5) / v.rate;
    v.phase = "telegraph";
    v.phaseT = 0.5;
    s.events.push({ type: "villain-attack", label: "Front-run", x: v.x, y: v.y, z: v.z });
  }
}

/* ------------------------------------------------------------------ Doc Octochain */

/**
 * Where arm i leaves Doc's body: two shoulders on each side along the bridge axis, the
 * outer pair higher, as fractions of his radius (along the axis, then up).
 */
const SHOULDERS: readonly (readonly [number, number])[] = [
  [-0.55, 0.12],
  [-0.3, -0.32],
  [0.3, -0.32],
  [0.55, 0.12],
];

/** Arm i's shoulder, in world space: the root of the chain (the scene draws, and hits test, from here). */
export function armShoulder(v: Villain, i: number): { x: number; y: number; z: number } {
  const o = SHOULDERS[i % SHOULDERS.length];
  const along = o[0] * v.radius;
  return { x: v.x + v.ax * along, y: v.y + o[1] * v.radius, z: v.z + v.az * along };
}

/** Arm i's tip: from its shoulder, in the vertical plane along the bridge axis (angle 0 along the axis, π/2 up). */
export function armTip(v: Villain, i: number): { x: number; y: number; z: number } {
  const a = v.arms[i];
  const o = armShoulder(v, i);
  const along = dcos(a.angle) * a.len;
  return { x: o.x + v.ax * along, y: o.y + dsin(a.angle) * a.len, z: o.z + v.az * along };
}

function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2, 0, 1);
  return len3(px - (ax + dx * t), py - (ay + dy * t), pz - (az + dz * t));
}

/**
 * Drive a joint toward `target` under a speed limit and an acceleration limit, braking in time
 * to stop there: the wanted rate is the braking speed for the distance left.
 */
export function drive(pos: number, vel: number, target: number, maxV: number, maxA: number, dt: number): [number, number] {
  const d = target - pos;
  const ad = d < 0 ? -d : d;
  const wantV = (d < 0 ? -1 : 1) * Math.min(maxV, Math.sqrt(2 * maxA * ad));
  const nv = vel + clamp(wantV - vel, -maxA * dt, maxA * dt);
  return [pos + nv * dt, nv];
}

function stepDoc(s: SimState, v: Villain, dt: number) {
  const t = v.t;
  const sway = 120 * dsin(0.35 * t);
  const swayV = 120 * 0.35 * dcos(0.35 * t);
  // Arms in (or stunned), he sags toward the deck to catch his breath: that's your opening.
  const sag = v.phase === "retract" || v.stun > 0 ? 150 : 0;
  const bodyX = v.home.x + v.ax * sway;
  const bodyZ = v.home.z + v.az * sway;
  const bodyY = v.home.y + 30 * dsin(1.3 * t) - sag;
  arrive(v, bodyX, bodyY, bodyZ, v.ax * swayV, 39 * dcos(1.3 * t), v.az * swayV, DOC_SPEED, DOC_ACCEL, want);
  steer(v, want.x, want.y, want.z, DOC_ACCEL, dt);
  if (v.phase === "enter") {
    for (const a of v.arms) [a.len, a.lv] = drive(a.len, a.lv, 60, ARM_EXTEND_SPEED * 0.5, ARM_EXTEND_ACCEL, dt);
    return;
  }
  const stunned = v.stun > 0;
  v.phaseT -= stunned ? 0 : dt;
  if (!stunned && v.phaseT <= 0) {
    switch (v.phase) {
      case "sweep":
        v.cycle += 1;
        if (v.cycle % (v.boss ? 2 : 3) === 0) {
          v.phase = "slam-wind";
          v.phaseT = 0.85;
          s.events.push({ type: "villain-attack", label: "Cross-chain slam", x: v.x, y: v.y, z: v.z });
        } else {
          v.phase = "retract";
          v.phaseT = 1.9;
        }
        break;
      case "slam-wind":
        v.phase = "slam";
        v.phaseT = 0.7;
        break;
      case "slam":
        v.phase = "retract";
        v.phaseT = 1.9;
        break;
      default:
        v.phase = "sweep";
        v.phaseT = 3 / v.rate;
        s.events.push({ type: "villain-attack", label: "Eight-arm flurry", x: v.x, y: v.y, z: v.z });
    }
  }
  const swing = 1.35 * Math.sqrt(v.rate);
  v.arms.forEach((a, i) => {
    let len = 48;
    let angle = a.base;
    let wMax = ARM_SPEED;
    let aMax = ARM_ACCEL;
    if (stunned) {
      len = 70;
      wMax = ARM_SPEED * 0.5;
    } else if (v.phase === "sweep") {
      // v2 lengths are from the shoulder (v1 measured from his centre: 285, 250, 330).
      len = 260;
      angle = a.base + dsin(t * swing + i * 1.4) * 0.95;
    } else if (v.phase === "slam-wind") {
      len = 225;
      angle = PI / 2 + (i - 1.5) * 0.42;
    } else if (v.phase === "slam") {
      len = 305;
      angle = -PI / 2 + (i - 1.5) * 0.36;
      wMax = ARM_SLAM_SPEED;
      aMax = ARM_SLAM_ACCEL;
    }
    [a.angle, a.w] = drive(a.angle, a.w, angle, wMax, aMax, dt);
    [a.len, a.lv] = drive(a.len, a.lv, len, ARM_EXTEND_SPEED, ARM_EXTEND_ACCEL, dt);
  });
  // Chain contact, along each arm from its shoulder.
  const h = s.hero;
  if (v.phase === "sweep" || v.phase === "slam") {
    for (let i = 0; i < v.arms.length; i++) {
      if (v.arms[i].len < 110) continue;
      const o = armShoulder(v, i);
      const tip = armTip(v, i);
      if (segDist(h.x, h.y, h.z, o.x, o.y, o.z, tip.x, tip.y, tip.z) < 20 + HERO_RADIUS) {
        const slam = v.phase === "slam";
        hurtHero(s, moveDamage(v, slam ? "Cross-chain slam" : "Eight-arm flurry"), slam ? "Cross-chain slam" : "a chain arm", tip.x, tip.y, tip.z);
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ The Sybil */

function stepSybil(s: SimState, v: Villain, dt: number, zone: Zone) {
  const alive = v.bodies.filter((b) => b.alive);
  const copies = alive.filter((b) => !b.real).length;
  const t = v.t;
  let cx: number;
  let cy: number;
  let cz: number;
  let fx: number;
  let fy: number;
  let fz: number;
  if (copies > 0) {
    cx = v.home.x + 180 * dsin(0.4 * t);
    cz = v.home.z + 140 * dsin(0.8 * t);
    cy = v.home.y + 110 * dsin(0.8 * t + 0.9);
    fx = 72 * dcos(0.4 * t);
    fz = 112 * dcos(0.8 * t);
    fy = 88 * dcos(0.8 * t + 0.9);
  } else {
    // Alone, he runs a quicker figure eight.
    cx = v.home.x + 260 * dsin(0.9 * t);
    cz = v.home.z + 200 * dsin(1.8 * t);
    cy = v.home.y + 150 * dsin(1.8 * t + 0.9);
    fx = 234 * dcos(0.9 * t);
    fz = 360 * dcos(1.8 * t);
    fy = 270 * dcos(1.8 * t + 0.9);
  }
  // The swarm's centre steers after its path (and coasts while he's stunned).
  const c: Mover = { x: v.cx, y: v.cy, z: v.cz, vx: v.cvx, vy: v.cvy, vz: v.cvz };
  const box = inside(zone, 60);
  if (v.stun <= 0 || v.phase === "enter") {
    arrive(c, cx, cy, cz, fx, fy, fz, SYBIL_CENTER_SPEED * (copies > 0 ? 1 : 1.6), SYBIL_CENTER_ACCEL, want);
    inward(box, c.x, c.z, want, 80, 200);
    steer(c, want.x, want.y, want.z, SYBIL_CENTER_ACCEL * (copies > 0 ? 1 : 1.8), dt);
  } else drift(c, STUN_DRAG, dt);
  keepIn(c, box, 150, 1100);
  v.cx = c.x;
  v.cy = c.y;
  v.cz = c.z;
  v.cvx = c.vx;
  v.cvy = c.vy;
  v.cvz = c.vz;
  // The copies orbit him in xz, the ring tipped a little so they sit at different heights:
  // each steers to its slot, which moves with the ring.
  const radius = copies > 0 ? (v.boss ? 175 : 155) : 0;
  const n = alive.length;
  const spin = 1.2;
  alive.forEach((b, k) => {
    const ang = t * spin + (k * PI * 2) / n;
    const co = dcos(ang);
    const sn = dsin(ang);
    const tx = v.cx + co * radius;
    const ty = v.cy + sn * radius * 0.25;
    const tz = v.cz + sn * radius;
    const ox = v.cvx - sn * radius * spin;
    const oy = v.cvy + co * radius * 0.25 * spin;
    const oz = v.cvz + co * radius * spin;
    arrive(b, tx, ty, tz, ox, oy, oz, SYBIL_BODY_SPEED, SYBIL_BODY_ACCEL, want);
    steer(b, want.x, want.y, want.z, SYBIL_BODY_ACCEL, dt);
  });
  const real = v.bodies.find((b) => b.real)!;
  v.x = real.x;
  v.y = real.y;
  v.z = real.z;
  v.vx = real.vx;
  v.vy = real.vy;
  v.vz = real.vz;
  if (v.phase === "enter" || v.stun > 0) return;
  for (const b of alive) {
    b.shootT -= dt;
    if (b.shootT > 0) continue;
    b.shootT = (1.5 * n + roll(s) * 0.8) / v.rate;
    const a = aim(s, 0.35);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    const d = len3(dx, dy, dz) || 1;
    const big = b.real;
    const speed = big ? 360 : 440;
    spawnHazard(s, {
      kind: "goo",
      x: b.x,
      y: b.y,
      z: b.z,
      vx: (dx / d) * speed,
      vy: (dy / d) * speed,
      vz: (dz / d) * speed,
      r: big ? 20 : 13,
      big,
      damage: moveDamage(v, big ? "Fake vote" : "Swarm"),
    });
    if (big) s.events.push({ type: "villain-attack", label: "Fake vote", x: b.x, y: b.y, z: b.z });
  }
}

/* ------------------------------------------------------------------ shared */

/** Webbed after a win: flyers lose their steering and sink to hang; Sandwich Man falls where he was hit. */
function stepWebbed(s: SimState, v: Villain, dt: number) {
  if (v.kind === "sandwich-man") {
    if (!v.grounded) {
      const prevFoot = v.y - v.radius;
      ballisticStep(v, SANDWICH_GRAVITY, dt);
      const top = groundBelow(s.grid, v.x, v.z, prevFoot + 0.5);
      if (v.y - v.radius <= top) {
        v.y = top + v.radius;
        v.vy = 0;
        v.grounded = true;
      }
    } else {
      const hs = len2(v.vx, v.vz);
      if (hs > 1e-9) {
        const k = Math.max(0, hs - SANDWICH_BRAKE * dt) / hs;
        v.vx *= k;
        v.vz *= k;
      }
      v.x += v.vx * dt;
      v.z += v.vz * dt;
    }
    return;
  }
  const m: Mover = v.kind === "sybil" ? (v.bodies.find((b) => b.real) ?? v) : v;
  const k = 1 / (1 + STUN_DRAG * dt);
  m.vx *= k;
  m.vz *= k;
  m.vy += clamp(-60 - m.vy, -300 * dt, 300 * dt);
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
  if (m.y < 260) {
    m.y = 260;
    if (m.vy < 0) m.vy = 0;
  }
  v.bank *= k;
  if (m !== v) {
    v.x = m.x;
    v.y = m.y;
    v.z = m.z;
    v.vx = m.vx;
    v.vy = m.vy;
    v.vz = m.vz;
  }
}

export function stepVillain(s: SimState, dt: number) {
  const v = s.villain;
  if (!v) return;
  const zone = s.city.zones[s.index];
  const slow = s.slowmo > 0 ? SLOWMO_FACTOR : 1;
  const vdt = dt * slow;
  v.invuln = Math.max(0, v.invuln - dt);
  if (s.mode === "won") {
    stepWebbed(s, v, dt);
    return;
  }
  if (s.mode !== "intro" && s.mode !== "fight") return;
  v.t += vdt;
  v.stun = Math.max(0, v.stun - vdt);
  v.fleeT = Math.max(0, v.fleeT - vdt);
  if (s.mode === "intro") {
    v.phase = "enter";
  } else if (v.phase === "enter") {
    v.phase = v.kind === "doc-octochain" ? "sweep" : "idle";
    v.phaseT = v.kind === "doc-octochain" ? 3 / v.rate : 0;
  }
  switch (v.kind) {
    case "gas-goblin":
      stepGoblin(s, v, vdt, zone);
      break;
    case "sandwich-man":
      stepSandwich(s, v, vdt, zone);
      break;
    case "doc-octochain":
      stepDoc(s, v, vdt);
      break;
    case "sybil":
      stepSybil(s, v, vdt, zone);
      break;
  }
  if (s.mode === "fight") heroContact(s, v);
}

/** Slamming into a villain: fast enough and it's a hit (and knocks him back); slow and you bounce. */
function heroContact(s: SimState, v: Villain) {
  const h = s.hero;
  for (const t of villainTargets(v)) {
    const dx = h.x - t.x;
    const dy = h.y - t.y;
    const dz = h.z - t.z;
    const d = len3(dx, dy, dz);
    // A little generous: slamming should feel like it connects.
    if (d > t.r + HERO_RADIUS + 10) continue;
    const nx = d > 0 ? dx / d : 0;
    const ny = d > 0 ? dy / d : 1;
    const nz = d > 0 ? dz / d : 0;
    const body: { vx: number; vy: number; vz: number } = t.body >= 0 ? v.bodies[t.body] : v;
    const rel = len3(h.vx - body.vx * 0.3, h.vy - body.vy * 0.3, h.vz - body.vz * 0.3);
    if (h.slam > 0) return; // the shockwave handles it on impact
    // Doc with his arms in is wide open: a lighter hit does it.
    const threshold = v.kind === "doc-octochain" && docVulnerable(v) ? SLAM_SPEED * 0.6 : SLAM_SPEED;
    const fast = rel >= threshold || (h.dashT > 0 && !h.dashHit);
    // The closing speed along the line between you, before the bounce.
    const closing = -(h.vx * nx + h.vy * ny + h.vz * nz);
    if (fast) {
      if (h.dashT > 0) h.dashHit = true;
      // Doc's arms and a villain's guard turn it into a clang (hitVillain says so).
      const landed = hitVillain(s, t.body, 1, h.dashT > 0 ? "dash" : "slam");
      if (s.villain === v && s.mode === "fight") knockVillain(v, t.body, -nx, -ny, -nz, KNOCK_TRANSFER * Math.max(0, closing) * (landed ? 1 : 0.4));
    }
    // Bounce off, either way.
    const vn = h.vx * nx + h.vy * ny + h.vz * nz;
    if (vn < 0) {
      h.vx -= 1.6 * vn * nx;
      h.vy -= 1.6 * vn * ny;
      h.vz -= 1.6 * vn * nz;
    }
    h.vy = Math.max(h.vy, 260);
    h.x = t.x + nx * (t.r + HERO_RADIUS + 1);
    h.y = t.y + ny * (t.r + HERO_RADIUS + 1);
    h.z = t.z + nz * (t.r + HERO_RADIUS + 1);
    if (h.rope) h.rope.len = Math.max(h.rope.len, len3(h.x - h.rope.x, h.y - h.rope.y, h.z - h.rope.z));
    return;
  }
}

export function stepHazards(s: SimState, dt: number) {
  const slow = s.slowmo > 0 ? SLOWMO_FACTOR : 1;
  const hdt = dt * slow;
  const h = s.hero;
  for (const z of s.hazards) {
    if (z.dead) continue;
    z.t += hdt;
    if (z.kind === "bomb") {
      z.vy -= 900 * hdt;
      z.x += z.vx * hdt;
      z.y += z.vy * hdt;
      z.z += z.vz * hdt;
      const hitHero = len3(h.x - z.x, h.y - z.y, h.z - z.z) < z.r + HERO_RADIUS;
      const ground = groundBelow(s.grid, z.x, z.z, z.y + z.r);
      if (hitHero || z.y - z.r <= ground) {
        z.dead = true;
        s.events.push({ type: "blast", x: z.x, y: Math.max(z.y, ground + z.r), z: z.z, r: 80, kind: "bomb" });
        if (hitHero || len3(h.x - z.x, h.y - z.y, h.z - z.z) < 80 + HERO_RADIUS * 0.5) hurtHero(s, z.damage, "a fee bomb", z.x, z.y, z.z, z.burn);
      }
    } else if (z.kind === "goo") {
      z.vy -= 120 * hdt;
      z.x += z.vx * hdt;
      z.y += z.vy * hdt;
      z.z += z.vz * hdt;
      if (len3(h.x - z.x, h.y - z.y, h.z - z.z) < z.r + HERO_RADIUS) {
        z.dead = true;
        s.events.push({ type: "goo", x: z.x, y: z.y, z: z.z });
        hurtHero(s, z.damage, z.big ? "a fake vote" : "Sybil goo", z.x, z.y, z.z);
      } else if (z.t > 4.5 || z.y - z.r <= groundBelow(s.grid, z.x, z.z, z.y + z.r)) {
        z.dead = true;
        s.events.push({ type: "goo", x: z.x, y: z.y, z: z.z });
      }
    } else if (z.kind === "trap") {
      const near = len2(h.x - z.x, h.z - z.z) < z.r + 8 && h.y - z.y > 0 && h.y - z.y < 118;
      if (z.state === "open" && z.t > 0.45) z.state = "armed";
      if (z.state === "armed" && near && h.cloakT <= 0) {
        z.state = "clap";
        z.t = 0;
        s.events.push({ type: "trap", x: z.x, y: z.y, z: z.z });
      } else if (z.state === "clap" && z.t > 0.14) {
        z.state = "closed";
        z.t = 0;
        if (near && hurtHero(s, z.damage, "a bread trap", z.x, z.y, z.z)) h.heldT = 0.35;
      } else if (z.state === "closed" && z.t > 1.4) {
        z.dead = true;
      } else if ((z.state === "armed" || z.state === "open") && z.t > 9) {
        z.dead = true;
      }
    } else if (z.kind === "blast") {
      if (z.t > 0.3) z.dead = true;
    }
  }
  if (s.hazards.some((z) => z.dead)) s.hazards = s.hazards.filter((z) => !z.dead);
}

/** The villain's taunt and defeat line, for banners. */
export function villainLines(v: Villain) {
  return { taunt: VILLAINS[v.kind].taunt, defeat: VILLAINS[v.kind].defeat };
}
