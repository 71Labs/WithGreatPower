/**
 * v4: the web button in a fight. Ruleset 3 only swung, so the only free hit was a slam at
 * SLAM_SPEED and fights were fought in the air. Now, in a fight:
 *
 * - A villain body in reach (constants.ts STRIKE_*): a press is a strike, a step in and a blow
 *   (the hero's jab or cross). It respects his guard and Doc's arms like any direct hit.
 * - Further out, in plain sight and no higher than a low flyer: a web-zip, the web pulling you
 *   at him (along the roof when he's down there) into a strike.
 * - Out of reach: the web as ever, a swing.
 *
 * A blow that lands knocks him back along the roof and flinches him; nobody is launched.
 */
import { HERO_RADIUS, STRIKE_CD, STRIKE_FLINCH, STRIKE_HIT_FROM, STRIKE_HIT_TO, STRIKE_KNOCK, STRIKE_LUNGE, STRIKE_REACH, STRIKE_RISE, STRIKE_STEP, STRIKE_TIME, ZIP_CD, ZIP_RANGE, ZIP_RISE, ZIP_SPEED, ZIP_TIME } from "./constants";
import { raycastCity } from "./city";
import { hitVillain, villainTargets, type Target } from "./combat";
import { len2, len3 } from "./dmath";
import type { Hero, SimState } from "./types";
import { knockVillain } from "./villains";

/**
 * What a press of the web would do in a fight right now: strike or zip at a target; "wait"
 * (nothing: a cooldown, or `high`, he's over your head out of reach); or "web", a swing.
 */
export type FightPress = { kind: "strike" | "zip"; target: Target } | { kind: "wait"; high: boolean } | { kind: "web" };

/** The gap between the hero's body and a target's (centre distance less both radii). */
const gapTo = (h: Hero, t: Target) => len3(t.x - h.x, t.y - h.y, t.z - h.z) - t.r - HERO_RADIUS;

/** Whether the line from the hero to a target is clear of buildings. */
function inSight(s: SimState, t: Target): boolean {
  const h = s.hero;
  const dx = t.x - h.x;
  const dy = t.y - h.y;
  const dz = t.z - h.z;
  const d = len3(dx, dy, dz);
  if (d < 1) return true;
  return !raycastCity(s.grid, h.x, h.y, h.z, dx / d, dy / d, dz / d, Math.max(0, d - t.r));
}

/**
 * The web button's meaning in a fight: a strike at the nearest body in reach, a zip at the
 * nearest in zip range. With a body within ZIP_RANGE across the roof the web never swings: a
 * press waits out a cooldown, and does nothing at a flyer over your head (`high`). Only
 * further out is it a swing.
 */
export function fightPress(s: SimState): FightPress {
  const h = s.hero;
  const v = s.villain;
  if (s.mode !== "fight" || !v || h.rope) return { kind: "web" };
  let strike: Target | null = null;
  let strikeGap = Infinity;
  let zip: Target | null = null;
  let zipD = Infinity;
  let near = false;
  for (const t of villainTargets(v)) {
    const rise = t.y - h.y;
    const gap = gapTo(h, t);
    if (gap <= STRIKE_STEP && rise <= STRIKE_RISE && rise >= -STRIKE_RISE) {
      if (gap < strikeGap) {
        strikeGap = gap;
        strike = t;
      }
      continue;
    }
    if (len2(t.x - h.x, t.z - h.z) > ZIP_RANGE) continue;
    near = true;
    const d = len3(t.x - h.x, rise, t.z - h.z);
    if (d <= ZIP_RANGE && rise <= ZIP_RISE && d < zipD && inSight(s, t)) {
      zipD = d;
      zip = t;
    }
  }
  if (strike) return h.strikeCd <= 0 && h.strike < 0 ? { kind: "strike", target: strike } : { kind: "wait", high: false };
  if (zip) return h.zipCd <= 0 && h.strikeCd <= 0 && h.zip < 0 && h.strike < 0 ? { kind: "zip", target: zip } : { kind: "wait", high: false };
  return near ? { kind: "wait", high: true } : { kind: "web" };
}

/** Throw a blow at `t` (the step in and the swing of the arm; it connects in stepStrike). */
export function startStrike(s: SimState, t: Target, zipped: boolean) {
  const h = s.hero;
  h.strike = 0;
  h.zip = -1;
  h.strikeBody = t.body;
  h.strikeDone = false;
  h.zipped = zipped;
  h.strikeCd = STRIKE_CD;
  h.landT = 0;
  s.events.push({ type: "strike", x: h.x, y: h.y, z: h.z, zip: zipped });
}

