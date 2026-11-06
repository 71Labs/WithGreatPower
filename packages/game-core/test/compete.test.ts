/**
 * The competitive rules (rules/compete.ts) and ghosts (ghost.ts): the Daily Run's standard
 * hero (the same city for everyone on a seed, whatever they look like), duels on a ranked
 * night's own save, medals, and a ghost replaying exactly in step with its verified run.
 */
import { describe, expect, it } from "vitest";

import { buildGhost, ghostGap, ghostPose, ghostTickAt, ProgressMeter, raceProgress } from "../src/ghost";
import { GOLDEN_CASES, GOLDEN_EXPECT, goldenLog, goldenSave } from "../src/golden";
import { TRIAL_GOLDEN_EXPECT, trialGoldenLog, trialGoldenSave } from "../src/golden-trial";
import { hashState } from "../src/hash";
import { decodeInputCodes, frameFromCode } from "../src/input/log";
import { chooseErrand, needsErrand, replayRun, runLog, startRun, startTrialRun, stepRun } from "../src/replay";
import {
  COURSES,
  compareRuns,
  DAILY_LEVEL,
  DAILY_NIGHT,
  dailyKit,
  dailySave,
  duelSave,
  isDayKey,
  medalFor,
  medalOfTier,
  medalTier,
  raceClock,
  raceGap,
  trialSave,
} from "../src/rules/compete";
import { STARTER_POWERS } from "../src/rules/data";
import { TRIAL_COURSE_IDS } from "../src/sim3d/trial";
import { playBot } from "./helpers";

