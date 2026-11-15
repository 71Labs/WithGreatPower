/**
 * Bits earned by a verified night. The server mints them with the night's loot
 * (src/server/db/runs.ts) and returns the number; the results screen shows that number.
 * `nightBits` is the whole night; the server pays it through the wallet taper below
 * (`nightPay`), which pays less to a hero who already holds many Bits.
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
 * The wallet taper on the Bits faucet. The server pays it (`nightPay`, called by
 * src/server/db/runs.ts). A hero holding up to `fullBelow` Bits earns the whole night.
 * Above it the night's Bits shrink in a straight line, down to the 5 for showing up at
 * `floorAt` and beyond. It reads only the night's verified result and a balance, so it
 * changes no score, replay, board or ruleset. docs/ECONOMY.md measures it.
 */
export interface Taper {
  fullBelow: number;
  floorAt: number;
}

/**
 * The taper verified nights are paid with. A suit costs 250 Bits once the owner sets
 * `craft_bits` (docs/ECONOMY.md), so `floorAt` sits above it: a crafter saving for a suit
 * still gets there, and spending Bits brings the full night back.
 */
export const NIGHT_TAPER: Taper = { fullBelow: 150, floorAt: 400 };

export function taperedNightBits(night: Parameters<typeof nightBits>[0], held: number, taper: Taper): number {
  const full = nightBits(night);
  const have = whole(held);
  if (have <= taper.fullBelow || taper.floorAt <= taper.fullBelow) return full;
  const keep = Math.min(full, BITS_FOR_SHOWING_UP);
  if (have >= taper.floorAt) return keep;
  return keep + Math.floor(((full - keep) * (taper.floorAt - have)) / (taper.floorAt - taper.fullBelow));
}

/** What a verified night pays, and why: `full` is the untapered night, `held` the balance the taper read. */
export interface NightPay {
  bits: number;
  full: number;
  /** The hero's Bits when the night was paid, or null when they couldn't be read (then the whole night is paid). */
  held: number | null;
}

/**
 * The night's Bits for a hero holding `held`. An unknown balance (null: the chain read
 * failed) pays the whole night: a slow RPC never costs a player their Bits.
 */
export function nightPay(night: Parameters<typeof nightBits>[0], held: number | null, taper: Taper = NIGHT_TAPER): NightPay {
  const full = nightBits(night);
  if (held === null || !Number.isFinite(held)) return { bits: full, full, held: null };
  return { bits: taperedNightBits(night, held, taper), full, held: whole(held) };
}
