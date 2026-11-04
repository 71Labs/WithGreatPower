/**
 * The HUD's view of a 3D night, in the same HudSnapshot shape the 2D game publishes, so
 * the sticker HUD (src/sim/ui/hud.tsx) draws both. The route bar puts the stops evenly
 * along it and the hero between the last stop and the next, by how much of the way there
 * is left.
 */
import { MAX_FLUID, POWERS, VILLAINS } from "@wgp/game-core/data";
import { abilityBlocked, gweiBlocked, inOpening, len2, stopTarget, takesHit } from "@wgp/game-core/sim3d";
import type { SimState } from "@wgp/game-core/sim3d";

import type { HudSnapshot, LoopStatus } from "@/sim/loop";

/** Where each stop sits on the route bar, 0–1: evenly spaced, the last one at the end. */
export function stopPositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) / Math.max(1, count));
}

/** Measures how far along the current leg the hero is (distance to the stop, from where the leg began). */
export class LegTracker {
  private index = -1;
  private start = 1;

  /** 0 at the start of the swing to the current stop, 1 on arrival. */
  fraction(s: SimState): number {
    const t = stopTarget(s);
    if (!t) return 1;
    const d = len2(t.x - s.hero.x, t.z - s.hero.z);
    if (s.index !== this.index) {
      this.index = s.index;
      this.start = Math.max(1, d);
    }
    if (d > this.start) this.start = d;
    return Math.max(0, Math.min(1, 1 - d / this.start));
  }
}

/** The route bar's progress, 0–1. */
export function routeProgress(s: SimState, leg: LegTracker): number {
  const n = s.city.zones.length;
  if (!n || s.mode === "done") return 1;
  if (s.mode === "travel") return (s.index + leg.fraction(s)) / n;
  return (s.index + 1) / n;
}

export function hudSnapshot(s: SimState, opts: { status: LoopStatus; countdown: number | null; hinted: boolean; progress: number }): HudSnapshot {
  const h = s.hero;
  const v = s.villain;
  return {
    status: opts.status,
    countdown: opts.countdown,
    mode: s.mode,
    index: s.index,
    hp: Math.round(s.hp),
    maxHp: s.maxHp,
    fluid: Math.round(s.fluid),
    maxFluid: MAX_FLUID,
    combo: s.combo,
    perfect: s.total.perfect,
    progress: opts.progress,
    abilities: s.powers.map((p, i) => {
      const reason = abilityBlocked(s, i);
      return {
        id: p.id,
        name: POWERS[p.id].name,
        key: String(i + 1),
        cost: p.cost,
        cd: Math.round(p.cd * 10) / 10,
        cdMax: p.cdMax,
        ready: !reason,
        reason,
      };
    }),
    gwei: { left: s.gweiLeft, ready: !gweiBlocked(s) },
    villain:
      v && (s.mode === "intro" || s.mode === "fight" || s.mode === "won" || s.mode === "ko")
        ? {
            kind: v.kind,
            name: VILLAINS[v.kind].name,
            hits: v.hits,
            hitsMax: v.hitsMax,
            open: takesHit(v),
            opening: inOpening(v),
            guard: v.invuln > 0 && !inOpening(v),
            boss: v.boss,
            quest: v.quest,
          }
        : null,
    buffs: { shield: h.shieldT > 0, cloak: h.cloakT > 0, finality: h.finalityT > 0, fork: h.forked, slowmo: s.slowmo > 0 },
    hint: !opts.hinted && s.index === 0 && s.mode === "travel",
  };
}
