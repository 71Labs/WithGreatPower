/**
 * Free roam's body, move by move: walk, jog, run and sprint; jumps and leaps; a roll on a hard
 * landing (never damage); climbing a building and mantling onto it; a drop to hang and back up;
 * a vault over an AC unit; a wall run; the web-zip; the swing only while the web is held; the
 * river. Each scenario is the scripted bot on a stick, in the one roam city.
 */
import { describe, expect, it } from "vitest";

import { startRoamRun, stepRoamRun } from "../src/roam-run";
import { JOG_SPEED, RUN_SPEED, SHOT_JUMP, SPRINT_SPEED, WALK_SPEED } from "../src/sim3d/roam/constants";
import { clearAt, roamCity, roamGrid, roamWorld } from "../src/sim3d/roam/world";
import { at, chain, playRoam } from "./roam-helpers";

const city = roamCity();
const grid = roamGrid(city);
const world = roamWorld();
const spawn = world.spawn;

/** A street-facing roof edge at least `minY` high with open air out over the street beyond it. */
function openEdge(minY: number) {
  return grid.edges.find((e) => {
    if (e.y0 > 0.5 || e.y < minY || e.y > minY + 120 || e.hi - e.lo < 200) return false;
    const nx = e.axis === 1 ? e.n : 0;
    const nz = e.axis === 0 ? e.n : 0;
    const t = (e.lo + e.hi) / 2;
    const x = e.axis === 0 ? t : e.c;
    const z = e.axis === 0 ? e.c : t;
    // The roof behind is clear for the run-up, and the street ahead open for the leap and the roll.
    for (let d = 20; d <= 200; d += 30) if (!clearAt(grid, x - nx * d, e.y + 27, z - nz * d, 26)) return false;
    for (let d = 30; d <= 700; d += 30) for (const y of [30, e.y * 0.5, e.y + 60]) if (!clearAt(grid, x + nx * d, y, z + nz * d, 30)) return false;
    return !city.river || !(x + nx * 400 > city.river.x0 - 60 && x + nx * 400 < city.river.x1 + 60);
  })!;
}

describe("free roam on foot", () => {
  it("walks, jogs and runs by the stick's tilt, and sprints on the button", () => {
    // A long, flat street.
    const flat = at(3810, 0, 600, 0, 1);
    const ahead = { x: 3810, z: 9000 };
    const walk = playRoam(flat, [{ kind: "hold", ...ahead, ticks: 40, mag: 1 }]);
    const jog = playRoam(flat, [{ kind: "hold", ...ahead, ticks: 40, mag: 2 }]);
    const run = playRoam(flat, [{ kind: "hold", ...ahead, ticks: 40, mag: 3 }]);
    expect(walk.top.ground).toBeCloseTo(WALK_SPEED, 0);
    expect(jog.top.ground).toBeCloseTo(JOG_SPEED, 0);
    expect(run.top.ground!).toBeGreaterThan(RUN_SPEED - 5);
    expect(run.top.ground!).toBeLessThanOrEqual(RUN_SPEED + 1e-6);
    // Sprinting builds past a run to the sprint's top speed.
    const sprint = playRoam(flat, [{ kind: "hold", ...ahead, ticks: 120, sprint: true }]);
    expect(sprint.top.ground!).toBeGreaterThan(SPRINT_SPEED - 5);
    expect(chain(walk)).toBe("ground");
    expect(chain(sprint)).toBe("ground");
  });

  it("stops at a roof's edge at a walk, and leaps off it at a run; a hard landing is a roll, and nothing hurts", () => {
    const e = openEdge(280);
    const nx = e.axis === 1 ? e.n : 0;
    const nz = e.axis === 0 ? e.n : 0;
    const t = (e.lo + e.hi) / 2;
    const ex = e.axis === 0 ? t : e.c;
    const ez = e.axis === 0 ? e.c : t;
    const from = at(ex - nx * 200, e.y, ez - nz * 200, nx, nz);
    const out = { x: ex + nx * 3000, z: ez + nz * 3000 };
    const edge = playRoam(from, [{ kind: "hold", ...out, ticks: 150, mag: 1 }]);
    expect(chain(edge)).toBe("ground");
    const leap = playRoam(from, [{ kind: "hold", ...out, ticks: 160, sprint: true }]);
    expect(leap.events.some(({ e: ev }) => ev.type === "roam-jump" && ev.kind === "leap")).toBe(true);
    expect(chain(leap)).toMatch(/^ground>air>roll>ground/);
    expect(leap.unhurt).toBe(true);
    expect(leap.events.some(({ e: ev }) => ev.type === "miss" || ev.type === "hero-hurt")).toBe(false);
  });

  it("jumps about two and a half metres, straight up from a standstill", () => {
    const run = startRoamRun(at(spawn.x, spawn.y, spawn.z - 120, 1, 0));
    stepRoamRun(run, { dir: 0, mag: 0, web: false, shot: SHOT_JUMP });
    let top = 0;
    for (let i = 0; i < 60; i++) {
      stepRoamRun(run, IDLE);
      top = Math.max(top, run.sim.hero.y - 26 - spawn.y);
    }
    expect(top).toBeGreaterThan(105);
    expect(top).toBeLessThan(135);
    expect(run.sim.roam!.body.move).toBe("ground");
  });
});

