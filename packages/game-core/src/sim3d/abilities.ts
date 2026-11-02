/**
 * Powers as real-time abilities. Each costs fluid (POWERS.cost) and has a cooldown of
 * about turns × 2 + 1.5 seconds; effects scale with powerScale(mastery). Ported from 2D:
 * aiming and homing work in 3D, and the twin shot from Fork fans out sideways.
 */
import { MAX_FLUID, POWERS } from "../rules/data";
import type { PowerId } from "../rules/types";

import { FLUID_REGEN_DEN, FLUID_REGEN_NUM, HERO_RADIUS, YANK_SPEED } from "./constants";
import { blast, hitVillain, nearestTarget } from "./combat";
import { datan2, dcos, dsin, len3 } from "./dmath";
import { release } from "./hero";
import type { PowerSlot, SimState } from "./types";

export const cooldownSeconds = (id: PowerId) => POWERS[id].cooldown * 2 + 1.5;

export function makeSlots(loadout: { id: PowerId; scale: number }[]): PowerSlot[] {
  return loadout.slice(0, 4).map(({ id, scale }) => ({ id, scale, cd: 0, cdMax: cooldownSeconds(id), cost: POWERS[id].cost }));
}

/** Powers that need someone to aim at. */
const NEEDS_TARGET: ReadonlySet<PowerId> = new Set(["yank"]);

/** The Fork twin shot's yaw offset (0.16 rad), evaluated once with the polynomial trig. */
const SPREAD_COS = dcos(0.16);
const SPREAD_SIN = dsin(0.16);

/** Why a slot can't fire right now, or null. */
export function abilityBlocked(s: SimState, slot: number): "cooldown" | "fluid" | "target" | "mode" | null {
  const p = s.powers[slot];
  if (!p) return "mode";
  if (s.mode !== "travel" && s.mode !== "fight") return "mode";
  if (p.cd > 0) return "cooldown";
  if (s.fluid < p.cost) return "fluid";
  if (NEEDS_TARGET.has(p.id) && !nearestTarget(s, s.hero.x, s.hero.y, s.hero.z, 900)) return "target";
  return null;
}

export function fireAbility(s: SimState, slot: number): boolean {
  const blocked = abilityBlocked(s, slot);
  if (blocked) {
    s.events.push({ type: "denied", slot, reason: blocked });
    return false;
  }
  const p = s.powers[slot];
  const h = s.hero;
  s.fluid -= p.cost;
  p.cd = p.cdMax;
  const twice = h.forked && p.id !== "fork";
  if (twice) h.forked = false;
  const times = twice ? 2 : 1;
  for (let k = 0; k < times; k++) {
    apply(s, p.id, p.scale, k);
    s.uses[p.id] = (s.uses[p.id] ?? 0) + 1;
  }
  s.events.push({ type: "ability", id: p.id, slot, x: h.x, y: h.y, z: h.z, twice });
  return true;
}

