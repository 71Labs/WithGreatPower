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
 *
 * Ruleset v4, grounded fights on a flat stage (zone.stage), each with a rhythm you can read:
 * - Gas Goblin loops lower and tighter over the stage; his dive levels out at your height and
 *   ends in a stall low over the roof: the opening (a direct hit gets through his guard).
 * - Sandwich Man keeps to the stage (no roof hops); his lunge is flat and ends in a stumble, the
 *   opening; he side-hops a sling, a web-zip or a blow he sees coming, low (460 up, not 840).
 * - Doc follows you along his bridge and across its deck, lining his arms up with you, and sags
 *   into a strike's reach when they pull in; a chain swats you away along the deck.
 * - The Sybil's swarm drifts at chest height, slower, and scatters when a copy pops.
 * Knocks slide a villain along the roof; nobody is popped into the air.
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
  DECK_HALF,
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

/** v4: the fight's floor (the stage's roof, Doc's deck). */
export const floorOf = (zone: Zone) => zone.stage?.y ?? zone.center.y;

/** v4: the stage (or, without one, the arena bounds) inset by `inset`. */
function stageBox(zone: Zone, inset: number) {
  const r = zone.stage ?? zone.bounds;
  return { x0: r.x0 + inset, z0: r.z0 + inset, x1: r.x1 - inset, z1: r.z1 - inset };
}

/** v4: how high each flyer keeps over the floor: Gas Goblin's cruise, Doc's hover, the Sybil swarm's centre. */
const GOBLIN_CRUISE = 290;
const DOC_HOVER = 280;
const SYBIL_HOVER = 120;

