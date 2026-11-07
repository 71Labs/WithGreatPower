/**
 * Cross-chain's relays in the scene (crosschain.ts): drawn where the sim has them solid (every
 * box inside the relay's solid box, but a lamp and a plug a few units proud of it, trim the
 * eye takes as the box), their chains on the structure under them, dark once unplugged, the ring
 * only while one is held, and five draw calls at most.
 */
import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";

import { startRoamRun, stepRoamRun } from "@wgp/game-core/roam";
import { newRenderFrame } from "@wgp/game-core/sim3d";
import { fillRoamFrame, freshStart, relaySolids, roamWorld, SHOT_ACT, TASK_IDS, type RoamStart } from "@wgp/game-core/sim3d/roam";

import { createSharedUniforms } from "../city/materials";
import { RoamRelays } from "./crosschain";

const relays = roamWorld().relays;
const solids = relaySolids(relays);
/** Trim the eye takes as the box's surface (a lamp on top, a plug in its socket). */
const TOL = 6;
const CX = TASK_IDS.indexOf("crosschain");

function frameAt(stage: number, items: number, hold = 0) {
  const start: RoamStart = { ...freshStart(), stage: TASK_IDS.map((_, i) => (i === CX ? stage : 0)), items: TASK_IDS.map((_, i) => (i === CX ? items : 0)) };
  // On the tallest building, in front of its antenna's relay.
  const r = relays.find((q) => q.key === "antenna")!;
  const run = startRoamRun({ ...start, at: { x: r.x + r.fx * 34, y: 795.7711192779243, z: r.z + r.fz * 34, fx: -r.fx, fz: -r.fz } });
  stepRoamRun(run, { dir: 0, mag: 0, web: false, shot: 0 });
  for (let t = 0; t < hold; t++) stepRoamRun(run, { dir: 0, mag: 0, web: false, shot: SHOT_ACT });
  return fillRoamFrame(run.sim, newRenderFrame());
}

describe("Cross-chain's relays in the City", () => {
  const scene = new RoamRelays(createSharedUniforms(), relays);

  it("draws each relay inside the sim's solid box (a lamp and a plug only a few units proud of it)", () => {
    const boxes = scene.drawnBoxes();
    expect(boxes.length).toBe(relays.length * 9);
    for (const b of boxes) {
      const s = solids[b.relay];
      const out = Math.max(s.x0 - b.x0, b.x1 - s.x1, s.y0 - b.y0, b.y1 - s.y1, s.z0 - b.z0, b.z1 - s.z1);
      expect(out, `relay ${relays[b.relay].key} part ${b.part}`).toBeLessThanOrEqual(TOL);
      // Nothing below the box: it stands on its structure (a cap, a pole's top) or is bolted beside one.
      expect(b.y0, `relay ${relays[b.relay].key} part ${b.part}`).toBeGreaterThanOrEqual(s.y0 - 0.01);
    }
  });

  it("goes dark once unplugged (the lamp off, the plug out of its socket), and dark for good once the task's done", () => {
    const plug = (i: number) => scene.drawnBoxes()[i * 9 + 7];
    const before = plug(0);
    const other = plug(1);
    scene.update(frameAt(1, 0b0001), 1, false);
    // The first relay's plug is out (hanging lower); the others stay in.
    expect(plug(0).y0).toBeLessThan(before.y0);
    expect(plug(1)).toEqual(other);
    // The live ones' lamps still glow.
    expect(scene.draws).toBe(5);
    scene.update(frameAt(9, 0b1111), 1, false);
    expect(scene.draws).toBe(4);
    // Before the task: every relay live (their glows on).
    scene.update(frameAt(0, 0), 1, false);
    expect(plug(0).y0).toBe(before.y0);
    expect(scene.draws).toBe(5);
  });

  it("shows the hold ring only while a relay is held", () => {
    const held = frameAt(1, 0, 45);
    expect(held.roam!.relay).toEqual({ index: 2, progress: 0.5 });
    scene.update(held, 2, true);
    expect(scene.draws).toBe(5);
  });

  it("never draws a box or a link mirrored (a mirrored one shows its inside, and its ink hull over its face)", () => {
    const meshes = scene as unknown as Record<"boxes" | "links", { count: number; instanceMatrix: { array: ArrayLike<number> } }>;
    const m = new Matrix4();
    for (const key of ["boxes", "links"] as const) {
      const mesh = meshes[key];
      for (let i = 0; i < mesh.count; i++) expect(m.fromArray(mesh.instanceMatrix.array, i * 16).determinant(), `${key} ${i}`).toBeGreaterThan(0);
    }
  });

  it("runs its chains down the structure under each relay, within reach of it", () => {
    const links = (scene as unknown as { links: { count: number; instanceMatrix: { array: ArrayLike<number> } } }).links;
    expect(links.count).toBeGreaterThan(relays.length * 2 * 8);
    const e = links.instanceMatrix.array;
    for (let i = 0; i < links.count; i++) {
      const [x, y, z] = [e[i * 16 + 12], e[i * 16 + 13], e[i * 16 + 14]];
      const near = relays.some((r) => Math.hypot(x - r.x, z - r.z) < 70 && y <= r.y && y >= r.ay - 2);
      expect(near, `link ${i} at ${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)}`).toBe(true);
    }
  });
});