describe("the Daily Run", () => {
  it("rotates a public kit by day: three starters and one advanced power", () => {
    const kit = dailyKit("2026-11-05");
    expect(kit).toHaveLength(4);
    expect(new Set(kit).size).toBe(4);
    expect(kit.slice(0, 3).every((p) => STARTER_POWERS.includes(p))).toBe(true);
    expect(STARTER_POWERS.includes(kit[3])).toBe(false);
    expect(dailyKit("2026-11-05")).toEqual(kit);
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(5 + i).padStart(2, "0")}`);
    expect(new Set(days.map((d) => dailyKit(d).join())).size).toBeGreaterThan(5);
  });

  it("is the same standard hero for everyone, dressed as each player", () => {
    const a = dailySave("2026-11-05", { name: "Alice", suit: "mint" });
    const b = dailySave("2026-11-05", { name: "Bob", suit: "snow" });
    expect(a.hero!.name).toBe("Alice");
    expect(a.hero!.suit).toBe("mint");
    expect(b.hero!.suit).toBe("snow");
    for (const s of [a, b]) {
      expect(s.night).toBe(DAILY_NIGHT);
      expect(s.hero!.level).toBe(DAILY_LEVEL);
      expect(s.hero!.loadout).toEqual(dailyKit("2026-11-05"));
      expect(s.nightDone).toBe(false);
      expect(s.patrol).toBeNull();
      expect(s.editions).toEqual([]);
    }
    // A bad look falls back to the Node in the classic suit.
    const c = dailySave("2026-11-05", { name: "   ", suit: "nope" as never });
    expect(c.hero!.name).toBe("The Node");
    expect(c.hero!.suit).toBe("classic");
  });

  it("plays the same city on the day's seed for every player, so one player's log replays on another's save", () => {
    const seed = 0xd417;
    const alice = dailySave("2026-11-05", { name: "Alice", suit: "mint" });
    const bob = dailySave("2026-11-05", { name: "Bob", suit: "snow" });
    const ra = startRun(alice, seed);
    const rb = startRun(bob, seed);
    expect(ra.error).toBeNull();
    expect(rb.save.patrol!.stops).toEqual(ra.save.patrol!.stops);
    expect(hashState(rb.sim)).toBe(hashState(ra.sim));
    const played = playBot(alice, seed, { maxTicks: 4000 });
    const log = runLog(played.run);
    // Bob's ghost of Alice's run (the same inputs on Bob's save) is the same run.
    const onBob = startRun(bob, seed);
    const { codes, events } = decodeInputCodes(log);
    let e = 0;
    for (const code of codes) {
      while (e < events.length && events[e].tick <= onBob.sim.tick && needsErrand(onBob)) chooseErrand(onBob, events[e++].value);
      stepRun(onBob, frameFromCode(code));
    }
    expect(hashState(onBob.sim)).toBe(hashState(played.run.sim));
  });

  it("knows a day key", () => {
    expect(isDayKey("2026-11-05")).toBe(true);
    expect(isDayKey("2026-11-5")).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});

describe("duels", () => {
  it("race a ranked night on its own start save: the challenger's look, the same run", () => {
    const c = GOLDEN_CASES[0];
    const start = goldenSave(c);
    const duel = duelSave(start, { name: "Challenger", suit: "midnight" });
    expect(duel.hero!.name).toBe("Challenger");
    expect(duel.hero!.suit).toBe("midnight");
    expect({ ...duel.hero, name: start.hero!.name, suit: start.hero!.suit }).toEqual(start.hero);
    expect(duel.night).toBe(start.night);
    // The night's own log replays on the duel save to the same result.
    const res = replayRun({ save: duel, seed: c.seed, log: goldenLog(c) });
    expect(res.hash).toBe(GOLDEN_EXPECT[c.name].hash);
  });
});

describe("medals and race clocks", () => {
  it("gives dev, gold, silver and bronze by time, and none past bronze", () => {
    for (const id of TRIAL_COURSE_IDS) {
      const m = COURSES[id].medals;
      expect(m.dev).toBeLessThan(m.gold);
      expect(m.gold).toBeLessThan(m.silver);
      expect(m.silver).toBeLessThan(m.bronze);
      expect(medalFor(id, m.dev)).toBe("dev");
      expect(medalFor(id, m.gold)).toBe("gold");
      expect(medalFor(id, m.silver)).toBe("silver");
      expect(medalFor(id, m.bronze)).toBe("bronze");
      expect(medalFor(id, m.bronze + 1)).toBeNull();
      expect(COURSES[id].gates).toBeGreaterThan(3);
    }
    expect(medalTier("dev")).toBe(4);
    expect(medalTier(null)).toBe(0);
    expect(medalOfTier(2)).toBe("silver");
    expect(medalOfTier(0)).toBeNull();
  });

  it("formats race clocks and gaps", () => {
    expect(raceClock(0)).toBe("0:00.0");
    expect(raceClock(3864)).toBe("1:04.4");
    expect(raceGap(144)).toBe("+2.4 s");
    expect(raceGap(-48)).toBe("−0.8 s");
    expect(raceGap(0)).toBe("±0.0 s");
  });

  it("compares runs: trials by finish then time, patrols by score then time", () => {
    expect(compareRuns("trial", { score: 0, ticks: 500, finished: true }, { score: 0, ticks: 400, finished: false })).toBeLessThan(0);
    expect(compareRuns("trial", { score: 0, ticks: 500, finished: true }, { score: 0, ticks: 400, finished: true })).toBeGreaterThan(0);
    expect(compareRuns("patrol", { score: 9000, ticks: 9000, finished: true }, { score: 8000, ticks: 100, finished: true })).toBeLessThan(0);
    expect(compareRuns("patrol", { score: 9000, ticks: 9000, finished: true }, { score: 9000, ticks: 100, finished: true })).toBeGreaterThan(0);
  });
});

describe("ghosts", () => {
  it("replay a verified patrol night frame for frame: the server's checkpoints, and the live run's hero at every tick", () => {
    const c = GOLDEN_CASES[0];
    const g = buildGhost({ save: goldenSave(c), seed: c.seed, log: goldenLog(c) });
    expect(g.ok, g.reason).toBe(true);
    expect(g.checkpoints).toEqual(GOLDEN_EXPECT[c.name].checkpoints);
    expect(g.hash).toBe(GOLDEN_EXPECT[c.name].hash);
    expect(g.ticks).toBe(GOLDEN_EXPECT[c.name].ticks);
    expect(g.splits.length).toBe(4);
    // A live run stepped from the same log is where the ghost says, every tick.
    const run = startRun(goldenSave(c), c.seed);
    const { codes, events } = decodeInputCodes(goldenLog(c));
    let e = 0;
    let checked = 0;
    for (const code of codes) {
      while (e < events.length && events[e].tick <= run.sim.tick && needsErrand(run)) chooseErrand(run, events[e++].value);
      stepRun(run, frameFromCode(code));
      const p = ghostPose(g, run.sim.tick);
      expect(p.x).toBe(Math.fround(run.sim.hero.x));
      expect(p.y).toBe(Math.fround(run.sim.hero.y));
      expect(p.z).toBe(Math.fround(run.sim.hero.z));
      checked += 1;
    }
    expect(checked).toBe(g.ticks);
    // Progress only climbs, and ends at the route's length.
    for (let i = 1; i <= g.ticks; i++) expect(g.progress[i]).toBeGreaterThanOrEqual(g.progress[i - 1]);
    expect(g.progress[g.ticks]).toBe(4);
  });

  it("replay a trial's golden with its splits, and measure a race against it", () => {
    const course = "canyon-swing";
    const g = buildGhost({ save: trialGoldenSave(), seed: 0, log: trialGoldenLog(course) }, { trial: course });
    expect(g.ok, g.reason).toBe(true);
    expect(g.hash).toBe(TRIAL_GOLDEN_EXPECT[course].hash);
    expect(g.checkpoints).toEqual(TRIAL_GOLDEN_EXPECT[course].checkpoints);
    expect(g.splits).toHaveLength(COURSES[course].gates);
    expect(g.splits[g.splits.length - 1]).toBe(g.ticks);
    expect(g.finished).toBe(true);
    // Racing the same run: dead level the whole way.
    const run = startTrialRun(trialSave(), course);
    const meter = new ProgressMeter();
    const { codes } = decodeInputCodes(trialGoldenLog(course));
    for (const code of codes) {
      stepRun(run, frameFromCode(code));
      meter.update(run.sim);
      const gap = meter.gap(g, run.sim.tick);
      if (meter.best > 0) expect(gap).toBe(0);
    }
    // Ten seconds of standing still at the start: ten seconds behind as soon as you set off.
    expect(ghostTickAt(g, g.progress[g.ticks] + 1)).toBeNull();
    expect(ghostGap(g, 600 + 30, g.progress[30], 600 + 30)).toBe(600);
    expect(raceProgress(run.sim)).toBe(COURSES[course].gates);
  });

  it("refuse a log of another mode, and wait at their finish", () => {
    const c = GOLDEN_CASES[0];
    expect(buildGhost({ save: goldenSave(c), seed: c.seed, log: goldenLog(c) }, { trial: "bridge-run" }).ok).toBe(false);
    expect(buildGhost({ save: trialGoldenSave(), seed: 0, log: trialGoldenLog("bridge-run") }).ok).toBe(false);
    const g = buildGhost({ save: trialGoldenSave(), seed: 0, log: trialGoldenLog("bridge-run") }, { trial: "bridge-run" });
    const end = ghostPose(g, g.ticks + 500);
    expect(end.done).toBe(true);
    expect(end.x).toBe(g.x[g.ticks]);
  });
});