export function spawnVillain(s: SimState, zone: Zone): Villain {
  const stop = s.config.stops[zone.index] as Extract<Stop, { kind: "fight" }>;
  const hits = villainHits(stop.level, stop.boss);
  const rate = 1 + 0.08 * (stop.level - 1) + (stop.boss ? 0.15 : 0);
  const c = zone.center;
  const floor = floorOf(zone);
  const v: Villain = {
    kind: stop.villain,
    cast: stop.villain,
    level: stop.level,
    boss: stop.boss,
    quest: stop.quest,
    x: c.x,
    y: floor + 360,
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
    cy: floor + 280,
    cz: c.z,
    cycle: 0,
    home: { x: c.x, y: floor + GOBLIN_CRUISE, z: c.z },
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
      v.y = floor + 660;
      v.vx = -GOBLIN_SPEED;
      break;
    case "sandwich-man":
      v.radius = 44;
      v.x = c.x + 200;
      v.y = floor + 520;
      v.home = { x: c.x, y: floor + v.radius, z: c.z };
      v.attackT = 3 / rate;
      v.attack2T = 2.2 / rate;
      break;
    case "doc-octochain":
      v.radius = 50;
      v.y = floor + 850;
      v.home = { x: c.x, y: floor + DOC_HOVER, z: c.z };
      v.cx = c.x;
      v.cz = c.z;
      if (s.city.bridge?.axis === "z") {
        v.ax = 0;
        v.az = 1;
      }
      v.arms = [-2.55, -1.95, -1.19, -0.59].map((base) => ({ base, angle: base, len: 40, w: 0, lv: 0 }));
      break;
    case "sybil": {
      v.radius = 40;
      v.y = floor + 760;
      v.home = { x: c.x, y: floor + SYBIL_HOVER, z: c.z };
      v.cy = floor + 760;
      // v4: at most six copies; the real one takes the hits that are left once they're popped.
      const copies = Math.min(6, hits - 1);
      for (let i = 0; i <= copies; i++) {
        v.bodies.push({ x: c.x, y: floor + 760, z: c.z, real: i === 0, alive: true, slot: i, shootT: 1.6 + i * 0.7, vx: 0, vy: 0, vz: 0 });
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
  m.vz += nz * k;
  // v4: on his feet, Sandwich Man slides back along the roof (v3 popped him 180 up into a
  // parabola); a knock from above or below only moves a flyer.
  if (v.kind !== "sandwich-man" || !v.grounded) m.vy += ny * k * 0.5;
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

/** v4: the dive skims the roof this high (centre over the floor), and the stall after it lasts this long, low and open. */
const GOBLIN_SKIM = 72;
const GOBLIN_STALL = 1.4;

function stepGoblin(s: SimState, v: Villain, dt: number, zone: Zone) {
  // A looping figure-eight over the stage, bobbing; hit, he climbs out of reach for a moment,
  // cackling. The path point moves; he flies after it with its own velocity plus a correction.
  // v4: a smaller loop (190 × 150; v3: 270 × 210) and a gentler bob (50; v3: 80), so he stays
  // over the stage, and the dive ends in a stall low over it: the opening.
  const t = v.t;
  const floor = floorOf(zone);
  const flee = Math.min(1, v.fleeT);
  const pathX = v.home.x + 190 * dsin(0.55 * t);
  const pathY = v.home.y + 50 * dsin(1.1 * t + 1.2) + 170 * flee;
  const pathZ = v.home.z + 150 * dsin(1.1 * t);
  const pvx = 190 * 0.55 * dcos(0.55 * t);
  const pvy = 50 * 1.1 * dcos(1.1 * t + 1.2) - (v.fleeT > 0 && v.fleeT < 1 ? 170 : 0);
  const pvz = 150 * 1.1 * dcos(1.1 * t);
  const box = stageBox(zone, 50);
  const low = floor + 48;
  const high = floor + 660;
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
    keepIn(v, box, low, high);
    return;
  }
  if (v.phase === "recover") {
    // v4: the stall after a dive: the glider sputters low over the roof, slowing, then he climbs
    // back to his loop. Hit, he climbs at once.
    v.phaseT -= dt;
    const k = 1 / (1 + 2.6 * dt);
    v.vx *= k;
    v.vz *= k;
    v.vy += clamp((floor + GOBLIN_SKIM + 8 * dsin(9 * t) - v.y) * 4 - v.vy, -900 * dt, 900 * dt);
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.z += v.vz * dt;
    v.bank *= k;
    keepIn(v, box, low, high);
    if (v.phaseT <= 0 || v.fleeT > 0) v.phase = "idle";
    return;
  }
  if (v.phase === "telegraph") {
    // Wind-up: pull up and bleed speed.
    v.phaseT -= dt;
    const sp = len2(v.vx, v.vz) || 1;
    glide(v, (v.vx / sp) * 140, 120, (v.vz / sp) * 140, GOBLIN_THRUST, GOBLIN_TURN_ACCEL, dt);
    keepIn(v, box, low, high);
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
      // v4: he levels out at the height he aimed at (chest height on the roof), not over your head.
      v.cy = Math.max(floor + 48, a.y + 12);
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
    // The dive: hard thrust down the line fixed at push-off, turning only GOBLIN_TURN_ACCEL (so a
    // sidestep dodges it). v4: near the roof it levels out and skims, into the stall.
    v.phaseT -= dt;
    const skim = v.y < v.cy + 30;
    if (skim && v.diveY < 0) {
      const hs = len2(v.diveX, v.diveZ) || 1;
      v.diveX /= hs;
      v.diveZ /= hs;
      v.diveY = 0;
    }
    glide(v, v.diveX * GOBLIN_DIVE_SPEED, v.diveY * GOBLIN_DIVE_SPEED, v.diveZ * GOBLIN_DIVE_SPEED, GOBLIN_DIVE_ACCEL, GOBLIN_TURN_ACCEL, dt);
    if (skim && v.vy < 0) v.vy *= 0.8;
    keepIn(v, box, low, high);
    const h = s.hero;
    if (!v.dashHit && len3(h.x - v.x, h.y - v.y, h.z - v.z) < v.radius + HERO_RADIUS) {
      v.dashHit = hurtHero(s, moveDamage(v, "Glider dive"), "Glider dive", v.x, v.y, v.z);
    }
    if (v.phaseT <= 0) {
      v.phase = "recover";
      v.phaseT = GOBLIN_STALL;
    }
    return;
  }
  // Glide the path (climbing back onto it after a stall).
  cruise(1.2);
  keepIn(v, box, low, high);
  v.attackT -= dt;
  if (v.attackT <= 0) {
    // v4: every 2.4–3.2 s (v3: 1.65–2.15).
    v.attackT = (2.4 + roll(s) * 0.8) / v.rate;
    spawnHazard(s, { kind: "bomb", x: v.x, y: v.y - 34, z: v.z, vx: v.vx * 0.35, vy: 40, vz: v.vz * 0.35, r: 17, damage: moveDamage(v, "Fee bomb"), burn: 10 });
    s.events.push({ type: "villain-attack", label: "Fee bomb", x: v.x, y: v.y, z: v.z });
  }
  v.attack2T -= dt;
  if (v.attack2T <= 0 && v.phase === "idle") {
    v.attack2T = (5.5 + roll(s) * 2) / v.rate;
    v.phase = "telegraph";
    v.phaseT = 0.8;
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

/** v4: after the lunge lands he stumbles this long (v3: 0.5 s, still running), the opening. */
const SANDWICH_STUMBLE = 0.9;
/** v4: knocked or flinching, he slides out at this rate rather than braking. */
const SANDWICH_SLIDE = 1000;

/** A spot to run to in `run` that's on the floor (not inside a corner tower): a few seeded tries. */
function floorSpot(s: SimState, v: Villain, run: { x0: number; z0: number; x1: number; z1: number }, floor: number) {
  for (let k = 0; k < 4; k++) {
    v.dashToX = run.x0 + roll(s) * (run.x1 - run.x0);
    v.dashToZ = run.z0 + roll(s) * (run.z1 - run.z0);
    if (groundBelow(s.grid, v.dashToX, v.dashToZ, floor + 400) <= floor + 5) return;
  }
  v.dashToX = (run.x0 + run.x1) / 2;
  v.dashToZ = (run.z0 + run.z1) / 2;
}

function stepSandwich(s: SimState, v: Villain, dt: number, zone: Zone) {
  const h = s.hero;
  const g = SANDWICH_GRAVITY;
  // v4: he keeps to the stage (no roof hops, no street).
  const stage = !!zone.stage;
  const floor = floorOf(zone);
  const box = stage ? stageBox(zone, 30) : inside(zone, 40);
  const run = stage ? stageBox(zone, 80) : inside(zone, 90);
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
        v.phaseT = SANDWICH_STUMBLE;
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
      v.phaseT = SANDWICH_STUMBLE;
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
  /** v4: a slide along the roof that dies out at SANDWICH_SLIDE (knocked back, flinching). */
  const slide = () => {
    const hs = len2(v.vx, v.vz);
    const k = hs > 1e-9 ? Math.max(0, hs - SANDWICH_SLIDE * dt) / hs : 0;
    runTo(v.vx * k, v.vz * k);
  };
  if (v.stun > 0) {
    if (v.grounded) slide();
    return;
  }
  if (v.phase === "recover" && stage) {
    // v4: the stumble after a lunge: he skids to a stop, wide open. Hit, he's off at once.
    v.phaseT -= dt;
    if (v.grounded) slide();
    if ((v.phaseT <= 0 || v.fleeT > 0) && v.grounded) v.phase = "idle";
    else return;
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
  // He front-runs your web too: hop sideways over a sling he sees coming, or out from under a
  // web-zip (v4). A low side-hop (v4: 460 up, 300 aside; v3 sprang 840 up).
  v.dodgeT = Math.max(0, v.dodgeT - dt);
  if (v.grounded && v.dodgeT <= 0 && v.phase === "idle") {
    const incoming = s.shots.find(
      (x) => x.kind === "sling" && len3(x.x - v.x, x.y - v.y, x.z - v.z) < 260 && (v.x - x.x) * x.vx + (v.y - x.y) * x.vy + (v.z - x.z) * x.vz > 0,
    );
    // A web-zip at him, or a blow he sees coming from close in.
    const zip = h.zip >= 0 && h.zip < 0.1 && h.strikeBody < 0;
    const blow = h.strike >= 0 && h.strike < 0.04 && !h.zipped && h.strikeBody < 0 && v.invuln <= 0;
    if (incoming || zip || blow) {
      v.dodgeT = 2.2 / v.rate;
      if (roll(s) < (incoming ? 0.55 : zip ? 0.4 : 0.3)) {
        const fx = incoming ? incoming.vx : v.x - h.x;
        const fz = incoming ? incoming.vz : v.z - h.z;
        const hs = len2(fx, fz) || 1;
        const side = roll(s) < 0.5 ? 1 : -1;
        v.vy = 460;
        v.vx += (-fz / hs) * 300 * side;
        v.vz += (fx / hs) * 300 * side;
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
      if (stage) floorSpot(s, v, run, floor);
      else {
        v.dashToX = run.x0 + roll(s) * (run.x1 - run.x0);
        v.dashToZ = run.z0 + roll(s) * (run.z1 - run.z0);
      }
    }
    const dx = v.dashToX - v.x;
    const dz = v.dashToZ - v.z;
    const d = len2(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    // Arrive: full speed, easing to a stop he can brake into.
    const speed = Math.min(SANDWICH_RUN * v.rate, Math.sqrt(1.6 * SANDWICH_BRAKE * d));
    runTo(ux * speed, uz * speed);
    const foot = v.y - v.radius;
    if (stage) {
      // v4: one flat stage: up against a tower or its edge, he turns for somewhere else.
      if (blocked || groundBelow(s.grid, v.x + ux * 34, v.z + uz * 34, foot + 1) < foot - 4) floorSpot(s, v, run, floor);
    }
    // About to run off a roof, up against a wall, or down in the street: hop (or turn back).
    const ahead = groundBelow(s.grid, v.x + ux * 34, v.z + uz * 34, foot + 1);
    const street = foot <= STREET_Y + 1;
    if (!stage && v.grounded && (ahead < foot - 4 || street || blocked)) {
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
    v.phaseT = 0.6;
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

/**
 * v4: Doc follows you along his bridge (at most DOC_ROAM from its middle, so his reach stays
 * inside the towers) and across the deck, lining his arms' plane up with you, while they sweep
 * and wind up; arms in, he holds still and sags low over the deck, in reach of a strike.
 */
const DOC_ROAM = 220;
const DOC_TRACK_ALONG = 110;
const DOC_TRACK_ACROSS = 150;
const DOC_SAG = 165;
/** v4: a chain arm swats you along the deck this fast (a long slide out of reach; the usual shove is HURT_SHOVE). */
const DOC_SWAT = 680;

function stepDoc(s: SimState, v: Villain, dt: number, zone: Zone) {
  const t = v.t;
  const h = s.hero;
  if (v.phase !== "enter" && (v.phase === "sweep" || v.phase === "slam-wind") && v.stun <= 0) {
    // The base point (cx, cz) walks toward the hero: along the axis, then across it.
    const c = zone.center;
    const across = DECK_HALF - 30;
    const along = clamp((h.x - c.x) * v.ax + (h.z - c.z) * v.az, -DOC_ROAM, DOC_ROAM);
    const side = clamp((h.x - c.x) * -v.az + (h.z - c.z) * v.ax, -across, across);
    const nowAlong = (v.cx - c.x) * v.ax + (v.cz - c.z) * v.az;
    const nowSide = (v.cx - c.x) * -v.az + (v.cz - c.z) * v.ax;
    const a = nowAlong + clamp(along - nowAlong, -DOC_TRACK_ALONG * dt, DOC_TRACK_ALONG * dt);
    const b = nowSide + clamp(side - nowSide, -DOC_TRACK_ACROSS * dt, DOC_TRACK_ACROSS * dt);
    v.cx = c.x + v.ax * a - v.az * b;
    v.cz = c.z + v.az * a + v.ax * b;
  }
  const sway = 60 * dsin(0.35 * t);
  const swayV = 60 * 0.35 * dcos(0.35 * t);
  // Arms in (or stunned), he sags toward the deck to catch his breath: that's your opening.
  const sag = v.phase === "retract" || v.stun > 0 ? DOC_SAG : 0;
  const bodyX = v.cx + v.ax * sway;
  const bodyZ = v.cz + v.az * sway;
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
  if (v.phase === "sweep" || v.phase === "slam") {
    for (let i = 0; i < v.arms.length; i++) {
      if (v.arms[i].len < 110) continue;
      const o = armShoulder(v, i);
      const tip = armTip(v, i);
      if (segDist(h.x, h.y, h.z, o.x, o.y, o.z, tip.x, tip.y, tip.z) < 20 + HERO_RADIUS) {
        const slam = v.phase === "slam";
        // v4: a sweep's chain does three quarters of the flurry's damage, and either swats you
        // away from Doc along the deck, out of reach (v3 threw you off the tip, often further in).
        const damage = moveDamage(v, slam ? "Cross-chain slam" : "Eight-arm flurry");
        const along = (h.x - v.x) * v.ax + (h.z - v.z) * v.az >= 0 ? 1 : -1;
        const hurt = hurtHero(s, slam ? damage : Math.round(damage * 0.7), slam ? "Cross-chain slam" : "a chain arm", h.x - v.ax * along * 100, tip.y, h.z - v.az * along * 100, 0, DOC_SWAT);
        // Swatted, a moment longer to get clear before the next chain counts.
        if (hurt) h.invuln = Math.max(h.invuln, 1.5);
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
  // v4: the swarm drifts low over the stage, at chest height to a strike (v3 floated 280–390
  // over the roofs, out of reach of anything but a swing): a smaller, slower path and ring.
  if (copies > 0) {
    cx = v.home.x + 90 * dsin(0.4 * t);
    cz = v.home.z + 70 * dsin(0.8 * t);
    cy = v.home.y + 30 * dsin(0.8 * t + 0.9);
    fx = 36 * dcos(0.4 * t);
    fz = 56 * dcos(0.8 * t);
    fy = 24 * dcos(0.8 * t + 0.9);
  } else {
    // Alone, he runs a quicker figure eight.
    cx = v.home.x + 150 * dsin(0.9 * t);
    cz = v.home.z + 115 * dsin(1.8 * t);
    cy = v.home.y + 30 * dsin(1.8 * t + 0.9);
    fx = 135 * dcos(0.9 * t);
    fz = 207 * dcos(1.8 * t);
    fy = 54 * dcos(1.8 * t + 0.9);
  }
  if (v.fleeT > 0) {
    // v4: a copy popped, the swarm scatters away from you for a moment.
    const ax = v.cx - s.hero.x;
    const az = v.cz - s.hero.z;
    const d = len2(ax, az) || 1;
    const k = 220 * Math.min(1, v.fleeT);
    cx += (ax / d) * k;
    cz += (az / d) * k;
  }
  // The swarm's centre steers after its path (and coasts while he's stunned).
  const c: Mover = { x: v.cx, y: v.cy, z: v.cz, vx: v.cvx, vy: v.cvy, vz: v.cvz };
  const box = zone.stage ? stageBox(zone, 60) : inside(zone, 60);
  const floor = floorOf(zone);
  if (v.stun <= 0 || v.phase === "enter") {
    arrive(c, cx, cy, cz, fx, fy, fz, SYBIL_CENTER_SPEED * (copies > 0 ? 1 : 1.6), SYBIL_CENTER_ACCEL, want);
    inward(box, c.x, c.z, want, 80, 200);
    steer(c, want.x, want.y, want.z, SYBIL_CENTER_ACCEL * (copies > 0 ? 1 : 1.8), dt);
  } else drift(c, STUN_DRAG, dt);
  keepIn(c, box, floor + 70, floor + 860);
  v.cx = c.x;
  v.cy = c.y;
  v.cz = c.z;
  v.cvx = c.vx;
  v.cvy = c.vy;
  v.cvz = c.vz;
  // The copies orbit him in xz, the ring tipped a little so they sit at different heights:
  // each steers to its slot, which moves with the ring.
  const radius = copies > 0 ? (v.boss ? 165 : 150) : 0;
  const n = alive.length;
  const spin = 0.75;
  alive.forEach((b, k) => {
    const ang = t * spin + (k * PI * 2) / n;
    const co = dcos(ang);
    const sn = dsin(ang);
    const tx = v.cx + co * radius;
    const ty = v.cy + sn * radius * 0.2;
    const tz = v.cz + sn * radius;
    const ox = v.cvx - sn * radius * spin;
    const oy = v.cvy + co * radius * 0.2 * spin;
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
    // v4: slower goo (v3: 360 and 440), so a sidestep beats it from across the stage.
    const speed = big ? 300 : 340;
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
function stepWebbed(s: SimState, v: Villain, dt: number, zone: Zone) {
  // Flyers sink to hang this far over the floor (v3: 260 over the street).
  const hang = floorOf(zone) + 70;
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
  if (m.y < hang) {
    m.y = hang;
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
    stepWebbed(s, v, dt, zone);
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
      stepDoc(s, v, vdt, zone);
      break;
    case "sybil":
      stepSybil(s, v, vdt, zone);
      break;
  }
  if (s.mode === "fight") heroContact(s, v);
}

/**
 * Touching a villain. Slamming into him from the air (a swing or a dash) fast enough is a hit
 * (and knocks him back), and bounces you off. v4: a strike or a zip is its own hit (strike.ts);
 * anything else is a body block, pushed apart (along the roof when you're on it) with the
 * closing speed stopped, never a bounce (v3 bounced every touch at least 260 up).
 */
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
    const blow = h.strike >= 0 || h.zip >= 0;
    const fast = !blow && !h.grounded && (rel >= threshold || (h.dashT > 0 && !h.dashHit));
    // The closing speed along the line between you, before the bounce.
    const closing = -(h.vx * nx + h.vy * ny + h.vz * nz);
    if (fast) {
      if (h.dashT > 0) h.dashHit = true;
      // Doc's arms and a villain's guard turn it into a clang (hitVillain says so).
      const landed = hitVillain(s, t.body, 1, h.dashT > 0 ? "dash" : "slam");
      if (s.villain === v && s.mode === "fight") knockVillain(v, t.body, -nx, -ny, -nz, KNOCK_TRANSFER * Math.max(0, closing) * (landed ? 1 : 0.4));
      // Bounce off (v4: 1.4× and at most 200 up; v3: 1.6× and at least 260).
      const vn = h.vx * nx + h.vy * ny + h.vz * nz;
      if (vn < 0) {
        h.vx -= 1.4 * vn * nx;
        h.vy -= 1.4 * vn * ny;
        h.vz -= 1.4 * vn * nz;
      }
      h.vy = Math.min(Math.max(h.vy, 120), 200);
      h.x = t.x + nx * (t.r + HERO_RADIUS + 1);
      h.y = t.y + ny * (t.r + HERO_RADIUS + 1);
      h.z = t.z + nz * (t.r + HERO_RADIUS + 1);
    } else {
      const R = t.r + HERO_RADIUS;
      if (d >= R) continue;
      if (h.grounded) {
        // Along the roof: out to where the bodies just touch at this height.
        if (dy >= R || dy <= -R) continue;
        const hd = len2(dx, dz);
        const ux = hd > 1e-6 ? dx / hd : -h.fx;
        const uz = hd > 1e-6 ? dz / hd : -h.fz;
        const need = Math.sqrt(R * R - dy * dy);
        h.x = t.x + ux * need;
        h.z = t.z + uz * need;
        const vn = h.vx * ux + h.vz * uz;
        if (vn < 0) {
          h.vx -= vn * ux;
          h.vz -= vn * uz;
        }
      } else {
        h.x = t.x + nx * R;
        h.y = t.y + ny * R;
        h.z = t.z + nz * R;
        const vn = h.vx * nx + h.vy * ny + h.vz * nz;
        if (vn < 0) {
          h.vx -= vn * nx;
          h.vy -= vn * ny;
          h.vz -= vn * nz;
        }
      }
    }
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
        // v4: a 70 blast (v3: 80).
        s.events.push({ type: "blast", x: z.x, y: Math.max(z.y, ground + z.r), z: z.z, r: 70, kind: "bomb" });
        if (hitHero || len3(h.x - z.x, h.y - z.y, h.z - z.z) < 70 + HERO_RADIUS * 0.5) hurtHero(s, z.damage, "a fee bomb", z.x, z.y, z.z, z.burn);
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
