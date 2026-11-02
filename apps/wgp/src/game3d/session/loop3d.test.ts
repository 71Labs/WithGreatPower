import { newSave, reduce, seedOf } from "@wgp/game-core/engine";
import { chooseErrand, needsErrand, replayRun, runHash, runLog, startRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";
import { describe, expect, it } from "vitest";

import { RunLoop } from "./loop3d";

const heroSave = (): Save => reduce(newSave(), { type: "create-hero", name: "Peter", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
const SEED = seedOf(1, "Peter");

/** The night played directly through game-core, the way the server verifier test does. */
function direct(save: Save, seed: number) {
  const run = startRun(save, seed);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  return run;
}

describe("the 3D loop", () => {
  it("plays a bot night through uneven frames into the same log and hash as game-core", () => {
    const run = startRun(heroSave(), SEED);
    expect(run.error).toBeNull();
    let t = 0;
    const loop = new RunLoop(run, { introSeconds: 0.1, outroSeconds: 0.1, now: () => t });
    const mem = newBotMemory();
    loop.setSource((r) => botFrame(r.sim, mem));
    let errand = false;
    let events = 0;
    loop.bus.on((ev) => {
      events += 1;
      if (ev.type === "errand") errand = true;
    });
    loop.start();
    // A mix of 30, 60, 75 and 144 Hz frames, and the odd hitch.
    const frames = [1 / 60, 1 / 30, 1 / 144, 1 / 75, 0.05, 1 / 60, 0.3];
    let i = 0;
    while (loop.status !== "done" && i < 400_000) {
      if (errand && loop.errandOpen) {
        expect(loop.chooseErrand(0)).toBe(true);
        errand = false;
      }
      const dt = frames[i++ % frames.length];
      t += dt * 1000;
      loop.advance(dt);
    }
    expect(loop.status).toBe("done");
    expect(run.error).toBeNull();
    expect(run.over).toBe(true);
    expect(events).toBeGreaterThan(10);

    const ref = direct(heroSave(), SEED);
    expect(run.sim.tick).toBe(ref.sim.tick);
    expect(Array.from(runLog(run))).toEqual(Array.from(runLog(ref)));
    expect(runHash(run)).toBe(runHash(ref));

    const verdict = replayRun({ save: run.start, seed: SEED, log: runLog(run) });
    expect(verdict.ok).toBe(true);
    expect(verdict.hash).toBe(runHash(run));
  }, 60_000);

  it("counts down, then steps at most five ticks a frame, and never while paused", () => {
    const run = startRun(heroSave(), SEED);
    const loop = new RunLoop(run, { introSeconds: 0.3, now: () => 0 });
    const counts: number[] = [];
    loop.bus.on((ev) => {
      if (ev.type === "countdown") counts.push(ev.value);
    });
    loop.start();
    expect(loop.status).toBe("intro");
    for (let k = 0; k < 3; k++) loop.advance(0.11);
    expect(counts).toEqual([3, 2, 1]);
    expect(loop.status).toBe("live");
    expect(run.sim.tick).toBe(0);

    loop.advance(1);
    expect(run.sim.tick).toBe(5);

    loop.setPaused(true);
    loop.advance(0.1);
    expect(run.sim.tick).toBe(5);
    expect(loop.status).toBe("paused");
    loop.setPaused(false);
    loop.advance(1 / 60);
    expect(run.sim.tick).toBe(6);
  });

  it("writes an interpolated view the scene can read", () => {
    const run = startRun(heroSave(), SEED);
    const loop = new RunLoop(run, { introSeconds: 0, now: () => 0 });
    loop.setSource(() => ({ dir: 0, mag: 0, web: true, shot: 0 }));
    loop.start();
    loop.advance(0.001);
    for (let k = 0; k < 30; k++) loop.advance(1 / 60);
    const v = loop.view;
    expect(v.tick).toBe(run.sim.tick);
    expect(Number.isFinite(v.hero.pos.x + v.hero.pos.y + v.hero.pos.z)).toBe(true);
    expect(v.alpha).toBeGreaterThanOrEqual(0);
    expect(v.alpha).toBeLessThanOrEqual(1);
  });
});
