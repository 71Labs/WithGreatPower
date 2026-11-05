/**
 * Case File 001 through the browser's loop (/play/patrol?case=001): the RunLoop steps a chapter
 * run like a patrol night, the blended frame carries the v1.5 chapter fields, the HUD snapshot
 * its `chapter`, and the recorded log is what the server replays as the chapter.
 */
import { newSave, reduce } from "@wgp/game-core/engine";
import { chapterCleared, replayRun, runHash, runLog, startChapterRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";
import { describe, expect, it } from "vitest";

import { chapterLocalSeed } from "./night";
import { RunLoop } from "./loop3d";

const heroSave = (): Save => reduce(newSave(), { type: "create-hero", name: "Detective", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });

describe("a chapter night in the 3D loop", () => {
  it("plays Case File 001 to the end, with the chapter in the frame and the HUD, into a log the server accepts", () => {
    const save = heroSave();
    const seed = chapterLocalSeed(save, "case-001");
    const run = startChapterRun(save, seed, "case-001");
    expect(run.error).toBeNull();
    let t = 0;
    const loop = new RunLoop(run, { introSeconds: 0.1, outroSeconds: 0.1, now: () => t });
    const mem = newBotMemory();
    loop.setSource((r) => botFrame(r.sim, mem));
    const seen = new Set<string>();
    const phases = new Set<string>();
    let aim = false;
    let closed = 0;
    loop.bus.on((ev) => {
      seen.add(ev.type);
      if (ev.type === "case-closed") closed += 1;
    });
    loop.start();
    const frames = [1 / 60, 1 / 30, 1 / 144, 0.05];
    let i = 0;
    while (loop.status !== "done" && i < 400_000) {
      const dt = frames[i++ % frames.length];
      t += dt * 1000;
      loop.advance(dt);
      const ch = loop.view.chapter;
      expect(ch).toBeTruthy();
      phases.add(ch!.phase);
      if (loop.view.villains.some((v) => v.id === "right-clicker" && v.aim)) aim = true;
      const hud = loop.hud.getSnapshot();
      if (hud && hud.chapter) {
        expect(hud.chapter.clues).toBe(3);
        // The villain bar through the standoff (so the phone HUD makes room), none in the rescue.
        if (hud.chapter.phase === "standoff" && (hud.mode === "fight" || hud.mode === "intro")) expect(hud.villain).toMatchObject({ kind: "right-clicker", name: "The Right-Clicker", hitsMax: 8 });
        if (hud.chapter.phase === "rescue" || hud.chapter.phase === "investigate") expect(hud.villain).toBeNull();
      }
    }
    expect(loop.status).toBe("done");
    expect(run.error).toBeNull();
    expect(chapterCleared(run)).toBe(true);
    expect([...phases]).toEqual(["investigate", "standoff", "rescue", "done"]);
    expect(aim).toBe(true);
    for (const type of ["clue-found", "encounter", "screenshot", "copy-spawn", "copy-pop", "fight-won", "captive-restore", "captive-freed", "night-over"]) expect(seen.has(type), type).toBe(true);
    expect(closed).toBe(1);
    const hud = loop.hud.getSnapshot()!;
    expect(hud.chapter).toMatchObject({ id: "case-001", phase: "done", cluesFound: 3, restore: 1, freed: true });

    const verdict = replayRun({ save, seed, log: runLog(run) }, { chapter: "case-001" });
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(verdict.hash).toBe(runHash(run));
    expect(verdict.stats.cleared).toBe(1);
  });
});
