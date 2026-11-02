/**
 * The hero in 3D: one-button web-swinging. Hold to shoot a web to an anchor ahead (swing.ts
 * picks it by predicting the swing); while held, an exact rope constraint swings you; let go
 * to fly. Releases are graded (perfect, good) and the street or the river is a miss.
 *
 * The heading never involves the camera: it is the stick's DIR64 direction when the stick
 * is tilted, else the bearing to the next stop (travel) or the villain (fights), else your
 * velocity. So a phone player can hold one thumb on the web and still go the right way.
 *
 * Ruleset v2 physics: quadratic air drag with a terminal speed; air control that only builds
 * speed up to a limit; the rope's tension does no work (only the pump adds energy); running
 * with an acceleration curve and grip; landings that lose speed to friction and crouch;
 * small ledges stepped up smoothly; wall climbing as a state (no jitter) with a ballistic
 * mantle; a body that turns at a limited rate; substeps short enough that nothing tunnels.
 */
import {
  CLIMB_ACCEL,
  CLIMB_LOSE,
  CLIMB_MAX_SPEED,
  CLIMB_PUSH,
  CLIMB_SLIDE,
  CLIMB_SPEED,
  EDGE_HOP,
  FIZZLE_COOLDOWN,
  GOOD_MIN_VY,
  GRAVITY,
  HERO_RADIUS,
  HERO_TURN,
  LAND_FRICTION,
  LAND_STOP,
  MANTLE_CLEAR,
  MAX_SPEED,
  MISS_BOUNCE,
  MISS_COOLDOWN,
  MISS_DAMAGE,
  MISS_DAMP,
  OVERSPEED_DECEL,
  PERFECT_BOOST,
  ROPE_MIN,
  ANCHOR_RANGE_FAR,
  RUN_ACCEL,
  RUN_ACCEL_TOP,
  RUN_BRAKE,
  RUN_SPEED,
  STEP_UP,
  STREET_Y,
  SUBSTEP_LEN,
} from "./constants";
import { collideSphere, overRiver, supported, type AnchorPick, type SphereHit } from "./city";
import { nearestTarget } from "./combat";
import type { InputFrame, Vec3, Zone } from "./contract";
import { clamp, datan2, dcos, DIR64, dsin, len2, len3, MAG_SCALE } from "./dmath";
import { ATTACH_HOP, flightStep, inReleaseWindow, pickAnchor, wrapRope, type FlightInput } from "./swing";
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
    climbing: false,
    wallNx: 0,
    wallNz: 0,
    wallTop: 0,
    wallT: 0,
    side: 0,
    landT: 0,
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
 * The anchor a web would take right now for heading (hx, hz): on a roof edge, a wall face or a
 * prop, ahead within 45° of the heading, chosen by predicting each candidate's swing
 * (swing.ts). Null if nothing fits: the web fizzles.
 */
export function bestAnchor(s: SimState, hx: number, hz: number): AnchorPick | null {
  return pickAnchor(s, hx, hz);
}

function attach(s: SimState, a: AnchorPick, hx: number, hz: number) {
  const h = s.hero;
  const d = len3(a.x - h.x, a.y - h.y, a.z - h.z);
  h.rope = { x: a.x, y: a.y, z: a.z, len: clamp(d, ROPE_MIN, ANCHOR_RANGE_FAR) };
  if (h.grounded) {
    h.grounded = false;
    h.vy = Math.max(h.vy, ATTACH_HOP);
  }
  h.idle = false;
  h.climbing = false;
  h.landT = 0;
  const lat = -(a.x - h.x) * hz + (a.z - h.z) * hx;
  h.side = lat > 30 ? 1 : lat < -30 ? -1 : 0;
  s.events.push({ type: "thwip", x: h.x, y: h.y, z: h.z, ax: a.x, ay: a.y, az: a.z });
}

/**
 * Let go of the web and grade the release; the velocity carries on as it was. Perfect:
 * rising fast at 20–60° above horizontal (swing.ts inReleaseWindow, where the anchor choice
 * plans each swing to release), which adds PERFECT_BOOST.
 */
