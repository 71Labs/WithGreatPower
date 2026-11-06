import { describe, expect, it } from "vitest";

import { newRenderFrame } from "@wgp/game-core/sim3d";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { blendFrame } from "./blend";

type Fee = NonNullable<RenderFrame3D["fee"]>;

const fee = (meterX: number, carried: boolean, phase: Fee["phase"] = "chase"): Fee => ({
  id: "case-003",
  phase,
  clues: [{ id: "burn", pos: { x: 1, y: 300, z: 2 }, found: true }],
  meter: { pos: { x: meterX, y: 400, z: 0 }, carried, heat: 1, cooled: false, spike: 0 },
  route: [
    { pos: { x: 0, y: 500, z: 0 }, roof: { x: 0, y: 280, z: 0 } },
    { pos: { x: 900, y: 600, z: 0 }, roof: null },
  ],
  chase: phase === "chase" ? { next: 1, checkpoint: 0, escape: 0.25, gap: 420, losses: 1, maxLosses: 5 } : null,
  bakery: { x: 2000, y: 240, z: 2000 },
});

describe("blending v1.6's fee (Case File 003)", () => {
  it("carries the case into the drawn frame, sliding the meter with him, and nothing on other nights", () => {
    const prev = newRenderFrame();
    const curr = newRenderFrame();
    prev.fee = fee(100, true);
    curr.fee = fee(140, true);
    const out = blendFrame(prev, curr, 0.5, newRenderFrame());
    expect(out.fee?.phase).toBe("chase");
    expect(out.fee?.meter.pos.x).toBeCloseTo(120, 6);
    expect(out.fee?.chase).toEqual(curr.fee.chase);
    expect(out.fee?.route).toEqual(curr.fee.route);
    expect(out.fee?.route).not.toBe(curr.fee.route);
    expect(out.fee?.clues).toEqual(curr.fee.clues);
    // Planted between the ticks: no slide across the city.
    curr.fee = fee(2000, false, "showdown");
    blendFrame(prev, curr, 0.5, out);
    expect(out.fee?.meter.pos.x).toBe(2000);
    expect(out.fee?.chase).toBeNull();
    // Another night: none.
    blendFrame(newRenderFrame(), newRenderFrame(), 0.5, out);
    expect(out.fee).toBeUndefined();
  });
});
