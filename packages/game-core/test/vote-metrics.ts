/**
 * Case File 002's metrics: whole nights played by the scripted players of fight-metrics.ts.
 * The bot investigates (it swings to every drop box and the polling station); then:
 *
 * - the lineup and the recount: a player marks the nearest voter who fits what it remembers of
 *   the clues: a simple player one tell, an average player two, a good player all three (the
 *   bot too), so the first two guess among the suspects left;
 * - the fight: playerFrame's chase, mash and dodge; a fork vote called with the player on the
 *   orphaned side gets an answer (crossing, or popping the last copy the quorum needs) never
 *   from a simple player, half the time from an average one, always from a good one;
 * - the rescue: after the runner, then the ballot to the box (everyone).
 *
 * Printed with VOTE_REPORT=1 (vote-report.test.ts); vote.test.ts pins the gates on it.
 */
import { chapterCleared, startChapterRun, stepRun, type Run } from "../src/replay";
import { TELL_BIT, TELL_OF_CLUE } from "../src/rules/chapters";
import type { Save } from "../src/rules/types";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { newVoteBotMemory, voteFightFrame } from "../src/sim3d/bot-vote";
import type { InputFrame } from "../src/sim3d/contract";
import type { SimEvent } from "../src/sim3d/types";
import { coin, newPlayerMem, nightHero, playerFrame } from "./fight-metrics";

export type VotePolicy = "bot" | "first" | "simple" | "average" | "good";
export const VOTE_POLICIES: VotePolicy[] = ["bot", "first", "simple", "average", "good"];

/**
 * Tells remembered from the clues, and the chance of answering a fork vote. "first" is a
 * first-timer: a simple player who skipped every case note, so marks by guessing.
 */
const SKILL: Record<Exclude<VotePolicy, "bot">, { tells: number; fork: number }> = {
  first: { tells: 0, fork: 0 },
  simple: { tells: 1, fork: 0 },
  average: { tells: 2, fork: 0.5 },
  good: { tells: 3, fork: 1 },
};

export interface VoteRunStats {
  policy: VotePolicy;
  seed: number;
  cleared: boolean;
  ko: boolean;
  fightWon: boolean;
  /** Seconds: the whole night, to the third clue, the lineup (live to the mark), the fight (mark to won), the rescue. */
  seconds: number;
  investigate: number;
  lineup: number;
  fight: number;
  rescue: number;
  wrong: number;
  hpStart: number;
  hpLeft: number;
  fightDamage: number;
  forks: number;
  forksPassed: number;
  forksHit: number;
  quorumFailed: number;
  /** The recount ended on a blow (found) rather than him stepping out. */
  recountFound: boolean;
  recountMisses: number;
  heroAir: number;
}

/** A hero for the case: night 3's (level 2, 106 health, sling, bomb, shield and wall-crawl). */
export const voteHero = (night = 3): Save => nightHero(night);

export function playVote(policy: VotePolicy, seed: number, save = voteHero()): VoteRunStats & { run: Run } {
  const run = startChapterRun(save, seed, "case-002");
  if (run.error) throw new Error(run.error);
  const travel = newBotMemory();
  const fightBot = newBotMemory();
  const vmem = newVoteBotMemory();
  const m = newPlayerMem(seed ^ 0x5eb1);
  const skill = policy === "bot" ? { tells: 3, fork: 1 } : SKILL[policy];
  const out: VoteRunStats = {
    policy,
    seed,
    cleared: false,
    ko: false,
    fightWon: false,
    seconds: 0,
    investigate: 0,
    lineup: 0,
    fight: 0,
    rescue: 0,
    wrong: 0,
    hpStart: run.sim.hp,
    hpLeft: 0,
    fightDamage: 0,
    forks: 0,
    forksPassed: 0,
    forksHit: 0,
    quorumFailed: 0,
    recountFound: false,
    recountMisses: 0,
    heroAir: 0,
  };
  // The tells the player remembers: the first `skill.tells` clues it found.
  let known = 0;
  let remembered = 0;
  let answering = false;
  let last: SimEvent[] = [];
  let liveAt = -1;
  let markAt = -1;
  let wonAt = -1;
  let rescueAt = -1;
  let fightTicks = 0;
  let airTicks = 0;
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    const s = run.sim;
    const c = s.chapter!;
    const vt = c.vote!;
    let frame: InputFrame;
    if (policy === "bot") frame = botFrame(s, s.mode === "travel" ? travel : fightBot);
    else if (s.mode !== "fight") frame = botFrame(s, s.mode === "travel" ? travel : fightBot);
    else if (c.phase === "lineup" || c.phase === "rescue" || (c.phase === "standoff" && vt.stage === "recount")) frame = voteFightFrame(s, vmem, 0, known);
    else if (c.phase === "standoff" && answering && vt.forkT > 0) frame = voteFightFrame(s, vmem, 0, known);
    else {
      frame = playerFrame(policy === "first" ? "simple" : policy, s, m, last);
      vmem.holding = frame.web;
    }
    const events = stepRun(run, frame);
    last = events;
    if (c.phase === "standoff" && s.mode === "fight") {
      fightTicks += 1;
      if (!s.hero.grounded) airTicks += 1;
    }
    for (const e of events) {
      if (e.type === "clue-found") {
        const t = TELL_OF_CLUE[e.id];
        if (t && remembered < skill.tells) {
          known |= TELL_BIT[t];
          remembered += 1;
        }
        if (e.found === e.of) out.investigate = s.tick / 60;
      }
      if (e.type === "fight-live") liveAt = s.tick;
      if (e.type === "voter-mark") {
        if (e.real) markAt = s.tick;
        else if (c.phase === "lineup") out.wrong = e.wrong;
        else out.recountMisses += 1;
      }
      if (e.type === "fork-call") {
        out.forks += 1;
        answering = policy === "bot" || coin(m) < skill.fork;
      }
      if (e.type === "fork") {
        if (e.passed) out.forksPassed += 1;
        else out.quorumFailed += 1;
        if (e.hit) out.forksHit += 1;
        answering = false;
      }
      if (e.type === "villain-hit" && vt.stage === "runoff" && last.some((x) => x.type === "recount" && x.end)) out.recountFound = true;
      if (e.type === "fight-won") wonAt = s.tick;
      if (e.type === "hero-hurt" && c.phase === "standoff") out.fightDamage += e.damage;
      if (e.type === "captive-freed") out.rescue = (s.tick - rescueAt) / 60;
    }
    if (c.phase === "rescue" && rescueAt < 0) rescueAt = s.tick;
  }
  const s = run.sim;
  out.cleared = chapterCleared(run);
  out.ko = s.hp <= 0;
  out.seconds = s.tick / 60;
  out.fightWon = wonAt >= 0;
  out.lineup = liveAt >= 0 && markAt >= 0 ? (markAt - liveAt) / 60 : 0;
  out.fight = markAt >= 0 ? ((wonAt >= 0 ? wonAt : s.tick) - markAt) / 60 : 0;
  out.hpLeft = s.hp;
  out.heroAir = fightTicks ? airTicks / fightTicks : 0;
  return { ...out, run };
}

