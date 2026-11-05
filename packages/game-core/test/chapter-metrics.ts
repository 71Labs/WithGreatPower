/**
 * Case File 001's metrics: whole chapter nights played by the scripted players of
 * fight-metrics.ts. The bot investigates (it swings to every clue and the bridge); in the
 * standoff one of the players fights the Right-Clicker; in the rescue they go to Mary and hold
 * the web:
 *
 * - simple: never dodges, mashes the web close in; in the rescue it just holds the web.
 * - average: dodges a wind-up half the time; in the rescue it punches a copy winding up in
 *   reach half the time.
 * - good: dodges nearly everything; in the rescue it punches every copy that winds up in reach.
 * - bot: the sim's own bot throughout.
 *
 * Printed with CHAPTER_REPORT=1 (chapter.test.ts); chapter.test.ts pins the gates on it.
 */
import { besideCaptive, COPY_RADIUS, RESTORE_REACH } from "../src/sim3d/chapter";
import { chapterCleared, startChapterRun, stepRun, type Run } from "../src/replay";
import type { Save } from "../src/rules/types";
import type { InputFrame } from "../src/sim3d/contract";
import { dirIndex, len2, len3 } from "../src/sim3d/dmath";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { fightPress } from "../src/sim3d/strike";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { coin, newPlayerMem, nightHero, playerFrame, type PlayerMem } from "./fight-metrics";

export type ChapterPolicy = "bot" | "simple" | "average" | "good";
export const CHAPTER_POLICIES: ChapterPolicy[] = ["bot", "simple", "average", "good"];

export interface ChapterRunStats {
  policy: ChapterPolicy;
  seed: number;
  cleared: boolean;
  ko: boolean;
  /** The Right-Clicker was beaten (the rescue began). */
  fightWon: boolean;
  /** Seconds: the whole night, the investigation (start to the third clue), the fight (live to won), the rescue. */
  seconds: number;
  investigate: number;
  fight: number;
  rescue: number;
  hpStart: number;
  hpLeft: number;
  /** Health lost in the fight and in the rescue. */
  fightDamage: number;
  rescueDamage: number;
  screenshots: number;
  saved: number;
  drags: number;
  copies: number;
  /** Fight ticks with the hero off the ground, as a share. */
  heroAir: number;
  /** Street touches during the fight. */
  fightMisses: number;
}

/** The rescue as a player plays it: to Mary, hold the web; punch a winding copy in reach with chance `punch`. */
function rescueFrame(s: SimState, m: PlayerMem, punch: number, holding: { on: boolean }): InputFrame {
  const h = s.hero;
  const c = s.chapter!;
  const v = s.villain!;
  const frame: InputFrame = { dir: 0, mag: 0, web: false, shot: 0 };
  const dx = c.captive.x - h.x;
  const dz = c.captive.z - h.z;
  if (len2(dx, dz) > RESTORE_REACH * 0.5) {
    frame.dir = dirIndex(dx, dz);
    frame.mag = 3;
  }
  m.t += 1;
  if (punch > 0) {
    for (const b of v.bodies) {
      if (!b.alive || c.copyWind[b.slot] <= 0) continue;
      const gap = len3(b.x - h.x, b.y - h.y, b.z - h.z) - COPY_RADIUS - 26;
      // Decide once per wind-up (the first tick it's seen).
      if (gap < 110 && m.dodgeAt !== b.slot * 1000 + c.copies) {
        m.dodgeAt = b.slot * 1000 + c.copies;
        m.webReady = coin(m) < punch ? 1 : 0;
      }
      if (gap < 110 && m.webReady === 1 && fightPress(s).kind === "strike") {
        frame.web = !holding.on;
        holding.on = frame.web;
        return frame;
      }
    }
  }
  frame.web = besideCaptive(s);
  holding.on = frame.web;
  return frame;
}

/** A hero for the chapter: night 3's (level 2, 106 health, sling, bomb, shield and heal). */
export const chapterHero = (night = 3): Save => nightHero(night);

