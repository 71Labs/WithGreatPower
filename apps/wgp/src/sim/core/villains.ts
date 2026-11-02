/**
 * The four villains as real-time encounters, plus their hazards.
 *
 * - Gas Goblin glides a sine path above the arena, dropping fee bombs (they hurt and burn
 *   fluid) and now and then diving at you.
 * - Sandwich Man runs the rooftops, front-runs you by lunging at where you're about to
 *   be, and drops bread-slab traps that clap shut.
 * - Doc Octochain hovers over his bridge; four chain arms sweep and slam. His body only
 *   takes a direct hit while the arms are pulled in.
 * - The Sybil hides among orbiting copies that shoot goo. Every hit pops a copy; the real
 *   one is last.
 */
import { VILLAINS } from "@wgp/game-core/data";
import type { Stop } from "@wgp/game-core/types";

import { HERO_RADIUS, SLAM_SPEED, SLOWMO_FACTOR, STREET_Y } from "./constants";
import { docVulnerable, hitVillain, hurtHero, moveDamage, villainHits, villainTargets } from "./combat";
import { roll } from "./rng";
import type { Hazard, SimState, Villain, Zone } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function spawnVillain(s: SimState, zone: Zone): Villain {
  const stop = zone.stop as Extract<Stop, { kind: "fight" }>;
  const hits = villainHits(stop.level, stop.boss);
  const rate = 1 + 0.08 * (stop.level - 1) + (stop.boss ? 0.15 : 0);
  const v: Villain = {
    kind: stop.villain,
    cast: stop.villain,
    level: stop.level,
    boss: stop.boss,
    quest: stop.quest,
    x: zone.x,
    y: 600,
    vx: 0,
    vy: 0,
    radius: 46,
    hits,
    hitsMax: hits,
    invuln: 0,
    stun: 0,
    flash: 0,
    t: 0,
    phase: "enter",
    phaseT: 1.6,
    facing: -1,
    attackT: 2.2 / rate,
    attack2T: 5.5 / rate,
    rate,
    grounded: false,
    dashTo: 0,
    dashHit: false,
    arms: [],
    bodies: [],
    cx: zone.x,
    cy: 520,
    cycle: 0,
    webbed: 0,
    home: { x: zone.x, y: 560 },
    fleeT: 0,
    dodgeT: 0,
  };
  switch (v.kind) {
    case "gas-goblin":
      v.x = zone.x1 + 260;
      v.y = 900;
      v.home = { x: zone.x, y: 560 };
      break;
    case "sandwich-man":
      v.radius = 44;
      v.x = zone.x + 380;
      v.y = 760;
      v.home = { x: zone.x, y: 220 };
      v.attackT = 3 / rate;
      v.attack2T = 2.2 / rate;
      break;
    case "doc-octochain":
      v.radius = 50;
      v.x = zone.x;
      v.y = 1050;
      v.home = { x: zone.x, y: 480 };
      v.arms = [-2.55, -1.95, -1.19, -0.59].map((base) => ({ base, angle: base, len: 40 }));
      break;
    case "sybil": {
      v.radius = 40;
      v.x = zone.x;
      v.y = 1000;
      v.home = { x: zone.x, y: 520 };
      v.cx = zone.x;
      v.cy = 1000;
      const copies = hits - 1;
      for (let i = 0; i <= copies; i++) {
        v.bodies.push({ x: zone.x, y: 1000, real: i === 0, alive: true, slot: i, shootT: 1.2 + i * 0.7 });
      }
      break;
    }
  }
  return v;
}

/** Where villains aim: at you, unless you're cloaked. */
function aim(s: SimState, lead = 0): { x: number; y: number } {
  const h = s.hero;
  if (h.cloakT > 0) return { x: h.x + Math.sin(s.time * 1.7) * 320, y: h.y + 180 };
  return { x: h.x + h.vx * lead, y: h.y + h.vy * lead * 0.6 };
}

function spawnHazard(s: SimState, hz: Partial<Hazard> & Pick<Hazard, "kind" | "x" | "y">) {
  s.hazards.push({ vx: 0, vy: 0, r: 16, t: 0, damage: 10, burn: 0, big: false, state: "open", dead: false, ...hz });
}

/** Platforms under x, highest first below `y`. */
function groundBelow(s: SimState, x: number, y: number): number {
  let best = STREET_Y;
  for (const p of s.world.platforms) if (x >= p.x0 && x <= p.x1 && p.y <= y + 1 && p.y > best) best = p.y;
  return best;
}

