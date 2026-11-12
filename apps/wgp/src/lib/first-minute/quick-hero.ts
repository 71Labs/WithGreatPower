/**
 * The quick start: a new visitor's "Play now" makes a ready hero and goes straight into the
 * first night, with no form in the way. The hero is the story's own (The Node, in the
 * Classic suit) with the three starter powers a first night leans on: a shot, a block and
 * a dodge. A guest can rename and re-suit it afterwards (components/first-minute/make-it-yours).
 *
 * Whether this browser's hero came from the quick start is a per-browser note in
 * localStorage, next to the save. It only decides whether the hub offers "Make it yours".
 */
import { SUITS } from "@wgp/game-core/data";
import type { Hero, PowerId, Save, SuitId } from "@wgp/game-core/types";

export const QUICK_HERO: { name: string; suit: SuitId; powers: PowerId[] } = {
  name: "The Node",
  suit: "classic",
  powers: ["web-sling", "web-shield", "node-sense"],
};

const KEY = "wgp:quick-hero:v1";
const listeners = new Set<() => void>();

/** True while this browser's hero is the quick start's, not yet made the player's own. */
export function isQuickHero(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markQuickHero(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Blocked storage: the offer just doesn't show.
  }
  listeners.forEach((l) => l());
}

export function subscribeQuickHero(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A hero's name, cleaned the way the reducer cleans it (rules/engine.ts, create-hero). */
export const HERO_NAME_MAX = 24;
export function cleanHeroName(raw: string): string {
  return raw.trim().slice(0, HERO_NAME_MAX).trim();
}

/**
 * A guest's save with the hero renamed and, while the starter suit they were given is the only
 * one they own, swapped for another starter: what the origin flow would have let them choose.
 * Level, powers, loot and the night are untouched. An empty name keeps the current one.
 */
export function personalize(save: Save & { hero: Hero }, name: string, suit: SuitId): Save & { hero: Hero } {
  const clean = cleanHeroName(name) || save.hero.name;
  const canSwap = !!SUITS[suit]?.starter && save.suits.length === 1 && save.suits[0] === save.hero.suit;
  if (!canSwap || suit === save.hero.suit) return { ...save, hero: { ...save.hero, name: clean } };
  return { ...save, hero: { ...save.hero, name: clean, suit }, suits: [suit] };
}
