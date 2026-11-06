/**
 * The Right-Clicker, Case File 001's villain ("Saves everything. Owns nothing."): a hooded
 * screenshot thief with a giant cursor, on foot on the bridge deck, fought by ruleset 4's
 * grounded rules (strikes beside him, zips from range, knocks along the floor, mercy).
 *
 * He keeps a few steps off and circles; every 1.4–2 s (/ his rate) he does one of, in turn:
 * - SCREENSHOT: he aims (the cone, AIM_SECONDS, tracking you at AIM_TURN until the last
 *   AIM_LOCK), then flashes. In the cone (SHOT_HALF either side, out to SHOT_RANGE) you're
 *   SAVED: frozen SAVED_FREEZE, a little hurt and your combo broken. Sidestep out of it. After
 *   the flash he reloads, open (RECOVER_SECONDS): a blow gets through his guard.
 * - CTRL+C: two flat paper copies of you stand between you and him; each takes one blow (and
 *   pops) before anything reaches him.
 * - DRAG: a telegraphed lasso that pulls you DRAG_PULL toward him, and drops you with a small
 *   hit if it lands you beside him. A blow (or a zip) during it breaks it: he staggers, open.
 * A blow that lands during the aim or CTRL+C cancels it. Beaten (CHAPTER_HITS), he's webbed
 * where he stands, and during the rescue two copies come at you with paper cuts.
 *
 * Deterministic: dmath trig, the sim's roll(), + − × ÷ and Math.sqrt only.
 */
import { breakCombo } from "./pickups";
import { CHAPTER_HITS, CHAPTER_LEVEL, COPY_HALF_H, COPY_RADIUS, deckAxis, MAX_COPIES, spawnCopy } from "./chapter";
import { hurtHero, mercy, moveDamage } from "./combat";
import { DT, HERO_RADIUS } from "./constants";
import type { Zone } from "./contract";
import { clamp, datan2, dcos, dsin, len2, len3 } from "./dmath";
import { roll } from "./rng";
import type { SimState, SybilBody, Villain } from "./types";

const RC_RADIUS = 44;
/** On foot: walking speed (× his rate), acceleration and braking. */
const RC_SPEED = 200;
const RC_ACCEL = 1200;
const RC_BRAKE = 1700;
/** The gap he likes to keep, and more just after a hit. */
const RC_KEEP = 300;
const RC_KEEP_FLEE = 460;

/** SCREENSHOT: the cone's half-angle (radians) and reach, how far up or down it catches you. */
export const SHOT_HALF = 0.3;
export const SHOT_RANGE = 950;
const SHOT_RISE = 260;
const SHOT_COS = dcos(SHOT_HALF);
/** The aim (+ AIM_MERCY × mercy on early levels), the locked last part of it, and how fast it tracks you before then. */
export const AIM_SECONDS = 0.9;
const AIM_MERCY = 0.3;
export const AIM_LOCK = 0.35;
const AIM_TURN = 1.0;
const FLASH_SECONDS = 0.15;
/** Reloading after the flash: open. */
export const RECOVER_SECONDS = 1.2;
const RECOVER_MERCY = 0.2;
/** A blow that lands in an opening leaves at most this much of it (about one more blow). */
const OPENING_AFTER_HIT = 0.3;
/** SAVED: how long the hero is frozen. */
export const SAVED_FREEZE = 1.0;
/** CTRL+C's wind-up, and where the copies stand: this share of the way to you (at most COPY_ALONG), COPY_SIDE either side. */
const COPY_WIND = 0.6;
const COPY_SHARE = 0.45;
const COPY_ALONG = 240;
const COPY_SIDE = 75;
const COPY_SPEED = 300;
const COPY_ACCEL = 1100;
/** DRAG: wind-up (+ mercy), reach, the pull (how far, how long, how fast), the drop's reach, and the stagger when it breaks. */
export const DRAG_WIND = 0.8;
const DRAG_MERCY = 0.3;
export const DRAG_RANGE = 720;
export const DRAG_PULL = 200;
export const DRAG_TIME = 0.45;
/** A little over DRAG_PULL / DRAG_TIME: the ground's skid friction takes some of it. */
export const DRAG_SPEED = 475;
const DRAG_DROP = 150;
export const STAGGER_SECONDS = 1.0;
const STAGGER_MERCY = 0.3;
/** The rescue's copies: chase speed, the slap's wind-up, cooldown, reach and shove. */
const CHASE_SPEED = 190;
export const SLAP_WIND = 0.6;
export const SLAP_CD = 2.2;
const SLAP_REACH = 70;
const SLAP_SHOVE = 150;

