/**
 * Knocked down by a car (roam-2, the move "knocked"): flung along the car's way and up, down
 * on the ground sliding to a stop, then up on his feet again. No damage and no fail: free roam
 * never hurts the hero. It always ends standing (or falling, off an edge), within KNOCK_MAX;
 * flung into the river it's a splash, and he climbs out on a bank as from any fall.
 *
 * The parkour set (sim3d/parkour) doesn't run while he's down: stepRoam steps this instead.
 * Deterministic: + − × ÷, Math.sqrt/ceil, a fixed order.
 */
import { collideSphere, overRiver, supported, type SphereHit } from "../city";
import { DT, GRAVITY, HERO_RADIUS, SUBSTEP_LEN } from "../constants";
import { clamp, len2, len3 } from "../dmath";
import type { SimState } from "../types";
import { KNOCK_BASE, KNOCK_DOWN, KNOCK_GETUP, KNOCK_IMMUNE, KNOCK_K, KNOCK_MAX, KNOCK_SIDE, KNOCK_UP, KNOCK_UP_K } from "./constants";
import type { RoamCar, RoamMove } from "./types";

const R = HERO_RADIUS;
/** Sliding along the ground once down. */
const SLIDE_DECEL = 1100;
/** A wall met while flung sends him back off it this fast, and keeps this share of the rest. */
const BOUNCE = 70;
const BOUNCE_KEEP = 0.55;
const hit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

/** Into a move (the parkour set's own bookkeeping, for a move it doesn't run). */
function enter(s: SimState, move: RoamMove) {
  const r = s.roam!;
  const b = r.body;
  const h = s.hero;
  if (b.move === move) return;
  r.events.push({ type: "roam-move", move, from: b.move, x: h.x, y: h.y, z: h.z, speed: len3(h.vx, h.vy, h.vz) });
  b.move = move;
  b.moveT = 0;
  h.grounded = move === "ground" || move === "roll";
  if (move !== "swing") {
    h.rope = null;
    h.latched = false;
  }
  if (move === "ground" || move === "roll") b.wallruns = 0;
}

