/**
 * Free roam's people and things to find: talking (lines in turn, the interact prompt), the four
 * side tasks start to finish, Daily Rug pages, viewpoints on their masts, and progress carried
 * from one outing to the next through RoamStart (as the save's city record does).
 */
import { describe, expect, it } from "vitest";

import { FOLKS, lineText, talkLine } from "../src/rules/city";
import { startRoamRun, stepRoamRun, roamOuting } from "../src/roam-run";
import { SHOT_ACT } from "../src/sim3d/roam/constants";
import { actTarget } from "../src/sim3d/roam/tasks";
import { TASK_DONE, TASK_IDS, type RoamStart, type TaskId } from "../src/sim3d/roam/types";
import { roamWorld } from "../src/sim3d/roam/world";
import { at, chain, playRoam } from "./roam-helpers";

const world = roamWorld();
const folk = (key: string) => world.folks.find((f) => f.key === key)!;
const ti = (id: TaskId) => TASK_IDS.indexOf(id);
const ACT = { dir: 0, mag: 0, web: false, shot: SHOT_ACT } as const;
const IDLE = { dir: 0, mag: 0, web: false, shot: 0 } as const;

/** Stand beside someone (on their side of things), facing them. */
function beside(key: string, base: Partial<RoamStart> = {}): RoamStart {
  const f = folk(key);
  return at(f.x + 60, f.y, f.z, -1, 0, base);
}

/** Step one press of interact; the talks and task changes it made. */
function press(start: RoamStart) {
  const run = startRoamRun(start);
  stepRoamRun(run, IDLE);
  const events = stepRoamRun(run, ACT);
  return { run, events };
}

describe("free roam's people", () => {
  it("places everyone the content knows, the allies on their roofs and the jogger in the street", () => {
    for (const f of world.folks) expect(FOLKS[f.key], f.key).toBeDefined();
    expect(world.folks.filter((f) => f.cast).map((f) => f.cast).sort()).toEqual(["aunt-mainnet", "bearson", "gwei", "mary-jpeg", "uncle-gen"]);
    expect(folk("dev").y).toBe(0);
    expect(world.folks.length).toBeGreaterThanOrEqual(15);
  });

  it("talks to a civilian on E: their lines in turn, prompted first", () => {
    const start = beside("barista");
    const run = startRoamRun(start);
    stepRoamRun(run, IDLE);
    expect(actTarget(run.sim)).toEqual({ kind: "talk", folk: folk("barista").id });
    const lines: number[] = [];
    for (let i = 0; i < 4; i++) {
      for (const e of stepRoamRun(run, ACT)) if (e.type === "roam-talk") lines.push(e.line);
      stepRoamRun(run, IDLE);
    }
    expect(lines).toEqual([0, 1, 2, 0]);
    expect(run.sim.roam!.chat).not.toBeNull();
    expect(lineText("barista", lines[0])).toMatch(/latte/);
  });

  it("has nothing to do with E out of reach", () => {
    const f = folk("barista");
    const { events } = press(at(f.x + 400, f.y, f.z, -1, 0));
    expect(events.some((e) => e.type === "roam-nothing")).toBe(true);
  });
});

