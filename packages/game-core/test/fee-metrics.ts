/**
 * Case File 003's metrics: whole "Fee Strike" nights played by scripted players, to measure the
 * chase's feel (how far behind players fall, how often they lose him) and the case's balance.
 *
 * Travel (the clues, the meter, the chase) is the sim's bot with a person's habits laid on:
 * - simple (a first-timer): re-aims the stick every 0.25 s, off by up to ±26°; lets go of a
 *   swing up to 0.25 s late, and one in five too soon; presses a web up to 0.2 s slow; stops
 *   to look around every 5 s or so (letting go of everything), and takes a wrong turn every
 *   12 s; never steps round a fee bomb.
 * - average: every 0.17 s, ±14°, 0.13 s late, one in ten too soon, a pause every 10 s and a
 *   wrong turn every 30 s; steps round a bomb half the time.
 * - good: the bot's travel, and steps round every bomb it sees coming.
 * - bot: the sim's own bot throughout.
 * The fight on the bakery roof is fight-metrics.ts's player of the same name (simple never
 * dodges, average half the time, good nearly always); cooling, simple never steps out of a fee
 * spike, average half the time, good always.
 *
 * Printed with FEE_REPORT=1 (fee-report.test.ts); fee-strike.test.ts pins the gates on it.
 */
import { chapterCleared, startChapterRun, stepRun, type Run } from "../src/replay";
import type { Save } from "../src/rules/types";
import type { InputFrame } from "../src/sim3d/contract";
import { dcos, dirIndex, DIR64, dsin, len2 } from "../src/sim3d/dmath";
import { botFrame, newBotMemory, type BotMemory } from "../src/sim3d/bot";
import { ESCAPE_GAP, SAFE_GAP } from "../src/sim3d/fee-chase";
import { coolFrame } from "../src/sim3d/fee-bot";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { coin, newPlayerMem, nightHero, playerFrame, type PlayerMem } from "./fight-metrics";

export type FeePolicy = "bot" | "simple" | "average" | "good";
export const FEE_POLICIES: FeePolicy[] = ["bot", "simple", "average", "good"];

interface Habits {
  /** Re-aim the stick every this many ticks, off by up to `noise` radians. */
  aimEvery: number;
  noise: number;
  /** Let go of a swing up to this many ticks late; let go of this share of swings too soon (0.25–0.55 s in). */
  lateMax: number;
  early: number;
  /** Press a web up to this many ticks after the bot would, in the air. */
  pressLate: number;
  /** A pause (everything let go) every this many seconds on average, for 0.4–0.9 s. */
  pauseEvery: number;
  /** A wrong turn (the stick 100–160° off the way, 1–2 s) every this many seconds on average. */
  wrongEvery: number;
  /** Chance of stepping round a fee bomb coming down on it; chance of stepping out of a fee spike. */
  dodgeBomb: number;
  dodgeSpike: number;
}

const HABITS: Record<Exclude<FeePolicy, "bot">, Habits> = {
  simple: { aimEvery: 15, noise: 0.45, lateMax: 15, early: 0.2, pressLate: 12, pauseEvery: 5, wrongEvery: 12, dodgeBomb: 0, dodgeSpike: 0 },
  average: { aimEvery: 10, noise: 0.25, lateMax: 8, early: 0.1, pressLate: 6, pauseEvery: 10, wrongEvery: 30, dodgeBomb: 0.5, dodgeSpike: 0.5 },
  good: { aimEvery: 1, noise: 0, lateMax: 0, early: 0, pressLate: 0, pauseEvery: 0, wrongEvery: 0, dodgeBomb: 1, dodgeSpike: 1 },
};

