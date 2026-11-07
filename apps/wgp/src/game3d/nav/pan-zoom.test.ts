import { describe, expect, it } from "vitest";

import { toMap } from "./map";
import { CENTRE_ZOOM, MAX_ZOOM, camView, centreOn, clampCam, fitCam, fitScale, fromMap, panBy, pinch, sameCam, wheelFactor, zoomAt, type MapFrame } from "./pan-zoom";

const bounds = { x0: 0, z0: 0, x1: 7000, z1: 7000 };
/** A phone on its side: the map pane beside the task drawer. */
const F: MapFrame = { bounds, w: 600, h: 400, pad: 16 };

describe("the big map's camera", () => {
  it("fits the whole city at zoom 1, centred", () => {
    const cam = fitCam(bounds);
    expect(cam).toEqual({ x: 3500, z: 3500, zoom: 1 });
    const v = camView(F, cam);
    // The city's top and bottom sit `pad` from the pane's edges (it's taller than wide here).
    expect(toMap(v, 3500, 0).y).toBeCloseTo(16);
    expect(toMap(v, 3500, 7000).y).toBeCloseTo(400 - 16);
    expect(toMap(v, 3500, 3500)).toEqual({ x: 300, y: 200 });
  });

  it("maps canvas points back to the world (fromMap undoes toMap, turned or not)", () => {
    for (const rotation of [0, 0.7, -2.1]) {
      const v = { ...camView(F, { x: 1200, z: 4100, zoom: 2.2 }), rotation };
      const p = toMap(v, 2345, 678);
      const w = fromMap(v, p.x, p.y);
      expect(w.x).toBeCloseTo(2345, 6);
      expect(w.z).toBeCloseTo(678, 6);
    }
  });

  it("drags the city with the finger, and stops at its edge", () => {
    const zoomed = { x: 3500, z: 3500, zoom: 3 };
    const s = fitScale(F) * 3;
    const moved = panBy(F, zoomed, 60, -30);
    expect(moved.x).toBeCloseTo(3500 - 60 / s);
    expect(moved.z).toBeCloseTo(3500 + 30 / s);
    // Dragging far right shows the city's west edge at the pane's left (plus the padding), no further.
    const far = panBy(F, zoomed, 100000, 0);
    const v = camView(F, far);
    expect(toMap(v, 0, 3500).x).toBeCloseTo(16, 3);
  });

  it("keeps the city centred on an axis while it's narrower than the view", () => {
    // At zoom 1 the city fits by height: across, it can't move at all.
    const c = clampCam(F, { x: 100, z: 9000, zoom: 1 });
    expect(c.x).toBe(3500);
    expect(c.z).toBe(3500);
  });

  it("zooms about a point: the world under it stays put", () => {
    const cam = fitCam(bounds);
    const before = fromMap(camView(F, cam), 340, 150);
    const z = zoomAt(F, cam, 2, 340, 150);
    expect(z.zoom).toBe(2);
    const after = toMap(camView(F, z), before.x, before.z);
    expect(after.x).toBeCloseTo(340, 6);
    expect(after.y).toBeCloseTo(150, 6);
  });

  it("lets the city's edge win over the zoom point near the edge", () => {
    // Zooming in by the east edge would pull the city off the pane: the edge stops at the pane's edge.
    const z = zoomAt(F, fitCam(bounds), 2, 590, 200);
    expect(toMap(camView(F, z), 7000, 3500).x).toBeCloseTo(600 - 16, 3);
  });

  it("never zooms out past the fit or in past the most", () => {
    expect(zoomAt(F, fitCam(bounds), 0.2).zoom).toBe(1);
    expect(zoomAt(F, fitCam(bounds), 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(F, fitCam(bounds), Number.NaN).zoom).toBe(1);
    expect(clampCam(F, { x: 1, z: 1, zoom: Number.POSITIVE_INFINITY }).zoom).toBe(1);
  });

  it("pinches: the spread zooms, the midpoint drags", () => {
    const start = { x: 3500, z: 3500, zoom: 1.5 };
    const a0 = { x: 250, y: 200 };
    const b0 = { x: 350, y: 200 };
    const held = fromMap(camView(F, start), 300, 200);
    // Spread to twice the distance and move the midpoint 40 px left.
    const cam = pinch(F, start, a0, b0, { x: 160, y: 200 }, { x: 360, y: 200 });
    expect(cam.zoom).toBeCloseTo(3);
    const now = toMap(camView(F, cam), held.x, held.z);
    expect(now.x).toBeCloseTo(260, 6);
    expect(now.y).toBeCloseTo(200, 6);
  });

  it("ignores a pinch whose fingers started on top of each other", () => {
    const start = { x: 3500, z: 3500, zoom: 2 };
    const p = { x: 300, y: 200 };
    expect(pinch(F, start, p, p, { x: 300, y: 200 }, { x: 500, y: 200 }).zoom).toBe(2);
  });

  it("centres on the hero, zoomed in to read his street (but never out)", () => {
    const c = centreOn(F, fitCam(bounds), 3000, 2900);
    expect(c.zoom).toBe(CENTRE_ZOOM);
    expect(toMap(camView(F, c), 3000, 2900)).toEqual({ x: 300, y: 200 });
    expect(centreOn(F, { x: 3500, z: 3500, zoom: 5 }, 3000, 2900).zoom).toBe(5);
    // By the city's edge it centres as near as the edge allows.
    const edge = centreOn(F, fitCam(bounds), 50, 50);
    expect(toMap(camView(F, edge), 0, 0).x).toBeCloseTo(16, 3);
  });

  it("turns the wheel into a zoom factor: up zooms in, a notch is a sensible step", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48));
    // A runaway delta is capped.
    expect(wheelFactor(-1e6)).toBeCloseTo(wheelFactor(-240));
  });

  it("knows a camera that hasn't moved", () => {
    expect(sameCam({ x: 1, z: 2, zoom: 3 }, { x: 1, z: 2, zoom: 3 })).toBe(true);
    expect(sameCam({ x: 1, z: 2, zoom: 3 }, { x: 1.1, z: 2, zoom: 3 })).toBe(false);
  });
});