describe("free roam's side tasks", () => {
  it("delivers Aunt Mainnet's bread to Uncle Gen, the loaf carried from one outing to the next", () => {
    const one = press(beside("aunt"));
    expect(one.events.some((e) => e.type === "roam-task" && e.task === "bread" && e.stage === 1)).toBe(true);
    const out = roamOuting(one.run);
    expect(out.stage[ti("bread")]).toBe(1);
    const two = press(beside("uncle", { stage: out.stage, items: out.items }));
    const talk = two.events.find((e) => e.type === "roam-talk")!;
    expect(talk.type === "roam-talk" && talk.line).toBe(talkLine("uncle", 1, 0, { warm: true }));
    expect(two.events.some((e) => e.type === "roam-task" && e.task === "bread" && e.done)).toBe(true);
    expect(two.run.sim.roam!.progress.stage[ti("bread")]).toBe(TASK_DONE);
  });

  it("chases the pickpocket bot over the roofs, catches it and gives Dev his wallet back", () => {
    const dev = folk("dev");
    const p = playRoam(at(dev.x + 60, 0, dev.z, -1, 0), [{ kind: "act" }, { kind: "wait", ticks: 30 }, { kind: "chase", ticks: 60 * 90 }, { kind: "go", x: dev.x, z: dev.z, r: 100, street: true }, { kind: "act" }], 60 * 150);
    const kinds = p.events.map(({ e }) => (e.type === "roam-bot" ? `bot-${e.state}` : e.type === "roam-task" ? `task-${e.stage}` : null)).filter(Boolean);
    expect(kinds).toEqual(["task-1", "bot-out", "bot-caught", "task-2", `task-${TASK_DONE}`]);
    // Caught up on the roofs: it took climbing to get there.
    expect(p.moves).toContain("climb");
    expect(p.unhurt).toBe(true);
  });

  it("finds Mary Jpeg's eight pixels across outings and brings them back", () => {
    let start = beside("mary");
    const first = press(start);
    expect(first.events.some((e) => e.type === "roam-task" && e.task === "pixels" && e.stage === 1)).toBe(true);
    let out = roamOuting(first.run);
    for (let i = 0; i < world.pixels.length; i++) {
      const px = world.pixels[i];
      // From the street under a pixel on a wall (a climb), or beside one on a roof.
      const onWall = world.pixels[i].y > 0 && !roofUnder(px);
      start = onWall ? wallStart(px, out) : roofStart(px, out);
      const goals = onWall ? [{ kind: "climb" as const, x: px.x - wallNormal(px).x * 200, z: px.z - wallNormal(px).z * 200, y: 99999 }] : [{ kind: "go" as const, x: px.x, z: px.z, r: 8 }];
      const p = playRoam(start, goals, 60 * 8);
      const got = p.events.filter(({ e }) => e.type === "roam-item" && e.task === "pixels").map(({ e }) => (e.type === "roam-item" ? e.item : -1));
      expect(got, `pixel ${i}`).toContain(i);
      out = roamOuting(p.run);
    }
    expect(out.stage[ti("pixels")]).toBe(2);
    const back = press(beside("mary", { stage: out.stage, items: out.items }));
    expect(back.events.some((e) => e.type === "roam-task" && e.task === "pixels" && e.done)).toBe(true);
  });

  it("photographs Gas Goblin's four tags for Bearson, framed from the street", () => {
    const first = press(beside("bearson"));
    let out = roamOuting(first.run);
    expect(out.stage[ti("graffiti")]).toBe(1);
    world.tags.forEach((t, i) => {
      // In the street in front of the tag, facing it (a step aside when something solid, a
      // crane's mast, stands in the line from the spot straight out).
      let run = startRoamRun(at(t.x + t.nx * 260, 0, t.z + t.nz * 260, -t.nx, -t.nz, { stage: out.stage, items: out.items }));
      for (const side of [0, 80, -80, 160, -160]) {
        const x = t.x + t.nx * 260 - t.nz * side;
        const z = t.z + t.nz * 260 + t.nx * side;
        const l = Math.hypot(t.x - x, t.z - z);
        run = startRoamRun(at(x, 0, z, (t.x - x) / l, (t.z - z) / l, { stage: out.stage, items: out.items }));
        stepRoamRun(run, IDLE);
        if (actTarget(run.sim)) break;
      }
      expect(actTarget(run.sim), `tag ${i}`).toEqual({ kind: "photo", tag: i });
      const ev = stepRoamRun(run, ACT);
      expect(ev.some((e) => e.type === "roam-item" && e.task === "graffiti" && e.item === i)).toBe(true);
      out = roamOuting(run);
    });
    expect(out.stage[ti("graffiti")]).toBe(2);
    const back = press(beside("bearson", { stage: out.stage, items: out.items }));
    expect(back.events.some((e) => e.type === "roam-task" && e.task === "graffiti" && e.done)).toBe(true);
  });

  it("won't photograph a tag he's facing away from", () => {
    const first = press(beside("bearson"));
    const out = roamOuting(first.run);
    const t = world.tags[0];
    const run = startRoamRun(at(t.x + t.nx * 260, 0, t.z + t.nz * 260, t.nx, t.nz, { stage: out.stage, items: out.items }));
    stepRoamRun(run, IDLE);
    expect(actTarget(run.sim)).toBeNull();
  });
});