export function release(s: SimState, grade = true) {
  const h = s.hero;
  h.climbing = false;
  if (!h.rope) return;
  h.rope = null;
  if (!grade) return;
  const speed = len3(h.vx, h.vy, h.vz);
  let result: "perfect" | "good" | null = null;
  if (inReleaseWindow(h.vx, h.vy, h.vz)) {
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

const NO_INPUT: FlightInput = { hx: 1, hz: 0, bias: false, sx: 0, sz: 0, pump: false };

/** Slow the horizontal velocity at `decel` (friction), never past a stop. */
function friction(h: Hero, decel: number, dt: number) {
  const hs = len2(h.vx, h.vz);
  if (hs <= 1e-9) return;
  const k = Math.max(0, hs - decel * dt) / hs;
  h.vx *= k;
  h.vz *= k;
}

/** Knocked out: fall under gravity and drag, slide to a stop with friction, drop off edges. */
function stepKnockedOut(s: SimState, arena: Zone | null, dt: number) {
  const h = s.hero;
  h.rope = null;
  h.climbing = false;
  if (h.grounded) {
    friction(h, RUN_BRAKE * 0.6, dt);
    h.vy = 0;
    h.x += h.vx * dt;
    h.z += h.vz * dt;
    collideSphere(s.grid, h, HERO_RADIUS, hit);
    if (h.y - HERO_RADIUS > STREET_Y + 1 && !supported(s.grid, h.x, h.y, h.z, HERO_RADIUS)) h.grounded = false;
  } else {
    const vyBefore = h.vy;
    flightStep(h, null, dt, NO_INPUT);
    collideSphere(s.grid, h, HERO_RADIUS, hit);
    if (hit.top && h.vy <= 0) {
      h.y = hit.topY + HERO_RADIUS;
      h.vy = 0;
      h.grounded = true;
      friction(h, (Math.max(0, -vyBefore) * LAND_FRICTION) / dt, dt);
    }
  }
  if (h.y - HERO_RADIUS <= STREET_Y) {
    h.y = STREET_Y + HERO_RADIUS;
    if (!h.grounded) friction(h, (Math.max(0, -h.vy) * LAND_FRICTION) / dt, dt);
    h.vy = 0;
    h.grounded = true;
  }
  if (arena) confine(s, arena);
}

/** Turn the facing toward (wx, wz) at most HERO_TURN·dt radians. */
function turnFacing(h: Hero, wx: number, wz: number, dt: number) {
  const wl = len2(wx, wz);
  if (wl < 1e-9) return;
  const ux = wx / wl;
  const uz = wz / wl;
  const angle = datan2(h.fx * uz - h.fz * ux, h.fx * ux + h.fz * uz);
  const max = HERO_TURN * dt;
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

/** Running on a roof: push along the heading on an easing curve, brake and grip at RUN_BRAKE. */
function run(h: Hero, hx: number, hz: number, target: number, dt: number) {
  const along = h.vx * hx + h.vz * hz;
  const side = -h.vx * hz + h.vz * hx;
  let a = along;
  if (a < target) {
    if (h.landT > 0) {
      // Crouched after a landing: no push.
    } else if (a < 0) a = Math.min(target, a + RUN_BRAKE * dt);
    else {
      const push = RUN_ACCEL * (1 - (1 - RUN_ACCEL_TOP) * Math.min(1, a / Math.max(1, target)));
      a = Math.min(target, a + push * dt);
    }
  } else if (a > target) a = Math.max(target, a - RUN_BRAKE * dt);
  const sd = side > 0 ? Math.max(0, side - RUN_BRAKE * dt) : Math.min(0, side + RUN_BRAKE * dt);
  h.vx = hx * a - hz * sd;
  h.vz = hz * a + hx * sd;
}

/** How fast a small ledge is stepped up, units a second (smooth, never a pop). */
const STEP_RATE = 900;

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
  h.landT = Math.max(0, h.landT - dt);

  const hold = input.web && !frozen && h.heldT <= 0 && h.slam === 0;
  const head = heroHeading(s, input);

  // Webs: holding keeps trying until something is in reach; nothing in reach is a fizzle, never a hit.
  if (hold && !h.rope && h.fizzleCd <= 0) {
    const a = pickAnchor(s, head.x, head.z);
    if (a) attach(s, a, head.x, head.z);
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
    // Clapped in a bread trap: stuck for a moment (a strong drag, not a stop).
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
    run(h, head.x, head.z, speed, dt);
    h.vy = 0;
  }

  const wasGrounded = h.grounded;
  let landed = false;
  let landY = 0;
  let landSpeed = 0;
  let touched = false;
  let wall = false;
  let wallNx = 0;
  let wallNz = 0;
  let wallTop = 0;
  let stepping = false;

  if (h.climbing && h.rope) {
    stepClimb(s, dt);
  } else {
    h.climbing = false;
    const fin: FlightInput = { hx: head.x, hz: head.z, bias: !arena, sx, sz, pump: true };
    // Short substeps (at most SUBSTEP_LEN each), so no wall or roof can be skipped.
    const steps = clamp(Math.ceil((len3(h.vx, h.vy, h.vz) * dt) / SUBSTEP_LEN), 1, 4);
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const preVx = h.vx;
      const preVz = h.vz;
      if (h.grounded) {
        h.x += h.vx * sdt;
        h.z += h.vz * sdt;
        // On a web from a roof: once the rope goes taut it lifts you off. Standing on a roof you
        // take up the slack (down to ROPE_MIN), so running off the edge swings on the line you
        // hold, not on one long enough to reach the street. A slack line does no work: energy is unchanged.
        const rope = h.rope;
        if (rope) {
          const dx = h.x - rope.x;
          const dy = h.y - rope.y;
          const dz = h.z - rope.z;
          const d = len3(dx, dy, dz);
          if (d > rope.len && dy < 0) h.grounded = false;
          else if (d < rope.len) rope.len = Math.max(d, Math.min(rope.len, ROPE_MIN));
        }
      } else {
        flightStep(h, h.rope, sdt, fin);
        if (h.slam > 0) h.vy = Math.min(h.vy, -1400);
      }
      // Boxes: land on a top face, slide along anything else.
      const vyBefore = h.vy;
      const before = len3(h.vx, h.vy, h.vz);
      collideSphere(s.grid, h, HERO_RADIUS, hit);
      if (hit.hit) touched = true;
      // Running into a ledge a little higher than the roof you're on: step up it, smoothly.
      const feet = h.y - HERO_RADIUS;
      if (h.grounded && hit.wall && hit.wallTop > feet && hit.wallTop - feet <= STEP_UP) {
        h.y += Math.min(hit.wallTop - feet + 0.5, STEP_RATE * sdt);
        h.vx = preVx;
        h.vz = preVz;
        stepping = true;
        continue;
      }
      if (hit.wall) {
        wall = true;
        wallNx = hit.wallNx;
        wallNz = hit.wallNz;
        wallTop = hit.wallTop;
      }
      if (hit.top && h.vy <= 0) {
        if (!h.grounded && !wasGrounded) {
          landed = true;
          landY = hit.topY;
          landSpeed = before;
          // The landing's friction impulse, and a crouch for a hard one.
          const impact = vyBefore < 0 ? -vyBefore : 0;
          friction(h, (impact * LAND_FRICTION) / sdt, sdt);
          h.landT = Math.max(h.landT, LAND_STOP * Math.min(1, impact / 1500));
        }
        h.grounded = true;
        h.y = hit.topY + HERO_RADIUS;
        h.vy = 0;
      }
    }
  }
  // A web can't pass through a building: pressed against one with the line cut, it wraps round
  // the corner it catches on, if that corner is above you (v2), or snaps (v1 always snapped).
  if (touched && h.rope && !h.climbing && !wrapRope(s.grid, h, h.rope)) release(s, false);
  // Stuck against a wall on a web that goes up (slow, and not sliding along it): climb it.
  const rp = h.rope;
  const vnw = h.vx * wallNx + h.vz * wallNz;
  const slide = len2(h.vx - vnw * wallNx, h.vz - vnw * wallNz);
  if (rp && wall && !h.climbing && !h.grounded && rp.y - h.y > HERO_RADIUS && len3(h.vx, h.vy, h.vz) < CLIMB_MAX_SPEED && slide < CLIMB_SLIDE) {
    h.climbing = true;
    h.wallNx = wallNx;
    h.wallNz = wallNz;
    h.wallTop = wallTop;
    h.wallT = 0;
    // A web below the top of this wall re-sticks to its roof edge straight above, so the line leads up.
    if (rp.y < wallTop - 1) {
      rp.x = h.x - wallNx * HERO_RADIUS;
      rp.y = wallTop;
      rp.z = h.z - wallNz * HERO_RADIUS;
      rp.len = len3(rp.x - h.x, rp.y - h.y, rp.z - h.z);
      s.events.push({ type: "thwip", x: h.x, y: h.y, z: h.z, ax: rp.x, ay: rp.y, az: rp.z });
    }
  }
  if (landed) s.events.push({ type: "land", x: h.x, y: landY, z: h.z, speed: landSpeed });
  else if (wasGrounded && h.grounded && !stepping && !supported(s.grid, h.x, h.y, h.z, HERO_RADIUS)) {
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
      h.climbing = false;
      h.grounded = false;
      h.vx *= MISS_DAMP;
      h.vz *= MISS_DAMP;
      h.vy = MISS_BOUNCE;
    }
  }

  confine(s, arena);

  // Over the soft limit (a boosted release, a dash): bleed it off rather than clamp.
  const speed = len3(h.vx, h.vy, h.vz);
  if (speed > MAX_SPEED && h.slam === 0 && h.dashT <= 0) {
    const k = Math.max(MAX_SPEED, speed - OVERSPEED_DECEL * dt) / speed;
    h.vx *= k;
    h.vy *= k;
    h.vz *= k;
  }

  // Face where you're going, turning at a limited rate (on a wall, face it).
  if (h.climbing) turnFacing(h, -h.wallNx, -h.wallNz, dt);
  else {
    const hs = len2(h.vx, h.vz);
    if (hs > (h.grounded ? 30 : 40)) turnFacing(h, h.vx, h.vz, dt);
  }
}

