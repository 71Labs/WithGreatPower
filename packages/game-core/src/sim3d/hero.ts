/**
 * The hero in 3D: one-button web-swinging. Hold to shoot a web to the anchor nearest a
 * point ahead of and above you; while held, a rope constraint swings you on a sphere; let
 * go to fly. Releases are graded (perfect, good) and the street or the river is a miss.
 *
 * The heading never involves the camera: it is the stick's DIR64 direction when the stick
 * is tilted, else the bearing to the next stop (travel) or the villain (fights), else your
 * velocity. So a phone player can hold one thumb on the web and still go the right way.
 */
import {
  AIR_CONTROL,
  AIR_DRAG,
  ANCHOR_AHEAD,
  ANCHOR_MIN,
  ANCHOR_MIN_RISE,
  ANCHOR_RANGE,
  ANCHOR_UP,
  ARENA_ANCHOR_MARGIN,
  CLIMB_MAX_SPEED,
  CLIMB_MIN,
  CLIMB_PUSH,
  CLIMB_SPEED,
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
  PERFECT_MIN_SPEED,
  PERFECT_MIN_VY,
  ROPE_COMFORT,
  ROPE_MIN,
  ROPE_PUMP,
  ROPE_REEL,
  RUN_ACCEL,
  RUN_SPEED,
  STEP_UP,
  STREET_Y,
  SUBSTEP_SPEED,
  TAN16,
  TAN74,
} from "./constants";
import { collideSphere, findAnchor, lineClear, overRiver, supportAt, type AnchorPick, type SphereHit } from "./city";
import { nearestTarget } from "./combat";
import type { InputFrame, Vec3, Zone } from "./contract";
import { clamp, DIR64, len2, len3, MAG_SCALE } from "./dmath";
import type { Hero, SimState } from "./types";