describe("free roam's collectibles", () => {
  it("picks up a Daily Rug page by touching it", () => {
    const pg = world.pages[0];
    const p = playRoam(at(pg.x + 70, pg.y, pg.z, -1, 0), [{ kind: "go", x: pg.x, z: pg.z, r: 6 }], 300);
    expect(p.events.some(({ e }) => e.type === "roam-page" && e.page === 0)).toBe(true);
    expect(p.run.sim.roam!.progress.pages & 1).toBe(1);
  });

  it("climbs a viewpoint's mast, perches on top and syncs it", () => {
    const v = world.views[0];
    const p = playRoam(at(v.x + 90, v.roof, v.z, -1, 0), [{ kind: "climb", x: v.x - 200, z: v.z, y: v.y }, { kind: "act" }, { kind: "wait", ticks: 2 }], 60 * 10);
    expect(chain(p)).toMatch(/climb>(hang>)?mantle>ground/);
    expect(p.events.some(({ e }) => e.type === "roam-sync" && e.view === 0)).toBe(true);
    expect(p.run.sim.roam!.progress.views & 1).toBe(1);
  });

  it("puts nothing back: found pages and synced views stay found in the next outing", () => {
    const run = startRoamRun({ ...beside("barista"), pages: 0b101, views: 0b10 });
    stepRoamRun(run, IDLE);
    const out = roamOuting(run);
    expect(out.pages).toBe(0b101);
    expect(out.views).toBe(0b10);
  });
});

/* ------------------------------------------------------------------ helpers */

import { groundBelow } from "../src/sim3d/city";
import { clearAt, roamCity, roamGrid } from "../src/sim3d/roam/world";
const grid = roamGrid(roamCity());

function roofUnder(p: { x: number; y: number; z: number }) {
  return groundBelow(grid, p.x, p.z, p.y + 2) > p.y - 3;
}

/** A wall pixel's facade normal: the axis it stands off its wall along. */
function wallNormal(p: { x: number; y: number; z: number }) {
  for (const [x, z] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    // The wall right behind it (the pixel sits 32 off the face), open air in front.
    if (groundBelow(grid, p.x - x * 34, p.z - z * 34, 99999) > p.y && clearAt(grid, p.x + x * 20, p.y, p.z + z * 20, 20)) return { x, z };
  return { x: 1, z: 0 };
}

/** Beside a roof pixel on the same roof, facing it. */
function roofStart(p: { x: number; y: number; z: number }, out: { stage: number[]; items: number[] }): RoamStart {
  for (const [dx, dz] of [
    [80, 0],
    [-80, 0],
    [0, 80],
    [0, -80],
  ]) {
    if (clearAt(grid, p.x + dx, p.y + 27, p.z + dz, 26) && Math.abs(groundBelow(grid, p.x + dx, p.z + dz, p.y + 2) - p.y) < 2) return at(p.x + dx, p.y, p.z + dz, -Math.sign(dx), -Math.sign(dz), { stage: out.stage, items: out.items });
  }
  throw new Error("no room beside the pixel");
}

function wallStart(p: { x: number; y: number; z: number }, out: { stage: number[]; items: number[] }): RoamStart {
  const n = wallNormal(p);
  return at(p.x + n.x * 40, 0, p.z + n.z * 40, -n.x, -n.z, { stage: out.stage, items: out.items });
}
