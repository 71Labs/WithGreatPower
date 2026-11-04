import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createSharedUniforms } from "../city/materials";
import { MoonShadows, SHADOW } from "./shadows";

/** The shadow camera's position in its own right/up axes, in texels. */
function lattice(s: MoonShadows) {
  const cam = s.camera;
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const texel = (2 * SHADOW.half) / s.size;
  return { x: cam.position.dot(right) / texel, y: cam.position.dot(up) / texel };
}

describe("moon shadows", () => {
  it("snaps the shadow square to whole texels, so the map doesn't crawl as the hero moves", () => {
    const shared = createSharedUniforms();
    const s = new MoonShadows(2048, shared);
    for (const at of [
      { x: 1234.5, y: 300, z: 987.25 },
      { x: 1234.9, y: 301, z: 987.6 },
      { x: 4100.13, y: 280, z: -620.7 },
    ]) {
      s.follow(at, 0.3, -1);
      const { x, y } = lattice(s);
      expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-6);
      expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-6);
    }
    s.dispose();
  });

  it("holds still for a sub-texel move and keeps the hero inside the square", () => {
    const shared = createSharedUniforms();
    const s = new MoonShadows(2048, shared);
    s.follow({ x: 1000, y: 300, z: 1000 }, 0, -1);
    const a = lattice(s);
    // Across the light, the square stays on the same texel (along the light only the depth range slides).
    s.follow({ x: 1000.2, y: 300, z: 1000.1 }, 0, -1);
    const b = lattice(s);
    expect(Math.abs(b.x - a.x)).toBeLessThan(1e-6);
    expect(Math.abs(b.y - a.y)).toBeLessThan(1e-6);
    // The hero projects inside the map, a little behind its centre (the square leads ahead).
    const p = new Vector3(1000, 300, 1000).applyMatrix4(shared.uShadowMatrix.value);
    expect(p.x).toBeGreaterThan(0.2);
    expect(p.x).toBeLessThan(0.8);
    expect(p.y).toBeGreaterThan(0.2);
    expect(p.y).toBeLessThan(0.8);
    expect(p.z).toBeGreaterThan(0);
    expect(p.z).toBeLessThan(1);
    s.dispose();
  });

  it("turns the materials' shadows on while it lives, and off when it goes", () => {
    const shared = createSharedUniforms();
    expect(shared.uShadowParams.value.x).toBe(0);
    const s = new MoonShadows(1024, shared);
    expect(shared.uShadowParams.value.x).toBe(1);
    expect(shared.uShadowMap.value).not.toBeNull();
    s.dispose();
    expect(shared.uShadowParams.value.x).toBe(0);
    expect(shared.uShadowMap.value).toBeNull();
  });
});
