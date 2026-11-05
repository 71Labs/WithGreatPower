/**
 * Case File 003's signature: the rooftop chase. Gas Goblin rips the fee meter off its roof and
 * flees on his glider along his route (fee-strike.ts buildRoute), most of the way round the
 * Market District and out to Aunt Mainnet's bakery, lobbing fee bombs back at you. The hero
 * keeps up by running, climbing and swinging (sim mode "travel": the hero's every move, nothing
 * of a fight's); the sim's rules make it tense but fair:
 *
 * - Catch-up: his speed follows the gap. Right on his tail he bolts (CHASE_FAST); at an easy
 *   distance he cruises (CHASE_BASE); further back he slows (CHASE_SLOW) and, well behind,
 *   only drifts (CHASE_CRAWL), looking back to jeer. A first-timer is never simply outrun.
 * - The escape meter: it fills while the hero is more than ESCAPE_GAP behind (ESCAPE_SECONDS,
 *   longer on the early levels) and drains once he's back within SAFE_GAP. Full, he's lost.
 * - Checkpoints: every route point on a roof the hero keeps up past (his progress along the
 *   route). Lost, the hero is put back on the last one's roof and Gas Goblin waits at the next
 *   point (HOLD_SECONDS, or until the hero closes in), the escape meter empty. MAX_LOSSES
 *   losses and he's gone with the meter: the night ends uncleared.
 * - Fee bombs: every BOMB_GAP or so while the hero is in range, lobbed to land where he's
 *   heading in BOMB_FLIGHT (a partial lead, a little scatter). A hit hurts a little, burns
 *   fluid and knocks the swing out of you; it never knocks you out (the chase keeps you at 1).
 * Node sense slows him and his bombs, as it slows every villain.
 *
 * He is `state.villain` through the chase, though no fight's rules reach him (they all need
 * mode "fight"): no strikes, no contact, no targets. At the bakery he plants the meter on the
 * roof and circles over it until the hero lands there; the fight then starts from where he is.
 *
 * Deterministic: dmath trig, the sim's roll(), + − × ÷ and Math.sqrt only.
 */
import { mercy } from "./combat";
import { DT, GRAVITY, HERO_RADIUS, HURT_AIR_VY, HURT_INVULN, HURT_STAGGER, MERCY_DAMAGE, MERCY_GUARD, SLOWMO_FACTOR, STREET_Y } from "./constants";
import type { Zone } from "./contract";
import { clamp, datan2, dcos, dsin, len2, len3 } from "./dmath";
import { groundBelow } from "./city";
import { meterPlant } from "./fee-strike";
import { roll } from "./rng";
import type { FeeState, SimState, Villain } from "./types";
import { leapVelocity, spawnVillain, steer } from "./villains";

/** His speed by the gap (see the file comment), units a second. */
export const CHASE_FAST = 600;
export const CHASE_BASE = 400;
export const CHASE_SLOW = 200;
export const CHASE_CRAWL = 60;
/** The gaps the speed bands change at. */
const GAP_TAIL = 280;
const GAP_EASY = 650;
const GAP_BACK = 1000;
const GAP_FAR = 1350;
const GAP_GONE = 1500;
/** His glider's steering. */
const CHASE_ACCEL = 900;
/** Through a route point within this; corners are rounded off over the last CORNER of a leg. */
const WAYPOINT_REACH = 120;
const CORNER = 260;
/** The escape meter: fills beyond ESCAPE_GAP over ESCAPE_SECONDS (+ ESCAPE_MERCY × mercy), drains inside SAFE_GAP over DRAIN_SECONDS. */
export const ESCAPE_GAP = 1250;
export const SAFE_GAP = 1000;
export const ESCAPE_SECONDS = 5;
const ESCAPE_MERCY = 1.5;
const DRAIN_SECONDS = 3;
/** After a loss he waits this long at his route point, or until the hero is within HOLD_RELEASE. */
export const HOLD_SECONDS = 2.5;
const HOLD_RELEASE = 650;
/** He's gone for good after this many losses. */
export const MAX_LOSSES = 5;
/** Progress only counts within this of the route's line. */
const ROUTE_SIDE = 900;
/** Fee bombs: the first after the grab, then every BOMB_GAP (+ up to BOMB_SPREAD, / his rate), in range only. */
const BOMB_FIRST = 1.8;
export const BOMB_GAP = 1.9;
const BOMB_SPREAD = 0.8;
const BOMB_MIN = 200;
const BOMB_MAX = 1250;
/** Lobbed to land BOMB_FLIGHT (+ mercy) later where the hero's heading, BOMB_LEAD of the way, give or take BOMB_SCATTER. */
export const BOMB_FLIGHT = 1.0;
const BOMB_FLIGHT_MERCY = 0.15;
const BOMB_LEAD = 0.9;
const BOMB_SCATTER = 60;
/** A chase bomb's hit: damage (before mercy), fluid burned, the blast's reach, and the knock. */
export const CHASE_BOMB_DAMAGE = 9;
const CHASE_BOMB_BURN = 10;
const BOMB_BLAST = 80;
/** A bomb bursts as it passes this close to him (its fuse), centre to body. */
const BOMB_FUSE = 75;
const CHASE_SHOVE = 200;
/** The throw's pose (render "throw"). */
const THROW_SECONDS = 0.35;
/** The meter hangs this far under him while he carries it. */
export const METER_HANG = 58;
/** Perched over the meter, before the grab: this high over its base. */
const PERCH_UP = 150;
/** Circling Aunt Mainnet's roof before the fight: over the floor (his fight cruise), and the loop. */
const SHOWDOWN_UP = 290;