function apply(s: SimState, id: PowerId, scale: number, k: number) {
  const h = s.hero;
  switch (id) {
    case "web-sling":
    case "web-bomb": {
      const t = nearestTarget(s, h.x, h.y, h.z);
      const speed = id === "web-sling" ? 1250 : 1000;
      // Aimed where he's heading (a straight lead, so a turn or a hop still dodges it).
      const v = s.villain;
      const lead = t && v && v.kind !== "sybil" ? len3(t.x - h.x, t.y - h.y, t.z - h.z) / speed : 0;
      let dx = t ? t.x + (v?.vx ?? 0) * lead - h.x : h.fx * 400;
      let dy = t ? t.y + (v?.vy ?? 0) * lead - h.y : 60;
      let dz = t ? t.z + (v?.vz ?? 0) * lead - h.z : h.fz * 400;
      const d = len3(dx, dy, dz) || 1;
      dx /= d;
      dy /= d;
      dz /= d;
      // The twin shot from Fork turns a little about the vertical.
      if (k > 0) {
        const rx = dx * SPREAD_COS - dz * SPREAD_SIN;
        dz = dx * SPREAD_SIN + dz * SPREAD_COS;
        dx = rx;
      }
      s.shots.push({
        kind: id === "web-sling" ? "sling" : "bomb",
        x: h.x + dx * 30,
        y: h.y + dy * 30,
        z: h.z + dz * 30,
        vx: dx * speed,
        vy: dy * speed,
        vz: dz * speed,
        t: 0,
        scale,
        dead: false,
      });
      break;
    }
    case "web-shield":
      h.shieldT = 10 * scale;
      break;
    case "node-sense":
      s.slowmo = Math.max(s.slowmo, 3 * scale);
      break;
    case "wall-crawl":
      s.hp = Math.min(s.maxHp, s.hp + Math.round((POWERS["wall-crawl"].heal ?? 16) * scale));
      break;
    case "yank": {
      const t = nearestTarget(s, h.x, h.y, h.z, 900);
      const v = s.villain;
      if (!t || !v) break;
      const dx = h.x - t.x;
      const dy = h.y - t.y;
      const dz = h.z - t.z;
      const d = len3(dx, dy, dz) || 1;
      // v2: a pull, not a teleport: an impulse toward you that drag wears off over about the
      // 220 units v1 moved him in one tick (none closer than 90).
      const pull = Math.max(0, Math.min(1, (d - 90) / 220)) * YANK_SPEED;
      if (v.kind === "sybil") {
        v.cvx += (dx / d) * pull;
        v.cvy += (dy / d) * pull;
        v.cvz += (dz / d) * pull;
      } else if (v.kind !== "doc-octochain") {
        v.vx += (dx / d) * pull;
        v.vy += (dy / d) * pull;
        v.vz += (dz / d) * pull;
        if (v.kind === "sandwich-man") v.grounded = false;
      }
      v.stun = Math.max(v.stun, 1 * scale);
      break;
    }
    case "finality":
      h.finalityT = 12;
      break;
    case "gas-refund":
      s.fluid = MAX_FLUID;
      s.fluidAcc = 0;
      s.hp = Math.min(s.maxHp, s.hp + Math.round((POWERS["gas-refund"].heal ?? 8) * scale));
      break;
    case "fork":
      h.forked = true;
      break;
    case "zk-cloak":
      h.cloakT = Math.max(h.cloakT, 3 * scale);
      break;
    case "front-run": {
      release(s, false);
      h.grounded = false;
      h.dashT = 0.45;
      h.dashHit = false;
      h.invuln = Math.max(h.invuln, 0.6);
      const speed = 1150 + 120 * (scale - 1);
      h.vx = h.fx * speed;
      h.vz = h.fz * speed;
      h.vy = Math.max(h.vy, 140);
      break;
    }
    case "validator-slam":
      release(s, false);
      if (h.grounded) slamImpact(s, 2);
      else {
        h.slam += 2;
        h.vx *= 0.3;
        h.vz *= 0.3;
        h.vy = -1400;
      }
      break;
  }
}

function slamImpact(s: SimState, hits: number) {
  const h = s.hero;
  h.slam = 0;
  blast(s, h.x, h.y - HERO_RADIUS + 10, h.z, 230, hits, 0.6, "slam");
}

/** Turn (vx, vy, vz) toward (wx, wy, wz) by at most `maxTurn` radians, keeping its speed. */
function steerToward(shot: { vx: number; vy: number; vz: number }, wx: number, wy: number, wz: number, maxTurn: number) {
  const speed = len3(shot.vx, shot.vy, shot.vz);
  const wl = len3(wx, wy, wz);
  if (speed <= 0 || wl <= 0) return;
  const ax = shot.vx / speed;
  const ay = shot.vy / speed;
  const az = shot.vz / speed;
  const bx = wx / wl;
  const by = wy / wl;
  const bz = wz / wl;
  const dot = ax * bx + ay * by + az * bz;
  // The part of the wanted direction perpendicular to the current one.
  let px = bx - dot * ax;
  let py = by - dot * ay;
  let pz = bz - dot * az;
  const pl = len3(px, py, pz);
  const angle = datan2(pl, dot);
  if (angle <= maxTurn) {
    shot.vx = bx * speed;
    shot.vy = by * speed;
    shot.vz = bz * speed;
    return;
  }
  if (pl <= 1e-12) return;
  px /= pl;
  py /= pl;
  pz /= pl;
  const c = dcos(maxTurn);
  const sn = dsin(maxTurn);
  shot.vx = (ax * c + px * sn) * speed;
  shot.vy = (ay * c + py * sn) * speed;
  shot.vz = (az * c + pz * sn) * speed;
}

