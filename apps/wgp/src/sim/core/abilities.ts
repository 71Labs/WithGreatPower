/**
 * Powers as real-time abilities. Each costs fluid (POWERS.cost) and has a cooldown of
 * about turns × 2 + 1.5 seconds; effects scale with powerScale(mastery).
 */
import { MAX_FLUID, POWERS } from "@/game/data";
import type { PowerId } from "@/game/types";

import { FLUID_REGEN, HERO_RADIUS } from "./constants";
import { blast, hitVillain, nearestTarget } from "./combat";
import { release } from "./hero";
import type { PowerSlot, SimState } from "./types";

export const cooldownSeconds = (id: PowerId) => POWERS[id].cooldown * 2 + 1.5;

export function makeSlots(loadout: { id: PowerId; scale: number }[]): PowerSlot[] {
  return loadout.slice(0, 4).map(({ id, scale }) => ({ id, scale, cd: 0, cdMax: cooldownSeconds(id), cost: POWERS[id].cost }));
}

/** Powers that need someone to aim at. */
const NEEDS_TARGET: ReadonlySet<PowerId> = new Set(["yank"]);

/** Why a slot can't fire right now, or null. */
export function abilityBlocked(s: SimState, slot: number): "cooldown" | "fluid" | "target" | "mode" | null {
  const p = s.powers[slot];
  if (!p) return "mode";
  if (s.mode !== "travel" && s.mode !== "fight") return "mode";
  if (p.cd > 0) return "cooldown";
  if (s.fluid < p.cost) return "fluid";
  if (NEEDS_TARGET.has(p.id) && !nearestTarget(s, s.hero.x, s.hero.y, 900)) return "target";
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
  s.events.push({ type: "ability", id: p.id, slot, x: h.x, y: h.y, twice });
  return true;
}

