import { DIR64 } from "@wgp/game-core/sim3d";
import { describe, expect, it } from "vitest";

import { dragStick, keysStick, stickInput, viewFromPose, worldStick } from "./stick";

const NORTH = { fx: 0, fz: -1 };
const EAST = { fx: 1, fz: 0 };

describe("camera-relative sticks", () => {
  it("turns forward into the camera's heading and right into a quarter turn right", () => {
    // Looking along −z, forward is −z (DIR64 48) and right is +x (DIR64 0).
    expect(stickInput({ x: 0, y: 1 }, NORTH)).toEqual({ dir: 48, mag: 3 });
    expect(stickInput({ x: 1, y: 0 }, NORTH)).toEqual({ dir: 0, mag: 3 });
    // Looking along +x, forward is +x and right is +z (DIR64 16); back is −x (32).
    expect(stickInput({ x: 0, y: 1 }, EAST)).toEqual({ dir: 0, mag: 3 });
    expect(stickInput({ x: 1, y: 0 }, EAST)).toEqual({ dir: 16, mag: 3 });
    expect(stickInput({ x: 0, y: -1 }, EAST)).toEqual({ dir: 32, mag: 3 });
  });

  it("keeps the stick's length", () => {
    const w = worldStick({ x: 0.6, y: 0.8 }, { fx: Math.SQRT1_2, fz: Math.SQRT1_2 });
    expect(Math.hypot(w.x, w.z)).toBeCloseTo(1, 10);
  });

  it("lands on the nearest of the 64 headings", () => {
    const view = { fx: 0.3, fz: 0.954 };
    const n = Math.hypot(view.fx, view.fz);
    const v = { fx: view.fx / n, fz: view.fz / n };
    const { dir } = stickInput({ x: 0, y: 1 }, v);
    const [dx, dz] = DIR64[dir];
    // Within half a step (π/64) of the camera heading.
    expect(dx * v.fx + dz * v.fz).toBeGreaterThan(Math.cos(Math.PI / 64) - 1e-9);
  });

  it("quantizes magnitude into thirds with a dead zone, and dir is 0 when idle", () => {
    expect(stickInput({ x: 0, y: 0 }, NORTH)).toEqual({ dir: 0, mag: 0 });
    expect(stickInput({ x: 0.1, y: 0 }, NORTH)).toEqual({ dir: 0, mag: 0 });
    expect(stickInput({ x: 0, y: 0.3 }, EAST)).toEqual({ dir: 0, mag: 1 });
    expect(stickInput({ x: 0, y: 0.6 }, EAST)).toEqual({ dir: 0, mag: 2 });
    expect(stickInput({ x: 0, y: -0.3 }, NORTH).mag).toBe(1);
    expect(stickInput({ x: 0, y: -0.3 }, NORTH).dir).toBe(16);
  });

  it("falls back to looking along −z with no camera", () => {
    expect(stickInput({ x: 0, y: 1 }, null)).toEqual({ dir: 48, mag: 3 });
  });

  it("reads the ground heading from a chase pose", () => {
    const v = viewFromPose({ position: { x: 0, y: 500, z: 100 }, target: { x: 0, y: 0, z: -300 } });
    expect(v?.fx).toBeCloseTo(0, 10);
    expect(v?.fz).toBeCloseTo(-1, 10);
    expect(viewFromPose({ position: { x: 5, y: 900, z: 5 }, target: { x: 5, y: 0, z: 5 } })).toBeNull();
    expect(viewFromPose(null)).toBeNull();
  });
});

describe("key and drag sticks", () => {
  it("cancels opposite keys and normalises diagonals", () => {
    expect(keysStick({ forward: true, back: true, left: false, right: false })).toEqual({ x: 0, y: 0 });
    const d = keysStick({ forward: true, back: false, left: false, right: true });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 10);
    expect(stickInput(d, NORTH).mag).toBe(3);
    expect(stickInput(d, NORTH).dir).toBe(56);
  });

  it("scales a thumb drag by the stick radius, clamped, with screen-down as back", () => {
    expect(dragStick(28, 0, 56)).toEqual({ x: 0.5, y: -0 });
    const far = dragStick(0, 200, 56);
    expect(far.x).toBeCloseTo(0, 10);
    expect(far.y).toBeCloseTo(-1, 10);
    expect(dragStick(0, 0, 56)).toEqual({ x: 0, y: 0 });
  });
});
