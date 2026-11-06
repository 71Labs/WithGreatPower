/**
 * The race model the HUD reads: the live gap to the chased ghost and the splits, against the
 * trials' golden ghosts (a ghost raced by its own inputs is level all the way).
 */
import { buildGhost } from "@wgp/game-core/ghost";
import { trialGoldenLog, trialGoldenSave } from "@wgp/game-core/golden-trial";
import { decodeInputCodes, frameFromCode } from "@wgp/game-core/input";
import { startTrialRun, stepRun } from "@wgp/game-core/replay";
import { describe, expect, it } from "vitest";

import { GHOST_COLORS, Race, type RaceGhost } from "./race";

function ghostOf(course: "bridge-run" | "canyon-swing", over: Partial<RaceGhost> = {}): RaceGhost {
  const track = buildGhost({ save: trialGoldenSave(), seed: 0, log: trialGoldenLog(course) }, { trial: course });
  return { runId: "g", label: "#1", handle: "ace", heroName: null, rank: 1, score: 0, ticks: track.ticks, finished: true, mine: false, role: "first", css: GHOST_COLORS.first, rgb: [1, 1, 0], track, synced: true, ...over };
}

describe("a race against ghosts", () => {
  it("chases the first ghost that isn't yours, and is level with a ghost of its own inputs", () => {
    const g = ghostOf("canyon-swing");
    const mine = { ...g, runId: "m", label: "You", mine: true, role: "you" as const };
    const race = new Race([mine, g], "trial", 6);
    expect(race.target?.label).toBe("#1");
    const run = startTrialRun(trialGoldenSave(), "canyon-swing");
    const { codes } = decodeInputCodes(trialGoldenLog("canyon-swing"));
    let splits = 0;
    for (const code of codes) {
      for (const ev of stepRun(run, frameFromCode(code))) {
        if (ev.type === "trial-gate") {
          race.split(ev.index, ev.ticks);
          splits += 1;
        }
      }
      race.update(run);
    }
    const snap = race.getSnapshot();
    expect(splits).toBe(6);
    expect(snap.splits.map((s) => s.gap)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(snap.last?.index).toBe(5);
    expect(snap.gap).toBe(0);
  });

  it("puts a slower start behind by the time it lost", () => {
    const g = ghostOf("bridge-run");
    const race = new Race([g], "trial", 6);
    const run = startTrialRun(trialGoldenSave(), "bridge-run");
    // Stand still for a second, then run the ghost's own inputs.
    for (let i = 0; i < 60; i++) stepRun(run, { dir: 0, mag: 0, web: false, shot: 0 });
    const { codes } = decodeInputCodes(trialGoldenLog("bridge-run"));
    for (const code of codes.slice(0, 200)) {
      for (const ev of stepRun(run, frameFromCode(code))) if (ev.type === "trial-gate") race.split(ev.index, ev.ticks);
      race.update(run);
    }
    expect(race.getSnapshot().gap).toBe(60);
    for (const s of race.getSnapshot().splits) expect(s.gap).toBe(60);
  });

  it("notifies the HUD at a split, and races alone without ghosts", () => {
    const race = new Race([], "daily", 4);
    let calls = 0;
    const off = race.subscribe(() => (calls += 1));
    race.split(0, 900);
    expect(calls).toBe(1);
    expect(race.getSnapshot()).toMatchObject({ target: null, gap: null, last: { index: 0, tick: 900, gap: null } });
    off();
  });
});
