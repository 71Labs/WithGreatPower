/**
 * The rules of contact: villains hurting the hero, the hero landing hits, and how an
 * encounter ends. Villain HP is counted in hits; the engine decides loot and XP. Ported
 * from 2D with z added; every number is unchanged.
 */
import { RIGHT_CLICKER_MOVES } from "../rules/chapters";
import { VILLAINS, damageScale } from "../rules/data";
import type { VillainId } from "../rules/types";

import { COPY_RADIUS, popCopies, popCopy } from "./chapter";
import { endRecount, markReal, popVoteCopies, realBody, RECOUNT_AT, startRecount, takeBallot, voteDamage, VOTE_GUARD, wrongVoter } from "./vote";
import { HURT_AIR_VY, HURT_INVULN, HURT_SHOVE, HURT_STAGGER, KO_SECONDS, MERCY_DAMAGE, MERCY_GUARD, VILLAIN_HIT_INVULN, WON_SECONDS } from "./constants";
import { len2, len3 } from "./dmath";
import type { HitSource, SimState, SimVillainId, Villain } from "./types";

/** A villain move's damage at this level, from the content tables (the Right-Clicker's in rules/chapters.ts). */
export function moveDamage(v: Villain, label: string): number {
  const moves = v.kind === "right-clicker" ? RIGHT_CLICKER_MOVES : VILLAINS[v.kind].moves;
  const base = moves.find((m) => m.label === label)?.value ?? 10;
  return Math.round(base * damageScale(v.level));
}

/**
 * v4: how forgiving a fight is to a new player, from 1 at level 1 (nights 1–2) down to 0 from
 * level 4 (night 7) on. Early fights hurt less (MERCY_DAMAGE off every hit at level 1) and give
 * longer to get clear after one (MERCY_GUARD more seconds untouchable), so a player who doesn't
 * dodge yet still wins most of them; later nights are as hard as ever.
 */
export function mercy(level: number): number {
  return Math.max(0, Math.min(1, (4 - level) / 3));
}

/**
 * Seconds a villain guards after taking a hit. Doc's arms and Sybil's copies do the rest.
 * v4 (v3: 2.4, 2.2, 1.2, 1.1): longer, so chip shots from range don't decide a fight; the
 * openings (Gas Goblin's stall after a dive, Sandwich Man's stumble after a lunge) get through
 * a guard, and end on the hit.
 */
const VILLAIN_GUARD: Partial<Record<SimVillainId, number>> = {
  "gas-goblin": 3,
  "sandwich-man": 3,
  "doc-octochain": 1.2,
  sybil: 2,
  // Case File 001: long, so the fight goes through his openings (the reload after a flash, the
  // stagger of a broken drag).
  "right-clicker": 4,
};

/**
 * v4: a villain in an opening (Gas Goblin's stall, Sandwich Man's stumble; the Right-Clicker
 * reloading after a flash, or staggered by a broken drag) takes a direct hit through his guard.
 */
export function inOpening(v: Villain): boolean {
  if (v.kind === "right-clicker") return v.phase === "recover" || v.phase === "stagger";
  // Case File 002's Sybil, recovering from a fake vote or staggered by a failed quorum (the
  // patrol's Sybil never takes these phases, so his fights read exactly as before).
  if (v.kind === "sybil") return v.phase === "recover" || v.phase === "stagger";
  return (v.kind === "gas-goblin" || v.kind === "sandwich-man") && v.phase === "recover";
}

/**
 * Hits to catch a villain: 6 + level / 2 (at most 9), and 3 more for a boss (v4; v3: 3 + level
 * / 2, and 2, when most hits were slams from the air). A strike, a sling or a slam is one hit.
 * Later levels get harder through the attack rate instead.
 */
