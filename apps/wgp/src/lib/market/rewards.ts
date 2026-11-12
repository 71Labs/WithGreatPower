/**
 * Bits earned by a verified night. The server mints them with the night's loot
 * (src/server/db/runs.ts) and returns the number; the results screen shows that number.
 *
 *   floor(score / 100) + 5 for showing up + 25 for a level-up
 *   + 1 per Bits token collected on the swing between stops (ruleset 3; at most 25)
 *   at most 1,000 in all (the contract's cap on one reward's amount).
 *
 * The tokens come from the verified replay's stats (`bits`), never from the client.
 */

export const BITS_PER_SCORE = 100;
export const BITS_FOR_SHOWING_UP = 5;
export const BITS_FOR_LEVEL_UP = 25;
/** Ruleset 3: Bits tokens collected count one Bit each, up to this many a night. */
export const MAX_PICKUP_BITS = 25;
export const MAX_NIGHT_BITS = 1_000;

const whole = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function nightBits({ score, levelledUp, pickups }: { score: number; levelledUp: boolean; pickups?: number }): number {
  const base = whole(score) > 0 ? Math.floor(whole(score) / BITS_PER_SCORE) : 0;
  const tokens = Math.min(MAX_PICKUP_BITS, whole(pickups));
  return Math.min(MAX_NIGHT_BITS, base + BITS_FOR_SHOWING_UP + (levelledUp ? BITS_FOR_LEVEL_UP : 0) + tokens);
}

/**
 * A wallet taper for the Bits faucet: a proposal, not what the server pays today
 * (docs/ECONOMY.md; `runs.ts` still calls `nightBits`). A hero holding up to `fullBelow`
 * Bits earns the whole night. Above it the night's Bits shrink in a straight line, down
 * to the 5 for showing up at `floorAt` and beyond. It reads only the night's verified
 * result and a balance, so it changes no score, replay or ruleset.
 */
export interface Taper {
  fullBelow: number;
  floorAt: number;
}

export function taperedNightBits(night: Parameters<typeof nightBits>[0], held: number, taper: Taper): number {
  const full = nightBits(night);
  const have = whole(held);
  if (have <= taper.fullBelow || taper.floorAt <= taper.fullBelow) return full;
  const keep = Math.min(full, BITS_FOR_SHOWING_UP);
  if (have >= taper.floorAt) return keep;
  return keep + Math.floor(((full - keep) * (taper.floorAt - have)) / (taper.floorAt - taper.fullBelow));
}
