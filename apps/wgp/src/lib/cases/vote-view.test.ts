/**
 * Case file 002 through the browser's loop (/play/patrol?case=002): the RunLoop steps it like any
 * night, the blended frame carries the v1.6 vote, and the HUD's view of it (vote-view.ts) tracks
 * the sim: the objective for each phase, the suspect profile filling in as the drop boxes are
 * read, the fork vote's side, the recount, the ballot. The recorded log is what the server
 * replays as Case file 002.
 */
import { describe, expect, it } from "vitest";

import { newSave, reduce } from "@wgp/game-core/engine";
import { chapterCleared, replayRun, runHash, runLog, startChapterRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";

import { chapterLocalSeed } from "@/game3d/session/night";
import { RunLoop } from "@/game3d/session/loop3d";

import { isVoteEvent, profileOf, voteCue, voteHud, voteLine, voteObjective, votePhaseLine } from "./vote-view";

const heroSave = (): Save => reduce(newSave(), { type: "create-hero", name: "Pollwatcher", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });

describe("Case file 002's HUD view", () => {
  it("follows a whole night in the loop: phases, profile, fork, recount, ballot; the log replays", () => {
    const save = heroSave();
    const seed = chapterLocalSeed(save, "case-002");
    const run = startChapterRun(save, seed, "case-002");
    expect(run.error).toBeNull();
    let t = 0;
    const loop = new RunLoop(run, { introSeconds: 0.1, outroSeconds: 0.1, now: () => t });
    const mem = newBotMemory();
    loop.setSource((r) => botFrame(r.sim, mem));
    const events: SimEvent[] = [];
    loop.bus.on((ev) => {
      if ("x" in ev || isVoteEvent(ev)) events.push(ev as SimEvent);
    });
    loop.start();
    const objectives = new Set<string>();
    const phases: string[] = [];
    let known = 0;
    let forkSeen = false;
    let recountSeen = false;
    const ballots = new Set<string>();
    let i = 0;
    while (loop.status !== "done" && i < 400_000) {
      const dt = [1 / 60, 1 / 30, 1 / 144][i++ % 3];
      t += dt * 1000;
      loop.advance(dt);
      const hud = voteHud(loop.view, loop.hud.getSnapshot()?.villain ?? null);
      expect(hud).toBeTruthy();
      if (!hud) continue;
      if (phases[phases.length - 1] !== hud.phase) phases.push(hud.phase);
      objectives.add(voteObjective(hud).label);
      // The profile fills in as the drop boxes are read, and never forgets.
      const k = hud.profile.filter((p) => p.known).length;
      expect(k).toBe(hud.found);
      expect(k).toBeGreaterThanOrEqual(known);
      known = k;
      for (const p of hud.profile) expect(!!p.words).toBe(p.known);
      if (hud.fork) {
        forkSeen = true;
        expect(hud.fork.left).toBeGreaterThanOrEqual(0);
        expect(hud.villain?.state === "vote" || hud.villain === null).toBe(true);
      }
      if (hud.recount) {
        recountSeen = true;
        expect(hud.villain).toBeNull();
      }
      if (hud.ballot) ballots.add(hud.ballot);
      if (hud.phase === "lineup") expect(hud.villain).toBeNull();
    }
    expect(loop.status).toBe("done");
    expect(chapterCleared(run)).toBe(true);
    expect(phases).toEqual(["investigate", "lineup", "standoff", "rescue", "done"]);
    expect(known).toBe(3);
    expect(forkSeen).toBe(true);
    expect(recountSeen).toBe(true);
    // (Caught beside the box, the ballot can go in a tick after it's taken: "carried" may not show.)
    expect(ballots.has("runner") && ballots.has("counted")).toBe(true);
    for (const o of ["Read the drop boxes", "Find the real Sybil", "Win the vote", "Recount: find him again", "Catch the ballot thief", "Case closed"]) expect(objectives.has(o), o).toBe(true);
    // Every case event has words (the recount's end needn't).
    const real = run.sim.chapter!.vote!.real;
    for (const ev of events) if (isVoteEvent(ev) && !(ev.type === "recount" && ev.end)) expect(voteLine(ev, real), ev.type).toBeTruthy();

    const verdict = replayRun({ save, seed, log: runLog(run) }, { chapter: "case-002" });
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(verdict.hash).toBe(runHash(run));
    expect(verdict.stats.cleared).toBe(1);
  });

  it("says each tell once its clue is read, either way", () => {
    const lines = profileOf({ real: { shadow: true, blink: false, left: true }, known: { shadow: true, blink: true, left: false } });
    expect(lines.map((l) => [l.label, l.words])).toEqual([
      ["Shadow", "Casts a shadow"],
      ["Eyes", "Never blinks"],
      ["Ballot", null],
    ]);
    expect(lines[2].clue).toBe("Smudged signature");
  });

  it("cues the fork vote and his openings in words, never colour alone", () => {
    expect(voteCue("vote", false)).toEqual({ text: "Fork vote!", tone: "warn" });
    expect(voteCue("idle", true)).toEqual({ text: "Open: hit him", tone: "open" });
    expect(voteCue("guard", false)).toEqual({ text: "Guarding", tone: "plain" });
    expect(voteCue("idle", false)).toBeNull();
    expect(votePhaseLine("lineup", "polls")).toMatch(/matches all three/);
    expect(votePhaseLine("standoff", "recount")).toMatch(/Recount/);
  });
});