export function villainHits(level: number, boss: boolean): number {
  return 6 + Math.min(3, Math.floor(level / 2)) + (boss ? 3 : 0);
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

/**
 * Every point you can hit: Sybil's living bodies, or the villain himself. The Right-Clicker:
 * himself until he's beaten, and his standing paper copies (each pops on one blow).
 */
export function villainTargets(v: Villain): Target[] {
  if (v.kind === "right-clicker") {
    const out: Target[] = v.hits > 0 ? [{ x: v.x, y: v.y, z: v.z, r: v.radius, body: -1 }] : [];
    v.bodies.forEach((b, i) => {
      if (b.alive) out.push({ x: b.x, y: b.y, z: b.z, r: COPY_RADIUS, body: i });
    });
    return out;
  }
  if (v.kind === "sybil") {
    const out: Target[] = [];
    v.bodies.forEach((b, i) => {
      // Beaten, he's no target (Case File 002's rescue: only the runner is; a patrol fight is
      // over by then).
      if (b.alive && !(b.real && v.hits <= 0)) out.push({ x: b.x, y: b.y, z: b.z, r: v.radius, body: i });
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
  // v4: early nights hurt less, and give longer to get clear after a hit (mercy()).
  const m = s.villain ? mercy(s.villain.level) : 0;
  const dmg = Math.max(1, Math.round(damage * (1 - MERCY_DAMAGE * m)));
  s.hp = Math.max(0, s.hp - dmg);
  s.fluid = Math.max(0, s.fluid - burn);
  h.invuln = HURT_INVULN + MERCY_GUARD * m;
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
  // Case File 002: the lineup, the fight's copies, the recount and the runner have their own rules.
  if (v.kind === "sybil" && s.chapter?.vote) return hitSybilVote(s, v, body, n, by);
  if (v.kind === "right-clicker") {
    // A paper copy takes the blow and pops (it doesn't land on him); beaten, he takes no more.
    const copy = body >= 0 ? v.bodies[body] : undefined;
    if (copy) {
      popCopy(s, copy);
      return false;
    }
    if (v.hits <= 0) return false;
  }
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
  // (Doc guards a little less on the first nights, so his opening there takes two blows.)
  v.invuln = (VILLAIN_GUARD[v.kind] ?? VILLAIN_HIT_INVULN) - (v.kind === "doc-octochain" ? 0.4 * mercy(v.level) : 0);
  v.fleeT = 1.8;
  s.events.push({ type: "villain-hit", x: at.x, y: at.y, z: at.z, hits: v.hits, hitsMax: v.hitsMax, by, double, copy });
  if (v.hits <= 0) winFight(s);
  return true;
}

/**
 * Case File 002's hits (sim3d/vote.ts):
 * - the lineup: only a blow marks; on the real Sybil it unmasks him (the standoff), on a copy
 *   it pops it, with a paper cut back;
 * - the fight: a copy pops on any hit and never passes it on; he takes direct hits through
 *   his guard only in an opening; at RECOUNT_AT hits left he hides (the recount);
 * - the recount: a hit on him lands whatever his guard and ends it; a copy pops, a paper cut;
 * - the rescue: a hit on the runner takes Uncle Gen's ballot back.
 */
function hitSybilVote(s: SimState, v: Villain, body: number, n: number, by: HitSource): boolean {
  const c = s.chapter!;
  const vt = c.vote!;
  const b = body >= 0 ? v.bodies[body] : realBody(v);
  if (!b || !b.alive) return false;
  if (c.phase === "lineup") {
    if (by !== "strike") return false;
    if (b.real) {
      markReal(s, v);
      return true;
    }
    wrongVoter(s, b);
    hurtHero(s, voteDamage(v, "Paper cut"), "a paper cut", b.x, b.y, b.z);
    return false;
  }
  if (c.phase === "rescue") {
    if (!b.real && b.slot === vt.runner && vt.ballot === 0) takeBallot(s, b);
    return false;
  }
  if (c.phase !== "standoff" || v.hits <= 0) return false;
  if (vt.stage === "recount") {
    if (!b.real) {
      wrongVoter(s, b);
      hurtHero(s, voteDamage(v, "Paper cut"), "a paper cut", b.x, b.y, b.z);
      return false;
    }
    v.hits = Math.max(0, v.hits - 1);
    v.invuln = VOTE_GUARD;
    v.fleeT = 1.8;
    s.events.push({ type: "villain-hit", x: b.x, y: b.y, z: b.z, hits: v.hits, hitsMax: v.hitsMax, by, double: false, copy: false });
    endRecount(s, v);
    if (v.hits <= 0) winFight(s);
    return true;
  }
  if (!b.real) {
    popCopy(s, b);
    return false;
  }
  const direct = by === "slam" || by === "dash" || by === "sling" || by === "strike";
  if (direct && v.invuln > 0 && !inOpening(v)) {
    s.events.push({ type: "clang", x: b.x, y: b.y, z: b.z, reason: "guard" });
    return false;
  }
  let count = n;
  const h = s.hero;
  const double = h.finalityT > 0;
  if (double) {
    count *= 2;
    h.finalityT = 0;
  }
  v.hits = Math.max(0, v.hits - count);
  v.invuln = VOTE_GUARD;
  v.fleeT = 1.8;
  // A blow in an opening leaves at most a moment of it (about one more blow).
  if (inOpening(v)) v.phaseT = Math.min(v.phaseT, 0.3);
  s.events.push({ type: "villain-hit", x: b.x, y: b.y, z: b.z, hits: v.hits, hitsMax: v.hitsMax, by, double, copy: false });
  if (v.hits <= 0) winFight(s);
  else if (vt.stage === "polls" && v.hits <= RECOUNT_AT) startRecount(s, v);
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
  // Case File 002: his copies pop, the fork vote is off.
  if (v.kind === "sybil" && s.chapter?.vote) {
    popVoteCopies(s, v);
    s.chapter.vote.forkT = 0;
  }
  // Case File 001: his copies go with him, and the lasso lets go.
  if (v.kind === "right-clicker") {
    popCopies(s, v);
    if (s.chapter) {
      s.chapter.dragT = 0;
      s.chapter.savedT = 0;
    }
  }
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
