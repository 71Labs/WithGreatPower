/**
 * Time trials (sim3d/trial.ts, ruleset "trial-1"): the courses, the gates in order, the clock,
 * determinism, and the verifier refusing a log from any other mode or course.
 */
import { describe, expect, it } from "vitest";

import { replayTrialGolden, trialGoldenLog, trialGoldenSave } from "../src/golden-trial";
import { GOLDEN_CASES, goldenLog, goldenSave } from "../src/golden";
import { caseGoldenLog, caseGoldenSave, CASE_GOLDEN_CASE } from "../src/golden-case";
import { hashState } from "../src/hash";
import { decodeInputCodes, frameFromCode } from "../src/input/log";
import { encodeInputCodes } from "../src/input/log";
import { replayRun, resumeRun, runHash, runLog, startRun, startTrialRun, stepRun, trialFinished } from "../src/replay";
import { COURSES, trialSave } from "../src/rules/compete";
import { RULESET_VERSION } from "../src/score";
import { chapterLogRuleset } from "../src/sim3d/chapter";
import { CityIndex } from "../src/sim3d/city";
import { fillRenderFrame, newRenderFrame } from "../src/sim3d/render";
import { createSim, IDLE_FRAME } from "../src/sim3d/sim";
import { nextGate, openAir, TRIAL_COURSE_IDS, TRIAL_MAX_TICKS, trialLogRuleset } from "../src/sim3d/trial";

