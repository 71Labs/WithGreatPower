import { describe, expect, it } from "vitest";

import { newRenderFrame } from "@wgp/game-core/sim3d";

import { blendFrame, copyFrame } from "./blend";

describe("blending v1.3 fields", () => {
  it("copies pickups, the combo and the route from the latest tick, without sharing objects", () => {
    const prev = newRenderFrame();
    const curr = newRenderFrame();
    curr.pickups = [
      { id: 7, kind: "bits", pos: { x: 1, y: 2, z: 3 }, taken: false },
      { id: 8, kind: "ring", pos: { x: 4, y: 5, z: 6 }, taken: true },
    ];
    curr.combo = { count: 5, multiplier: 1.5, ticksLeft: 90 };
    curr.route = [{ x: 10, y: 0, z: 20 }];
    const out = blendFrame(prev, curr, 0.5, newRenderFrame());
    expect(out.pickups).toEqual(curr.pickups);
    expect(out.pickups).not.toBe(curr.pickups);
    expect(out.pickups![0].pos).not.toBe(curr.pickups[0].pos);
    expect(out.combo).toEqual(curr.combo);
    expect(out.combo).not.toBe(curr.combo);
    expect(out.route).toEqual(curr.route);

    // A pickup taken, the list shrinking: the same slots, updated.
    const slot = out.pickups![0];
    curr.pickups = [{ id: 7, kind: "bits", pos: { x: 1, y: 2, z: 3 }, taken: true }];
    blendFrame(prev, curr, 1, out);
    expect(out.pickups).toHaveLength(1);
    expect(out.pickups![0]).toBe(slot);
    expect(slot.taken).toBe(true);
  });

  it("leaves them off when the sim doesn't send them (a v1.2 frame)", () => {
    const out = newRenderFrame();
    const rich = newRenderFrame();
    rich.pickups = [{ id: 1, kind: "bits", pos: { x: 0, y: 0, z: 0 }, taken: false }];
    rich.combo = { count: 1, multiplier: 1, ticksLeft: 10 };
    rich.route = [];
    copyFrame(rich, out);
    // A v1.2 frame: game-core's newRenderFrame carries the v1.3 fields now, so strip them.
    const old = newRenderFrame();
    delete old.pickups;
    delete old.combo;
    delete old.route;
    copyFrame(old, out);
    expect(out.pickups).toBeUndefined();
    expect(out.combo).toBeUndefined();
    expect(out.route).toBeUndefined();
  });
});