/** A car (index `index`) met him at speed: flung along its way, off its line and up, facing back at it. */
export function knockDown(s: SimState, car: RoamCar, index: number): void {
  const r = s.roam!;
  const h = s.hero;
  const k = r.traffic.knock;
  // Which side of the car's line he's on: pushed off it that way.
  const side = -(h.x - car.x) * car.hz + (h.z - car.z) * car.hx;
  const sgn = side >= 0 ? 1 : -1;
  const out = KNOCK_K * car.v + KNOCK_BASE;
  h.vx = car.hx * out - car.hz * sgn * KNOCK_SIDE;
  h.vz = car.hz * out + car.hx * sgn * KNOCK_SIDE;
  h.vy = KNOCK_UP + KNOCK_UP_K * car.v;
  h.fx = -car.hx;
  h.fz = -car.hz;
  k.down = -1;
  k.dx = car.hx;
  k.dz = car.hz;
  k.immune = KNOCK_IMMUNE;
  r.events.push({ type: "roam-car-hit", speed: car.v, car: index, x: h.x, y: h.y, z: h.z });
  enter(s, "knocked");
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

/** Into the river: a splash (the parkour set climbs him out on the nearest bank the way he was going). */
function splash(s: SimState) {
  const r = s.roam!;
  const h = s.hero;
  const b = r.body;
  r.events.push({ type: "roam-splash", x: h.x, y: 0, z: h.z });
  b.ax = h.x;
  b.az = h.z;
  const hs = len2(h.vx, h.vz);
  b.ex = hs > 1 ? h.vx / hs : h.fx;
  b.ez = hs > 1 ? h.vz / hs : h.fz;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.y = R - 30;
  r.traffic.knock.down = -1;
  enter(s, "splash");
}

const standing = (s: SimState) => s.hero.y - R <= 0.5 || supported(s.grid, s.hero.x, s.hero.y, s.hero.z, R);

/** Back on his feet (or falling, if what he was on went from under him). */
function getUp(s: SimState) {
  const h = s.hero;
  s.roam!.traffic.knock.down = -1;
  if (standing(s)) {
    h.vx = 0;
    h.vz = 0;
    enter(s, "ground");
  } else enter(s, "air");
}

/** One tick of being knocked down. */
export function stepKnock(s: SimState): void {
  const r = s.roam!;
  const h = s.hero;
  const b = r.body;
  const k = r.traffic.knock;
  const dt = DT;
  b.moveT += dt;
  b.jumpBuf = 0;
  b.coyote += dt;
  b.grabCd = Math.max(0, b.grabCd - dt);
  b.zipCd = Math.max(0, b.zipCd - dt);
  b.leapCd = Math.max(0, b.leapCd - dt);
  b.launchT = 0;
  h.fizzleCd = Math.max(0, h.fizzleCd - dt);
  h.landT = Math.max(0, h.landT - dt);
  h.idle = false;
  h.climbing = false;
  if (b.moveT > KNOCK_MAX) return getUp(s);

  if (k.down < 0) {
    // Flung: a ballistic arc, off any wall it meets.
    const steps = clamp(Math.ceil((len3(h.vx, h.vy, h.vz) * dt) / SUBSTEP_LEN), 1, 4);
    const sdt = dt / steps;
    let bounced = false;
    for (let i = 0; i < steps; i++) {
      h.vy -= GRAVITY * sdt;
      const pvy = h.vy;
      h.x += h.vx * sdt;
      h.y += h.vy * sdt;
      h.z += h.vz * sdt;
      collideSphere(s.grid, h, R, hit);
      // Thrown into a corner of small boxes (a rail, a post): settle it out of all of them.
      if (hit.hit) {
        const wall = hit.wall;
        const nx = hit.wallNx;
        const nz = hit.wallNz;
        const top = hit.top;
        const topY = hit.topY;
        collideSphere(s.grid, h, R, hit);
        if (!hit.hit) {
          hit.wall = wall;
          hit.wallNx = nx;
          hit.wallNz = nz;
          hit.top = top;
          hit.topY = topY;
        }
      }
      if (hit.wall && !bounced) {
        bounced = true;
        h.vx = h.vx * BOUNCE_KEEP + hit.wallNx * BOUNCE;
        h.vz = h.vz * BOUNCE_KEEP + hit.wallNz * BOUNCE;
      }
      const feet = h.y - R;
      if ((hit.top && h.vy <= 0) || feet <= 0) {
        h.y = feet <= 0 ? R : hit.topY + R;
        s.events.push({ type: "land", x: h.x, y: h.y - R, z: h.z, speed: len3(h.vx, pvy, h.vz) });
        h.vy = 0;
        h.vx *= 0.7;
        h.vz *= 0.7;
        k.down = 0;
        if (h.y - R <= 0.5 && overRiver(s.city, h.x, h.z)) return splash(s);
        break;
      }
    }
    confine(s);
    return;
  }

  // Down: sliding to a stop on his back, then getting up.
  k.down += dt;
  const hs = len2(h.vx, h.vz);
  if (hs > 1e-9) {
    const f = Math.max(0, hs - SLIDE_DECEL * dt) / hs;
    h.vx *= f;
    h.vz *= f;
  }
  h.vy = 0;
  h.x += h.vx * dt;
  h.z += h.vz * dt;
  collideSphere(s.grid, h, R, hit);
  if (hit.top) h.y = Math.max(h.y, hit.topY + R);
  if (h.y - R < 0) h.y = R;
  confine(s);
  if (h.y - R <= 0.5 && overRiver(s.city, h.x, h.z)) return splash(s);
  if (!standing(s)) {
    // Slid off an edge: flung again, from here.
    k.down = -1;
    return;
  }
  if (k.down >= KNOCK_DOWN + KNOCK_GETUP) getUp(s);
}

/** What the scene draws for a knock: its phase, seconds into it, and the push's way. */
export function knockPhase(s: SimState): { phase: "flung" | "down" | "up"; t: number } | null {
  const r = s.roam;
  if (!r || r.body.move !== "knocked") return null;
  const k = r.traffic.knock;
  if (k.down < 0) return { phase: "flung", t: r.body.moveT };
  if (k.down < KNOCK_DOWN) return { phase: "down", t: k.down };
  return { phase: "up", t: k.down - KNOCK_DOWN };
}