interface Traveller {
  bot: BotMemory;
  m: PlayerMem;
  /** The stick it holds between re-aims. */
  dir: number;
  mag: number;
  aimAt: number;
  /** Ticks it keeps holding past the bot's release, and of a pause left. */
  late: number;
  pause: number;
  /** The last web it sent. */
  web: boolean;
  /** A bomb dodge: ticks left, which way; the bomb it decided about. */
  dodge: number;
  dodgeDir: number;
  seen: number;
  /** The spike wind-up it decided about, and whether it steps out of it. */
  spikeSeen: number;
  spikeOut: boolean;
  /** This swing: ticks on it, and the tick it lets go too soon at (−1: it won't). A press it's slow with: ticks left. */
  swingT: number;
  earlyAt: number;
  press: number;
  /** The bot's web last tick. */
  botWeb: boolean;
  /** A wrong turn: ticks left, and how far off (radians). */
  wrong: number;
  wrongBy: number;
}

const newTraveller = (seed: number): Traveller => ({
  bot: newBotMemory(),
  m: newPlayerMem(seed),
  dir: 0,
  mag: 0,
  aimAt: 0,
  late: 0,
  pause: 0,
  web: false,
  dodge: 0,
  dodgeDir: 0,
  seen: -1,
  spikeSeen: -1,
  spikeOut: false,
  swingT: -1,
  earlyAt: -1,
  press: 0,
  botWeb: false,
  wrong: 0,
  wrongBy: 0,
});

/** Where a falling fee bomb lands (under the bombs' gravity on night 3, near enough). */
function bombLanding(s: SimState, z: SimState["hazards"][number]): { x: number; z: number; t: number } {
  const g = 900 * (1 - 0.3 * (2 / 3));
  const fall = Math.max(0, z.y - s.hero.y);
  const t = (z.vy + Math.sqrt(z.vy * z.vy + 2 * g * fall)) / g;
  return { x: z.x + z.vx * t, z: z.z + z.vz * t, t };
}

/** A person travelling: the bot's frame with their habits laid on. */
function travelFrame(policy: Exclude<FeePolicy, "bot">, s: SimState, p: Traveller): InputFrame {
  const hb = HABITS[policy];
  const h = s.hero;
  const want = botFrame(s, p.bot);
  const t = s.tick;
  // Bombs coming down on it: step round (once per bomb, with its chance).
  if (hb.dodgeBomb > 0 && s.fee?.phase === "chase" && p.dodge <= 0) {
    for (let i = 0; i < s.hazards.length; i++) {
      const z = s.hazards[i];
      if (z.kind !== "bomb") continue;
      const key = Math.floor(z.x * 7 + z.z * 13) & 0xffff;
      if (key === p.seen) continue;
      const l = bombLanding(s, z);
      const lx = l.x - (h.x + h.vx * l.t);
      const lz = l.z - (h.z + h.vz * l.t);
      if (l.t < 1.1 && len2(lx, lz) < 140) {
        p.seen = key;
        if (coin(p.m) < hb.dodgeBomb) {
          p.dodge = 20;
          const sp = len2(h.vx, h.vz) || 1;
          const side = coin(p.m) < 0.5 ? 1 : -1;
          p.dodgeDir = dirIndex((h.vx / sp) * 0.6 - (h.vz / sp) * side, (h.vz / sp) * 0.6 + (h.vx / sp) * side);
        }
        break;
      }
    }
  }
  if (p.dodge > 0) {
    p.dodge -= 1;
    return { dir: p.dodgeDir, mag: 3, web: want.web, shot: want.shot };
  }
  // A pause: everything let go.
  if (p.pause > 0) {
    p.pause -= 1;
    p.web = false;
    return { dir: 0, mag: 0, web: false, shot: 0 };
  }
  if (hb.pauseEvery > 0 && coin(p.m) < 1 / (hb.pauseEvery * 60)) {
    p.pause = 24 + Math.floor(coin(p.m) * 30);
    p.web = false;
    return { dir: 0, mag: 0, web: false, shot: 0 };
  }
  // A wrong turn now and then: the stick well off the way for a second or two.
  if (p.wrong > 0) p.wrong -= 1;
  else if (hb.wrongEvery > 0 && coin(p.m) < 1 / (hb.wrongEvery * 60)) {
    p.wrong = 60 + Math.floor(coin(p.m) * 60);
    p.wrongBy = (coin(p.m) < 0.5 ? 1 : -1) * (1.75 + coin(p.m) * 1.05);
    p.aimAt = t;
  }
  // The stick: re-aimed now and then, off by a little.
  if (t >= p.aimAt) {
    p.aimAt = t + hb.aimEvery;
    if (want.mag > 0 && (hb.noise > 0 || p.wrong > 0)) {
      const [x, z] = DIR64[want.dir];
      const a = (coin(p.m) * 2 - 1) * hb.noise + (p.wrong > 0 ? p.wrongBy : 0);
      const c = dcos(a);
      const sn = dsin(a);
      p.dir = dirIndex(x * c - z * sn, x * sn + z * c);
    } else p.dir = want.dir;
    p.mag = want.mag;
  }
  // The web: a release a little late (or a swing let go too soon), a press a little slow.
  let web = want.web;
  if (h.rope) {
    if (p.swingT < 0) {
      p.swingT = 0;
      p.earlyAt = coin(p.m) < hb.early ? 15 + Math.floor(coin(p.m) * 18) : -1;
    }
    p.swingT += 1;
  } else p.swingT = -1;
  if (h.rope && p.earlyAt >= 0 && p.swingT >= p.earlyAt) web = false;
  else if (p.web && !web && h.rope) {
    if (p.late <= 0 && hb.lateMax > 0) p.late = 1 + Math.floor(coin(p.m) * hb.lateMax);
    if (p.late > 0) {
      p.late -= 1;
      web = p.late > 0;
    }
  } else if (web) p.late = 0;
  // A fresh press in the air comes a little slow.
  if (want.web && !p.botWeb && !h.rope && !h.grounded && hb.pressLate > 0) p.press = Math.floor(coin(p.m) * hb.pressLate);
  p.botWeb = want.web;
  if (p.press > 0) {
    p.press -= 1;
    web = false;
  }
  p.web = web;
  return { dir: p.mag ? p.dir : 0, mag: p.mag, web, shot: want.shot };
}

