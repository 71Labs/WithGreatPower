import { describe, expect, it } from "vitest";

import { edgePoint, inBox, place, project, waypointLayout, type CameraPose, type SafeInsets } from "./waypoint";

const W = 1440;
const H = 900;
/** At the origin looking north (−z), level, 60° vertical FOV. */
const NORTH: CameraPose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -100 }, fov: 60 };
const INSET: SafeInsets = { top: 100, right: 40, bottom: 120, left: 40 };

describe("projecting the stop", () => {
  it("puts a point straight ahead in the middle of the screen", () => {
    const p = project({ x: 0, y: 0, z: -1000 }, NORTH, W, H);
    expect(p.behind).toBe(false);
    expect(p.x).toBeCloseTo(W / 2, 6);
    expect(p.y).toBeCloseTo(H / 2, 6);
    expect(p.depth).toBeCloseTo(1000, 6);
  });

  it("matches a perspective camera: right is right, up is up, the FOV edge is the screen edge", () => {
    const t = Math.tan(Math.PI / 6);
    // On the top edge of the vertical FOV.
    const top = project({ x: 0, y: 1000 * t, z: -1000 }, NORTH, W, H);
    expect(top.y).toBeCloseTo(0, 6);
    // On the right edge of the horizontal FOV.
    const right = project({ x: 1000 * t * (W / H), y: 0, z: -1000 }, NORTH, W, H);
    expect(right.x).toBeCloseTo(W, 6);
    // East of a north-facing camera is to the right.
    expect(project({ x: 200, y: 0, z: -1000 }, NORTH, W, H).x).toBeGreaterThan(W / 2);
  });

  it("follows a turned, pitched camera", () => {
    // Looking east and down at a point: it's centred.
    const cam: CameraPose = { position: { x: 0, y: 500, z: 0 }, target: { x: 400, y: 200, z: 0 }, fov: 55 };
    const p = project({ x: 800, y: -100, z: 0 }, cam, W, H);
    expect(p.x).toBeCloseTo(W / 2, 4);
    expect(p.y).toBeCloseTo(H / 2, 4);
    // South (+z) is to the camera's right when it faces east.
    expect(project({ x: 800, y: -100, z: 300 }, cam, W, H).x).toBeGreaterThan(W / 2);
  });

  it("flags points behind the camera with their bearing", () => {
    const back = project({ x: 0, y: 0, z: 500 }, NORTH, W, H);
    expect(back.behind).toBe(true);
    expect(Math.abs(back.bearing)).toBeCloseTo(Math.PI, 6);
    const backRight = project({ x: 300, y: 0, z: 300 }, NORTH, W, H);
    expect(backRight.behind).toBe(true);
    expect(backRight.bearing).toBeCloseTo((3 * Math.PI) / 4, 6);
  });
});