export interface VoteSummary {
  runs: number;
  clearRate: number;
  koRate: number;
  medianSeconds: number;
  p90Seconds: number;
  medianInvestigate: number;
  medianLineup: number;
  meanWrong: number;
  medianFight: number;
  p90Fight: number;
  medianRescue: number;
  meanFightDamage: number;
  forksPerFight: number;
  forkHitsPerFight: number;
  quorumFailsPerFight: number;
  heroAir: number;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function summarizeVote(rs: VoteRunStats[]): VoteSummary {
  const n = Math.max(1, rs.length);
  const cleared = rs.filter((r) => r.cleared);
  const won = rs.filter((r) => r.fightWon);
  return {
    runs: rs.length,
    clearRate: r2(cleared.length / n),
    koRate: r2(rs.filter((r) => r.ko).length / n),
    medianSeconds: r2(pct(cleared.map((r) => r.seconds), 0.5)),
    p90Seconds: r2(pct(cleared.map((r) => r.seconds), 0.9)),
    medianInvestigate: r2(pct(rs.map((r) => r.investigate), 0.5)),
    medianLineup: r2(pct(rs.map((r) => r.lineup), 0.5)),
    meanWrong: r2(rs.reduce((a, r) => a + r.wrong, 0) / n),
    medianFight: r2(pct(won.map((r) => r.fight), 0.5)),
    p90Fight: r2(pct(won.map((r) => r.fight), 0.9)),
    medianRescue: r2(pct(cleared.map((r) => r.rescue), 0.5)),
    meanFightDamage: r2(rs.reduce((a, r) => a + r.fightDamage, 0) / n),
    forksPerFight: r2(rs.reduce((a, r) => a + r.forks, 0) / n),
    forkHitsPerFight: r2(rs.reduce((a, r) => a + r.forksHit, 0) / n),
    quorumFailsPerFight: r2(rs.reduce((a, r) => a + r.quorumFailed, 0) / n),
    heroAir: r2(rs.reduce((a, r) => a + r.heroAir, 0) / n),
  };
}

export const VOTE_SEEDS = Array.from({ length: 24 }, (_, i) => Math.imul(i + 7, 0x9e3779b1) >>> 0);

export function voteRuns(policy: VotePolicy, seeds = VOTE_SEEDS, save = voteHero()): VoteRunStats[] {
  return seeds.map((seed) => {
    const { run: _run, ...stats } = playVote(policy, seed, save);
    return stats;
  });
}

export function voteTable(rows: [string, VoteSummary][]): string {
  const cols = Object.keys(rows[0]?.[1] ?? {}) as (keyof VoteSummary)[];
  const w = Math.max(...rows.map(([k]) => k.length), 8);
  const head = ["".padEnd(w), ...cols.map((c) => c.padStart(Math.max(7, c.length)))].join(" ");
  const lines = rows.map(([k, s]) => [k.padEnd(w), ...cols.map((c) => String(s[c]).padStart(Math.max(7, c.length)))].join(" "));
  return [head, ...lines].join("\n");
}

/** The report VOTE_REPORT=1 prints. */
export function voteReport(seeds = VOTE_SEEDS): string {
  const rows: [string, VoteSummary][] = [];
  for (const night of [1, 3, 9]) {
    for (const policy of VOTE_POLICIES) rows.push([`night-${night} ${policy}`, summarizeVote(voteRuns(policy, seeds, voteHero(night)))]);
  }
  return voteTable(rows);
}
