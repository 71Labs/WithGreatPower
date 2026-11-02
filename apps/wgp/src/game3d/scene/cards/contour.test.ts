import { describe, expect, it } from "vitest";

import { signedArea, simplifyClosed, stickerOutline, traceContour } from "./contour";

function disc(size: number, r: number): Uint8Array {
  const m = new Uint8Array(size * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) m[y * size + x] = (x - c) ** 2 + (y - c) ** 2 <= r * r ? 1 : 0;
  return m;
}

describe("sticker contour", () => {
  it("traces a square's four corners", () => {
    const m = new Uint8Array(8 * 8);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) m[y * 8 + x] = 1;
    const ring = traceContour(m, 8, 8);
    expect(ring).toHaveLength(4);
    expect(Math.abs(signedArea(ring))).toBe(16);
    const xs = ring.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(6);
  });

  it("outlines a disc with a few dozen points and the right area", () => {
    const size = 64;
    const r = 24;
    const out = stickerOutline(disc(size, r), size, size);
    expect(out.length).toBeGreaterThan(16);
    expect(out.length).toBeLessThan(140);
    expect(Math.abs(signedArea(out))).toBeGreaterThan(Math.PI * r * r * 0.9);
    expect(Math.abs(signedArea(out))).toBeLessThan(Math.PI * (r + 1.5) ** 2);
  });

  it("keeps a closed ring's extremes when simplifying", () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 100; i++) ring.push([Math.cos((i / 100) * Math.PI * 2) * 10, Math.sin((i / 100) * Math.PI * 2) * 10]);
    const s = simplifyClosed(ring, 0.5);
    expect(s.length).toBeLessThan(40);
    expect(Math.max(...s.map((p) => p[0]))).toBeCloseTo(10, 0);
  });

  it("returns nothing for an empty mask", () => {
    expect(stickerOutline(new Uint8Array(16), 4, 4)).toEqual([]);
  });
});
