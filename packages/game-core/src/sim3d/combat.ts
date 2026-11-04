/**
 * The rules of contact: villains hurting the hero, the hero landing hits, and how an
 * encounter ends. Villain HP is counted in hits; the engine decides loot and XP. Ported
 * from 2D with z added; every number is unchanged.
 */
import { VILLAINS, damageScale } from "../rules/data";
import type { VillainId } from "../rules/types";

import { HURT_AIR_VY, HURT_INVULN, HURT_SHOVE, HURT_STAGGER, KO_SECONDS, VILLAIN_HIT_INVULN, WON_SECONDS } from "./constants";
import { len2, len3 } from "./dmath";
import type { HitSource, SimState, Villain } from "./types";

/** A villain move's damage at this level, from the content tables. */
export function moveDamage(v: Villain, label: string): number {
  const base = VILLAINS[v.kind].moves.find((m) => m.label === label)?.value ?? 10;
  return Math.round(base * damageScale(v.level));
}

/**
 * Seconds a villain guards after taking a hit. Doc's arms and Sybil's copies do the rest.
 * v4 (v3: 2.4, 2.2, 1.2, 1.1): longer, so chip shots from range don't decide a fight; the
 * openings (Gas Goblin's stall after a dive, Sandwich Man's stumble after a lunge) get through
 * a guard, and end on the hit.
 */
const VILLAIN_GUARD: Partial<Record<VillainId, number>> = {
  "gas-goblin": 3,
  "sandwich-man": 3,
  "doc-octochain": 1.2,
  sybil: 2,
};

/** v4: a villain in an opening (Gas Goblin's stall, Sandwich Man's stumble) takes a direct hit through his guard. */
export function inOpening(v: Villain): boolean {
  return (v.kind === "gas-goblin" || v.kind === "sandwich-man") && v.phase === "recover";
}

/**
 * Hits to catch a villain: 6 + level / 2, and 3 more for a boss (v4; v3: 3 + level / 2, and 2,
 * when most hits were slams from the air). A strike, a sling or a slam is one hit.
 */
export function villainHits(level: number, boss: boolean): number {
  return 6 + Math.floor(level / 2) + (boss ? 3 : 0);
}

export const villainName = (id: VillainId) => VILLAINS[id].name;

/** Doc only takes a direct hit while his arms are pulled in (or he's stunned). */
export function docVulnerable(v: Villain): boolean {
  return v.phase === "retract" || v.stun > 0;
}

export function isVulnerable(v: Villain): boolean {
  return v.kind === "doc-octochain" ? docVulnerable(v) : true;
}

/** Whether a direct hit (a strike, a sling, a slam) would land on him right now. */
export function takesHit(v: Villain): boolean {
  return isVulnerable(v) && (v.invuln <= 0 || inOpening(v));
}

export interface Target {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Sybil's body index, or −1 for the villain himself. */
  body: number;
}

/** Every point you can hit: Sybil's living bodies, or the villain himself. */
export function villainTargets(v: Villain): Target[] {
  if (v.kind === "sybil") {
    const out: Target[] = [];
    v.bodies.forEach((b, i) => {
      if (b.alive) out.push({ x: b.x, y: b.y, z: b.z, r: v.radius, body: i });
    });
    return out;
  }
  return [{ x: v.x, y: v.y, z: v.z, r: v.radius, body: -1 }];
}