/** One chapter night with `policy` in the standoff and the rescue (the bot investigates). */
export function playChapter(policy: ChapterPolicy, seed: number, save = chapterHero()): ChapterRunStats & { run: Run } {
  const run = startChapterRun(save, seed, "case-001");
  if (run.error) throw new Error(run.error);
  const travel = newBotMemory();
  const fightBot = newBotMemory();
  const m = newPlayerMem(seed ^ 0x51ab);
  const holding = { on: false };
  const out: ChapterRunStats = {
    policy,
    seed,
    cleared: false,
    ko: false,
    fightWon: false,
    seconds: 0,
    investigate: 0,
    fight: 0,
    rescue: 0,
    hpStart: run.sim.hp,
    hpLeft: 0,
    fightDamage: 0,
    rescueDamage: 0,
    screenshots: 0,
    saved: 0,
    drags: 0,
    copies: 0,
    heroAir: 0,
    fightMisses: 0,
  };
  let last: SimEvent[] = [];
  let liveAt = -1;
  let wonAt = -1;
  let rescueAt = -1;
  let fightTicks = 0;
  let airTicks = 0;
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    const s = run.sim;
    const c = s.chapter!;
    let frame: InputFrame;
    if (policy !== "bot" && c.phase === "rescue" && s.mode === "fight") {
      frame = rescueFrame(s, m, policy === "simple" ? 0 : policy === "average" ? 0.5 : 1, holding);
    } else if (policy !== "bot" && c.phase === "standoff" && s.mode === "fight") {
      frame = playerFrame(policy, s, m, last);
    } else if (s.mode === "fight" || s.mode === "intro" || s.mode === "won") {
      frame = botFrame(s, fightBot);
    } else frame = botFrame(s, travel);
    const events = stepRun(run, frame);
    last = events;
    if (c.phase === "standoff" && s.mode === "fight") {
      fightTicks += 1;
      if (!s.hero.grounded) airTicks += 1;
    }
    for (const e of events) {
      if (e.type === "clue-found" && e.found === e.of) out.investigate = s.tick / 60;
      if (e.type === "fight-live") liveAt = s.tick;
      if (e.type === "fight-won") wonAt = s.tick;
      if (e.type === "screenshot") {
        out.screenshots += 1;
        if (e.hit) out.saved += 1;
      }
      if (e.type === "drag") out.drags += 1;
      if (e.type === "copy-spawn") out.copies += 1;
      if (e.type === "miss" && c.phase === "standoff" && s.mode !== "travel") out.fightMisses += 1;
      if (e.type === "hero-hurt") {
        if (c.phase === "rescue") out.rescueDamage += e.damage;
        else out.fightDamage += e.damage;
      }
      if (e.type === "captive-freed") out.rescue = (s.tick - rescueAt) / 60;
    }
    if (c.phase === "rescue" && rescueAt < 0) rescueAt = s.tick;
  }
  const s = run.sim;
  out.cleared = chapterCleared(run);
  out.ko = s.hp <= 0;
  out.seconds = s.tick / 60;
  out.fightWon = wonAt >= 0;
  out.fight = liveAt >= 0 ? ((wonAt >= 0 ? wonAt : s.tick) - liveAt) / 60 : 0;
  out.hpLeft = s.hp;
  out.heroAir = fightTicks ? airTicks / fightTicks : 0;
  return { ...out, run };
}

export interface ChapterSummary {
  runs: number;
  clearRate: number;
  fightWinRate: number;
  koRate: number;
  medianSeconds: number;
  p90Seconds: number;
  medianInvestigate: number;
  medianFight: number;
  p90Fight: number;
  medianRescue: number;
  meanFightDamage: number;
  meanRescueDamage: number;
  savedPerFight: number;
  screenshotsPerFight: number;
  heroAir: number;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function summarizeChapter(rs: ChapterRunStats[]): ChapterSummary {
  const n = Math.max(1, rs.length);
  const cleared = rs.filter((r) => r.cleared);
  const won = rs.filter((r) => r.fightWon);
  return {
    runs: rs.length,
    clearRate: r2(cleared.length / n),
    fightWinRate: r2(won.length / n),
    koRate: r2(rs.filter((r) => r.ko).length / n),
    medianSeconds: r2(pct(cleared.map((r) => r.seconds), 0.5)),
    p90Seconds: r2(pct(cleared.map((r) => r.seconds), 0.9)),
    medianInvestigate: r2(pct(rs.map((r) => r.investigate), 0.5)),
    medianFight: r2(pct(won.map((r) => r.fight), 0.5)),
    p90Fight: r2(pct(won.map((r) => r.fight), 0.9)),
    medianRescue: r2(pct(cleared.map((r) => r.rescue), 0.5)),
    meanFightDamage: r2(rs.reduce((a, r) => a + r.fightDamage, 0) / n),
    meanRescueDamage: r2(rs.reduce((a, r) => a + r.rescueDamage, 0) / n),
    savedPerFight: r2(rs.reduce((a, r) => a + r.saved, 0) / n),
    screenshotsPerFight: r2(rs.reduce((a, r) => a + r.screenshots, 0) / n),
    heroAir: r2(rs.reduce((a, r) => a + r.heroAir, 0) / n),
  };
}

export const CHAPTER_SEEDS = Array.from({ length: 24 }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);

/** Every policy over the seeds. */
export function chapterRuns(policy: ChapterPolicy, seeds = CHAPTER_SEEDS, save = chapterHero()): ChapterRunStats[] {
  return seeds.map((seed) => {
    const { run: _run, ...stats } = playChapter(policy, seed, save);
    return stats;
  });
}

export function chapterTable(rows: [string, ChapterSummary][]): string {
  const cols = Object.keys(rows[0]?.[1] ?? {}) as (keyof ChapterSummary)[];
  const w = Math.max(...rows.map(([k]) => k.length), 8);
  const head = ["".padEnd(w), ...cols.map((c) => c.padStart(Math.max(7, c.length)))].join(" ");
  const lines = rows.map(([k, s]) => [k.padEnd(w), ...cols.map((c) => String(s[c]).padStart(Math.max(7, c.length)))].join(" "));
  return [head, ...lines].join("\n");
}

/** The report CHAPTER_REPORT=1 prints. */
export function chapterReport(seeds = CHAPTER_SEEDS): string {
  const rows: [string, ChapterSummary][] = [];
  for (const night of [1, 3, 9]) {
    for (const policy of CHAPTER_POLICIES) rows.push([`night-${night} ${policy}`, summarizeChapter(chapterRuns(policy, seeds, chapterHero(night)))]);
  }
  return chapterTable(rows);
}