describe("placing the waypoint", () => {
  it("pins a stop that's on screen where it is", () => {
    const pl = place(project({ x: 100, y: 50, z: -1000 }, NORTH, W, H), W, H, INSET);
    expect(pl.onScreen).toBe(true);
    expect(pl.x).toBeGreaterThan(W / 2);
    expect(pl.y).toBeLessThan(H / 2);
  });

  it("clamps an off-screen stop to the safe box's edge, pointing at it", () => {
    // Far to the right and level: the right edge, at mid height, pointing right.
    const pl = place(project({ x: 5000, y: 0, z: -1000 }, NORTH, W, H), W, H, INSET);
    expect(pl.onScreen).toBe(false);
    expect(pl.x).toBeCloseTo(W - INSET.right, 6);
    expect(pl.angle).toBeCloseTo(0, 2);
    // High above: the top edge, pointing up.
    const up = place(project({ x: 0, y: 5000, z: -1000 }, NORTH, W, H), W, H, INSET);
    expect(up.y).toBeCloseTo(INSET.top, 6);
    expect(up.angle).toBeCloseTo(-Math.PI / 2, 2);
    expect(up.x).toBeCloseTo(W / 2, 6);
  });

  it("keeps clamped points on the box along the line from the centre", () => {
    const pr = project({ x: 3000, y: 2000, z: -1000 }, NORTH, W, H);
    const e = edgePoint(pr, W, H, INSET);
    const onEdge = Math.abs(e.x - INSET.left) < 1e-6 || Math.abs(e.x - (W - INSET.right)) < 1e-6 || Math.abs(e.y - INSET.top) < 1e-6 || Math.abs(e.y - (H - INSET.bottom)) < 1e-6;
    expect(onEdge).toBe(true);
    // Same direction from the centre as the projected point.
    const a = Math.atan2(pr.y - H / 2, pr.x - W / 2);
    expect(Math.atan2(e.y - H / 2, e.x - W / 2)).toBeCloseTo(a, 6);
  });

  it("sends a stop behind you to the bottom edge, on the side to turn toward", () => {
    const behind = place(project({ x: 0, y: 0, z: 800 }, NORTH, W, H), W, H, INSET);
    expect(behind.onScreen).toBe(false);
    expect(behind.y).toBeCloseTo(H - INSET.bottom, 6);
    expect(behind.x).toBeCloseTo(W / 2, 6);
    expect(behind.angle).toBeCloseTo(Math.PI / 2, 6);
    const right = place(project({ x: 600, y: 0, z: 300 }, NORTH, W, H), W, H, INSET);
    expect(right.x).toBeGreaterThan(W / 2);
    const left = place(project({ x: -600, y: 0, z: 300 }, NORTH, W, H), W, H, INSET);
    expect(left.x).toBeLessThan(W / 2);
    // Never above the middle: behind means look down and turn.
    expect(left.y).toBeGreaterThan(H / 2);
  });

  it("never pins a point behind the camera, even if it lands inside the box", () => {
    const pr = project({ x: 0, y: 0, z: 800 }, NORTH, W, H);
    expect(inBox({ ...pr, x: W / 2, y: H / 2 }, W, H, INSET)).toBe(false);
  });

  it("slides the arrow along its edge out of the HUD's corners", () => {
    const { arrow, avoid } = waypointLayout(W, H, false);
    const bottom = H - arrow.bottom;
    // Behind and to the left: on the bottom edge it would sit under the minimap (bottom
    // left), so it slides right along that edge, still pointing the same way.
    const pr = project({ x: -874, y: 0, z: 486 }, NORTH, W, H);
    const raw = edgePoint(pr, W, H, arrow);
    expect(raw.y).toBeCloseTo(bottom, 6);
    expect(raw.x).toBeLessThan(260);
    const moved = edgePoint(pr, W, H, arrow, avoid);
    expect(moved.y).toBeCloseTo(bottom, 6);
    expect(moved.x).toBe(260);
    expect(moved.angle).toBe(raw.angle);
    // Further round to the left: the left edge, low, so it slides up above the minimap.
    const side = project({ x: -900, y: 0, z: 250 }, NORTH, W, H);
    const rawSide = edgePoint(side, W, H, arrow);
    expect(rawSide.x).toBeCloseTo(arrow.left, 6);
    expect(rawSide.y).toBeGreaterThan(H - 250);
    const up = edgePoint(side, W, H, arrow, avoid);
    expect(up.x).toBeCloseTo(arrow.left, 6);
    expect(up.y).toBe(H - 250);
    // A pin that would land under the minimap isn't pinned.
    expect(inBox({ x: 120, y: H - 160, depth: 500, behind: false, bearing: 0 }, W, H, { top: 0, right: 0, bottom: 0, left: 0 }, avoid)).toBe(false);
  });

  it("keeps a phone's waypoint below the route bar, off the minimap and the power arc", () => {
    const w = 390;
    const h = 844;
    const { arrow, pin, avoid, avoidPin } = waypointLayout(w, h, true);
    const clear = (x: number, y: number) => !avoid.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
    expect(arrow.top).toBeGreaterThanOrEqual(200);
    expect(pin.top).toBeGreaterThan(arrow.top);
    // Behind and to the right: bottom right is the arc, so it slides clear of it.
    const back = edgePoint(project({ x: 900, y: 0, z: 250 }, NORTH, w, h), w, h, arrow, avoid);
    expect(clear(back.x, back.y)).toBe(true);
    // Up and to the right: the right edge by the minimap, so it slides below it.
    const up = edgePoint(project({ x: 3000, y: 2400, z: -1000 }, NORTH, w, h), w, h, arrow, avoid);
    expect(clear(up.x, up.y)).toBe(true);
    expect(up.x).toBeCloseTo(w - arrow.right, 6);
    // A pin whose body would cover the minimap becomes the arrow; one clear of it stays a pin.
    const mini = avoid[0];
    const under = { x: mini.x0 + 20, y: mini.y1 + 40, depth: 500, behind: false, bearing: 0 };
    expect(inBox(under, w, h, pin, avoidPin)).toBe(false);
    expect(inBox({ ...under, x: 120 }, w, h, pin, avoidPin)).toBe(true);
  });
});