const IDLE = { dir: 0, mag: 0, web: false, shot: 0 } as const;

describe("free roam on walls", () => {
  it("climbs a building from the street with the stick into it, and mantles onto the roof", () => {
    // The tallest building near the middle: up its east face, then up its tier.
    const tall = [...city.buildings]
      .filter((b) => Math.abs((b.x0 + b.x1) / 2 - 3400) < 1500 && Math.abs((b.z0 + b.z1) / 2 - 3400) < 1500)
      .sort((a, b) => Math.max(b.h, b.top?.h ?? 0) - Math.max(a.h, a.top?.h ?? 0))[0];
    const zc = (tall.z0 + tall.z1) / 2;
    const roof = Math.max(tall.h, tall.top?.h ?? 0);
    const p = playRoam(at(tall.x1 + 60, 0, zc, -1, 0), [{ kind: "climb", x: (tall.x0 + tall.x1) / 2, z: zc, y: roof - 2 }], 60 * 20);
    expect(p.finished).toBe(true);
    expect(chain(p)).toMatch(/^ground>climb>mantle>ground/);
    expect(p.run.sim.hero.y - 26).toBeCloseTo(roof, 0);
  });

  it("drops over a roof's edge to hang by the hands, and pulls back up", () => {
    const p = playRoam(at(3610, 300, 3300, 1, 0), [{ kind: "press", shot: "drop", x: 3800, z: 3300 }, { kind: "wait", ticks: 30 }, { kind: "hold", x: 3500, z: 3300, ticks: 60 }]);
    expect(chain(p)).toMatch(/^ground>hang>mantle>ground/);
    expect(p.run.sim.hero.y - 26).toBeCloseTo(300, 0);
  });

  it("lets go of a hang on the drop button, falls, and lands", () => {
    const p = playRoam(at(3610, 300, 3300, 1, 0), [{ kind: "press", shot: "drop", x: 3800, z: 3300 }, { kind: "wait", ticks: 20 }, { kind: "press", shot: "drop" }, { kind: "wait", ticks: 90 }]);
    expect(chain(p)).toMatch(/^ground>hang>air>(roll|ground)/);
  });

  it("vaults over an AC unit at a run", () => {
    const ac = city.props.find((q) => {
      if (q.kind !== "ac" || q.at.y < 100) return false;
      const b = city.buildings.find((o) => o.id === q.buildingId)!;
      if (q.at.x - b.x0 < 260 || b.x1 - q.at.x < 150) return false;
      for (let x = q.at.x - 240; x < q.at.x - 40; x += 20) if (!clearAt(grid, x, q.at.y + 27, q.at.z, 26)) return false;
      return true;
    })!;
    const p = playRoam(at(ac.at.x - 240, ac.at.y, ac.at.z, 1, 0), [{ kind: "hold", x: ac.at.x + 600, z: ac.at.z, ticks: 70, mag: 3 }]);
    expect(chain(p)).toMatch(/ground>vault>ground/);
    // Over it, not onto it: past its far side, back on the roof.
    expect(p.run.sim.hero.x).toBeGreaterThan(ac.at.x + ac.w / 2);
  });

  it("wall-runs along a facade met at speed, and wall-jumps off it", () => {
    const e = grid.edges.find((q) => q.y0 < 1 && q.axis === 1 && q.hi - q.lo > 450 && q.y > 250 && clearAt(grid, q.c + q.n * 70, 30, q.lo + 40, 30) && clearAt(grid, q.c + q.n * 70, 30, q.lo + 300, 30))!;
    // Sprint along the wall, the stick a little into it (brushing it), then jump.
    const brush = { x: e.c - e.n * 600, z: e.lo + 4000 };
    const p = playRoam(at(e.c + e.n * 40, 0, e.lo + 30, 0, 1), [
      { kind: "hold", ...brush, ticks: 24, sprint: true },
      { kind: "press", shot: "jump", ...brush },
      { kind: "hold", ...brush, ticks: 20, sprint: true },
      { kind: "press", shot: "jump", x: e.c + e.n * 2000, z: e.lo + 2000 },
      { kind: "wait", ticks: 80 },
    ]);
    expect(chain(p)).toMatch(/wallrun>air/);
    expect(p.events.some(({ e: ev }) => ev.type === "roam-jump" && ev.kind === "wall")).toBe(true);
  });
});

