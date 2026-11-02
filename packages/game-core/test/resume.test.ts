import { describe, expect, it } from "vitest";

import { finishRun, needsErrand, resumeRun, runHash, runLog } from "../src/replay";
import { newBotMemory } from "../src/sim3d/bot";
import { continueBot, heroSave, playBot, STANDARD } from "./helpers";

const SEED = 0x7e57;

describe("resume after a reload", () => {
  it("replaying the saved log from tick 0 gives back the live state, at every stop and mid-swing", () => {
    const save = heroSave(STANDARD, "Reload Hero", 3);
    const full = playBot(save, SEED).run;
    const total = full.sim.tick;
    for (const at of [1, 337, Math.floor(total * 0.3), Math.floor(total * 0.55), Math.floor(total * 0.8), total]) {
      const live = playBot(save, SEED, { maxTicks: at }).run;
      const resumed = resumeRun({ save: live.start, seed: SEED, log: runLog(live) });
      expect(resumed.error, `at ${at}`).toBeNull();
      expect(resumed.sim.tick).toBe(live.sim.tick);
      expect(runHash(resumed)).toBe(runHash(live));
      expect(resumed.checkpoints).toEqual(live.checkpoints);
      expect(JSON.stringify(resumed.save)).toBe(JSON.stringify(live.save));
      expect(needsErrand(resumed)).toBe(needsErrand(live));
    }
  });

  it("a resumed run carries on to the same night as one that was never interrupted", () => {
    const save = heroSave(STANDARD, "Reload Hero", 5);
    const straight = playBot(save, SEED).run;
    // Play about half, "reload", replay the log, and keep going with a fresh bot.
    const half = playBot(save, SEED, { maxTicks: Math.floor(straight.sim.tick / 2) }).run;
    const resumed = resumeRun({ save: half.start, seed: SEED, log: runLog(half) });
    expect(resumed.error).toBeNull();
    // The bot is stateless enough that a fresh one can pick up; the night must still finish
    // and verify, and its log is the old log plus the new frames.
    const after = continueBot(resumed, {}, newBotMemory()).run;
    expect(after.over).toBe(true);
    const prefix = runLog(half);
    const whole = runLog(after);
    expect(whole.length).toBeGreaterThan(0);
    const verified = finishRun(resumeRun({ save: after.start, seed: SEED, log: whole }));
    expect(verified.ok, verified.reason).toBe(true);
    expect(verified.hash).toBe(finishRun(after).hash);
    // The first half of the frames is exactly what was recorded before the reload.
    expect(after.codes.slice(0, half.codes.length)).toEqual(half.codes);
    expect(prefix.length).toBeGreaterThan(0);
  });
});
