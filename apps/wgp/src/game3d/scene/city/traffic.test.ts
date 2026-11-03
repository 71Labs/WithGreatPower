import { describe, expect, it } from "vitest";
import { Vector4 } from "three";

import { generateFixtureCity } from "../fixture-city";
import { createSharedUniforms } from "./materials";
import { OCCLUSION, setOcclusion } from "./occlusion";
import { lampStops, LAMP } from "./streets";
import { trafficLoops } from "./traffic";

const city = generateFixtureCity(7);

describe("traffic", () => {
  const loops = trafficLoops(city);
  const river = city.river!;

  it("drives every street but the river, turning short of the banks", () => {
    expect(loops.filter((l) => !l.deck).length).toBeGreaterThan(15);
    for (const l of loops) {
      if (l.deck) continue;
      // Both lanes and both U-turns stay out of the water.
      const across = [l.c - l.r, l.c + l.r];
      const along = [l.lo - l.r, l.hi + l.r];
      const xs = l.axis === 0 ? along : across;
      const zs = l.axis === 0 ? across : along;
      const wet = xs[1] > river.x0 && xs[0] < river.x1 && zs[1] > river.z0 && zs[0] < river.z1;
      expect(wet).toBe(false);
    }
  });

  it("has a loop up on the bridge deck", () => {
    const deck = loops.find((l) => l.deck);
    expect(deck).toBeDefined();
    expect(deck!.y).toBe(city.bridge!.deck.y);
  });
});

describe("street lamps", () => {
  it("stand a spacing apart and zigzag across the street", () => {
    const stops = lampStops(0, 0, 2000);
    expect(stops.length).toBeGreaterThan(5);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].at - stops[i - 1].at).toBeCloseTo(LAMP.spacing);
      expect(stops[i].side).toBe(-stops[i - 1].side);
    }
  });
});

describe("occlusion", () => {
  it("pulls each end back toward the camera, and switches an end off", () => {
    const u = createSharedUniforms();
    setOcclusion(u, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 500 }, null);
    const a: Vector4 = u.uOccA.value;
    expect(a.w).toBe(1);
    expect(a.z).toBeCloseTo(500 - OCCLUSION.pull);
    expect(u.uOccB.value.w).toBe(0);
    expect(u.uOccHero.value.w).toBe(1);
    // A target closer than the pull-back has nothing in between to fade.
    setOcclusion(u, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: 400 });
    expect(u.uOccA.value.w).toBe(0);
    setOcclusion(u, { x: 0, y: 0, z: 0 }, null, null);
    expect(u.uOccHero.value.w).toBe(0);
  });

  it("aims the rival's end at the villain itself, so a body just inside a tower still fades it", () => {
    const u = createSharedUniforms();
    setOcclusion(u, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 400 });
    expect(OCCLUSION.pullRival).toBeLessThan(10);
    const b: Vector4 = u.uOccB.value;
    expect(b.w).toBe(1);
    expect(b.z).toBeCloseTo(400 - OCCLUSION.pullRival);
    // The hero's end still stops short of the wall he clings to.
    expect(u.uOccA.value.z).toBeCloseTo(500 - OCCLUSION.pull);
  });
});