function apply(s: SimState, id: PowerId, scale: number, k: number) {
  const h = s.hero;
  const facing = h.facing;
  switch (id) {
    case "web-sling":
    case "web-bomb": {
      const t = nearestTarget(s, h.x, h.y);
      const spread = k === 0 ? 0 : 0.16;
      const speed = id === "web-sling" ? 1250 : 1000;
      // Aimed where he's heading (a straight lead, so a turn or a hop still dodges it).
      const v = s.villain;
      const lead = t && v && v.kind !== "sybil" ? Math.hypot(t.x - h.x, t.y - h.y) / speed : 0;
      let dx = t ? t.x + (v?.vx ?? 0) * lead - h.x : facing * 400;
      let dy = t ? t.y + (v?.vy ?? 0) * lead - h.y : 60;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const c = Math.cos(spread);
      const sn = Math.sin(spread);
      s.shots.push({
        kind: id === "web-sling" ? "sling" : "bomb",
        x: h.x + dx * 30,
        y: h.y + dy * 30,
        vx: (dx * c - dy * sn) * speed,
        vy: (dx * sn + dy * c) * speed,
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
      const t = nearestTarget(s, h.x, h.y, 900);
      const v = s.villain;
      if (!t || !v) break;
      const dx = h.x - t.x;
      const dy = h.y - t.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = Math.min(d - 90, 220);
      if (v.kind === "sybil") {
        v.cx += (dx / d) * pull;
        v.cy += (dy / d) * pull;
      } else if (v.kind !== "doc-octochain") {
        v.x += (dx / d) * pull;
        v.y += (dy / d) * pull;
      }
      v.stun = Math.max(v.stun, 1 * scale);
      break;
    }
    case "finality":
      h.finalityT = 12;
      break;
    case "gas-refund":
      s.fluid = MAX_FLUID;
      s.hp = Math.min(s.maxHp, s.hp + Math.round((POWERS["gas-refund"].heal ?? 8) * scale));
      break;
    case "fork":
      h.forked = true;
      break;
    case "zk-cloak":
      h.cloakT = Math.max(h.cloakT, 3 * scale);
      break;
    case "front-run":
      release(s, false);
      h.grounded = false;
      h.dashT = 0.45;
      h.dashHit = false;
      h.invuln = Math.max(h.invuln, 0.6);
      h.vx = facing * (1150 + 120 * (scale - 1));
      h.vy = Math.max(h.vy, 140);
      break;
    case "validator-slam":
      release(s, false);
      if (h.grounded) slamImpact(s, 2);
      else {
        h.slam += 2;
        h.vx *= 0.3;
        h.vy = -1400;
      }
      break;
  }
}

function slamImpact(s: SimState, hits: number) {
  const h = s.hero;
  h.slam = 0;
  blast(s, h.x, h.y - HERO_RADIUS + 10, 230, hits, 0.6, "slam");
}

export function stepAbilities(s: SimState, dt: number) {
  for (const p of s.powers) p.cd = Math.max(0, p.cd - dt);
  if (s.mode === "travel" || s.mode === "fight" || s.mode === "intro") s.fluid = Math.min(MAX_FLUID, s.fluid + FLUID_REGEN * dt);
  s.slowmo = Math.max(0, s.slowmo - dt);

  const h = s.hero;
  // Validator slam: the shockwave on landing, or on reaching the villain.
  if (h.slam > 0) {
    const t = nearestTarget(s, h.x, h.y, 70 + HERO_RADIUS);
    if (h.grounded || t) slamImpact(s, h.slam);
  }

  for (const shot of s.shots) {
    if (shot.dead) continue;
    shot.t += dt;
    // Slings curve a touch toward the nearest target; bombs fly straight.
    const t = shot.kind === "sling" ? nearestTarget(s, shot.x, shot.y, 320) : null;
    if (t) {
      const speed = Math.hypot(shot.vx, shot.vy);
      const want = Math.atan2(t.y - shot.y, t.x - shot.x);
      const have = Math.atan2(shot.vy, shot.vx);
      let diff = want - have;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-1.4 * dt, Math.min(1.4 * dt, diff));
      shot.vx = Math.cos(have + turn) * speed;
      shot.vy = Math.sin(have + turn) * speed;
    }
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    if (shot.kind === "bomb") shot.vy -= 300 * dt;
    const hit = nearestTarget(s, shot.x, shot.y, 999999);
    const touching = hit && Math.hypot(hit.x - shot.x, hit.y - shot.y) < hit.r + 14;
    if (shot.kind === "sling") {
      if (touching && hit) {
        shot.dead = true;
        hitVillain(s, hit.body, 1, "sling");
      } else if (shot.t > 0.6) shot.dead = true;
    } else if (touching || shot.t > 0.7 || shot.y < 20) {
      shot.dead = true;
      blast(s, shot.x, shot.y, 200 * Math.sqrt(shot.scale), 1, 2 * shot.scale, "web");
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
  const zone = s.world.zones[s.index];
  const t = nearestTarget(s, s.hero.x, s.hero.y);
  const ty = t ? t.y : 500;
  const tx = t ? t.x : zone.x;
  s.gweiLeft -= 1;
  s.gweiUsed += 1;
  s.gwei = {
    t: 0,
    dur: 1.5,
    from: { x: tx - 540, y: ty + 310 },
    to: { x: tx + 540, y: ty + 310 },
    anchor: { x: tx, y: ty + 620 },
    struck: false,
    x: tx - 540,
    y: ty + 310,
  };
  s.events.push({ type: "gwei", x: tx, y: ty });
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
  g.x = g.anchor.x + Math.sin(ang) * len;
  g.y = g.anchor.y - Math.cos(ang) * len;
  if (!g.struck && u >= 0.5) {
    g.struck = true;
    const t = nearestTarget(s, g.x, g.y);
    if (t) hitVillain(s, t.body, 2, "gwei");
  }
  if (u >= 1) s.gwei = null;
}
