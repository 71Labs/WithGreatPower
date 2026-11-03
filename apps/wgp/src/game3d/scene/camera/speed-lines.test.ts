import { PerspectiveCamera, Vector2, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import { motionFocus, SpeedLines } from "./speed-lines";

/** A camera at the origin looking down −z, the way the chase camera hands it over (matrices fresh). */
function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(55, 16 / 9, 4, 30000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -100);
  cam.updateMatrixWorld();
  return cam;
}

const focusOf = (lines: SpeedLines) => (lines.mesh.material as ShaderMaterial).uniforms.uFocus.value as Vector2;

describe("motionFocus", () => {
  it("puts motion straight ahead at the centre", () => {
    const out = new Vector2(9, 9);
    expect(motionFocus({ x: 0, y: 0, z: -1200 }, camera(), out)).toBe(true);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it("leans toward the side the hero is heading, within ±0.6", () => {
    const out = new Vector2();
    motionFocus({ x: 900, y: 200, z: -900 }, camera(), out);
    expect(out.x).toBeGreaterThan(0.3);
    expect(out.x).toBeLessThanOrEqual(0.6);
    expect(out.y).toBeGreaterThan(0);
  });

  it("centres motion that points behind the camera", () => {
    const out = new Vector2(9, 9);
    expect(motionFocus({ x: 50, y: 0, z: 1200 }, camera(), out)).toBe(true);
    expect(out.toArray()).toEqual([0, 0]);
  });

  it("has no focus for a hero standing still (no divide by zero), and leaves the last one", () => {
    const out = new Vector2(0.25, -0.1);
    expect(motionFocus({ x: 0, y: 0, z: 0 }, camera(), out)).toBe(false);
    expect(motionFocus({ x: Number.NaN, y: 0, z: 0 }, camera(), out)).toBe(false);
    expect(out.toArray()).toEqual([0.25, -0.1]);
  });
});

describe("SpeedLines", () => {
  /** Swing fast for a second: the lines come in at full strength. */
  function fast(lines: SpeedLines, cam: PerspectiveCamera) {
    for (let i = 0; i < 60; i++) lines.update({ x: 400, y: 0, z: -1400 }, cam, 1920, 1080, 1 / 60, i / 60);
    expect(lines.mesh.visible).toBe(true);
    expect(lines.level).toBeGreaterThan(0.9);
  }

  it("never feeds the shader a NaN focus when the hero stops dead (the errand blackout)", () => {
    const cam = camera();
    const lines = new SpeedLines();
    fast(lines, cam);
    const before = focusOf(lines).clone();
    // Stood beside an errand ally: the sim's velocity is exactly zero while the lines fade.
    for (let i = 0; i < 30; i++) {
      lines.update({ x: 0, y: 0, z: 0 }, cam, 1920, 1080, 1 / 60, 1 + i / 60);
      const f = focusOf(lines);
      expect(Number.isFinite(f.x) && Number.isFinite(f.y)).toBe(true);
    }
    expect(focusOf(lines).toArray()).toEqual(before.toArray());
    lines.dispose();
  });

  it("drops the lines at once on a camera cut", () => {
    const cam = camera();
    const lines = new SpeedLines();
    fast(lines, cam);
    lines.reset();
    expect(lines.mesh.visible).toBe(false);
    expect(lines.level).toBe(0);
    lines.update({ x: 0, y: 0, z: 0 }, cam, 1920, 1080, 1 / 60, 2);
    expect(lines.mesh.visible).toBe(false);
    lines.dispose();
  });

  it("stays off when disabled (reduced motion, or a tier without them)", () => {
    const cam = camera();
    const lines = new SpeedLines();
    lines.enabled = false;
    for (let i = 0; i < 60; i++) lines.update({ x: 0, y: 0, z: -2000 }, cam, 1920, 1080, 1 / 60, i / 60);
    expect(lines.mesh.visible).toBe(false);
    lines.dispose();
  });
});