/** His speed for a gap (the catch-up rule). */
export function chaseSpeed(gap: number): number {
  if (gap <= GAP_TAIL) return CHASE_FAST;
  if (gap <= GAP_EASY) return CHASE_FAST + ((CHASE_BASE - CHASE_FAST) * (gap - GAP_TAIL)) / (GAP_EASY - GAP_TAIL);
  if (gap <= GAP_BACK) return CHASE_BASE + ((CHASE_SLOW - CHASE_BASE) * (gap - GAP_EASY)) / (GAP_BACK - GAP_EASY);
  if (gap <= GAP_FAR) return CHASE_SLOW + ((CHASE_CRAWL - CHASE_SLOW) * (gap - GAP_BACK)) / (GAP_FAR - GAP_BACK);
  if (gap <= GAP_GONE) return (CHASE_CRAWL * (GAP_GONE - gap)) / (GAP_GONE - GAP_FAR);
  return 0;
}

/** The horizontal gap between the hero and him. */
export function chaseGap(s: SimState): number {
  const v = s.villain;
  return v ? len2(s.hero.x - v.x, s.hero.z - v.z) : 0;
}

/* ------------------------------------------------------------------ him */

/** Gas Goblin as the chase has him: tonight's fight villain (spawnVillain, the stop's), moved to (x, y, z) and still. */
export function chaseGoblin(s: SimState, x: number, y: number, z: number): Villain {
  const v = spawnVillain(s, s.city.zones[0]);
  v.x = x;
  v.y = y;
  v.z = z;
  v.vx = 0;
  v.vy = 0;
  v.vz = 0;
  v.phase = "idle";
  v.phaseT = 0;
  v.bank = 0;
  return v;
}

/** Fly toward the wanted velocity (wx, wy, wz), banking into the turn as his glider does. */
function fly(v: Villain, wx: number, wy: number, wz: number, accel: number, dt: number) {
  const vx = v.vx;
  const vz = v.vz;
  steer(v, wx, wy, wz, accel, dt);
  const hs = len2(v.vx, v.vz);
  const lat = hs > 1 && dt > 0 ? (((v.vx - vx) / dt) * -v.vz + ((v.vz - vz) / dt) * v.vx) / hs : 0;
  v.bank += (datan2(lat, GRAVITY) - v.bank) * Math.min(1, 8 * dt);
}

/** Toward (tx, ty, tz) at up to `speed`, arriving. */
function flyTo(v: Villain, tx: number, ty: number, tz: number, speed: number, dt: number) {
  const dx = tx - v.x;
  const dy = ty - v.y;
  const dz = tz - v.z;
  const d = len3(dx, dy, dz);
  const k = d > 1e-9 ? Math.min(speed, Math.sqrt(1.6 * CHASE_ACCEL * d)) / d : 0;
  fly(v, dx * k, dy * k, dz * k, CHASE_ACCEL, dt);
}

/** Perched over the meter, bobbing, until the hero comes for it. */
export function stepPerch(s: SimState) {
  const f = s.fee!;
  const v = s.villain;
  if (!v) return;
  v.t += DT;
  const m = f.meter;
  flyTo(v, m.x + 30 * dsin(0.9 * v.t), m.y + PERCH_UP + 12 * dsin(2.1 * v.t), m.z + 20 * dcos(0.9 * v.t), 320, DT);
}

/* ------------------------------------------------------------------ the route */

