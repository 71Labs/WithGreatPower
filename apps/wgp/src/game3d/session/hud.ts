/**
 * The HUD's view of a 3D night, in the same HudSnapshot shape the 2D game publishes, so
 * the sticker HUD (src/sim/ui/hud.tsx) draws both. The route bar puts the stops evenly
 * along it and the hero between the last stop and the next, by how much of the way there
 * is left.
 */
import { villainCard } from "@wgp/game-core/chapters";
import { MAX_FLUID, POWERS, VILLAINS } from "@wgp/game-core/data";
import { abilityBlocked, besideCaptive, gweiBlocked, inOpening, len2, RESTORE_TICKS, rightClickerState, stopTarget, takesHit } from "@wgp/game-core/sim3d";
import type { SimState } from "@wgp/game-core/sim3d";

import type { ChapterHud, HudSnapshot, LoopStatus } from "@/sim/loop";

/** Case File 001's HUD fields, or null on a patrol night. */
export function chapterHud(s: SimState): ChapterHud | null {
  const c = s.chapter;
  if (!c) return null;
  const v = s.villain;
  const fighting = !!v && v.kind === "right-clicker" && (s.mode === "intro" || s.mode === "fight" || s.mode === "won" || s.mode === "ko");
  return {
    id: c.id,
    phase: c.phase,
    cluesFound: c.clues.filter((k) => k.found).length,
    clues: c.clues.length,
    villain:
      fighting && v
        ? {
            name: villainCard("right-clicker").name,
            hits: v.hits,
            hitsMax: v.hitsMax,
            state: rightClickerState(s, v),
            open: s.mode === "fight" && v.hits > 0 && takesHit(v),
            guard: v.invuln > 0 && !inOpening(v),
          }
        : null,
    saved: c.savedT > 0,
    restore: Math.round((c.captive.restore / RESTORE_TICKS) * 100) / 100,
    beside: besideCaptive(s),
    freed: c.captive.freed,
  };
}

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
    // Set for the Right-Clicker too, through the standoff (the phone HUD gives the minimap's spot
    // to the villain bar), but not in the rescue, when he's beaten and his copies come at you.
    villain:
      v && (s.mode === "intro" || s.mode === "fight" || s.mode === "won" || s.mode === "ko") && !(s.chapter && s.chapter.phase !== "standoff")
        ? {
            kind: v.kind,
            name: v.kind === "right-clicker" ? villainCard(v.kind).name : VILLAINS[v.kind].name,
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
    ...(s.chapter ? { chapter: chapterHud(s) } : {}),
  };
}
