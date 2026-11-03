/**
 * Bits earned by a verified night. The server mints them with the night's loot
 * (src/server/db/runs.ts); the results screen shows the same number from the same
 * inputs: the server's verified score and whether the night levelled the hero up.
 *
 *   floor(score / 100) + 5 for showing up + 25 for a level-up, at most 1,000
 *   (the contract's cap on one reward's amount).
 */

export const BITS_PER_SCORE = 100;
export const BITS_FOR_SHOWING_UP = 5;
export const BITS_FOR_LEVEL_UP = 25;
export const MAX_NIGHT_BITS = 1_000;

export function nightBits({ score, levelledUp }: { score: number; levelledUp: boolean }): number {
  const base = Number.isFinite(score) && score > 0 ? Math.floor(score / BITS_PER_SCORE) : 0;
  return Math.min(MAX_NIGHT_BITS, base + BITS_FOR_SHOWING_UP + (levelledUp ? BITS_FOR_LEVEL_UP : 0));
}