describe("time trials", () => {
  it("number every course's logs apart from each other, the patrol's and the chapter's", () => {
    const fields = TRIAL_COURSE_IDS.map(trialLogRuleset);
    expect(new Set(fields).size).toBe(TRIAL_COURSE_IDS.length);
    for (const f of fields) {
      expect(f).not.toBe(RULESET_VERSION);
      expect(f).not.toBe(chapterLogRuleset("case-001"));
      // A varint the log can hold (4 bytes, 28 bits).
      expect(f).toBeLessThan(2 ** 28);
    }
    expect(trialLogRuleset("rooftop-sprint")).toBe(0x07a10104);
  });

  for (const course of TRIAL_COURSE_IDS) {
    it(`${course}: a fixed city with no stops, the hero on the start roof, every gate in open air`, () => {
      const run = startTrialRun(trialSave(), course);
      expect(run.error).toBeNull();
      const s = run.sim;
      expect(s.city.zones).toHaveLength(0);
      expect(s.mode).toBe("travel");
      expect(s.trial).toEqual({ course, next: 0, splits: [], finished: false, endTick: -1 });
      expect(s.pickups).toHaveLength(COURSES[course].gates);
      expect(s.pickups.every((p) => p.kind === "ring" && !p.taken)).toBe(true);
      expect(s.hero.grounded).toBe(true);
      expect(s.hero.y).toBeCloseTo(s.city.start.y + 26, 5);
      const grid = new CityIndex(s.city);
      for (const g of s.pickups) expect(openAir(grid, g), `${course} gate ${g.id} at ${g.x},${g.y},${g.z}`).toBe(true);
      // Gates are a course, not a heap: each at least a short hop from the last.
      for (let i = 1; i < s.pickups.length; i++) {
        const a = s.pickups[i - 1];
        const b = s.pickups[i];
        expect(Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y), `${course} gates ${i - 1}→${i}`).toBeGreaterThan(200);
      }
      // The same course is the same race: same city, same gates, every time.
      const again = startTrialRun(trialSave({ name: "Someone else", suit: "mint" }), course);
      expect(hashState(again.sim)).toBe(hashState(s));
      expect(again.seed).toBe(COURSES[course].seed);
    });
  }

  it("takes gates only in order: the next one counts, a later one is just air", () => {
    const run = startTrialRun(trialSave(), "canyon-swing");
    const s = run.sim;
    const second = s.pickups[1];
    // Stand the hero in the second gate.
    s.hero.x = second.x;
    s.hero.y = second.y;
    s.hero.z = second.z;
    s.hero.grounded = false;
    stepRun(run, IDLE_FRAME);
    expect(s.pickups[1].taken).toBe(false);
    expect(s.trial!.next).toBe(0);
    // In the first, it counts (and points the route at the second).
    const first = s.pickups[0];
    s.hero.x = first.x;
    s.hero.y = first.y;
    s.hero.z = first.z;
    s.hero.vx = 300;
    const events = stepRun(run, IDLE_FRAME);
    expect(s.pickups[0].taken).toBe(true);
    expect(s.trial!.next).toBe(1);
    expect(s.trial!.splits).toEqual([s.tick]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["pickup", "trial-gate"]));
    expect(nextGate(s)).toBe(s.pickups[1]);
    // The ring's boost.
    expect(Math.hypot(s.hero.vx, s.hero.vy, s.hero.vz)).toBeGreaterThan(900);
  });

  it("stops the clock through the last gate, and times out unfinished", () => {
    const res = replayTrialGolden("bridge-run");
    expect(res.ok).toBe(true);
    expect(res.stats.finished).toBe(1);
    expect(res.stats.gates).toBe(res.stats.of);
    // Nobody moves: out of time at TRIAL_MAX_TICKS, unfinished.
    const run = startTrialRun(trialSave(), "rooftop-sprint");
    while (!run.over && run.sim.tick <= TRIAL_MAX_TICKS + 5) stepRun(run, IDLE_FRAME);
    expect(run.over).toBe(true);
    expect(run.sim.tick).toBe(TRIAL_MAX_TICKS);
    expect(run.sim.mode).toBe("done");
    expect(trialFinished(run)).toBe(false);
    const idle = replayRun({ save: run.start, seed: 0, log: runLog(run) }, { trial: "rooftop-sprint" });
    expect(idle.ok).toBe(true);
    expect(idle.stats.finished).toBe(0);
  });

  it("replays the same way every time, and from a reload", () => {
    for (const course of TRIAL_COURSE_IDS) {
      const log = trialGoldenLog(course);
      const a = replayRun({ save: trialGoldenSave(), seed: 0, log }, { trial: course });
      const b = replayRun({ save: trialGoldenSave(), seed: 12345, log }, { trial: course });
      expect(b.hash).toBe(a.hash);
      // Half the log, resumed (a reload), then the rest stepped live: the same finish.
      const { codes } = decodeInputCodes(log);
      const half = encodeInputCodes(codes.slice(0, codes.length >> 1), [], 0, trialLogRuleset(course));
      const run = resumeRun({ save: trialGoldenSave(), seed: 0, log: half }, { trial: course });
      expect(run.error).toBeNull();
      for (const code of codes.slice(codes.length >> 1)) stepRun(run, frameFromCode(code));
      expect(runHash(run)).toBe(a.hash);
    }
  });

  it("refuses a log from another mode, or another course", () => {
    const sprint = trialGoldenLog("rooftop-sprint");
    // A trial log is no patrol night…
    const asPatrol = replayRun({ save: goldenSave(GOLDEN_CASES[0]), seed: GOLDEN_CASES[0].seed, log: sprint });
    expect(asPatrol.ok).toBe(false);
    expect(asPatrol.reason).toBe(`ruleset ${trialLogRuleset("rooftop-sprint")} is not ${RULESET_VERSION}`);
    // …nor a case…
    const asCase = replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log: sprint }, { chapter: "case-001" });
    expect(asCase.ok).toBe(false);
    expect(asCase.reason).toMatch(/is not chapter case-001/);
    // …nor another course.
    const asBridge = replayRun({ save: trialGoldenSave(), seed: 0, log: sprint }, { trial: "bridge-run" });
    expect(asBridge.ok).toBe(false);
    expect(asBridge.reason).toBe(`ruleset ${trialLogRuleset("rooftop-sprint")} is not trial bridge-run's ${trialLogRuleset("bridge-run")}`);
    // A patrol night's log and a case's are no trial.
    const night = goldenLog(GOLDEN_CASES[0]);
    const nightAsTrial = replayRun({ save: trialGoldenSave(), seed: 0, log: night }, { trial: "rooftop-sprint" });
    expect(nightAsTrial.ok).toBe(false);
    expect(nightAsTrial.reason).toBe(`ruleset ${RULESET_VERSION} is not trial rooftop-sprint's ${trialLogRuleset("rooftop-sprint")}`);
    const caseAsTrial = replayRun({ save: trialGoldenSave(), seed: 0, log: caseGoldenLog() }, { trial: "rooftop-sprint" });
    expect(caseAsTrial.ok).toBe(false);
    // And a run can't be both.
    expect(replayRun({ save: trialGoldenSave(), seed: 0, log: sprint }, { trial: "rooftop-sprint", chapter: "case-001" }).ok).toBe(false);
  });

  it("leaves patrol and chapter states without a trial field, and their frames without a trial", () => {
    const c = GOLDEN_CASES[0];
    const run = startRun(goldenSave(c), c.seed);
    expect("trial" in run.sim).toBe(false);
    const frame = fillRenderFrame(run.sim, newRenderFrame());
    expect(frame.trial).toBeUndefined();
    const s = createSim({ seed: 1, stops: [], index: 0, entry: "travel", hp: 100, maxHp: 100, fluid: 100, combo: 0, gweiCalls: 1, heroLevel: 1, loadout: [], chapter: "case-001" });
    expect("trial" in s).toBe(false);
  });

  it("fills the frame's trial, its gates as rings and its route through the gates ahead", () => {
    const run = startTrialRun(trialSave(), "gauntlet");
    const f = fillRenderFrame(run.sim, newRenderFrame());
    expect(f.trial).toEqual({ course: "gauntlet", next: 0, gates: 7, ticks: 0, splits: [], finished: false, over: false });
    expect(f.pickups).toHaveLength(7);
    expect(f.pickups!.every((p) => p.kind === "ring")).toBe(true);
    expect(f.route).toHaveLength(7);
    expect(f.route![0]).toEqual({ x: run.sim.pickups[0].x, y: run.sim.pickups[0].y, z: run.sim.pickups[0].z });
  });
});
