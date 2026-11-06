import { describe, expect, it } from "vitest";

import { replayRoam, roamLog, startRoamRun } from "@wgp/game-core/roam";
import { freshStart, newRoamBot, roamBotFrame, roamTour, roamWorld, TASK_DONE } from "@wgp/game-core/sim3d/roam";

import { RoamLoop, type RoamLoopEvent } from "./roam-loop";

describe("the roam loop", () => {
  it("steps the outing at 60 Hz from its source, fills the roam frame, publishes the HUD", () => {
    let now = 0;
    const loop = new RoamLoop(startRoamRun(freshStart()), () => now);
    const mem = newRoamBot(roamTour(roamWorld()));
    loop.setSource((run) => roamBotFrame(run.sim, mem));
    const events: RoamLoopEvent[] = [];
    loop.bus.on((e) => events.push(e));
    loop.start();
    for (let i = 0; i < 60 * 40; i++) {
      now += 1000 / 60;
      loop.advance(1 / 60);
    }
    expect(loop.run.sim.tick).toBeGreaterThan(60 * 28);
    expect(loop.view.roam?.folks.length).toBe(roamWorld().folks.length);
    const hud = loop.hud.getSnapshot()!;
    expect(hud.status).toBe("live");
    expect(hud.tasks.find((t) => t.id === "pickpocket")?.stage).toBe(TASK_DONE);
    expect(hud.pages).toBe(1);
    expect(events.some((e) => e.type === "roam-page")).toBe(true);
    // What the loop recorded replays to the same outing.
    const res = replayRoam({ start: freshStart(), log: roamLog(loop.run) });
    expect(res.ok).toBe(true);
    expect(res.outing.stage).toEqual(loop.run.sim.roam!.progress.stage);
  });

  it("waits while paused, and carries on in the next outing after replace()", () => {
    let now = 0;
    const loop = new RoamLoop(startRoamRun(freshStart()), () => now);
    loop.start();
    loop.setPaused(true);
    for (let i = 0; i < 30; i++) loop.advance(1 / 60);
    expect(loop.run.sim.tick).toBe(0);
    loop.setPaused(false);
    for (let i = 0; i < 30; i++) {
      now += 16;
      loop.advance(1 / 60);
    }
    expect(loop.run.sim.tick).toBeGreaterThan(20);
    const next = startRoamRun({ ...freshStart(), at: { x: 3810, y: 0, z: 600, fx: 0, fz: 1 } });
    loop.replace(next);
    loop.advance(1 / 60);
    expect(loop.view.hero.pos.x).toBeCloseTo(3810, 0);
  });
});