/** The hero's progress along the route (units from the meter), from the legs between his checkpoint and Gas Goblin; null off the line. */
function routeProgress(f: FeeState, x: number, z: number): number | null {
  const r = f.route;
  let best: number | null = null;
  let bestSide = ROUTE_SIDE;
  const from = Math.max(0, f.checkpoint - 1);
  const to = Math.min(r.length - 1, f.next);
  for (let i = from; i < to; i++) {
    const a = r[i];
    const b = r[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1) continue;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
    const side = len2(a.x + dx * t - x, a.z + dz * t - z);
    if (side < bestSide) {
      bestSide = side;
      best = a.at + (b.at - a.at) * t;
    }
  }
  return best;
}

/** Progress, and the checkpoints it passes (route points on a roof, short of the bakery). */
function stepProgress(s: SimState) {
  const f = s.fee!;
  const h = s.hero;
  const p = routeProgress(f, h.x, h.z);
  if (p !== null && p > f.progress) f.progress = p;
  const r = f.route;
  for (let i = f.checkpoint + 1; i < r.length - 1 && i < f.next && r[i].at <= f.progress; i++) {
    if (!r[i].roof) continue;
    f.checkpoint = i;
    s.events.push({ type: "chase-checkpoint", index: i, of: r.length - 2, x: r[i].rx, y: r[i].ry, z: r[i].rz });
  }
}

/* ------------------------------------------------------------------ fee bombs */

/** Hurt the hero in the chase (travel): as combat.ts hurtHero, but it never knocks him out and keeps half his swing. */
export function chaseHurt(s: SimState, damage: number, source: string, fromX: number, fromY: number, fromZ: number, burn: number): boolean {
  const h = s.hero;
  if (damage <= 0 || h.invuln > 0 || h.dashT > 0) return false;
  if (h.cloakT > 0) {
    s.events.push({ type: "dodge", x: h.x, y: h.y, z: h.z });
    h.invuln = 0.4;
    return false;
  }
  if (h.shieldT > 0) {
    h.shieldT = 0;
    h.invuln = 0.6;
    s.events.push({ type: "shield-pop", x: h.x, y: h.y, z: h.z });
    return false;
  }
  const m = s.villain ? mercy(s.villain.level) : 0;
  const dmg = Math.max(1, Math.round(damage * (1 - MERCY_DAMAGE * m)));
  s.hp = Math.max(1, s.hp - dmg);
  s.fluid = Math.max(0, s.fluid - burn);
  h.invuln = HURT_INVULN + MERCY_GUARD * m;
  h.hurtT = 0.35;
  h.climbing = false;
  let dx = h.x - fromX;
  let dz = h.z - fromZ;
  const d = len2(dx, dz);
  if (d > 1) {
    dx /= d;
    dz /= d;
  } else {
    dx = -h.fx;
    dz = -h.fz;
  }
  h.vx = h.vx * 0.5 + dx * CHASE_SHOVE;
  h.vz = h.vz * 0.5 + dz * CHASE_SHOVE;
  if (!h.grounded) h.vy = Math.min(h.vy, HURT_AIR_VY);
  h.landT = Math.max(h.landT, HURT_STAGGER);
  s.events.push({ type: "hero-hurt", x: h.x, y: h.y, z: h.z, damage: dmg, source, hp: s.hp });
  return true;
}

/** A fee bomb lobbed back at where the hero's heading (further back, a longer lob). */
function throwBomb(s: SimState, v: Villain, gap: number) {
  const h = s.hero;
  const m = mercy(v.level);
  const t = clamp(BOMB_FLIGHT * (0.8 + gap / 1500), 0.9, 1.5) + BOMB_FLIGHT_MERCY * m;
  const g = bombGravity(s);
  const tx = h.x + h.vx * t * BOMB_LEAD + (roll(s) - 0.5) * 2 * BOMB_SCATTER;
  const tz = h.z + h.vz * t * BOMB_LEAD + (roll(s) - 0.5) * 2 * BOMB_SCATTER;
  const ty = Math.max(groundBelow(s.grid, tx, tz, h.y + 60), h.y - 40);
  const from = { x: v.x, y: v.y - 34, z: v.z };
  const l = leapVelocity(from.x, from.y, from.z, tx, ty, tz, t, g);
  s.hazards.push({ kind: "bomb", x: from.x, y: from.y, z: from.z, vx: l.vx, vy: l.vy, vz: l.vz, r: 17, t: 0, damage: CHASE_BOMB_DAMAGE, burn: CHASE_BOMB_BURN, big: false, state: "open", dead: false });
  s.events.push({ type: "villain-attack", label: "Fee bomb", x: v.x, y: v.y, z: v.z });
  v.phase = "telegraph";
  v.phaseT = THROW_SECONDS;
}