/**
 * Climbing: up the wall, accelerating to CLIMB_SPEED, sliding to rest along it, held against
 * it; at the top, a mantle onto the roof on a ballistic hop that clears the edge.
 */
function stepClimb(s: SimState, dt: number) {
  const h = s.hero;
  const rope = h.rope!;
  h.wallT += dt;
  h.vy += clamp(CLIMB_SPEED - h.vy, -CLIMB_ACCEL * dt, CLIMB_ACCEL * dt);
  const nx = h.wallNx;
  const nz = h.wallNz;
  const vn = h.vx * nx + h.vz * nz;
  let tx = h.vx - vn * nx;
  let tz = h.vz - vn * nz;
  const tl = len2(tx, tz);
  if (tl > 1e-9) {
    const k = Math.max(0, tl - CLIMB_ACCEL * dt) / tl;
    tx *= k;
    tz *= k;
  }
  // A light press into the wall keeps the contact.
  h.vx = tx - nx * 40;
  h.vz = tz - nz * 40;
  h.x += h.vx * dt;
  h.y += h.vy * dt;
  h.z += h.vz * dt;
  collideSphere(s.grid, h, HERO_RADIUS, hit);
  if (hit.wall) {
    h.wallT = 0;
    h.wallNx = hit.wallNx;
    h.wallNz = hit.wallNz;
    h.wallTop = Math.max(h.wallTop, hit.wallTop);
  }
  rope.len = Math.max(1, len3(rope.x - h.x, rope.y - h.y, rope.z - h.z));
  if (hit.top) {
    // Up onto a ledge.
    h.climbing = false;
    h.grounded = true;
    h.y = hit.topY + HERO_RADIUS;
    h.vy = 0;
    release(s, false);
    return;
  }
  if (h.y - HERO_RADIUS >= h.wallTop - 4) {
    // The mantle: a hop that clears the edge by MANTLE_CLEAR, pushed in over the roof.
    release(s, false);
    const need = Math.max(4, h.wallTop + HERO_RADIUS + MANTLE_CLEAR - h.y);
    h.vy = Math.sqrt(2 * GRAVITY * need);
    h.vx = -nx * CLIMB_PUSH;
    h.vz = -nz * CLIMB_PUSH;
    h.grounded = false;
    return;
  }
  if (h.wallT > CLIMB_LOSE) h.climbing = false;
}
