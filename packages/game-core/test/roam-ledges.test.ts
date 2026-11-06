/**
 * Ledges, vaults and mantles against the city's smaller solids (roam-2): a hang never puts the
 * body into the roof under a low ledge, a vault's arc never cuts through a thin post, and a
 * mantle onto a long thin top (a billboard, a rail) sets him down where he grabbed it, its path
 * swept clear. Each scene is a few solids added to the roam city's own index in an open street
 * (x 3810, the long flat street the movement tests run on), and the body played tick by tick.
 */
import { describe, expect, it } from "vitest";

import { startRoamRun, stepRoamRun, type RoamRun } from "../src/roam-run";
import { HERO_RADIUS as R } from "../src/sim3d/constants";
import type { InputFrame } from "../src/sim3d/contract";
import { dirIndex } from "../src/sim3d/dmath";
import { clearAt } from "../src/sim3d/roam/world";
import { at } from "./roam-helpers";

const stick = (dx: number, dz: number): InputFrame => ({ dir: dirIndex(dx, dz), mag: 3, web: false, shot: 0 });

function play(run: RoamRun, frame: (t: number) => InputFrame, ticks: number, each: (run: RoamRun) => void) {
  for (let t = 0; t < ticks; t++) {
    stepRoamRun(run, frame(t));
    each(run);
  }
}

describe("free roam's ledges against small solids (roam-2)", () => {
  it("never hangs with the body in the roof under a low ledge: pulls up onto it instead", () => {
    // A platform (a roof 200 up) with a low unit on it, 52 tall; he drops past the unit's face.
    const run = startRoamRun(at(3803, 600, 1150, 1, 0));
    const g = run.sim.grid;
    g.addSolid(3700, 0, 1000, 3920, 200, 1300);
    g.addSolid(3830, 200, 1100, 3900, 252, 1200);
    // Falling past its face, its top just within the hands' reach.
    run.sim.hero.y = 230 + R;
    const moves = new Set<string>();
    let inside = 0;
    let landed = Number.NaN;
    play(run, () => stick(1, 0), 120, (r) => {
      const m = r.sim.roam!.body.move;
      if (m === "ground" && moves.has("mantle") && Number.isNaN(landed)) landed = r.sim.hero.y - R;
      moves.add(m);
      if (m === "hang" && !clearAt(g, r.sim.hero.x, r.sim.hero.y, r.sim.hero.z, R - 2)) inside++;
    });
    expect(inside).toBe(0);
    expect(moves.has("hang")).toBe(false);
    expect(moves.has("mantle")).toBe(true);
    // Up onto the unit.
    expect(landed).toBeCloseTo(252, 0);
  });

  it("never vaults through a thin post: the arc is swept, not sampled", () => {
    // A low box across the street (60 tall, 40 deep): vaulted over at a run.
    const vault = (post: boolean) => {
      const run = startRoamRun(at(3810, 0, 1200, 0, 1));
      const g = run.sim.grid;
      g.addSolid(3760, 0, 1500, 3860, 60, 1540);
      // A thin post just beside the arc, between where eight samples of it would fall.
      if (post) g.addSolid(3823.5, 60, 1544.5, 3825, 110, 1545.5);
      let clipped = 0;
      let vaulted = 0;
      play(run, () => stick(0, 1), 150, (r) => {
        if (r.sim.roam!.body.move !== "vault") return;
        vaulted++;
        if (!clearAt(g, r.sim.hero.x, r.sim.hero.y, r.sim.hero.z, R - 10)) clipped++;
      });
      return { clipped, vaulted };
    };
    const clear = vault(false);
    expect(clear.vaulted).toBeGreaterThan(0);
    expect(clear.clipped).toBe(0);
    // With the post: no vault through it (a clean one, or none).
    expect(vault(true).clipped).toBe(0);
  });

  it("never mantles through something in the way over the lip: hangs there instead", () => {
    // A block 200 up, climbed from the street, with a thin post on its roof just in from the
    // edge: room to stand beyond it, but the pull-up's path goes through it.
    const run = startRoamRun(at(3800, 0, 1150, 1, 0));
    const g = run.sim.grid;
    g.addSolid(3830, 0, 1000, 3920, 200, 1300);
    g.addSolid(3836, 200, 1148, 3840, 240, 1152);
    const moves = new Set<string>();
    let clipped = 0;
    play(run, () => stick(1, 0), 60 * 4, (r) => {
      const m = r.sim.roam!.body.move;
      moves.add(m);
      if (m === "mantle" && !clearAt(g, r.sim.hero.x, r.sim.hero.y, r.sim.hero.z, R - 4)) clipped++;
    });
    expect(moves.has("climb")).toBe(true);
    expect(clipped).toBe(0);
    expect(moves.has("mantle")).toBe(false);
    expect(run.sim.roam!.body.move).toBe("hang");
  });

  it("mantles onto a long thin top where he grabbed it, not slid to its middle", () => {
    // A billboard along the street: 10 thick (x), 300 long (z), 130 tall. He climbs it 100 from
    // its middle.
    const run = startRoamRun(at(3880, 0, 2250, -1, 0));
    const g = run.sim.grid;
    g.addSolid(3800, 0, 2000, 3810, 130, 2300);
    expect(clearAt(g, 3880, R + 1, 2250, R)).toBe(true);
    const moves: string[] = [];
    let landed: { x: number; y: number; z: number } | null = null;
    play(run, () => stick(-1, 0), 60 * 3, (r) => {
      const m = r.sim.roam!.body.move;
      if (m === "ground" && moves.includes("mantle") && !landed) landed = { x: r.sim.hero.x, y: r.sim.hero.y - R, z: r.sim.hero.z };
      if (moves[moves.length - 1] !== m) moves.push(m);
    });
    expect(moves.join(">")).toMatch(/climb>mantle>ground/);
    expect(landed!.y).toBeCloseTo(130, 0);
    expect(Math.abs(landed!.z - 2250)).toBeLessThan(6);
    expect(Math.abs(landed!.x - 3805)).toBeLessThan(1);
  });
});