export function startZip(s: SimState, t: Target) {
  const h = s.hero;
  h.zip = 0;
  h.strike = -1;
  h.strikeBody = t.body;
  h.strikeDone = false;
  h.zipCd = ZIP_CD;
  h.landT = 0;
  s.events.push({ type: "zip", x: h.x, y: h.y, z: h.z, tx: t.x, ty: t.y, tz: t.z });
}

/** The body a strike or zip is aimed at, if it's still there (a popped copy hands over to the nearest). */
function aimed(s: SimState): Target | null {
  const v = s.villain;
  if (!v || s.mode !== "fight") return null;
  const h = s.hero;
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of villainTargets(v)) {
    if (t.body === h.strikeBody) return t;
    const d = len3(t.x - h.x, t.y - h.y, t.z - h.z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * Before the physics step: a zip pulls the hero at his target (straight at it; along the roof
 * when it's at roof height), handing over to a strike in reach or at ZIP_TIME; a strike steps
 * in at up to STRIKE_LUNGE and lands its blow once. Returns true while either is running
 * (the stick doesn't run you then).
 */
export function stepStrike(s: SimState, dt: number): boolean {
  const h = s.hero;
  h.strikeCd = Math.max(0, h.strikeCd - dt);
  h.zipCd = Math.max(0, h.zipCd - dt);
  if (h.zip < 0 && h.strike < 0) return false;
  const t = aimed(s);
  if (!t) {
    h.zip = -1;
    h.strike = -1;
    return false;
  }
  const dx = t.x - h.x;
  const dy = t.y - h.y;
  const dz = t.z - h.z;
  const hd = len2(dx, dz);
  const gap = len3(dx, dy, dz) - t.r - HERO_RADIUS;
  if (h.zip >= 0) {
    h.zip += dt;
    if (gap <= STRIKE_REACH * 0.75 || h.zip >= ZIP_TIME) {
      startStrike(s, t, true);
    } else {
      const d = len3(dx, dy, dz) || 1;
      // Up to a low flyer (out of a strike's reach from the roof): straight at him. Else along the roof.
      const up = dy > STRIKE_RISE || !h.grounded;
      if (up) {
        const k = ZIP_SPEED / d;
        h.vx = dx * k;
        h.vy = dy * k;
        h.vz = dz * k;
        h.grounded = false;
      } else {
        const k = ZIP_SPEED / Math.max(1, hd);
        h.vx = dx * k;
        h.vz = dz * k;
      }
      return true;
    }
  }
  h.strike += dt;
  if (h.strike <= STRIKE_HIT_TO) {
    // The step in: toward him, slowing to stop at the reach.
    const want = Math.max(0, gap - STRIKE_REACH * 0.5);
    const speed = Math.min(STRIKE_LUNGE, want / Math.max(dt, STRIKE_HIT_TO - h.strike + dt));
    const k = hd > 1 ? speed / hd : 0;
    h.vx = dx * k;
    h.vz = dz * k;
    // A blow in the air hangs a moment rather than dropping out from under itself.
    if (!h.grounded && h.vy < 0) h.vy *= 0.6;
  } else if (h.grounded) {
    // Follow-through: the step bleeds off.
    h.vx *= 0.75;
    h.vz *= 0.75;
  }
  if (!h.strikeDone && h.strike >= STRIKE_HIT_FROM && h.strike <= STRIKE_HIT_TO && gap <= STRIKE_REACH) {
    h.strikeDone = true;
    const v = s.villain!;
    const landed = hitVillain(s, t.body, 1, "strike");
    // hitVillain may end the fight (and the villain stays for the webbed beat).
    if (s.villain === v && s.mode === "fight") {
      const nx = hd > 1 ? dx / hd : h.fx;
      const nz = hd > 1 ? dz / hd : h.fz;
      knockVillain(v, t.body, nx, 0, nz, STRIKE_KNOCK * (landed ? 1 : 0.35));
      if (landed) v.stun = Math.max(v.stun, STRIKE_FLINCH);
    }
  }
  if (h.strike >= STRIKE_TIME) h.strike = -1;
  return h.strike >= 0;
}