export interface FeeRunStats {
  policy: FeePolicy;
  seed: number;
  cleared: boolean;
  ko: boolean;
  escaped: boolean;
  /** Seconds: the night, the investigation (to the third clue), the chase (grab to the bakery), the fight (live to won), the cooling. */
  seconds: number;
  investigate: number;
  chase: number;
  fight: number;
  cool: number;
  /** The chase: the gap's mean, median and 90th percentile (units, across), the share of it spent past SAFE_GAP and past ESCAPE_GAP, its losses. */
  gapMean: number;
  gapP50: number;
  gapP90: number;
  behind: number;
  far: number;
  losses: number;
  bombs: number;
  bombHits: number;
  /** Health at the start, at the fight, and left; the damage in the chase, the fight and the cooling. */
  hpStart: number;
  hpFight: number;
  hpLeft: number;
  chaseDamage: number;
  fightDamage: number;
  coolDamage: number;
  spikes: number;
  spikeHits: number;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A hero for the case: night 3's (level 2, 106 health, sling, bomb, shield and heal). */
export const feeHero = (night = 3): Save => nightHero(night);

/** One Fee Strike night with `policy` throughout. */
export function playFee(policy: FeePolicy, seed: number, save = feeHero()): FeeRunStats & { run: Run } {
  const run = startChapterRun(save, seed, "case-003");
  if (run.error) throw new Error(run.error);
  const travel = newTraveller(seed ^ 0x3c03);
  const fightBot = newBotMemory();
  const fm = newPlayerMem(seed ^ 0x51ab);
  const out: FeeRunStats = {
    policy,
    seed,
    cleared: false,
    ko: false,
    escaped: false,
    seconds: 0,
    investigate: 0,
    chase: 0,
    fight: 0,
    cool: 0,
    gapMean: 0,
    gapP50: 0,
    gapP90: 0,
    behind: 0,
    far: 0,
    losses: 0,
    bombs: 0,
    bombHits: 0,
    hpStart: run.sim.hp,
    hpFight: 0,
    hpLeft: 0,
    chaseDamage: 0,
    fightDamage: 0,
    coolDamage: 0,
    spikes: 0,
    spikeHits: 0,
  };
  const gaps: number[] = [];
  let last: SimEvent[] = [];
  let grabAt = -1;
  let endAt = -1;
  let liveAt = -1;
  let wonAt = -1;
  let coolAt = -1;
  let cooledAt = -1;
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    const s = run.sim;
    const f = s.fee!;
    let frame: InputFrame;
    if (s.mode === "travel") frame = policy === "bot" ? botFrame(s, travel.bot) : travelFrame(policy, s, travel);
    else if (f.phase === "cool" && s.mode === "fight") {
      const dodge = policy === "bot" || policy === "good" ? true : policy === "simple" ? false : (() => {
        if (f.spikeWind > 0 && travel.spikeSeen !== Math.floor(f.coolT)) {
          travel.spikeSeen = Math.floor(f.coolT);
          travel.spikeOut = coin(travel.m) < 0.5;
        }
        return travel.spikeOut;
      })();
      frame = coolFrame(s, 0, dodge);
    } else if (policy !== "bot" && s.mode === "fight") frame = playerFrame(policy, s, fm, last);
    else frame = botFrame(s, fightBot);
    const events = stepRun(run, frame);
    last = events;
    if (f.phase === "chase" && s.villain) gaps.push(len2(s.hero.x - s.villain.x, s.hero.z - s.villain.z));
    for (const e of events) {
      if (e.type === "fee-clue" && e.found === e.of) out.investigate = s.tick / 60;
      if (e.type === "meter-grab") grabAt = s.tick;
      if (e.type === "chase-end") endAt = s.tick;
      if (e.type === "chase-lost") out.losses += 1;
      if (e.type === "chase-escaped") out.escaped = true;
      if (e.type === "fight-live") {
        liveAt = s.tick;
        out.hpFight = s.hp;
      }
      if (e.type === "fight-won") wonAt = s.tick;
      if (e.type === "villain-attack" && e.label === "Fee bomb" && f.phase === "chase") out.bombs += 1;
      if (e.type === "fee-spike") {
        out.spikes += 1;
        if (e.hit) out.spikeHits += 1;
      }
      if (e.type === "fees-cooled") cooledAt = s.tick;
      if (e.type === "hero-hurt") {
        if (f.phase === "chase") {
          out.chaseDamage += e.damage;
          if (e.source === "a fee bomb") out.bombHits += 1;
        } else if (f.phase === "cool") out.coolDamage += e.damage;
        else out.fightDamage += e.damage;
      }
    }
    if (f.phase === "cool" && coolAt < 0) coolAt = s.tick;
  }
  const s = run.sim;
  out.cleared = chapterCleared(run);
  out.ko = s.hp <= 0;
  out.seconds = s.tick / 60;
  out.chase = grabAt >= 0 ? ((endAt >= 0 ? endAt : s.tick) - grabAt) / 60 : 0;
  out.fight = liveAt >= 0 ? ((wonAt >= 0 ? wonAt : s.tick) - liveAt) / 60 : 0;
  out.cool = coolAt >= 0 && cooledAt >= 0 ? (cooledAt - coolAt) / 60 : 0;
  out.gapMean = gaps.length ? gaps.reduce((a, g) => a + g, 0) / gaps.length : 0;
  out.gapP50 = pct(gaps, 0.5);
  out.gapP90 = pct(gaps, 0.9);
  out.behind = gaps.length ? gaps.filter((g) => g > SAFE_GAP).length / gaps.length : 0;
  out.far = gaps.length ? gaps.filter((g) => g > ESCAPE_GAP).length / gaps.length : 0;
  out.hpLeft = s.hp;
  return { ...out, run };
}

