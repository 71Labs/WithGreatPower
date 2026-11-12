/**
 * Front-run in the scene (roam/frontrun.ts): the race's solids are drawn as the sim has them (every
 * drawn box inside a solid, every solid drawn), and Sandwich Man reaches the cast as a frame
 * villain at his body's height, only while the race is on.
 */
import { describe, expect, it } from "vitest";

import { fillRenderFrame, newRenderFrame } from "@wgp/game-core/sim3d";
import { createRoamSim, fillRoamFrame, raceCourse, roamWorld, SHOT_ACT, stepRoam, TASK_IDS } from "@wgp/game-core/sim3d/roam";

import { villainsOf } from "../chapter/contract";
import { courseBoxes, raceRival } from "./frontrun";

const course = raceCourse();
/** Trim the eye takes as the surface (a slice standing a hair proud of a loaf). */
const TOL = 1;

describe("Front-run's scene", () => {
  it("draws the bread barricade and Gwei's crates box for box inside the sim's solids, and all of each", () => {
    const boxes = courseBoxes(course);
    for (const b of boxes) {
      const inside = course.solids.some((s) => b.x0 >= s.x0 - TOL && b.x1 <= s.x1 + TOL && b.y0 >= s.y0 - TOL && b.y1 <= s.y1 + TOL && b.z0 >= s.z0 - TOL && b.z1 <= s.z1 + TOL);
      expect(inside, JSON.stringify(b)).toBe(true);
    }
    for (const s of course.solids) {
      // Its footprint and its top are covered by what's drawn (no invisible wall).
      const own = boxes.filter((b) => b.x0 >= s.x0 - TOL && b.x1 <= s.x1 + TOL && b.z0 >= s.z0 - TOL && b.z1 <= s.z1 + TOL && b.y0 >= s.y0 - TOL);
      expect(Math.min(...own.map((b) => b.z0))).toBeCloseTo(s.z0, 3);
      expect(Math.max(...own.map((b) => b.z1))).toBeCloseTo(s.z1, 3);
      expect(Math.max(...own.map((b) => b.y1))).toBeCloseTo(s.y1, 3);
    }
  });

  it("hands the cast Sandwich Man (at his body's height, running) only while the race is on", () => {
    const w = roamWorld();
    const s = createRoamSim({ stage: TASK_IDS.map(() => 0), items: TASK_IDS.map(() => 0), pages: 0, views: 0, talks: [], at: { ...w.race.spot } });
    const frame = () => fillRoamFrame(s, fillRenderFrame(s, newRenderFrame()));
    stepRoam(s, { dir: 0, mag: 0, web: false, shot: 0 });
    expect(raceRival(frame())).toBeNull();
    expect(villainsOf(frame())).toEqual([]);
    stepRoam(s, { dir: 0, mag: 0, web: false, shot: SHOT_ACT });
    // Into his run (past his wait at the start).
    for (let i = 0; i < 60 * 2.5; i++) stepRoam(s, { dir: 0, mag: 0, web: false, shot: 0 });
    const f = frame();
    const v = villainsOf(f);
    expect(v).toHaveLength(1);
    expect(v[0].id).toBe("sandwich-man");
    expect(v[0].pos.y).toBeCloseTo(f.roam!.race!.rival.y + 44, 6);
    expect(Math.hypot(v[0].vel!.x, v[0].vel!.y, v[0].vel!.z)).toBeGreaterThan(100);
    expect(Math.hypot(v[0].facing!.x, v[0].facing!.z)).toBeCloseTo(1, 6);
  });

  it("tells the cast when he's climbing the facade, so he climbs it instead of rising in a jump pose", () => {
    const w = roamWorld();
    const s = createRoamSim({ stage: TASK_IDS.map(() => 0), items: TASK_IDS.map(() => 0), pages: 0, views: 0, talks: [], at: { ...w.race.spot } });
    const frame = () => fillRoamFrame(s, fillRenderFrame(s, newRenderFrame()));
    stepRoam(s, { dir: 0, mag: 0, web: false, shot: 0 });
    stepRoam(s, { dir: 0, mag: 0, web: false, shot: SHOT_ACT });
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 5; i++) {
      stepRoam(s, { dir: 0, mag: 0, web: false, shot: 0 });
      const f = frame();
      const rival = raceRival(f);
      if (!rival || f.roam!.race!.over !== null) break;
      seen.add(`${f.roam!.race!.rivalMove}:${rival.state}`);
      if (rival.state === "climb") {
        // Straight up the face, turned mostly into it (+x: the Mempool Market block's west facade;
        // the race faces him the way on over the top, a little askew, and the cast squares him up).
        expect(rival.vel!.y).toBeGreaterThan(200);
        expect(rival.facing!.x).toBeGreaterThan(0.9);
      }
    }
    expect(seen).toContain("climb:climb");
    expect(seen).toContain("run:idle");
    expect(seen).toContain("leap:idle");
  });
});