/** Fee bombs fall as a fight's do (a little slower on the early levels). */
const bombGravity = (s: SimState) => 900 * (1 - 0.3 * (s.villain ? mercy(s.villain.level) : 0));

/** The chase's bombs: they fall, burst on whatever they hit, and hurt within the blast. */
export function stepChaseBombs(s: SimState, dt: number) {
  const h = s.hero;
  const g = bombGravity(s);
  for (const z of s.hazards) {
    if (z.dead || z.kind !== "bomb") continue;
    z.t += dt;
    z.vy -= g * dt;
    z.x += z.vx * dt;
    z.y += z.vy * dt;
    z.z += z.vz * dt;
    const hitHero = len3(h.x - z.x, h.y - z.y, h.z - z.z) < BOMB_FUSE + HERO_RADIUS;
    const ground = groundBelow(s.grid, z.x, z.z, z.y + z.r);
    if (hitHero || z.y - z.r <= ground || z.t > 4) {
      z.dead = true;
      const y = Math.max(z.y, ground + z.r);
      s.events.push({ type: "blast", x: z.x, y, z: z.z, r: BOMB_BLAST, kind: "bomb" });
      if (hitHero || len3(h.x - z.x, h.y - y, h.z - z.z) < BOMB_BLAST + HERO_RADIUS * 0.5) chaseHurt(s, z.damage, "a fee bomb", z.x, y, z.z, z.burn);
    }
  }
  if (s.hazards.some((z) => z.dead)) s.hazards = s.hazards.filter((z) => !z.dead);
}

/* ------------------------------------------------------------------ the chase */

/** The grab: he takes the meter and goes. */
export function startChase(s: SimState) {
  const f = s.fee!;
  const v = s.villain!;
  f.phase = "chase";
  f.meter.carried = true;
  f.next = 1;
  f.checkpoint = 0;
  f.progress = 0;
  f.escape = 0;
  f.bombT = BOMB_FIRST;
  f.chaseT = 0;
  v.phase = "idle";
  s.events.push({ type: "meter-grab", x: f.meter.x, y: f.meter.y, z: f.meter.z });
}

/** Stand the hero on a roof at (x, y, z) (feet), still, facing (fx, fz). */
function placeHero(s: SimState, x: number, y: number, z: number, fx: number, fz: number) {
  const h = s.hero;
  h.x = x;
  h.y = y + HERO_RADIUS;
  h.z = z;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.grounded = y > STREET_Y;
  h.rope = null;
  h.climbing = false;
  h.latched = false;
  h.rewebWait = false;
  h.webBuf = 0;
  h.landT = 0;
  h.hurtT = 0;
  h.heldT = 0;
  h.slam = 0;
  h.strike = -1;
  h.zip = -1;
  const l = len2(fx, fz);
  if (l > 1e-6) {
    h.fx = fx / l;
    h.fz = fz / l;
  }
}

/** Lost him: back to the last checkpoint, or (MAX_LOSSES) he's gone and the night ends. */
function lose(s: SimState) {
  const f = s.fee!;
  const v = s.villain!;
  f.losses += 1;
  s.hazards.length = 0;
  if (f.losses >= MAX_LOSSES) {
    s.events.push({ type: "chase-escaped", losses: f.losses });
    s.mode = "done";
    s.events.push({ type: "night-over", reason: "route" });
    return;
  }
  const r = f.route;
  let cp = f.checkpoint;
  while (cp > 0 && !r[cp].roof) cp -= 1;
  const at = r[cp];
  const ahead = r[Math.min(r.length - 1, cp + 1)];
  placeHero(s, at.rx, at.ry, at.rz, ahead.x - at.rx, ahead.z - at.rz);
  // He waits at the next point, jeering, with the meter.
  v.x = ahead.x;
  v.y = ahead.y;
  v.z = ahead.z;
  v.vx = 0;
  v.vy = 0;
  v.vz = 0;
  v.bank = 0;
  v.phase = "idle";
  f.next = Math.min(r.length - 1, cp + 1);
  f.checkpoint = cp;
  f.progress = at.at;
  f.escape = 0;
  f.holdT = HOLD_SECONDS;
  f.bombT = BOMB_FIRST;
  s.events.push({ type: "chase-lost", losses: f.losses, checkpoint: cp, x: at.rx, y: at.ry, z: at.rz });
}