/* ------------------------------------------------------------------ Gas Goblin */

function stepGoblin(s: SimState, v: Villain, dt: number, zone: Zone) {
  const pathX = v.home.x + 390 * Math.sin(0.55 * v.t);
  // Hit, he climbs out of reach for a moment, cackling.
  const pathY = v.home.y + 80 * Math.sin(1.1 * v.t) + 170 * Math.min(1, v.fleeT);
  if (v.phase === "enter") {
    v.x += (pathX - v.x) * Math.min(1, dt * 2.2);
    v.y += (pathY - v.y) * Math.min(1, dt * 2.2);
    return;
  }
  const stunned = v.stun > 0;
  if (stunned) {
    v.vy = Math.max(-200, v.vy - 400 * dt);
    v.y = Math.max(240, v.y + v.vy * dt);
    return;
  }
  if (v.phase === "telegraph") {
    v.phaseT -= dt;
    if (v.phaseT <= 0) {
      const t = aim(s, 0.25);
      const dx = t.x - v.x;
      const dy = t.y - v.y;
      const d = Math.hypot(dx, dy) || 1;
      v.vx = (dx / d) * 780;
      v.vy = (dy / d) * 780;
      v.phase = "dash";
      v.phaseT = 0.85;
      v.dashHit = false;
    }
    return;
  }
  if (v.phase === "dash") {
    v.phaseT -= dt;
    v.x = clamp(v.x + v.vx * dt, zone.x0 + 40, zone.x1 - 40);
    v.y = clamp(v.y + v.vy * dt, 150, 900);
    const h = s.hero;
    if (!v.dashHit && Math.hypot(h.x - v.x, h.y - v.y) < v.radius + HERO_RADIUS) {
      v.dashHit = hurtHero(s, moveDamage(v, "Glider dive"), "Glider dive", v.x, v.y);
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
  v.vx = (nx - v.x) / dt;
  v.vy = (ny - v.y) / dt;
  v.x = nx;
  v.y = ny;
  v.facing = v.vx >= 0 ? 1 : -1;
  if (v.phase === "recover") {
    v.phaseT -= dt;
    if (v.phaseT <= 0) v.phase = "idle";
  }
  v.attackT -= dt;
  if (v.attackT <= 0) {
    v.attackT = (1.65 + roll(s) * 0.5) / v.rate;
    spawnHazard(s, { kind: "bomb", x: v.x, y: v.y - 34, vx: v.vx * 0.35, vy: 40, r: 17, damage: moveDamage(v, "Fee bomb"), burn: 10 });
    s.events.push({ type: "villain-attack", label: "Fee bomb", x: v.x, y: v.y });
  }
  v.attack2T -= dt;
  if (v.attack2T <= 0 && v.phase === "idle") {
    v.attack2T = (5.5 + roll(s) * 2) / v.rate;
    v.phase = "telegraph";
    v.phaseT = 0.75;
    s.events.push({ type: "villain-attack", label: "Glider dive", x: v.x, y: v.y });
  }
}

/* ------------------------------------------------------------------ Sandwich Man */

const SANDWICH_RUN = 250;

function stepSandwich(s: SimState, v: Villain, dt: number, zone: Zone) {
  const h = s.hero;
  const prevY = v.y;
  const gravity = 1700;
  if (v.phase === "dash") {
    v.phaseT -= dt;
    v.x = clamp(v.x + v.vx * dt, zone.x0 + 40, zone.x1 - 40);
    v.y = clamp(v.y + v.vy * dt, STREET_Y + v.radius, 900);
    if (!v.dashHit && Math.hypot(h.x - v.x, h.y - v.y) < v.radius + HERO_RADIUS + 6) {
      v.dashHit = hurtHero(s, moveDamage(v, "Front-run"), "Front-run", v.x, v.y);
    }
    if (v.phaseT <= 0) {
      v.phase = "recover";
      v.phaseT = 0.5;
      v.vx *= 0.3;
      v.vy = 0;
      v.grounded = false;
    }
    return;
  }
  // Gravity and the rooftops.
  if (!v.grounded) {
    v.vy -= gravity * dt;
    v.x = clamp(v.x + v.vx * dt, zone.x0 + 40, zone.x1 - 40);
    v.y += v.vy * dt;
    const foot = v.y - v.radius;
    const prevFoot = prevY - v.radius;
    for (const p of s.world.platforms) {
      if (v.x < p.x0 || v.x > p.x1 || v.vy > 0) continue;
      if (prevFoot >= p.y - 0.5 && foot < p.y) {
        v.y = p.y + v.radius;
        v.vy = 0;
        v.grounded = true;
        break;
      }
    }
    if (v.y - v.radius <= STREET_Y) {
      v.y = STREET_Y + v.radius;
      v.vy = 0;
      v.grounded = true;
    }
  } else {
    const below = groundBelow(s, v.x, v.y - v.radius);
    if (Math.abs(v.y - v.radius - below) > 2) v.grounded = false;
  }
  if (v.phase === "enter") {
    if (v.grounded) v.phaseT = Math.min(v.phaseT, 0.2);
    return;
  }
  if (v.stun > 0) {
    v.vx *= 0.85;
    return;
  }
  if (v.phase === "telegraph") {
    v.vx *= 0.7;
    v.phaseT -= dt;
    if (v.phaseT <= 0) {
      // Front-run: lunge at where you're about to be.
      const t = aim(s, 0.45);
      const dx = t.x - v.x;
      const dy = t.y - v.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 1150;
      v.vx = (dx / d) * speed;
      v.vy = (dy / d) * speed;
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
  // He front-runs your web too: hop over a sling he sees coming.
  v.dodgeT = Math.max(0, v.dodgeT - dt);
  if (v.grounded && v.dodgeT <= 0 && v.phase === "idle") {
    const incoming = s.shots.find((x) => x.kind === "sling" && Math.hypot(x.x - v.x, x.y - v.y) < 260 && (v.x - x.x) * x.vx + (v.y - x.y) * x.vy > 0);
    if (incoming) {
      v.dodgeT = 2.2 / v.rate;
      if (roll(s) < 0.55) {
        v.vy = 840;
        v.vx = (incoming.vx > 0 ? 1 : -1) * 260;
        v.grounded = false;
        s.events.push({ type: "villain-attack", label: "Front-runs your web", x: v.x, y: v.y });
      }
    }
  }
  // Run the rooftops toward a spot, jumping gaps.
  if (v.grounded) {
    if (v.fleeT > 1.7) {
      // Just hit: run for the far side.
      v.dashTo = h.x > zone.x ? zone.x0 + 90 : zone.x1 - 90;
    } else if (Math.abs(v.dashTo - v.x) < 24 || v.dashTo < zone.x0 || v.dashTo > zone.x1) {
      v.dashTo = zone.x0 + 80 + roll(s) * (zone.x1 - zone.x0 - 160);
    }
    const dir = v.dashTo > v.x ? 1 : -1;
    v.facing = dir as 1 | -1;
    v.vx += (dir * SANDWICH_RUN * v.rate - v.vx) * Math.min(1, dt * 6);
    v.x = clamp(v.x + v.vx * dt, zone.x0 + 40, zone.x1 - 40);
    // About to run off a roof (or stuck in the street): jump.
    const ahead = groundBelow(s, v.x + dir * 30, v.y - v.radius);
    if (ahead < v.y - v.radius - 4 || v.y - v.radius <= STREET_Y + 1) {
      v.vy = v.y - v.radius <= STREET_Y + 1 ? 980 : 760;
      v.vx = dir * 330;
      v.grounded = false;
    }
  }
  v.attack2T -= dt;
  if (v.attack2T <= 0 && v.grounded && v.y - v.radius > STREET_Y + 10) {
    v.attack2T = (3.2 + roll(s)) / v.rate;
    if (s.hazards.filter((z) => z.kind === "trap" && !z.dead).length < 3) {
      spawnHazard(s, { kind: "trap", x: v.x, y: v.y - v.radius, r: 52, damage: moveDamage(v, "Squeeze") });
      s.events.push({ type: "villain-attack", label: "Bread trap", x: v.x, y: v.y });
    }
  }
  v.attackT -= dt;
  if (v.attackT <= 0 && v.phase === "idle" && Math.hypot(h.x - v.x, h.y - v.y) < 700) {
    v.attackT = (3.8 + roll(s) * 1.5) / v.rate;
    v.phase = "telegraph";
    v.phaseT = 0.5;
    s.events.push({ type: "villain-attack", label: "Front-run", x: v.x, y: v.y });
  }
}

/* ------------------------------------------------------------------ Doc Octochain */

export function armTip(v: Villain, i: number): { x: number; y: number } {
  const a = v.arms[i];
  return { x: v.x + Math.cos(a.angle) * a.len, y: v.y + Math.sin(a.angle) * a.len };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function stepDoc(s: SimState, v: Villain, dt: number) {
  const bodyX = v.home.x + 120 * Math.sin(0.35 * v.t);
  // Arms in (or stunned), he sags toward the deck to catch his breath: that's your opening.
  const sag = v.phase === "retract" || v.stun > 0 ? 150 : 0;
  const bodyY = v.home.y + 30 * Math.sin(1.3 * v.t) - sag;
  if (v.phase === "enter") {
    v.x += (bodyX - v.x) * Math.min(1, dt * 2.4);
    v.y += (bodyY - v.y) * Math.min(1, dt * 2.4);
    for (const a of v.arms) a.len += (60 - a.len) * Math.min(1, dt * 3);
    return;
  }
  v.x += (bodyX - v.x) * Math.min(1, dt * 3);
  v.y += (bodyY - v.y) * Math.min(1, dt * 3);
  const stunned = v.stun > 0;
  v.phaseT -= stunned ? 0 : dt;
  if (!stunned && v.phaseT <= 0) {
    switch (v.phase) {
      case "sweep":
        v.cycle += 1;
        if (v.cycle % (v.boss ? 2 : 3) === 0) {
          v.phase = "slam-wind";
          v.phaseT = 0.85;
          s.events.push({ type: "villain-attack", label: "Cross-chain slam", x: v.x, y: v.y });
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
        s.events.push({ type: "villain-attack", label: "Eight-arm flurry", x: v.x, y: v.y });
    }
  }
  const ease = (from: number, to: number, k: number) => from + (to - from) * Math.min(1, dt * k);
  v.arms.forEach((a, i) => {
    let len = a.len;
    let angle = a.angle;
    if (stunned || v.phase === "retract" || v.phase === "idle") {
      len = ease(len, stunned ? 70 : 48, 6);
      angle = ease(angle, a.base, 5);
    } else if (v.phase === "sweep") {
      len = ease(len, 285, 4);
      angle = a.base + Math.sin(v.t * 1.35 * Math.sqrt(v.rate) + i * 1.4) * 0.95;
    } else if (v.phase === "slam-wind") {
      len = ease(len, 250, 6);
      angle = ease(angle, Math.PI / 2 + (i - 1.5) * 0.42, 7);
    } else if (v.phase === "slam") {
      len = ease(len, 330, 10);
      angle = ease(angle, -Math.PI / 2 + (i - 1.5) * 0.36, 9);
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
      if (segDist(h.x, h.y, v.x, v.y, tip.x, tip.y) < 20 + HERO_RADIUS) {
        const slam = v.phase === "slam";
        hurtHero(s, moveDamage(v, slam ? "Cross-chain slam" : "Eight-arm flurry"), slam ? "Cross-chain slam" : "a chain arm", tip.x, tip.y);
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ The Sybil */

function stepSybil(s: SimState, v: Villain, dt: number) {
  const alive = v.bodies.filter((b) => b.alive);
  const copies = alive.filter((b) => !b.real).length;
  let cx: number;
  let cy: number;
  if (copies > 0) {
    cx = v.home.x + 280 * Math.sin(0.4 * v.t);
    cy = v.home.y + 110 * Math.sin(0.8 * v.t);
  } else {
    // Alone, he runs a quicker figure eight.
    cx = v.home.x + 360 * Math.sin(0.9 * v.t);
    cy = v.home.y + 150 * Math.sin(1.8 * v.t);
  }
  const follow = v.phase === "enter" ? 2 : 4;
  if (v.stun <= 0 || v.phase === "enter") {
    v.cx += (cx - v.cx) * Math.min(1, dt * follow);
    v.cy += (cy - v.cy) * Math.min(1, dt * follow);
  }
  const radius = copies > 0 ? (v.boss ? 175 : 155) : 0;
  const n = alive.length;
  alive.forEach((b, k) => {
    const ang = v.t * 1.2 + (k * Math.PI * 2) / n;
    const tx = v.cx + Math.cos(ang) * radius;
    const ty = v.cy + Math.sin(ang) * radius * 0.8;
    b.x += (tx - b.x) * Math.min(1, dt * 6);
    b.y += (ty - b.y) * Math.min(1, dt * 6);
  });
  const real = v.bodies.find((b) => b.real)!;
  v.x = real.x;
  v.y = real.y;
  if (v.phase === "enter" || v.stun > 0) return;
  for (const b of alive) {
    b.shootT -= dt;
    if (b.shootT > 0) continue;
    b.shootT = (1.5 * n + roll(s) * 0.8) / v.rate;
    const t = aim(s, 0.35);
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const big = b.real;
    const speed = big ? 360 : 440;
    spawnHazard(s, {
      kind: "goo",
      x: b.x,
      y: b.y,
      vx: (dx / d) * speed,
      vy: (dy / d) * speed,
      r: big ? 20 : 13,
      big,
      damage: moveDamage(v, big ? "Fake vote" : "Swarm"),
    });
    if (big) s.events.push({ type: "villain-attack", label: "Fake vote", x: b.x, y: b.y });
  }
}

/* ------------------------------------------------------------------ shared */

export function stepVillain(s: SimState, dt: number) {
  const v = s.villain;
  if (!v) return;
  const zone = s.world.zones[s.index];
  const slow = s.slowmo > 0 ? SLOWMO_FACTOR : 1;
  const vdt = dt * slow;
  v.flash = Math.max(0, v.flash - dt * 4);
  v.invuln = Math.max(0, v.invuln - dt);
  if (s.mode === "won") {
    v.webbed = Math.min(1, v.webbed + dt * 2.2);
    // Webbed villains drift down to hang.
    v.vx = 0;
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
      stepSybil(s, v, vdt);
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
    const d = Math.hypot(dx, dy);
    // A little generous: slamming should feel like it connects.
    if (d > t.r + HERO_RADIUS + 10) continue;
    const nx = d > 0 ? dx / d : 0;
    const ny = d > 0 ? dy / d : 1;
    const rel = Math.hypot(h.vx - v.vx * 0.3, h.vy - v.vy * 0.3);
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
    const vn = h.vx * nx + h.vy * ny;
    if (vn < 0) {
      h.vx -= 1.6 * vn * nx;
      h.vy -= 1.6 * vn * ny;
    }
    h.vy = Math.max(h.vy, 260);
    h.x = t.x + nx * (t.r + HERO_RADIUS + 1);
    h.y = t.y + ny * (t.r + HERO_RADIUS + 1);
    if (h.rope) h.rope.len = Math.max(h.rope.len, Math.hypot(h.x - h.rope.x, h.y - h.rope.y));
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
      const hitHero = Math.hypot(h.x - z.x, h.y - z.y) < z.r + HERO_RADIUS;
      const ground = groundBelow(s, z.x, z.y + z.r);
      if (hitHero || z.y - z.r <= ground) {
        z.dead = true;
        s.events.push({ type: "blast", x: z.x, y: Math.max(z.y, ground + z.r), r: 80, kind: "bomb" });
        if (hitHero || Math.hypot(h.x - z.x, h.y - z.y) < 80 + HERO_RADIUS * 0.5) hurtHero(s, z.damage, "a fee bomb", z.x, z.y, z.burn);
      }
    } else if (z.kind === "goo") {
      z.vy -= 120 * hdt;
      z.x += z.vx * hdt;
      z.y += z.vy * hdt;
      if (Math.hypot(h.x - z.x, h.y - z.y) < z.r + HERO_RADIUS) {
        z.dead = true;
        s.events.push({ type: "goo", x: z.x, y: z.y });
        hurtHero(s, z.damage, z.big ? "a fake vote" : "Sybil goo", z.x, z.y);
      } else if (z.t > 4.5 || z.y - z.r <= groundBelow(s, z.x, z.y + z.r)) {
        z.dead = true;
        s.events.push({ type: "goo", x: z.x, y: z.y });
      }
    } else if (z.kind === "trap") {
      const near = Math.abs(h.x - z.x) < z.r + 8 && h.y - z.y > 0 && h.y - z.y < 118;
      if (z.state === "open" && z.t > 0.45) z.state = "armed";
      if (z.state === "armed" && near && h.cloakT <= 0) {
        z.state = "clap";
        z.t = 0;
        s.events.push({ type: "trap", x: z.x, y: z.y });
      } else if (z.state === "clap" && z.t > 0.14) {
        z.state = "closed";
        z.t = 0;
        if (near && hurtHero(s, z.damage, "a bread trap", z.x, z.y)) h.heldT = 0.35;
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
