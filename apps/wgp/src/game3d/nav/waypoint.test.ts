import { describe, expect, it } from "vitest";

import { edgePoint, inBox, mergeRects, place, project, waypointLayout, waypointLayoutFromHud, type CameraPose, type HudZones, type Rect, type SafeInsets } from "./waypoint";

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

describe("placing the waypoint around the HUD as laid out", () => {
  const inside = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  /** Stops all round the camera: ahead and up, both sides, behind, below, overhead. */
  const AROUND = [
    { x: 3000, y: 2400, z: -1000 },
    { x: -3000, y: 2400, z: -1000 },
    { x: 3000, y: 0, z: -200 },
    { x: -3000, y: 0, z: -200 },
    { x: 900, y: 0, z: 250 },
    { x: -900, y: 0, z: 250 },
    { x: 0, y: -2000, z: -300 },
    { x: 0, y: 4000, z: -300 },
  ];

  const check = (w: number, h: number, zones: HudZones) => {
    const { arrow, avoid } = waypointLayoutFromHud(w, h, zones);
    const band = Math.max(...zones.band.map((r) => r.y1));
    expect(arrow.top).toBeGreaterThan(band);
    expect(arrow.left).toBeGreaterThan(zones.safe.left);
    expect(arrow.right).toBeGreaterThan(zones.safe.right);
    expect(arrow.bottom).toBeGreaterThan(zones.safe.bottom);
    for (const p of AROUND) {
      const e = edgePoint(project(p, NORTH, w, h), w, h, arrow, avoid);
      for (const r of zones.avoid) expect(inside(r, e.x, e.y)).toBe(false);
      expect(e.y).toBeGreaterThanOrEqual(arrow.top - 1e-6);
      expect(e.x).toBeGreaterThanOrEqual(arrow.left - 1e-6);
      expect(e.x).toBeLessThanOrEqual(w - arrow.right + 1e-6);
    }
  };

  it("keeps a phone held upright's arrow below the route bar, off the hint, the minimap and the arc", () => {
    const w = 390;
    const h = 844;
    const zones: HudZones = {
      safe: { top: 47, right: 0, bottom: 34, left: 0 },
      band: [
        { x0: 12, y0: 47, x1: 378, y1: 117 },
        { x0: 12, y0: 125, x1: 378, y1: 185 },
      ],
      avoid: [
        { x0: 12, y0: 193, x1: 240, y1: 316 },
        { x0: 255, y0: 193, x1: 378, y1: 316 },
        { x0: 194, y0: 614, x1: 390, y1: 810 },
      ],
    };
    check(w, h, zones);
    // The hint beside the minimap fills the width: the box starts below that row. After the
    // first leg the hint goes, and the arrow may come up beside the minimap again.
    expect(waypointLayoutFromHud(w, h, zones).arrow.top).toBeGreaterThan(316);
    const later = { ...zones, avoid: zones.avoid.slice(1) };
    check(w, h, later);
    expect(waypointLayoutFromHud(w, h, later).arrow.top).toBeLessThan(316);
    // A pin whose body would cover the minimap becomes the arrow; one clear of everything stays a pin.
    const { pin, avoidPin } = waypointLayoutFromHud(w, h, later);
    expect(inBox({ x: 300, y: 340, depth: 500, behind: false, bearing: 0 }, w, h, pin, avoidPin)).toBe(false);
    expect(inBox({ x: 150, y: 520, depth: 500, behind: false, bearing: 0 }, w, h, pin, avoidPin)).toBe(true);
  });

  it("works for a phone on its side: under the route bar, past the notch, the meters, the minimap and the arc", () => {
    const w = 844;
    const h = 390;
    const zones: HudZones = {
      safe: { top: 0, right: 47, bottom: 21, left: 47 },
      band: [{ x0: 251, y0: 12, x1: 605, y1: 72 }],
      avoid: [
        // The meters, and the first-leg hint stacked under them.
        { x0: 59, y0: 12, x1: 239, y1: 156 },
        { x0: 59, y0: 164, x1: 307, y1: 272 },
        { x0: 662, y0: 12, x1: 785, y1: 135 },
        { x0: 601, y0: 173, x1: 797, y1: 369 },
      ],
    };
    check(w, h, zones);
    // The arrow comes up to just under the route bar, not under the tallest sticker.
    expect(waypointLayoutFromHud(w, h, zones).arrow.top).toBeLessThan(135);
  });

  it("merges stickers that touch, so the arrow can't slide from one into the next", () => {
    const merged = mergeRects([
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { x0: 50, y0: 100, x1: 200, y1: 150 },
      { x0: 300, y0: 300, x1: 320, y1: 320 },
      { x0: 190, y0: 140, x1: 210, y1: 400 },
    ]);
    expect(merged).toEqual([
      { x0: 0, y0: 0, x1: 210, y1: 400 },
      { x0: 300, y0: 300, x1: 320, y1: 320 },
    ]);
  });

  it("never pushes the arrow's box past the middle of a very short screen", () => {
    const { arrow } = waypointLayoutFromHud(600, 300, { safe: { top: 0, right: 0, bottom: 0, left: 0 }, band: [{ x0: 0, y0: 0, x1: 600, y1: 200 }], avoid: [] });
    expect(arrow.top).toBe(150);
  });
});
