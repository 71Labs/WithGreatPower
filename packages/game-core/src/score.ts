/**
 * A run's score, in integers only, so the browser and the server always agree. Pinned by
 * RULESET_VERSION, which every input log carries: change any number in the sim, the
 * city or here and bump it, and old logs are refused rather than mis-scored.
 *
 *   fights        1,000 × levelScale(level), × 1.5 for a boss (won fights only)
 *   errands       250 each
 *   perfect       40 per perfect swing, the first 60 count
 *   combo         25 per point of the night's best combo
 *   hp            5 per health point left (0 after a knockout)
 *   time          10 per second under par
 *
 * Ties go to the faster run (fewer ticks); the leaderboard sorts on (score desc, ticks asc).
 */
import { SIM_HZ } from "./sim3d/constants";

/** Defined with the sim's constants (so the verifier can import it from either place). */
export { RULESET_VERSION } from "./sim3d/constants";

/** Par for a night, in seconds. A full night takes the bot about two to three minutes. */
export const PAR_SECONDS = 360;

export const SCORE = {
  fight: 1000,
  /** levelScale is 1 + 0.12 per level: 120 points a level on 1,000. */
  fightPerLevel: 120,
  errand: 250,
  perfect: 40,
  perfectCap: 60,
  combo: 25,
  hp: 5,
  time: 10,
} as const;

/** Points for catching a villain: 1,000 × levelScale(level), and half again for a boss. */
export function fightPoints(level: number, boss: boolean): number {
  const base = SCORE.fight + SCORE.fightPerLevel * (Math.max(1, Math.floor(level)) - 1);
  return boss ? Math.floor((base * 3) / 2) : base;
}

export interface ScoreInput {
  /** Every fight that ended, won or lost. */
  fights: { level: number; boss: boolean; won: boolean }[];
  errands: number;
  perfect: number;
  maxCombo: number;
  hpLeft: number;
  ticks: number;
}

export interface ScoreBreakdown {
  fights: number;
  errands: number;
  perfect: number;
  combo: number;
  hp: number;
  time: number;
  total: number;
}

const whole = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

export function scoreRun(input: ScoreInput): ScoreBreakdown {
  const fights = input.fights.reduce((n, f) => n + (f.won ? fightPoints(f.level, f.boss) : 0), 0);
  const errands = whole(input.errands) * SCORE.errand;
  const perfect = Math.min(whole(input.perfect), SCORE.perfectCap) * SCORE.perfect;
  const combo = whole(input.maxCombo) * SCORE.combo;
  const hp = whole(input.hpLeft) * SCORE.hp;
  const seconds = Math.floor(whole(input.ticks) / SIM_HZ);
  const time = Math.max(0, PAR_SECONDS - seconds) * SCORE.time;
  return { fights, errands, perfect, combo, hp, time, total: fights + errands + perfect + combo + hp + time };
}