export interface FeeSummary {
  runs: number;
  clear: number;
  ko: number;
  escaped: number;
  /** Chases with at least one loss (the chase's failure rate), and losses per chase. */
  lostOnce: number;
  losses: number;
  night: number;
  inv: number;
  chase: number;
  chaseP90: number;
  gap: number;
  gapP90: number;
  behind: number;
  far: number;
  bombHit: number;
  chaseDmg: number;
  hpFight: number;
  fight: number;
  fightDmg: number;
  cool: number;
  spikeHit: number;
}

export function summarizeFee(rs: FeeRunStats[]): FeeSummary {
  const n = Math.max(1, rs.length);
  const mean = (k: keyof FeeRunStats) => r2(rs.reduce((a, r) => a + (r[k] as number), 0) / n);
  const chased = rs.filter((r) => r.chase > 0);
  return {
    runs: rs.length,
    clear: r2(rs.filter((r) => r.cleared).length / n),
    ko: r2(rs.filter((r) => r.ko).length / n),
    escaped: r2(rs.filter((r) => r.escaped).length / n),
    lostOnce: r2(chased.filter((r) => r.losses > 0).length / Math.max(1, chased.length)),
    losses: mean("losses"),
    night: r2(pct(rs.map((r) => r.seconds), 0.5)),
    inv: r2(pct(rs.map((r) => r.investigate), 0.5)),
    chase: r2(pct(chased.map((r) => r.chase), 0.5)),
    chaseP90: r2(pct(chased.map((r) => r.chase), 0.9)),
    gap: Math.round(pct(chased.map((r) => r.gapP50), 0.5)),
    gapP90: Math.round(pct(chased.map((r) => r.gapP90), 0.5)),
    behind: mean("behind"),
    far: mean("far"),
    bombHit: r2(rs.reduce((a, r) => a + r.bombHits, 0) / Math.max(1, rs.reduce((a, r) => a + r.bombs, 0))),
    chaseDmg: mean("chaseDamage"),
    hpFight: mean("hpFight"),
    fight: r2(pct(rs.filter((r) => r.fight > 0).map((r) => r.fight), 0.5)),
    fightDmg: mean("fightDamage"),
    cool: r2(pct(rs.filter((r) => r.cool > 0).map((r) => r.cool), 0.5)),
    spikeHit: r2(rs.reduce((a, r) => a + r.spikeHits, 0) / Math.max(1, rs.reduce((a, r) => a + r.spikes, 0))),
  };
}

