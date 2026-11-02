/**
 * The hero: one-button web-swinging. Hold to shoot a web to the best anchor above and
 * ahead; while held, a rope constraint swings you as a pendulum; let go to fly. Releases
 * are graded (perfect, good) and the street is a miss.
 */
import {
  AIR_CONTROL,
  AIR_DRAG,
  ANCHOR_MIN,
  ANCHOR_MIN_RISE,
  ANCHOR_RANGE,
  EDGE_HOP,
  FIZZLE_COOLDOWN,
  GOOD_MIN_VY,
  GRAVITY,
  HERO_RADIUS,
  MAX_SPEED,
  MISS_BOUNCE,
  MISS_COOLDOWN,
  MISS_DAMAGE,
  MISS_DAMP,
  PERFECT_BOOST,
  PERFECT_MAX_ANGLE,
  PERFECT_MIN_ANGLE,
  PERFECT_MIN_SPEED,
  PERFECT_MIN_VY,
  ROPE_COMFORT,
  ROPE_MIN,
  ROPE_PUMP,
  ROPE_REEL,
  RUN_ACCEL,
  RUN_SPEED,
  STREET_Y,
} from "./constants";
import { anchorLowerBound, overWater } from "./world";
import type { Anchor, Hero, SimInput, SimState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;

export function newHero(x: number, y: number, grounded: boolean): Hero {
  return {
    x,
    y: grounded ? y + HERO_RADIUS : y,
    vx: 0,
    vy: 0,
    grounded,
    rope: null,
    facing: 1,
    angle: 0,
    spin: 0,
    squash: 0,
    missCd: 0,
    invuln: 0,
    fizzleCd: 0,
    shieldT: 0,
    cloakT: 0,
    dashT: 0,
    dashHit: false,
    slam: 0,
    finalityT: 0,
    forked: false,
    heldT: 0,
    hurtT: 0,
    holdPrev: false,
    idle: grounded,
  };
}

/** True while the hero is confined to an arena. */
export function inArena(s: SimState): boolean {
  return s.mode === "intro" || s.mode === "fight" || s.mode === "won" || s.mode === "ko";
}

/** Which way the hero wants to go: the route goes right, fights go wherever you're moving. */
export function heroFacing(s: SimState, steer: number): 1 | -1 {
  if (steer !== 0) return steer > 0 ? 1 : -1;
  if (!inArena(s)) return 1;
  const h = s.hero;
  if (Math.abs(h.vx) > 60) return h.vx > 0 ? 1 : -1;
  return h.facing;
}

/** The facing with no steering input, for previews (the renderer's target ring). */
export const heroFacingFor = (s: SimState) => heroFacing(s, 0);

/**
 * The best anchor for a web right now: within reach, above you, scored for being ahead,
 * up, and a comfortable rope length. Null when nothing is in reach.
 */
export function bestAnchor(s: SimState, facing: number): Anchor | null {
  const h = s.hero;
  const A = s.world.anchors;
  const zone = inArena(s) ? s.world.zones[s.index] : null;
  let best: Anchor | null = null;
  let bestScore = -Infinity;
  for (let i = anchorLowerBound(A, h.x - ANCHOR_RANGE); i < A.length && A[i].x <= h.x + ANCHOR_RANGE; i++) {
    const a = A[i];
    if (zone && (a.x < zone.x0 - 40 || a.x > zone.x1 + 40)) continue;
    const dx = a.x - h.x;
    const dy = a.y - h.y;
    if (dy < ANCHOR_MIN_RISE) continue;
    const d = Math.hypot(dx, dy);
    if (d > ANCHOR_RANGE || d < ANCHOR_MIN) continue;
    const ahead = dx * facing;
    const score = 1.25 * clamp(ahead / 300, -1, 1) + 0.7 * clamp(dy / 300, 0, 1.2) - 0.9 * (Math.abs(d - ROPE_COMFORT) / ROPE_COMFORT);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function attach(s: SimState, a: Anchor) {
  const h = s.hero;
  const d = Math.hypot(a.x - h.x, a.y - h.y);
  h.rope = { x: a.x, y: a.y, len: clamp(d, ROPE_MIN, ANCHOR_RANGE) };
  if (h.grounded) {
    h.grounded = false;
    h.vy = Math.max(h.vy, 260);
  }
  h.idle = false;
  s.events.push({ type: "thwip", x: h.x, y: h.y, ax: a.x, ay: a.y });
}

/** Let go of the web and grade the release. */
export function release(s: SimState, grade = true) {
  const h = s.hero;
  if (!h.rope) return;
  h.rope = null;
  if (!grade) return;
  const speed = Math.hypot(h.vx, h.vy);
  const forward = inArena(s) ? (h.vx >= 0 ? 1 : -1) : 1;
  const fx = h.vx * forward;
  const angle = Math.atan2(h.vy, Math.max(1e-6, fx)) * DEG;
  let result: "perfect" | "good" | null = null;
  if (h.vy > PERFECT_MIN_VY && speed > PERFECT_MIN_SPEED && fx > 100 && angle >= PERFECT_MIN_ANGLE && angle <= PERFECT_MAX_ANGLE) {
    result = "perfect";
    const boosted = Math.min(MAX_SPEED, speed * PERFECT_BOOST);
    h.vx *= boosted / speed;
    h.vy *= boosted / speed;
    s.combo += 1;
    s.tally.perfect += 1;
    s.total.perfect += 1;
    h.spin = 1;
    h.facing = forward as 1 | -1;
  } else if (h.vy > GOOD_MIN_VY) {
    result = "good";
    s.tally.good += 1;
    s.total.good += 1;
  }
  s.events.push({ type: "release", grade: result, x: h.x, y: h.y, combo: s.combo });
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** One fixed step of hero physics. */
export function stepHero(s: SimState, input: SimInput, dt: number) {
  const h = s.hero;
  const arena = inArena(s) ? s.world.zones[s.index] : null;
  const frozen = s.mode === "ko" || s.mode === "errand" || s.mode === "done";
  h.missCd = Math.max(0, h.missCd - dt);
  h.invuln = Math.max(0, h.invuln - dt);
  h.fizzleCd = Math.max(0, h.fizzleCd - dt);
  h.shieldT = Math.max(0, h.shieldT - dt);
  h.cloakT = Math.max(0, h.cloakT - dt);
  h.dashT = Math.max(0, h.dashT - dt);
  h.finalityT = Math.max(0, h.finalityT - dt);
  h.hurtT = Math.max(0, h.hurtT - dt);
  h.heldT = Math.max(0, h.heldT - dt);
  h.spin = Math.max(0, h.spin - dt * 1.9);
  h.squash = Math.max(0, h.squash - dt * 5);
  if (h.finalityT <= 0) h.finalityT = 0;

  const hold = input.hold && !frozen && h.heldT <= 0 && h.slam === 0;
  const facing = heroFacing(s, input.steer);

  // Webs: holding keeps trying until something is in reach.
  if (hold && !h.rope && h.fizzleCd <= 0) {
    const a = bestAnchor(s, facing);
    if (a) attach(s, a);
    else if (!h.holdPrev) {
      h.fizzleCd = FIZZLE_COOLDOWN;
      s.events.push({ type: "fizzle", x: h.x, y: h.y });
    }
  }
  if (!hold && h.rope) release(s, !frozen);
  h.holdPrev = input.hold;

  if (s.mode === "ko") {
    // Knocked out: drop and lie there.
    h.rope = null;
    if (!h.grounded) {
      h.vy -= GRAVITY * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.vx *= 1 - 1.5 * dt;
      landOnPlatforms(s, h.y - h.vy * dt, false);
      if (h.y - HERO_RADIUS <= STREET_Y) {
        h.y = STREET_Y + HERO_RADIUS;
        h.vy = 0;
        h.vx = 0;
        h.grounded = true;
      }
      if (arena) h.x = clamp(h.x, arena.x0 + HERO_RADIUS, arena.x1 - HERO_RADIUS);
    }
    h.angle += (wrapAngle(Math.PI / 2) - h.angle) * Math.min(1, dt * 6);
    return;
  }
  if (frozen) return;

  if (h.heldT > 0) {
    // Clapped in a bread trap: stuck for a moment.
    h.vx *= 0.8;
    h.vy = Math.max(0, h.vy * 0.8);
  }

  const prevY = h.y;
  if (h.grounded) {
    const fight = !!arena;
    if (input.steer !== 0) h.idle = false;
    const target = fight || h.idle ? input.steer * RUN_SPEED : input.steer < 0 ? -RUN_SPEED * 0.5 : input.steer > 0 ? RUN_SPEED * 1.25 : RUN_SPEED;
    const dv = target - h.vx;
    h.vx += clamp(dv, -RUN_ACCEL * dt, RUN_ACCEL * dt);
    h.vy = 0;
    if (Math.abs(h.vx) > 30) h.facing = h.vx > 0 ? 1 : -1;
  } else {
    h.vy -= GRAVITY * dt;
    if (h.slam > 0) h.vy = Math.min(h.vy, -1400);
    h.vx += input.steer * AIR_CONTROL * dt;
    h.vx *= 1 - AIR_DRAG * dt;
    h.vy *= 1 - AIR_DRAG * dt;
  }

  const r = h.rope;
  if (r) {
    const dx = h.x - r.x;
    const dy = h.y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    // Pump along the swing while below the anchor and moving, to keep swings lively.
    if (dy < 0) {
      let tx = -ny;
      let ty = nx;
      if (tx * h.vx + ty * h.vy < 0) {
        tx = -tx;
        ty = -ty;
      }
      const speed = Math.hypot(h.vx, h.vy);
      const forward = arena ? 1 : tx > 0 ? 1 : 0.35;
      if (speed > 40 && speed < 1250) {
        h.vx += tx * ROPE_PUMP * forward * dt;
        h.vy += ty * ROPE_PUMP * forward * dt;
      }
    }
    // Reel in toward a comfortable length, never so short that a swing can't build.
    if (r.len > ROPE_COMFORT * 0.8) r.len = Math.max(ROPE_COMFORT * 0.8, r.len - ROPE_REEL * dt);
  }

  h.x += h.vx * dt;
  h.y += h.vy * dt;

  if (r) {
    const dx = h.x - r.x;
    const dy = h.y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > r.len) {
      const nx = dx / d;
      const ny = dy / d;
      h.x = r.x + nx * r.len;
      h.y = r.y + ny * r.len;
      const vr = h.vx * nx + h.vy * ny;
      if (vr > 0) {
        h.vx -= vr * nx;
        h.vy -= vr * ny;
      }
      if (h.grounded && ny > -0.2) h.grounded = false;
    }
  }

  // Rooftops: one-way platforms.
  if (!h.grounded) landOnPlatforms(s, prevY, true);
  else if (!onPlatform(s)) {
    h.grounded = false;
    if (!r && h.vx * h.facing > 120) h.vy = EDGE_HOP;
  }

  // The street (or the river) is a miss.
  if (h.y - HERO_RADIUS <= STREET_Y) {
    h.y = STREET_Y + HERO_RADIUS;
    const water = overWater(s.world, h.x);
    if (h.slam > 0) {
      h.vy = 0;
      h.grounded = true;
    } else {
      if (h.missCd <= 0) {
        const damage = Math.min(MISS_DAMAGE, s.hp - 1);
        s.hp -= Math.max(0, damage);
        s.combo = 0;
        s.tally.miss += 1;
        s.total.miss += 1;
        h.missCd = MISS_COOLDOWN;
        s.events.push({ type: "miss", x: h.x, y: h.y, damage: Math.max(0, damage), water });
      }
      h.rope = null;
      h.grounded = false;
      h.vx *= MISS_DAMP;
      h.vy = MISS_BOUNCE;
    }
  }

  if (arena) {
    const lo = arena.x0 + HERO_RADIUS;
    const hi = arena.x1 - HERO_RADIUS;
    if (h.x < lo) {
      h.x = lo;
      if (h.vx < 0) h.vx = -h.vx * 0.45;
    } else if (h.x > hi) {
      h.x = hi;
      if (h.vx > 0) h.vx = -h.vx * 0.45;
    }
    if (h.y > 1020) {
      h.y = 1020;
      if (h.vy > 0) h.vy = 0;
    }
  }

  const speed = Math.hypot(h.vx, h.vy);
  if (speed > MAX_SPEED && h.slam === 0) {
    h.vx *= MAX_SPEED / speed;
    h.vy *= MAX_SPEED / speed;
  }

  // The sprite: head toward the anchor while swinging, a tilt in flight, upright on a roof.
  let target = 0;
  if (h.rope) target = Math.atan2(h.rope.x - h.x, h.rope.y - h.y);
  else if (!h.grounded) target = clamp(h.vx / 1400, -1, 1) * 0.55;
  if (!h.grounded && !h.rope && Math.abs(h.vx) > 40) h.facing = h.vx > 0 ? 1 : -1;
  h.angle = wrapAngle(h.angle + wrapAngle(target - h.angle) * Math.min(1, dt * 14));
}

function onPlatform(s: SimState): boolean {
  const h = s.hero;
  const foot = h.y - HERO_RADIUS;
  for (const p of s.world.platforms) {
    if (h.x >= p.x0 && h.x <= p.x1 && Math.abs(foot - p.y) < 2) return true;
  }
  return false;
}

/** Land on a roof when crossing its top from above. */
function landOnPlatforms(s: SimState, prevY: number, events: boolean) {
  const h = s.hero;
  if (h.vy > 0) return;
  const prevFoot = prevY - HERO_RADIUS;
  const foot = h.y - HERO_RADIUS;
  for (const p of s.world.platforms) {
    if (h.x < p.x0 || h.x > p.x1) continue;
    if (prevFoot >= p.y - 0.5 && foot < p.y) {
      const speed = Math.hypot(h.vx, h.vy);
      h.y = p.y + HERO_RADIUS;
      h.squash = Math.min(1, -h.vy / 1100);
      h.vy = 0;
      h.grounded = true;
      if (events) s.events.push({ type: "land", x: h.x, y: p.y, speed });
      return;
    }
  }
}