/** A new hero. When grounded, `y` is the roof under the feet; otherwise it's the centre. */
export function newHero(x: number, y: number, z: number, grounded: boolean): Hero {
  return {
    x,
    y: grounded ? y + HERO_RADIUS : y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded,
    rope: null,
    fx: 1,
    fz: 0,
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

/** The arena the hero is confined to, if any. */
export function arenaZone(s: SimState): Zone | null {
  return inArena(s) ? (s.city.zones[s.index] ?? null) : null;
}

/** Where the route goes next: the arena's centre, or the ally. */
export function stopTarget(s: SimState): Vec3 | null {
  const z = s.city.zones[s.index];
  if (!z) return null;
  return z.kind === "errand" ? (z.allyAt ?? z.center) : z.center;
}

/** The unit xz direction toward the next stop, or null at the end of the route. */
export function travelBearing(s: SimState): { x: number; z: number } | null {
  const t = stopTarget(s);
  if (!t) return null;
  const dx = t.x - s.hero.x;
  const dz = t.z - s.hero.z;
  const d = len2(dx, dz);
  return d > 1 ? { x: dx / d, z: dz / d } : null;
}

/**
 * Which way the hero wants to go: the stick, else the next stop (travel) or the villain
 * (fights), else the velocity, else the facing. Always a unit xz vector.
 */
export function heroHeading(s: SimState, input: InputFrame): { x: number; z: number } {
  if (input.mag > 0) {
    const d = DIR64[input.dir];
    return { x: d[0], z: d[1] };
  }
  const h = s.hero;
  let tx = 0;
  let tz = 0;
  let has = false;
  if (inArena(s)) {
    const v = s.villain;
    if (v && (s.mode === "fight" || s.mode === "intro")) {
      const t = nearestTarget(s, h.x, h.y, h.z);
      tx = t ? t.x : v.x;
      tz = t ? t.z : v.z;
      has = true;
    }
  } else if (s.mode === "travel") {
    const t = stopTarget(s);
    if (t) {
      tx = t.x;
      tz = t.z;
      has = true;
    }
  }
  if (has) {
    const dx = tx - h.x;
    const dz = tz - h.z;
    const d = len2(dx, dz);
    if (d > 1) return { x: dx / d, z: dz / d };
  }
  const hs = len2(h.vx, h.vz);
  if (hs > 60) return { x: h.vx / hs, z: h.vz / hs };
  return { x: h.fx, z: h.fz };
}

/**
 * The anchor for a web right now, given a heading: the roof-edge point or prop anchor
 * nearest a spot ANCHOR_AHEAD along the heading and ANCHOR_UP above, among those in reach,
 * high enough, on a facade facing you, and inside the arena in fights. Null if none.
 */
export function bestAnchor(s: SimState, hx: number, hz: number): AnchorPick | null {
  const h = s.hero;
  const zone = arenaZone(s);
  const m = ARENA_ANCHOR_MARGIN;
  const area = zone ? { x0: zone.bounds.x0 - m, z0: zone.bounds.z0 - m, x1: zone.bounds.x1 + m, z1: zone.bounds.z1 + m } : null;
  return findAnchor(s.grid, h.x, h.y, h.z, h.x + hx * ANCHOR_AHEAD, h.y + ANCHOR_UP, h.z + hz * ANCHOR_AHEAD, area, ANCHOR_RANGE, ANCHOR_MIN, ANCHOR_MIN_RISE);
}

function attach(s: SimState, a: AnchorPick) {
  const h = s.hero;
  const d = len3(a.x - h.x, a.y - h.y, a.z - h.z);
  h.rope = { x: a.x, y: a.y, z: a.z, len: clamp(d, ROPE_MIN, ANCHOR_RANGE) };
  if (h.grounded) {
    h.grounded = false;
    h.vy = Math.max(h.vy, 260);
  }
  h.idle = false;
  s.events.push({ type: "thwip", x: h.x, y: h.y, z: h.z, ax: a.x, ay: a.y, az: a.z });
}

/**
 * Let go of the web and grade the release. Perfect: rising fast, between 16° and 74° above
 * horizontal, checked as TAN16·hs ≤ vy ≤ TAN74·hs on the horizontal speed hs (no atan2).
 */
export function release(s: SimState, grade = true) {
  const h = s.hero;
  if (!h.rope) return;
  h.rope = null;
  if (!grade) return;
  const speed = len3(h.vx, h.vy, h.vz);
  const hs = len2(h.vx, h.vz);
  let result: "perfect" | "good" | null = null;
  if (h.vy > PERFECT_MIN_VY && speed > PERFECT_MIN_SPEED && hs > 100 && h.vy >= hs * TAN16 && h.vy <= hs * TAN74) {
    result = "perfect";
    const boosted = Math.min(MAX_SPEED, speed * PERFECT_BOOST);
    const k = boosted / speed;
    h.vx *= k;
    h.vy *= k;
    h.vz *= k;
    s.combo += 1;
    if (s.combo > s.maxCombo) s.maxCombo = s.combo;
    s.tally.perfect += 1;
    s.total.perfect += 1;
    h.fx = h.vx / hs;
    h.fz = h.vz / hs;
  } else if (h.vy > GOOD_MIN_VY) {
    result = "good";
    s.tally.good += 1;
    s.total.good += 1;
  }
  s.events.push({ type: "release", grade: result, x: h.x, y: h.y, z: h.z, combo: s.combo });
}

const hit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

/** Keep the hero inside an arena (bouncing off its sides) or the city. */
function confine(s: SimState, arena: Zone | null) {
  const h = s.hero;
  const r = HERO_RADIUS;
  if (arena) {
    const b = arena.bounds;
    if (h.x < b.x0 + r) {
      h.x = b.x0 + r;
      if (h.vx < 0) h.vx = -h.vx * 0.45;
    } else if (h.x > b.x1 - r) {
      h.x = b.x1 - r;
      if (h.vx > 0) h.vx = -h.vx * 0.45;
    }
    if (h.z < b.z0 + r) {
      h.z = b.z0 + r;
      if (h.vz < 0) h.vz = -h.vz * 0.45;
    } else if (h.z > b.z1 - r) {
      h.z = b.z1 - r;
      if (h.vz > 0) h.vz = -h.vz * 0.45;
    }
    if (h.y > b.h) {
      h.y = b.h;
      if (h.vy > 0) h.vy = 0;
    }
    return;
  }
  const c = s.city.bounds;
  if (h.x < c.x0 + r) {
    h.x = c.x0 + r;
    if (h.vx < 0) h.vx = 0;
  } else if (h.x > c.x1 - r) {
    h.x = c.x1 - r;
    if (h.vx > 0) h.vx = 0;
  }
  if (h.z < c.z0 + r) {
    h.z = c.z0 + r;
    if (h.vz < 0) h.vz = 0;
  } else if (h.z > c.z1 - r) {
    h.z = c.z1 - r;
    if (h.vz > 0) h.vz = 0;
  }
}

/** Knocked out: drop and lie there. */
function stepKnockedOut(s: SimState, arena: Zone | null, dt: number) {
  const h = s.hero;
  h.rope = null;
  if (h.grounded) return;
  h.vy -= GRAVITY * dt;
  h.x += h.vx * dt;
  h.y += h.vy * dt;
  h.z += h.vz * dt;
  const damp = 1 - 1.5 * dt;
  h.vx *= damp;
  h.vz *= damp;
  collideSphere(s.grid, h, HERO_RADIUS, hit);
  if (hit.top && h.vy <= 0) {
    h.y = hit.topY + HERO_RADIUS;
    h.vy = 0;
    h.grounded = true;
  }
  if (h.y - HERO_RADIUS <= STREET_Y) {
    h.y = STREET_Y + HERO_RADIUS;
    h.vx = 0;
    h.vy = 0;
    h.vz = 0;
    h.grounded = true;
  }
  if (arena) confine(s, arena);
}

/** One fixed step of hero physics. */
export function stepHero(s: SimState, input: InputFrame, dt: number) {
  const h = s.hero;
  const arena = arenaZone(s);
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

  const hold = input.web && !frozen && h.heldT <= 0 && h.slam === 0;
  const head = heroHeading(s, input);

  // Webs: holding keeps trying until something is in reach.
  if (hold && !h.rope && h.fizzleCd <= 0) {
    const a = bestAnchor(s, head.x, head.z);
    if (a) attach(s, a);
    else if (!h.holdPrev) {
      h.fizzleCd = FIZZLE_COOLDOWN;
      s.events.push({ type: "fizzle", x: h.x, y: h.y, z: h.z });
    }
  }
  if (!hold && h.rope) release(s, !frozen);
  h.holdPrev = input.web;

  if (s.mode === "ko") {
    stepKnockedOut(s, arena, dt);
    return;
  }
  if (frozen) return;

  if (h.heldT > 0) {
    // Clapped in a bread trap: stuck for a moment.
    h.vx *= 0.8;
    h.vz *= 0.8;
    h.vy = Math.max(0, h.vy * 0.8);
  }

  const tilt = MAG_SCALE[input.mag];
  const sx = input.mag > 0 ? DIR64[input.dir][0] * tilt : 0;
  const sz = input.mag > 0 ? DIR64[input.dir][1] * tilt : 0;
  if (h.grounded) {
    if (input.mag > 0) h.idle = false;
    let speed: number;
    if (input.mag > 0) speed = arena ? RUN_SPEED * tilt : RUN_SPEED * (input.mag === 3 ? 1.25 : input.mag === 2 ? 1 : 0.6);
    else speed = arena || h.idle ? 0 : RUN_SPEED;
    let dvx = head.x * speed - h.vx;
    let dvz = head.z * speed - h.vz;
    const dv = len2(dvx, dvz);
    const max = RUN_ACCEL * dt;
    if (dv > max) {
      dvx *= max / dv;
      dvz *= max / dv;
    }
    h.vx += dvx;
    h.vz += dvz;
    h.vy = 0;
    const hs = len2(h.vx, h.vz);
    if (hs > 30) {
      h.fx = h.vx / hs;
      h.fz = h.vz / hs;
    }
  } else {
    h.vy -= GRAVITY * dt;
    if (h.slam > 0) h.vy = Math.min(h.vy, -1400);
    h.vx += sx * AIR_CONTROL * dt;
    h.vz += sz * AIR_CONTROL * dt;
    const drag = 1 - AIR_DRAG * dt;
    h.vx *= drag;
    h.vy *= drag;
    h.vz *= drag;
  }

  const r = h.rope;
  if (r) {
    const dx = h.x - r.x;
    const dy = h.y - r.y;
    const dz = h.z - r.z;
    const d = len3(dx, dy, dz) || 1;
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    // Pump along the swing while below the anchor and moving, to keep swings lively.
    if (dy < 0) {
      const vn = h.vx * nx + h.vy * ny + h.vz * nz;
      let tx = h.vx - vn * nx;
      let ty = h.vy - vn * ny;
      let tz = h.vz - vn * nz;
      const tl = len3(tx, ty, tz);
      const speed = len3(h.vx, h.vy, h.vz);
      if (tl > 1e-6 && speed > 40 && speed < 1250) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
        let forward = 1;
        if (!arena) {
          const b = travelBearing(s);
          if (b) forward = tx * b.x + tz * b.z > 0 ? 1 : 0.35;
        }
        h.vx += tx * ROPE_PUMP * forward * dt;
        h.vy += ty * ROPE_PUMP * forward * dt;
        h.vz += tz * ROPE_PUMP * forward * dt;
      }
    }
    // Reel in toward a comfortable length, never so short that a swing can't build.
    if (r.len > ROPE_COMFORT * 0.8) r.len = Math.max(ROPE_COMFORT * 0.8, r.len - ROPE_REEL * dt);
  }

  // Integrate; above SUBSTEP_SPEED in two halves so a wall can't be skipped.
  const wasGrounded = h.grounded;
  const steps = len3(h.vx, h.vy, h.vz) > SUBSTEP_SPEED ? 2 : 1;
  const sdt = dt / steps;
  let landed = false;
  let landY = 0;
  let landSpeed = 0;
  let touched = false;
  let wall = false;
  let wallNx = 0;
  let wallNz = 0;
  for (let i = 0; i < steps; i++) {
    h.x += h.vx * sdt;
    h.y += h.vy * sdt;
    h.z += h.vz * sdt;
    const rope = h.rope;
    if (rope) {
      const dx = h.x - rope.x;
      const dy = h.y - rope.y;
      const dz = h.z - rope.z;
      const d = len3(dx, dy, dz) || 1;
      if (d > rope.len) {
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;
        h.x = rope.x + nx * rope.len;
        h.y = rope.y + ny * rope.len;
        h.z = rope.z + nz * rope.len;
        const vr = h.vx * nx + h.vy * ny + h.vz * nz;
        if (vr > 0) {
          h.vx -= vr * nx;
          h.vy -= vr * ny;
          h.vz -= vr * nz;
        }
        if (h.grounded && ny > -0.2) h.grounded = false;
      }
    }
    // Boxes: land on a top face, slide along anything else.
    const before = len3(h.vx, h.vy, h.vz);
    collideSphere(s.grid, h, HERO_RADIUS, hit);
    if (hit.hit) touched = true;
    // Running into a ledge a little higher than the roof you're on: step up onto it.
    if (h.grounded && hit.wall && hit.wallTop > h.y - HERO_RADIUS && hit.wallTop - (h.y - HERO_RADIUS) <= STEP_UP) {
      h.y = hit.wallTop + HERO_RADIUS;
      h.vy = 0;
      continue;
    }
    if (hit.wall) {
      wall = true;
      wallNx = hit.wallNx;
      wallNz = hit.wallNz;
    }
    if (hit.top && h.vy <= 0) {
      if (!h.grounded && !wasGrounded) {
        landed = true;
        landY = hit.topY;
        landSpeed = before;
      }
      h.grounded = true;
      h.y = hit.topY + HERO_RADIUS;
      h.vy = 0;
    }
  }
  // A web can't pass through a building: pressed against one with the line blocked, it snaps.
  if (touched && h.rope && !lineClear(s.grid, h.x, h.y, h.z, h.rope.x, h.rope.y, h.rope.z)) release(s, false);
  // Climbing: stuck against a wall on a web that goes up, reel in fast; level with it, mantle over.
  const rp = h.rope;
  if (rp && wall && rp.y - h.y > 0 && len3(h.vx, h.vy, h.vz) < CLIMB_MAX_SPEED) {
    rp.len = Math.max(CLIMB_MIN, rp.len - CLIMB_SPEED * dt);
    if (h.vy < 0) h.vy = 0;
    if (rp.y - h.y < 2 * CLIMB_MIN) {
      release(s, false);
      h.vy = EDGE_HOP;
      h.vx -= wallNx * CLIMB_PUSH;
      h.vz -= wallNz * CLIMB_PUSH;
      h.grounded = false;
    }
  }
  if (landed) s.events.push({ type: "land", x: h.x, y: landY, z: h.z, speed: landSpeed });
  else if (wasGrounded && h.grounded && !supportAt(s.grid, h.x, h.y - HERO_RADIUS, h.z)) {
    // Ran off a roof: a little hop if running forward, so a run flows into a swing.
    h.grounded = false;
    if (!h.rope && h.vx * h.fx + h.vz * h.fz > 120) h.vy = EDGE_HOP;
  }

  // The street (or the river) is a miss.
  if (h.y - HERO_RADIUS <= STREET_Y) {
    h.y = STREET_Y + HERO_RADIUS;
    const water = overRiver(s.city, h.x, h.z);
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
        s.events.push({ type: "miss", x: h.x, y: h.y, z: h.z, damage: Math.max(0, damage), water });
      }
      h.rope = null;
      h.grounded = false;
      h.vx *= MISS_DAMP;
      h.vz *= MISS_DAMP;
      h.vy = MISS_BOUNCE;
    }
  }

  confine(s, arena);

  const speed = len3(h.vx, h.vy, h.vz);
  if (speed > MAX_SPEED && h.slam === 0) {
    const k = MAX_SPEED / speed;
    h.vx *= k;
    h.vy *= k;
    h.vz *= k;
  }

  if (!h.grounded && !h.rope) {
    const hs = len2(h.vx, h.vz);
    if (hs > 40) {
      h.fx = h.vx / hs;
      h.fz = h.vz / hs;
    }
  }
}