export function stepAbilities(s: SimState, dt: number) {
  for (const p of s.powers) p.cd = Math.max(0, p.cd - dt);
  // Fluid is an integer: whole units from an exact per-tick accumulator (2.2 a second).
  if (s.mode === "travel" || s.mode === "fight" || s.mode === "intro") {
    if (s.fluid < MAX_FLUID) {
      s.fluidAcc += FLUID_REGEN_NUM;
      while (s.fluidAcc >= FLUID_REGEN_DEN) {
        s.fluidAcc -= FLUID_REGEN_DEN;
        s.fluid += 1;
      }
    }
    if (s.fluid >= MAX_FLUID) {
      s.fluid = MAX_FLUID;
      s.fluidAcc = 0;
    }
  }
  s.slowmo = Math.max(0, s.slowmo - dt);

  const h = s.hero;
  // Validator slam: the shockwave on landing, or on reaching the villain.
  if (h.slam > 0) {
    const t = nearestTarget(s, h.x, h.y, h.z, 70 + HERO_RADIUS);
    if (h.grounded || t) slamImpact(s, h.slam);
  }

  for (const shot of s.shots) {
    if (shot.dead) continue;
    shot.t += dt;
    // Slings curve a touch toward the nearest target; bombs fly straight.
    const t = shot.kind === "sling" ? nearestTarget(s, shot.x, shot.y, shot.z, 320) : null;
    if (t) steerToward(shot, t.x - shot.x, t.y - shot.y, t.z - shot.z, 1.4 * dt);
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.z += shot.vz * dt;
    if (shot.kind === "bomb") shot.vy -= 300 * dt;
    const hitT = nearestTarget(s, shot.x, shot.y, shot.z, 999999);
    const touching = hitT && len3(hitT.x - shot.x, hitT.y - shot.y, hitT.z - shot.z) < hitT.r + 14;
    if (shot.kind === "sling") {
      if (touching && hitT) {
        shot.dead = true;
        hitVillain(s, hitT.body, 1, "sling");
      } else if (shot.t > 0.6) shot.dead = true;
    } else if (touching || shot.t > 0.7 || shot.y < 20) {
      shot.dead = true;
      blast(s, shot.x, shot.y, shot.z, 200 * Math.sqrt(shot.scale), 1, 2 * shot.scale, "web");
    }
  }
  if (s.shots.some((x) => x.dead)) s.shots = s.shots.filter((x) => !x.dead);

  stepGwei(s, dt);
}

/* ------------------------------------------------------------------ Gwei Stacy */

export function gweiBlocked(s: SimState): boolean {
  return s.mode !== "fight" || s.gweiLeft <= 0 || !!s.gwei;
}

export function callGwei(s: SimState): boolean {
  if (gweiBlocked(s)) return false;
  const zone = s.city.zones[s.index];
  const h = s.hero;
  const t = nearestTarget(s, h.x, h.y, h.z);
  const tx = t ? t.x : zone.center.x;
  const ty = t ? t.y : 500;
  const tz = t ? t.z : zone.center.z;
  // She swings across along the line from you to him (or along x if you're right under him).
  let dx = tx - h.x;
  let dz = tz - h.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1) {
    dx /= d;
    dz /= d;
  } else {
    dx = 1;
    dz = 0;
  }
  s.gweiLeft -= 1;
  s.gweiUsed += 1;
  s.gwei = {
    t: 0,
    dur: 1.5,
    anchor: { x: tx, y: ty + 620, z: tz },
    dx,
    dz,
    struck: false,
    x: tx - dx * 540,
    y: ty + 310,
    z: tz - dz * 540,
  };
  s.events.push({ type: "gwei", x: tx, y: ty, z: tz });
  return true;
}

/** She swings across on a web from above and lands two hits at the bottom of the arc. */
function stepGwei(s: SimState, dt: number) {
  const g = s.gwei;
  if (!g) return;
  g.t += dt;
  const u = Math.min(1, g.t / g.dur);
  // A pendulum arc through the bottom, right where the villain is.
  const ang = (-1 + 2 * u) * 1.05;
  const len = 620;
  const across = dsin(ang) * len;
  g.x = g.anchor.x + g.dx * across;
  g.y = g.anchor.y - dcos(ang) * len;
  g.z = g.anchor.z + g.dz * across;
  if (!g.struck && u >= 0.5) {
    g.struck = true;
    const t = nearestTarget(s, g.x, g.y, g.z);
    if (t) hitVillain(s, t.body, 2, "gwei");
  }
  if (u >= 1) s.gwei = null;
}