export function nearestTarget(s: SimState, x: number, y: number, z: number, range = Infinity): Target | null {
  const v = s.villain;
  if (!v || s.mode !== "fight") return null;
  let best: Target | null = null;
  let bestD = range;
  for (const t of villainTargets(v)) {
    const d = len3(t.x - x, t.y - y, t.z - z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * Hurt the hero. Shields eat the hit; a cloak, a dash or recent damage makes you
 * untouchable. Returns true if it landed.
 */
export function hurtHero(s: SimState, damage: number, source: string, fromX: number, fromY: number, fromZ: number, burn = 0, shove = HURT_SHOVE): boolean {
  const h = s.hero;
  if (s.mode !== "fight" || damage <= 0) return false;
  if (h.invuln > 0 || h.dashT > 0) return false;
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
  const dmg = Math.round(damage);
  s.hp = Math.max(0, s.hp - dmg);
  s.fluid = Math.max(0, s.fluid - burn);
  h.invuln = HURT_INVULN;
  h.hurtT = 0.35;
  // Knocked off a wall too, and out of a strike.
  h.climbing = false;
  h.strike = -1;
  h.zip = -1;
  // v4: shoved away from the source along the ground (a stagger that slides out), never
  // launched; in the air, pushed sideways with any rise cut short. v3 threw you 420 back and
  // 120–420 up.
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
  h.vx = dx * shove;
  h.vz = dz * shove;
  if (!h.grounded) h.vy = Math.min(h.vy, HURT_AIR_VY);
  h.landT = Math.max(h.landT, HURT_STAGGER);
  s.events.push({ type: "hero-hurt", x: h.x, y: h.y, z: h.z, damage: dmg, source, hp: s.hp });
  if (s.hp <= 0) knockOut(s);
  return true;
}

/**
 * Land `n` hits on the villain (on Sybil's body `body`, or the nearest one). Direct hits
 * (slams, dashes, slings) bounce off Doc's arms and respect the brief invulnerability
 * after a hit; area hits and Gwei always land.
 */
export function hitVillain(s: SimState, body: number, n: number, by: HitSource): boolean {
  const v = s.villain;
  if (!v || s.mode !== "fight" || n <= 0) return false;
  const direct = by === "slam" || by === "dash" || by === "sling" || by === "strike";
  const at = body >= 0 && v.bodies[body] ? v.bodies[body] : v;
  if (direct && v.kind === "doc-octochain" && !docVulnerable(v)) {
    s.events.push({ type: "clang", x: at.x, y: at.y, z: at.z, reason: "arms" });
    return false;
  }
  if (direct && v.invuln > 0 && !inOpening(v)) {
    s.events.push({ type: "clang", x: at.x, y: at.y, z: at.z, reason: "guard" });
    return false;
  }
  let count = n;
  const h = s.hero;
  const double = h.finalityT > 0;
  if (double) {
    count *= 2;
    h.finalityT = 0;
  }
  let copy = false;
  if (v.kind === "sybil") {
    for (let k = 0; k < count; k++) {
      const copies = v.bodies.filter((b) => b.alive && !b.real);
      if (copies.length) {
        // The copy you hit pops; hit the real one early and the nearest copy pops in his place.
        const hitBody = body >= 0 && v.bodies[body]?.alive && !v.bodies[body].real ? v.bodies[body] : null;
        const victim =
          hitBody ??
          copies.reduce((a, b) => (len3(a.x - at.x, a.y - at.y, a.z - at.z) <= len3(b.x - at.x, b.y - at.y, b.z - at.z) ? a : b));
        victim.alive = false;
        copy = true;
        body = -1;
      }
      v.hits = Math.max(0, v.hits - 1);
      if (v.hits <= 0) break;
    }
  } else {
    v.hits = Math.max(0, v.hits - count);
  }
  // After a hit he guards for a moment (and counters), so a fight has a rhythm.
  v.invuln = VILLAIN_GUARD[v.kind] ?? VILLAIN_HIT_INVULN;
  v.fleeT = 1.8;
  s.events.push({ type: "villain-hit", x: at.x, y: at.y, z: at.z, hits: v.hits, hitsMax: v.hitsMax, by, double, copy });
  if (v.hits <= 0) winFight(s);
  return true;
}

/** An area hit: every body inside the radius takes `n` hits, and is stunned. */
export function blast(s: SimState, x: number, y: number, z: number, r: number, n: number, stun: number, kind: "web" | "slam"): number {
  s.events.push({ type: "blast", x, y, z, r, kind });
  const v = s.villain;
  if (!v || s.mode !== "fight") return 0;
  let landed = 0;
  for (const t of villainTargets(v)) {
    if (len3(t.x - x, t.y - y, t.z - z) > r + t.r) continue;
    if (s.mode !== "fight") break;
    if (hitVillain(s, t.body, n, kind === "web" ? "web-bomb" : "validator-slam")) landed += 1;
  }
  if (s.villain && s.mode === "fight" && landed > 0 && stun > 0) s.villain.stun = Math.max(s.villain.stun, stun);
  return landed;
}

function report(s: SimState) {
  const uses = { ...s.uses };
  s.uses = {};
  return uses;
}

export function winFight(s: SimState) {
  const v = s.villain!;
  s.mode = "won";
  s.modeT = WON_SECONDS;
  v.stun = 0;
  s.hazards.length = 0;
  s.shots.length = 0;
  s.events.push({ type: "fight-won", index: s.index, villain: v.kind, hp: s.hp, fluid: s.fluid, uses: report(s), gweiUsed: s.gweiUsed });
}

export function knockOut(s: SimState) {
  const v = s.villain;
  s.mode = "ko";
  s.modeT = KO_SECONDS;
  s.hero.rope = null;
  s.hero.grounded = false;
  s.hero.slam = 0;
  s.events.push({
    type: "ko",
    index: s.index,
    villain: v?.kind ?? "gas-goblin",
    hp: 0,
    fluid: s.fluid,
    uses: report(s),
    gweiUsed: s.gweiUsed,
  });
}