/** One step of the chase (travel): his flight, the escape meter, checkpoints, bombs, the meter under him. */
export function stepChase(s: SimState) {
  const f = s.fee!;
  const v = s.villain;
  if (!v || f.phase !== "chase") return;
  const vdt = DT * (s.slowmo > 0 ? SLOWMO_FACTOR : 1);
  f.chaseT += DT;
  v.t += vdt;
  stepProgress(s);
  const gap = chaseGap(s);
  // The escape meter.
  if (f.holdT <= 0 && gap > ESCAPE_GAP) {
    f.escape = Math.min(1, f.escape + DT / (ESCAPE_SECONDS + ESCAPE_MERCY * mercy(v.level)));
    if (f.escape >= 1) {
      lose(s);
      return;
    }
  } else if (gap < SAFE_GAP) f.escape = Math.max(0, f.escape - DT / DRAIN_SECONDS);

  const r = f.route;
  const to = r[f.next];
  if (f.holdT > 0) {
    // Waiting at his point after a loss: hover, until the hero's on his way or the wait's up.
    f.holdT = gap < HOLD_RELEASE ? 0 : Math.max(0, f.holdT - DT);
    flyTo(v, to.x + 24 * dsin(1.3 * v.t), to.y + 10 * dsin(2.2 * v.t), to.z + 24 * dcos(1.3 * v.t), 200, vdt);
  } else {
    const speed = chaseSpeed(gap);
    let dx = to.x - v.x;
    let dy = to.y - v.y;
    let dz = to.z - v.z;
    const d = len3(dx, dy, dz) || 1;
    dx /= d;
    dy /= d;
    dz /= d;
    // Round the corner onto the next leg.
    const after = r[f.next + 1];
    if (after && d < CORNER) {
      const w = 1 - d / CORNER;
      let ax = after.x - to.x;
      let ay = after.y - to.y;
      let az = after.z - to.z;
      const al = len3(ax, ay, az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      dx += (ax - dx) * w;
      dy += (ay - dy) * w;
      dz += (az - dz) * w;
      const l = len3(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
    }
    const last = f.next === r.length - 1;
    const k = last ? Math.min(speed, Math.sqrt(1.6 * CHASE_ACCEL * d)) : speed;
    fly(v, dx * k, dy * k, dz * k, CHASE_ACCEL, vdt);
    // Past the point (or through it): on to the next.
    const pass = after && (v.x - to.x) * (after.x - to.x) + (v.z - to.z) * (after.z - to.z) > 0 && len2(v.x - to.x, v.z - to.z) < CORNER;
    if (len3(v.x - to.x, v.y - to.y, v.z - to.z) < WAYPOINT_REACH || pass) {
      if (last) {
        endChase(s);
        return;
      }
      f.next += 1;
    }
  }
  // The throw's pose wears off.
  if (v.phase === "telegraph") {
    v.phaseT -= vdt;
    if (v.phaseT <= 0) v.phase = "idle";
  }
  // Fee bombs, back over his shoulder.
  f.bombT -= vdt;
  if (f.bombT <= 0) {
    if (f.holdT <= 0 && gap > BOMB_MIN && gap < BOMB_MAX) {
      throwBomb(s, v, gap);
      f.bombT = (BOMB_GAP + roll(s) * BOMB_SPREAD) / v.rate;
    } else f.bombT = 0.4;
  }
  stepChaseBombs(s, vdt);
  const m = f.meter;
  m.x = v.x;
  m.y = v.y - METER_HANG;
  m.z = v.z;
}

/** At the bakery: he plants the meter on the roof and circles over it, waiting for the fight. */
function endChase(s: SimState) {
  const f = s.fee!;
  const p = meterPlant(s.city);
  f.phase = "showdown";
  f.meter.carried = false;
  f.meter.x = p.x;
  f.meter.y = p.y;
  f.meter.z = p.z;
  f.escape = 0;
  f.holdT = 0;
  s.hazards.length = 0;
  if (s.villain) s.villain.phase = "idle";
  s.events.push({ type: "chase-end", x: p.x, y: p.y, z: p.z });
}

/** Circling Aunt Mainnet's roof (the fight's own loop) until the hero lands there. */
export function stepShowdown(s: SimState, zone: Zone) {
  const v = s.villain;
  if (!v) return;
  v.t += DT;
  const st = zone.stage;
  const cx = st ? (st.x0 + st.x1) / 2 : zone.center.x;
  const cz = st ? (st.z0 + st.z1) / 2 : zone.center.z;
  const floor = st?.y ?? zone.center.y;
  const t = v.t;
  flyTo(v, cx + 190 * dsin(0.55 * t), floor + SHOWDOWN_UP + 50 * dsin(1.1 * t + 1.2), cz + 150 * dsin(1.1 * t), 320, DT);
}