describe("free roam on the web", () => {
  it("never swings without the web button: a whole tour on foot stays off the web", () => {
    const p = playRoam(at(spawn.x - 100, spawn.y, spawn.z - 120, 1, 0), [
      { kind: "hold", x: spawn.x + 1200, z: spawn.z - 120, ticks: 160, sprint: true },
      { kind: "go", x: 2021, z: 3102, r: 30, street: true },
      { kind: "press", shot: "jump" },
      { kind: "wait", ticks: 60 },
    ]);
    expect(p.moves).not.toContain("swing");
    expect(p.events.some(({ e }) => e.type === "thwip")).toBe(false);
  });

  it("swings while the web is held, chains swings, and lets go when it's released", () => {
    const p = playRoam(at(3810, 0, 600, 0, 1), [{ kind: "web", x: 3810, z: 6000, ticks: 150 }, { kind: "wait", ticks: 120 }]);
    const thwips = p.events.filter(({ e }) => e.type === "thwip");
    expect(thwips.length).toBeGreaterThanOrEqual(2);
    expect(p.moves).toContain("swing");
    // Let go: no web after the button came up.
    const lastWeb = Math.max(...thwips.map(({ tick }) => tick));
    expect(lastWeb).toBeLessThanOrEqual(150);
    expect(p.run.sim.hero.rope).toBeNull();
  });

  it("zips to a roof edge ahead and lands on that roof", () => {
    const p = playRoam(at(3300, 300, 3420, -1, 0), [{ kind: "press", shot: "zip", x: 2000, z: 3420 }, { kind: "wait", ticks: 90 }]);
    expect(chain(p)).toMatch(/^ground>zip>air>ground$/);
    const z = p.events.find(({ e }) => e.type === "roam-zip")!.e as { tx: number; ty: number };
    expect(p.run.sim.hero.y - 26).toBeCloseTo(z.ty, 0);
    expect(p.run.sim.hero.x).toBeLessThan(z.tx);
  });

  it("launches off the end of a zip with a jump", () => {
    const p = playRoam(at(3300, 300, 3420, -1, 0), [{ kind: "press", shot: "zip", x: 2000, z: 3420 }, { kind: "wait", ticks: 14 }, { kind: "press", shot: "jump" }, { kind: "wait", ticks: 120 }]);
    expect(p.events.some(({ e }) => e.type === "roam-jump" && e.kind === "launch")).toBe(true);
  });
});

describe("free roam on a keyboard's eight directions", () => {
  it("wall-runs off a diagonal sprint-jump at a wall (W+D), and climbs a head-on one (W)", () => {
    const e = grid.edges.find((q) => q.y0 < 1 && q.axis === 1 && q.hi - q.lo > 450 && q.y > 250 && clearAt(grid, q.c + q.n * 70, 30, q.lo + 40, 30) && clearAt(grid, q.c + q.n * 70, 30, q.lo + 300, 30))!;
    // 45° into the wall and along it, sprinting from 150 out, a jump 70 short of it.
    const start = at(e.c + e.n * 150, 0, e.lo + 20, 0, 1);
    const diag = { x: e.c - e.n * 2000, z: e.lo + 20 + 2000 };
    const p = playRoam(start, [{ kind: "hold", ...diag, ticks: 8, sprint: true }, { kind: "press", shot: "jump", ...diag }, { kind: "hold", ...diag, ticks: 40, sprint: true }]);
    expect(chain(p)).toMatch(/air>wallrun/);
    const head = playRoam(at(e.c + e.n * 150, 0, e.lo + 200, -e.n, 0), [{ kind: "hold", x: e.c - e.n * 2000, z: e.lo + 200, ticks: 60 }]);
    expect(chain(head)).toMatch(/^ground>climb/);
  });

  it("swings mid-air when the web is held after a jump (it keeps looking while held), never without it", () => {
    const p = playRoam(at(3810, 0, 600, 0, 1), [{ kind: "press", shot: "jump", x: 3810, z: 6000 }, { kind: "hold", x: 3810, z: 6000, ticks: 10 }, { kind: "web", x: 3810, z: 6000, ticks: 60 }]);
    expect(chain(p)).toMatch(/air>swing/);
    const q = playRoam(at(3810, 0, 600, 0, 1), [{ kind: "press", shot: "jump", x: 3810, z: 6000 }, { kind: "hold", x: 3810, z: 6000, ticks: 70, sprint: true }]);
    expect(q.moves).not.toContain("swing");
  });
});

describe("free roam in the river", () => {
  it("splashes in, climbs out on a bank, unhurt", () => {
    const rv = city.river!;
    const p = playRoam(at(rv.x0 - 60, 0, 1500, 1, 0), [{ kind: "hold", x: rv.x0 + 300, z: 1500, ticks: 30 }, { kind: "wait", ticks: 60 }]);
    expect(chain(p)).toMatch(/ground>splash>ground/);
    expect(p.unhurt).toBe(true);
    const h = p.run.sim.hero;
    expect(h.x < rv.x0 || h.x > rv.x1).toBe(true);
  });
});
