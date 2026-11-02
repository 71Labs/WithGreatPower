/**
 * The four villains as real-time encounters in 3D, plus their hazards. Every joke from 2D
 * survives:
 *
 * - Gas Goblin flies a looping figure-eight over the arena, dropping fee bombs (they hurt
 *   and burn fluid) and now and then diving at you.
 * - Sandwich Man runs the arena roofs, front-runs you by lunging at where you're about to
 *   be, hops over webs he sees coming, and drops bread-slab traps that clap shut.
 * - Doc Octochain hovers over his bridge; four chain arms sweep and slam in the bridge's
 *   vertical plane. His body only takes a direct hit in the open window, arms pulled in.
 * - The Sybil hides among copies orbiting in xz that shoot goo. Every hit pops a copy; the
 *   real one is last.
 */
import { VILLAINS } from "../rules/data";
import type { Stop } from "../rules/types";

import { collideSphere, groundBelow, type SphereHit } from "./city";
import { HERO_RADIUS, SLAM_SPEED, SLOWMO_FACTOR, STREET_Y } from "./constants";
import { docVulnerable, hitVillain, hurtHero, moveDamage, villainHits, villainTargets } from "./combat";
import type { Zone } from "./contract";
import { clamp, dcos, dsin, len2, len3, PI } from "./dmath";
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
  };
  switch (v.kind) {
    case "gas-goblin":
      // He swoops in from outside the arena.
      v.x = zone.bounds.x1 + 200;
      v.y = 900;
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
      v.arms = [-2.55, -1.95, -1.19, -0.59].map((base) => ({ base, angle: base, len: 40 }));
      break;
    case "sybil": {
      v.radius = 40;
      v.y = 1000;
      v.home = { x: c.x, y: 520, z: c.z };
      v.cy = 1000;
      const copies = hits - 1;
      for (let i = 0; i <= copies; i++) {
        v.bodies.push({ x: c.x, y: 1000, z: c.z, real: i === 0, alive: true, slot: i, shootT: 1.2 + i * 0.7 });
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

/* ------------------------------------------------------------------ Gas Goblin */

function stepGoblin(s: SimState, v: Villain, dt: number, zone: Zone) {
  // A looping figure-eight in xz, bobbing; hit, he climbs out of reach for a moment, cackling.
  const pathX = v.home.x + 270 * dsin(0.55 * v.t);
  const pathZ = v.home.z + 210 * dsin(1.1 * v.t);
  const pathY = v.home.y + 80 * dsin(1.1 * v.t + 1.2) + 170 * Math.min(1, v.fleeT);
  if (v.phase === "enter") {
    const k = Math.min(1, dt * 2.2);
    v.x += (pathX - v.x) * k;
    v.y += (pathY - v.y) * k;
    v.z += (pathZ - v.z) * k;
    return;
  }
  if (v.stun > 0) {
    v.vy = Math.max(-200, v.vy - 400 * dt);
    v.y = Math.max(240, v.y + v.vy * dt);
    return;
  }
  const box = inside(zone, 40);
  if (v.phase === "telegraph") {
    v.phaseT -= dt;
    if (v.phaseT <= 0) {
      const t = aim(s, 0.25);
      const dx = t.x - v.x;
      const dy = t.y - v.y;
      const dz = t.z - v.z;
      const d = len3(dx, dy, dz) || 1;
      v.vx = (dx / d) * 780;
      v.vy = (dy / d) * 780;
      v.vz = (dz / d) * 780;
      v.phase = "dash";
      v.phaseT = 0.85;
      v.dashHit = false;
    }
    return;
  }
  if (v.phase === "dash") {
    v.phaseT -= dt;
    v.x = clamp(v.x + v.vx * dt, box.x0, box.x1);
    v.y = clamp(v.y + v.vy * dt, 150, 900);
    v.z = clamp(v.z + v.vz * dt, box.z0, box.z1);
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
  // Glide the path (easing back to it after a dive).
  const k = v.phase === "recover" ? Math.min(1, dt * 2.5) : 1;
  const nx = v.x + (pathX - v.x) * k;
  const ny = v.y + (pathY - v.y) * k;
  const nz = v.z + (pathZ - v.z) * k;
  v.vx = (nx - v.x) / dt;
  v.vy = (ny - v.y) / dt;
  v.vz = (nz - v.z) / dt;
  v.x = nx;
  v.y = ny;
  v.z = nz;
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

const SANDWICH_RUN = 250;
const vhit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

function stepSandwich(s: SimState, v: Villain, dt: number, zone: Zone) {
  const h = s.hero;
  const prevY = v.y;
  const gravity = 1700;
  const box = inside(zone, 40);
  if (v.phase === "dash") {
    v.phaseT -= dt;
    v.x = clamp(v.x + v.vx * dt, box.x0, box.x1);
    v.y = clamp(v.y + v.vy * dt, STREET_Y + v.radius, 900);
    v.z = clamp(v.z + v.vz * dt, box.z0, box.z1);
    if (!v.dashHit && len3(h.x - v.x, h.y - v.y, h.z - v.z) < v.radius + HERO_RADIUS + 6) {
      v.dashHit = hurtHero(s, moveDamage(v, "Front-run"), "Front-run", v.x, v.y, v.z);
    }
    if (v.phaseT <= 0) {
      v.phase = "recover";
      v.phaseT = 0.5;
      v.vx *= 0.3;
      v.vz *= 0.3;
      v.vy = 0;
      v.grounded = false;
    }
    return;
  }
  // Gravity, the rooftops, and the walls between them.
  let blocked = false;
  if (!v.grounded) {
    v.vy -= gravity * dt;
    v.x = clamp(v.x + v.vx * dt, box.x0, box.x1);
    v.y += v.vy * dt;
    v.z = clamp(v.z + v.vz * dt, box.z0, box.z1);
    const foot = v.y - v.radius;
    const top = groundBelow(s.grid, v.x, v.z, prevY - v.radius + 0.5);
    if (v.vy <= 0 && foot < top) {
      v.y = top + v.radius;
      v.vy = 0;
      v.grounded = true;
    }
  } else {
    const below = groundBelow(s.grid, v.x, v.z, v.y - v.radius);
    const gap = v.y - v.radius - below;
    if (gap > 2 || gap < -2) v.grounded = false;
  }
  collideSphere(s.grid, v, v.radius, vhit);
  if (vhit.wall) blocked = true;
  if (vhit.top && v.vy <= 0) {
    v.y = vhit.topY + v.radius;
    v.vy = 0;
    v.grounded = true;
  }
  if (v.phase === "enter") {
    if (v.grounded) v.phaseT = Math.min(v.phaseT, 0.2);
    return;
  }
  if (v.stun > 0) {
    v.vx *= 0.85;
    v.vz *= 0.85;
    return;
  }
  if (v.phase === "telegraph") {
    v.vx *= 0.7;
    v.vz *= 0.7;
    v.phaseT -= dt;
    if (v.phaseT <= 0) {
      // Front-run: lunge at where you're about to be.
      const t = aim(s, 0.45);
      const dx = t.x - v.x;
      const dy = t.y - v.y;
      const dz = t.z - v.z;
      const d = len3(dx, dy, dz) || 1;
      const speed = 1150;
      v.vx = (dx / d) * speed;
      v.vy = (dy / d) * speed;
      v.vz = (dz / d) * speed;
      v.phase = "dash";
      v.phaseT = Math.min(0.6, d / speed + 0.08);
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
        v.vx = (-incoming.vz / hs) * 260;
        v.vz = (incoming.vx / hs) * 260;
        v.grounded = false;
        s.events.push({ type: "villain-attack", label: "Front-runs your web", x: v.x, y: v.y, z: v.z });
      }
    }
  }
  // Run the rooftops toward a spot, jumping gaps and walls.
  if (v.grounded) {
    const run = inside(zone, 90);
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
    const k = Math.min(1, dt * 6);
    v.vx += (ux * SANDWICH_RUN * v.rate - v.vx) * k;
    v.vz += (uz * SANDWICH_RUN * v.rate - v.vz) * k;
    v.x = clamp(v.x + v.vx * dt, box.x0, box.x1);
    v.z = clamp(v.z + v.vz * dt, box.z0, box.z1);
    // About to run off a roof, up against a wall, or stuck in the street: jump.
    const foot = v.y - v.radius;
    const ahead = groundBelow(s.grid, v.x + ux * 30, v.z + uz * 30, foot);
    const street = foot <= STREET_Y + 1;
    if (ahead < foot - 4 || street || blocked) {
      v.vy = street ? 980 : 760;
      v.vx = ux * 330;
      v.vz = uz * 330;
      v.grounded = false;
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
  if (v.attackT <= 0 && v.phase === "idle" && len3(h.x - v.x, h.y - v.y, h.z - v.z) < 700) {
    v.attackT = (3.8 + roll(s) * 1.5) / v.rate;
    v.phase = "telegraph";
    v.phaseT = 0.5;
    s.events.push({ type: "villain-attack", label: "Front-run", x: v.x, y: v.y, z: v.z });
  }
}

/* ------------------------------------------------------------------ Doc Octochain */

/** Arm i's tip: in the vertical plane along the bridge axis (angle 0 along the axis, π/2 up). */
export function armTip(v: Villain, i: number): { x: number; y: number; z: number } {
  const a = v.arms[i];
  const along = dcos(a.angle) * a.len;
  return { x: v.x + v.ax * along, y: v.y + dsin(a.angle) * a.len, z: v.z + v.az * along };
}

function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2, 0, 1);
  return len3(px - (ax + dx * t), py - (ay + dy * t), pz - (az + dz * t));
}

function stepDoc(s: SimState, v: Villain, dt: number) {
  const sway = 120 * dsin(0.35 * v.t);
  const bodyX = v.home.x + v.ax * sway;
  const bodyZ = v.home.z + v.az * sway;
  // Arms in (or stunned), he sags toward the deck to catch his breath: that's your opening.
  const sag = v.phase === "retract" || v.stun > 0 ? 150 : 0;
  const bodyY = v.home.y + 30 * dsin(1.3 * v.t) - sag;
  if (v.phase === "enter") {
    const k = Math.min(1, dt * 2.4);
    v.x += (bodyX - v.x) * k;
    v.y += (bodyY - v.y) * k;
    v.z += (bodyZ - v.z) * k;
    for (const a of v.arms) a.len += (60 - a.len) * Math.min(1, dt * 3);
    return;
  }
  const k = Math.min(1, dt * 3);
  v.x += (bodyX - v.x) * k;
  v.y += (bodyY - v.y) * k;
  v.z += (bodyZ - v.z) * k;
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
  const ease = (from: number, to: number, kk: number) => from + (to - from) * Math.min(1, dt * kk);
  const swing = 1.35 * Math.sqrt(v.rate);
  v.arms.forEach((a, i) => {
    let len = a.len;
    let angle = a.angle;
    if (stunned || v.phase === "retract" || v.phase === "idle") {
      len = ease(len, stunned ? 70 : 48, 6);
      angle = ease(angle, a.base, 5);
    } else if (v.phase === "sweep") {
      len = ease(len, 285, 4);
      angle = a.base + dsin(v.t * swing + i * 1.4) * 0.95;
    } else if (v.phase === "slam-wind") {
      len = ease(len, 250, 6);
      angle = ease(angle, PI / 2 + (i - 1.5) * 0.42, 7);
    } else if (v.phase === "slam") {
      len = ease(len, 330, 10);
      angle = ease(angle, -PI / 2 + (i - 1.5) * 0.36, 9);
    }
    a.len = len;
    a.angle = angle;
  });
  // Chain contact.
  const h = s.hero;
  if (v.phase === "sweep" || v.phase === "slam") {
    for (let i = 0; i < v.arms.length; i++) {
      if (v.arms[i].len < 110) continue;
      const tip = armTip(v, i);
      if (segDist(h.x, h.y, h.z, v.x, v.y, v.z, tip.x, tip.y, tip.z) < 20 + HERO_RADIUS) {
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
  let cx: number;
  let cy: number;
  let cz: number;
  if (copies > 0) {
    cx = v.home.x + 180 * dsin(0.4 * v.t);
    cz = v.home.z + 140 * dsin(0.8 * v.t);
    cy = v.home.y + 110 * dsin(0.8 * v.t + 0.9);
  } else {
    // Alone, he runs a quicker figure eight.
    cx = v.home.x + 260 * dsin(0.9 * v.t);
    cz = v.home.z + 200 * dsin(1.8 * v.t);
    cy = v.home.y + 150 * dsin(1.8 * v.t + 0.9);
  }
  const follow = v.phase === "enter" ? 2 : 4;
  if (v.stun <= 0 || v.phase === "enter") {
    const k = Math.min(1, dt * follow);
    v.cx += (cx - v.cx) * k;
    v.cy += (cy - v.cy) * k;
    v.cz += (cz - v.cz) * k;
  }
  const box = inside(zone, 60);
  v.cx = clamp(v.cx, box.x0, box.x1);
  v.cz = clamp(v.cz, box.z0, box.z1);
  // The copies orbit him in xz, the ring tipped a little so they sit at different heights.
  const radius = copies > 0 ? (v.boss ? 175 : 155) : 0;
  const n = alive.length;
  alive.forEach((b, k) => {
    const ang = v.t * 1.2 + (k * PI * 2) / n;
    const c = dcos(ang);
    const sn = dsin(ang);
    const tx = v.cx + c * radius;
    const ty = v.cy + sn * radius * 0.25;
    const tz = v.cz + sn * radius;
    const f = Math.min(1, dt * 6);
    b.x += (tx - b.x) * f;
    b.y += (ty - b.y) * f;
    b.z += (tz - b.z) * f;
  });
  const real = v.bodies.find((b) => b.real)!;
  v.x = real.x;
  v.y = real.y;
  v.z = real.z;
  if (v.phase === "enter" || v.stun > 0) return;
  for (const b of alive) {
    b.shootT -= dt;
    if (b.shootT > 0) continue;
    b.shootT = (1.5 * n + roll(s) * 0.8) / v.rate;
    const t = aim(s, 0.35);
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const dz = t.z - b.z;
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

export function stepVillain(s: SimState, dt: number) {
  const v = s.villain;
  if (!v) return;
  const zone = s.city.zones[s.index];
  const slow = s.slowmo > 0 ? SLOWMO_FACTOR : 1;
  const vdt = dt * slow;
  v.invuln = Math.max(0, v.invuln - dt);
  if (s.mode === "won") {
    // Webbed villains drift down to hang (Sandwich Man stays where he fell).
    v.vx = 0;
    v.vz = 0;
    if (v.kind === "sandwich-man") return;
    v.y += (Math.max(260, v.y - 30) - v.y) * Math.min(1, dt * 2);
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

/** Slamming into a villain: fast enough and it's a hit; slow and you bounce. */
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
    const rel = len3(h.vx - v.vx * 0.3, h.vy - v.vy * 0.3, h.vz - v.vz * 0.3);
    if (h.slam > 0) return; // the shockwave handles it on impact
    // Doc with his arms in is wide open: a lighter hit does it.
    const threshold = v.kind === "doc-octochain" && docVulnerable(v) ? SLAM_SPEED * 0.6 : SLAM_SPEED;
    const fast = rel >= threshold || (h.dashT > 0 && !h.dashHit);
    if (fast) {
      if (h.dashT > 0) h.dashHit = true;
      // Doc's arms and a villain's guard turn it into a clang (hitVillain says so).
      hitVillain(s, t.body, 1, h.dashT > 0 ? "dash" : "slam");
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
