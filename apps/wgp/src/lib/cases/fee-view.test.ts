import { describe, expect, it } from "vitest";

import { feeHud } from "@/game3d/session/hud";
import { startChapterRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import { reduce, newSave } from "@wgp/game-core/engine";

import { chaseCue, feeClue, feeEventLine, feeObjective, feePhaseLine, isFeeEvent } from "./fee-view";

const chase = (over: Partial<Parameters<typeof chaseCue>[0]> = {}) => ({ gap: 500, escape: 0, warn: false, checkpoint: 2, checkpoints: 8, losses: 0, maxLosses: 5, holding: false, ...over });

describe("Fee Strike in words", () => {
  it("names the objective for every phase, with the clue count while investigating", () => {
    expect(feeObjective({ phase: "investigate", cluesFound: 1, clues: 3 })).toEqual({ label: "Find the clues", count: { found: 1, total: 3 } });
    expect(feeObjective({ phase: "meter", cluesFound: 3, clues: 3 }).label).toBe("Find the fee meter");
    expect(feeObjective({ phase: "chase", cluesFound: 3, clues: 3 }).label).toBe("Keep up with Gas Goblin");
    expect(feeObjective({ phase: "showdown", cluesFound: 3, clues: 3 }, "travel").label).toBe("Land on Aunt Mainnet’s roof");
    expect(feeObjective({ phase: "showdown", cluesFound: 3, clues: 3 }, "fight").label).toBe("Stop Gas Goblin");
    expect(feeObjective({ phase: "cool", cluesFound: 3, clues: 3 }).label).toBe("Cool the fees");
    expect(feeObjective({ phase: "done", cluesFound: 3, clues: 3 }).label).toBe("Case closed");
  });

  it("reads the chase: on his tail, keeping up, behind, getting away, and him waiting", () => {
    expect(chaseCue(chase({ gap: 200 })).tone).toBe("tail");
    expect(chaseCue(chase({ gap: 600 })).tone).toBe("close");
    expect(chaseCue(chase({ gap: 1000 })).tone).toBe("behind");
    expect(chaseCue(chase({ gap: 1300, warn: true }))).toEqual({ tone: "away", text: "He’s getting away!" });
    expect(chaseCue(chase({ holding: true, warn: true })).tone).toBe("waiting");
  });

  it("says each clue's note, the meter's Downloads tie-in, losses and the ending out loud", () => {
    expect(feeClue("pretzel").note).toMatch(/400,000,000,000 gwei/);
    expect(feeEventLine({ type: "fee-clue", id: "florist", x: 0, y: 0, z: 0, found: 2, of: 3 })!.text).toMatch(/^Clue 2 of 3: the florist\./);
    expect(feeEventLine({ type: "meter-grab", x: 0, y: 0, z: 0 })!.text).toMatch(/Right-Clicker’s Downloads/);
    expect(feeEventLine({ type: "chase-lost", losses: 2, checkpoint: 3, x: 0, y: 0, z: 0 })!.text).toMatch(/2 of 5 lost/);
    expect(feeEventLine({ type: "fees-cooled", x: 0, y: 0, z: 0 })!.text).toMatch(/Fresh blocks, still warm/);
    expect(feeEventLine({ type: "meter-cool", p: 0.5 })).toBeNull();
    expect(feeEventLine({ type: "fee-spike", hit: false, x: 0, y: 0, z: 0 })).toBeNull();
    for (const phase of ["investigate", "meter", "chase", "showdown", "cool", "done"] as const) expect(feePhaseLine(phase).length).toBeGreaterThan(10);
    expect(isFeeEvent({ type: "fee-clue" })).toBe(true);
    expect(isFeeEvent({ type: "clue-found" })).toBe(false);
  });

  it("matches the sim's HUD through a real night (the snapshot game3d/session/hud.ts publishes)", () => {
    const save = reduce(newSave(), { type: "create-hero", name: "View Tester", suit: "classic", powers: ["web-sling", "web-shield", "wall-crawl"] });
    const run = startChapterRun(save, 0xfee5003, "case-003");
    const mem = newBotMemory();
    const phases = new Set<string>();
    let sawChase = false;
    while (!run.over && run.sim.tick < 54_000) {
      stepRun(run, botFrame(run.sim, mem));
      const h = feeHud(run.sim)!;
      phases.add(h.phase);
      expect(h.found).toHaveLength(3);
      expect(h.heat).toBeGreaterThanOrEqual(0);
      expect(h.heat).toBeLessThanOrEqual(1);
      if (h.chase) {
        sawChase = true;
        expect(h.chase.checkpoint).toBeLessThanOrEqual(h.chase.checkpoints);
        expect(chaseCue(h.chase).text.length).toBeGreaterThan(3);
      }
    }
    expect(sawChase).toBe(true);
    expect([...phases]).toEqual(["investigate", "meter", "chase", "showdown", "cool", "done"]);
    expect(feeHud(run.sim)).toMatchObject({ phase: "done", cooled: true, heat: 0, chase: null });
  });
});