/** His moves in turn (CTRL+C becomes a SCREENSHOT while copies stand, DRAG one when you're out of reach). */
const PATTERN = ["shot", "copy", "shot", "drag"] as const;

export function spawnRightClicker(s: SimState, zone: Zone): Villain {
  const h = s.hero;
  const c = zone.center;
  const floor = zone.stage?.y ?? c.y;
  const a = deckAxis(s.city);
  const rate = 1 + 0.08 * (CHAPTER_LEVEL - 1);
  // At the far end of the deck from you, walking in to a few steps off the middle.
  const side = (h.x - c.x) * a.x + (h.z - c.z) * a.z >= 0 ? -1 : 1;
  const x = c.x + a.x * side * 520;
  const z = c.z + a.z * side * 520;
  return {
    kind: "right-clicker",
    cast: "right-clicker",
    level: CHAPTER_LEVEL,
    boss: false,
    quest: false,
    x,
    y: floor + RC_RADIUS,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: RC_RADIUS,
    hits: CHAPTER_HITS,
    hitsMax: CHAPTER_HITS,
    invuln: 0,
    stun: 0,
    t: 0,
    phase: "enter",
    phaseT: 1.6,
    attackT: 1.6 / rate,
    // The hits he had at his last step (a landed blow shows as fewer).
    attack2T: CHAPTER_HITS,
    rate,
    grounded: true,
    dashToX: x,
    dashToZ: z,
    dashHit: false,
    arms: [],
    bodies: [],
    cx: c.x,
    cy: floor,
    cz: c.z,
    cycle: 0,
    home: { x: c.x + a.x * side * 300, y: floor + RC_RADIUS, z: c.z + a.z * side * 300 },
    ax: a.x,
    az: a.z,
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
}

/* ------------------------------------------------------------------ on foot */

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function stageBox(zone: Zone, inset: number): Box {
  const r = zone.stage ?? zone.bounds;
  return { x0: r.x0 + inset, z0: r.z0 + inset, x1: r.x1 - inset, z1: r.z1 - inset };
}

function keepIn(m: { x: number; z: number; vx: number; vz: number }, b: Box) {
  if (m.x < b.x0) {
    m.x = b.x0;
    if (m.vx < 0) m.vx = 0;
  } else if (m.x > b.x1) {
    m.x = b.x1;
    if (m.vx > 0) m.vx = 0;
  }
  if (m.z < b.z0) {
    m.z = b.z0;
    if (m.vz < 0) m.vz = 0;
  } else if (m.z > b.z1) {
    m.z = b.z1;
    if (m.vz > 0) m.vz = 0;
  }
}

/** Walk toward a wanted ground velocity (accelerating at `accel`, braking at `brake`), on the deck. */
export function walk(m: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, wx: number, wz: number, accel: number, brake: number, dt: number, box: Box, y: number) {
  const faster = len2(wx, wz) > len2(m.vx, m.vz);
  let ax = wx - m.vx;
  let az = wz - m.vz;
  const dv = len2(ax, az);
  const max = (faster ? accel : brake) * dt;
  if (dv > max) {
    ax *= max / dv;
    az *= max / dv;
  }
  m.vx += ax;
  m.vz += az;
  m.vy = 0;
  m.x += m.vx * dt;
  m.z += m.vz * dt;
  m.y = y;
  keepIn(m, box);
}

/** Toward (tx, tz), arriving: as fast as `speed`, slow enough to stop there. */
export function walkTo(m: SybilBody | Villain, tx: number, tz: number, speed: number, accel: number, dt: number, box: Box, y: number) {
  const dx = tx - m.x;
  const dz = tz - m.z;
  const d = len2(dx, dz);
  const k = d > 1e-9 ? Math.min(speed, Math.sqrt(1.6 * accel * d)) / d : 0;
  walk(m, dx * k, dz * k, accel, accel * 1.4, dt, box, y);
}

/** Turn the aim (unit xz) toward (dx, dz) by at most `max` radians. */
function turnAim(s: SimState, dx: number, dz: number, max: number) {
  const c = s.chapter!;
  const l = len2(dx, dz);
  if (l < 1e-9) return;
  const ux = dx / l;
  const uz = dz / l;
  const angle = datan2(c.aimX * uz - c.aimZ * ux, c.aimX * ux + c.aimZ * uz);
  if (angle <= max && angle >= -max) {
    c.aimX = ux;
    c.aimZ = uz;
    return;
  }
  const step = angle > 0 ? max : -max;
  const co = dcos(step);
  const sn = dsin(step);
  const nx = c.aimX * co - c.aimZ * sn;
  const nz = c.aimX * sn + c.aimZ * co;
  const n = len2(nx, nz) || 1;
  c.aimX = nx / n;
  c.aimZ = nz / n;
}

/** Whether the hero stands in the SCREENSHOT's cone right now. */
export function inShotCone(s: SimState, v: Villain): boolean {
  const c = s.chapter;
  if (!c) return false;
  const h = s.hero;
  const dx = h.x - v.x;
  const dz = h.z - v.z;
  const d = len2(dx, dz);
  if (d > SHOT_RANGE || h.y - v.y > SHOT_RISE || v.y - h.y > SHOT_RISE) return false;
  return d < 1 || dx * c.aimX + dz * c.aimZ >= SHOT_COS * d;
}

/** Seconds between his moves, before his rate. */
const gap = (s: SimState) => 1.0 + roll(s) * 0.6;

/* ------------------------------------------------------------------ the moves */

function flash(s: SimState, v: Villain) {
  const c = s.chapter!;
  const h = s.hero;
  let hit = false;
  if (inShotCone(s, v) && hurtHero(s, moveDamage(v, "Screenshot"), "a screenshot", v.x, v.y, v.z, 0, 0)) {
    hit = true;
    c.savedT = SAVED_FREEZE;
    h.heldT = Math.max(h.heldT, SAVED_FREEZE);
    breakCombo(s, "saved");
  }
  s.events.push({ type: "screenshot", hit, x: v.x, y: v.y, z: v.z });
  if (s.mode !== "fight") return;
  v.phase = "flash";
  v.phaseT = FLASH_SECONDS;
}

function copies(s: SimState, v: Villain, floor: number, box: Box) {
  const h = s.hero;
  const dx = h.x - v.x;
  const dz = h.z - v.z;
  const d = len2(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  const along = Math.min(d * COPY_SHARE, COPY_ALONG);
  for (const side of [-1, 1]) {
    const x = clamp(v.x + ux * along - uz * side * COPY_SIDE, box.x0, box.x1);
    const z = clamp(v.z + uz * along + ux * side * COPY_SIDE, box.z0, box.z1);
    spawnCopy(s, v, x, z, floor);
  }
}

function startMove(s: SimState, v: Villain, d: number) {
  const c = s.chapter!;
  const h = s.hero;
  let move: (typeof PATTERN)[number] = PATTERN[v.cycle % PATTERN.length];
  v.cycle += 1;
  if (move === "copy" && (v.bodies.some((b) => b.alive) || c.copies + 2 > MAX_COPIES)) move = "shot";
  if (move === "drag" && d > DRAG_RANGE) move = "shot";
  const m = mercy(v.level);
  if (move === "shot") {
    v.phase = "aim";
    v.phaseT = AIM_SECONDS + AIM_MERCY * m;
    const l = len2(h.x - v.x, h.z - v.z);
    if (l > 1) {
      c.aimX = (h.x - v.x) / l;
      c.aimZ = (h.z - v.z) / l;
    }
    s.events.push({ type: "villain-attack", label: "Screenshot", x: v.x, y: v.y, z: v.z });
  } else if (move === "copy") {
    v.phase = "copy";
    v.phaseT = COPY_WIND;
    s.events.push({ type: "villain-attack", label: "Ctrl+C", x: v.x, y: v.y, z: v.z });
  } else {
    v.phase = "drag";
    v.phaseT = DRAG_WIND + DRAG_MERCY * m;
    v.dashHit = false;
    s.events.push({ type: "villain-attack", label: "Drag", x: v.x, y: v.y, z: v.z });
  }
}

function toIdle(s: SimState, v: Villain, scale = 1) {
  v.phase = "idle";
  v.phaseT = 0;
  v.dashHit = false;
  v.attackT = (gap(s) * scale) / v.rate;
}

function breakDrag(s: SimState, v: Villain) {
  s.chapter!.dragT = 0;
  v.dashHit = false;
  v.phase = "stagger";
  v.phaseT = STAGGER_SECONDS + STAGGER_MERCY * mercy(v.level);
}

/* ------------------------------------------------------------------ the copies */

function stepCopies(s: SimState, v: Villain, dt: number, zone: Zone, floor: number) {
  const c = s.chapter!;
  const h = s.hero;
  const box = stageBox(zone, COPY_RADIUS);
  const y = floor + COPY_HALF_H;
  for (const b of v.bodies) {
    if (!b.alive) continue;
    const id = b.slot;
    if (c.phase !== "rescue") {
      // CTRL+C: stand in the way, between him and you.
      const dx = h.x - v.x;
      const dz = h.z - v.z;
      const d = len2(dx, dz) || 1;
      const ux = dx / d;
      const uz = dz / d;
      const side = id % 2 === 0 ? -1 : 1;
      const along = Math.min(d * COPY_SHARE, COPY_ALONG);
      walkTo(b, v.x + ux * along - uz * side * COPY_SIDE, v.z + uz * along + ux * side * COPY_SIDE, COPY_SPEED, COPY_ACCEL, dt, box, y);
      continue;
    }
    // The rescue: come at you, wind up, and slap.
    c.copyCd[id] = Math.max(0, c.copyCd[id] - dt);
    const reach = len3(h.x - b.x, h.y - b.y, h.z - b.z) - COPY_RADIUS - HERO_RADIUS;
    if (c.copyWind[id] > 0) {
      walk(b, 0, 0, COPY_ACCEL, COPY_ACCEL, dt, box, y);
      c.copyWind[id] = Math.max(0, c.copyWind[id] - dt);
      if (c.copyWind[id] === 0) {
        c.copyCd[id] = SLAP_CD;
        if (reach <= SLAP_REACH) hurtHero(s, moveDamage(v, "Paper cut"), "a paper cut", b.x, b.y, b.z, 0, SLAP_SHOVE);
      }
      continue;
    }
    const dx = h.x - b.x;
    const dz = h.z - b.z;
    const d = len2(dx, dz) || 1;
    // Up to you (body to body), then the wind-up when it's ready.
    const stop = COPY_RADIUS + HERO_RADIUS + 26;
    walkTo(b, h.x - (dx / d) * stop, h.z - (dz / d) * stop, CHASE_SPEED, COPY_ACCEL, dt, box, y);
    if (c.copyCd[id] <= 0 && reach <= 50) {
      c.copyWind[id] = SLAP_WIND;
      s.events.push({ type: "villain-attack", label: "Paper cut", x: b.x, y: b.y, z: b.z });
    }
  }
}

/* ------------------------------------------------------------------ the step */

/** One step of the Right-Clicker and his copies (stepVillain calls it in intro and fight). */
export function stepRightClicker(s: SimState, v: Villain, dt: number, zone: Zone) {
  const c = s.chapter;
  if (!c) return;
  const h = s.hero;
  const floor = zone.stage?.y ?? zone.center.y;
  const box = stageBox(zone, v.radius);
  const y = floor + v.radius;
  if (c.phase === "rescue" || c.phase === "done") {
    // Webbed where he stood; his copies do the work.
    walk(v, 0, 0, RC_BRAKE, RC_BRAKE, dt, box, y);
    stepCopies(s, v, dt, zone, floor);
    return;
  }
  if (v.phase === "enter") {
    walkTo(v, v.home.x, v.home.z, RC_SPEED, RC_ACCEL, dt, box, y);
    stepCopies(s, v, dt, zone, floor);
    return;
  }
  const dx = h.x - v.x;
  const dz = h.z - v.z;
  const d = len2(dx, dz) || 1;
  // A blow (or a zip into one) the hero started this tick.
  const punched = (h.strike > 0 && h.strike <= DT * 1.01) || (h.zip > 0 && h.zip <= DT * 1.01);
  // A blow that landed since last step (attack2T keeps the count he had): it cuts an opening short.
  if (v.hits < v.attack2T) {
    v.attack2T = v.hits;
    if (v.phase === "recover" || v.phase === "stagger") v.phaseT = Math.min(v.phaseT, OPENING_AFTER_HIT);
  }
  switch (v.phase) {
    case "aim":
      walk(v, 0, 0, RC_ACCEL, RC_BRAKE, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT > AIM_LOCK) turnAim(s, dx, dz, AIM_TURN * dt);
      if (v.phaseT <= 0) flash(s, v);
      break;
    case "flash":
      walk(v, 0, 0, RC_ACCEL, RC_BRAKE, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0) {
        v.phase = "recover";
        v.phaseT = RECOVER_SECONDS + RECOVER_MERCY * mercy(v.level);
      }
      break;
    case "recover":
      walk(v, 0, 0, RC_ACCEL, RC_BRAKE, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0) toIdle(s, v);
      break;
    case "copy":
      walk(v, 0, 0, RC_ACCEL, RC_BRAKE, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0) {
        copies(s, v, floor, stageBox(zone, COPY_RADIUS));
        toIdle(s, v);
      }
      break;
    case "drag":
      walk(v, 0, 0, RC_ACCEL, RC_BRAKE, dt, box, y);
      if (punched || (v.stun > 0 && !v.dashHit)) {
        breakDrag(s, v);
        break;
      }
      if (!v.dashHit) {
        v.phaseT -= dt;
        if (v.phaseT > 0) break;
        if (d > DRAG_RANGE || h.cloakT > 0 || s.mode !== "fight") {
          toIdle(s, v, 0.5);
          break;
        }
        // The lasso lands: a pull toward him, stopping short of his reach.
        const pull = Math.min(DRAG_PULL, Math.max(0, d - (v.radius + HERO_RADIUS + 40)));
        c.dragX = h.x - (dx / d) * pull;
        c.dragZ = h.z - (dz / d) * pull;
        c.dragT = pull > 1 ? DRAG_TIME : 0;
        v.dashHit = true;
        s.events.push({ type: "drag", from: { x: h.x, y: h.y, z: h.z }, to: { x: c.dragX, y: h.y, z: c.dragZ } });
        break;
      }
      if (c.dragT > 0) break;
      // Dropped beside him: a small hit.
      if (d <= DRAG_DROP) hurtHero(s, moveDamage(v, "Drag"), "drag and drop", v.x, v.y, v.z);
      if (s.mode === "fight") toIdle(s, v, 0.8);
      break;
    case "stagger":
      walk(v, 0, 0, RC_ACCEL, RC_BRAKE * 0.6, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0) toIdle(s, v, 0.7);
      break;
    default: {
      if (v.stun > 0) {
        walk(v, 0, 0, RC_ACCEL, RC_BRAKE * 0.6, dt, box, y);
        break;
      }
      // Keep a few steps off and circle; just hit, back off further.
      const keep = v.fleeT > 0 ? RC_KEEP_FLEE : RC_KEEP;
      const speed = RC_SPEED * v.rate * (v.fleeT > 0 ? 1.3 : 1);
      const ux = dx / d;
      const uz = dz / d;
      const radial = clamp((d - keep) * 2.5, -speed, speed);
      const circle = (v.cycle & 1 ? 1 : -1) * speed * 0.45;
      let wx = ux * radial - uz * circle;
      let wz = uz * radial + ux * circle;
      const w = len2(wx, wz);
      if (w > speed) {
        wx *= speed / w;
        wz *= speed / w;
      }
      walk(v, wx, wz, RC_ACCEL, RC_BRAKE, dt, box, y);
      v.attackT -= dt;
      if (v.attackT <= 0 && s.mode === "fight" && d <= SHOT_RANGE) startMove(s, v, d);
    }
  }
  stepCopies(s, v, dt, zone, floor);
}

/** Webbed after the win (the won beats): he slides to a stop where he stood. */
export function stepRightClickerWebbed(v: Villain, dt: number, zone: Zone) {
  const floor = zone.stage?.y ?? zone.center.y;
  walk(v, 0, 0, RC_BRAKE, RC_BRAKE, dt, stageBox(zone, v.radius), floor + v.radius);
}

/* ------------------------------------------------------------------ for the scene */

/** The render state word (contract.ts): idle, aim, flash, recover, copy, drag, stunned, webbed. */
export function rightClickerState(s: SimState, v: Villain): string {
  const c = s.chapter;
  if (s.mode === "won" || (c && (c.phase === "rescue" || c.phase === "done"))) return "webbed";
  // The aim is committed (a flinch doesn't stop it): it shows over a flinch.
  if (v.phase === "aim" || v.phase === "flash") return v.phase;
  if (v.stun > 0 || v.phase === "stagger") return "stunned";
  switch (v.phase) {
    case "recover":
    case "copy":
    case "drag":
      return v.phase;
    default:
      return "idle";
  }
}

/** The SCREENSHOT's cone while he aims or flashes (unit xz direction, half-angle), else null. */
export function rightClickerAim(s: SimState, v: Villain): { x: number; z: number; half: number } | null {
  const c = s.chapter;
  if (!c || s.mode !== "fight" || (v.phase !== "aim" && v.phase !== "flash")) return null;
  return { x: c.aimX, z: c.aimZ, half: SHOT_HALF };
}