export const FEE_SEEDS = Array.from({ length: 24 }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);

export function feeRuns(policy: FeePolicy, seeds = FEE_SEEDS, save = feeHero()): FeeRunStats[] {
  return seeds.map((seed) => {
    const { run: _run, ...stats } = playFee(policy, seed, save);
    return stats;
  });
}

export function feeTable(rows: [string, FeeSummary][]): string {
  const cols = Object.keys(rows[0]?.[1] ?? {}) as (keyof FeeSummary)[];
  const w = Math.max(...rows.map(([k]) => k.length), 8);
  const head = ["".padEnd(w), ...cols.map((c) => c.padStart(Math.max(6, c.length)))].join(" ");
  const lines = rows.map(([k, s]) => [k.padEnd(w), ...cols.map((c) => String(s[c]).padStart(Math.max(6, c.length)))].join(" "));
  return [head, ...lines].join("\n");
}

/** The report FEE_REPORT=1 prints: nights 1 and 3, every player. */
export function feeReport(seeds = FEE_SEEDS): string {
  const rows: [string, FeeSummary][] = [];
  for (const night of [1, 3]) for (const policy of FEE_POLICIES) rows.push([`night-${night} ${policy}`, summarizeFee(feeRuns(policy, seeds, feeHero(night)))]);
  return feeTable(rows);
}
