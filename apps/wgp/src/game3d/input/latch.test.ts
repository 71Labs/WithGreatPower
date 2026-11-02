import { describe, expect, it } from "vitest";

import { InputLatch } from "./latch";
import { TouchRouter } from "./touch";

const NORTH = { fx: 0, fz: -1 };

describe("the input latch", () => {
  it("gives the idle frame before anything is pressed", () => {
    expect(new InputLatch().take(NORTH)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
  });

  it("latches a power until one tick takes it, exactly once", () => {
    const latch = new InputLatch();
    latch.pushShot(2);
    expect(latch.peek(NORTH).shot).toBe(2);
    expect(latch.take(NORTH).shot).toBe(2);
    expect(latch.take(NORTH).shot).toBe(0);
  });

  it("keeps a tap shorter than a tick, and the latest press wins", () => {
    const latch = new InputLatch();
    latch.pushShot(1);
    latch.pushShot(5);
    expect(latch.take(NORTH).shot).toBe(5);
  });

  it("ignores shots out of range", () => {
    const latch = new InputLatch();
    latch.pushShot(0);
    latch.pushShot(9 as never);
    expect(latch.take(NORTH).shot).toBe(0);
  });

  it("holds the stick and web across ticks", () => {
    const latch = new InputLatch();
    latch.setStick({ x: 0, y: 1 });
    latch.setWeb("key", true);
    expect(latch.take(NORTH)).toEqual({ dir: 48, mag: 3, web: true, shot: 0 });
    expect(latch.take(NORTH)).toEqual({ dir: 48, mag: 3, web: true, shot: 0 });
  });

  it("keeps the web while any source still holds it", () => {
    const latch = new InputLatch();
    latch.setWeb("key", true);
    latch.setWeb("mouse", true);
    latch.setWeb("key", false);
    expect(latch.take(NORTH).web).toBe(true);
    latch.setWeb("mouse", false);
    expect(latch.take(NORTH).web).toBe(false);
  });

  it("clamps the stick and treats NaN as centred", () => {
    const latch = new InputLatch();
    latch.setStick({ x: 3, y: 4 });
    expect(latch.take(NORTH).mag).toBe(3);
    latch.setStick({ x: Number.NaN, y: 0 });
    expect(latch.take(NORTH)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
  });

  it("lets go of everything on clear", () => {
    const latch = new InputLatch();
    latch.setStick({ x: 1, y: 0 });
    latch.setWeb("touch:1", true);
    latch.pushShot(3);
    latch.clear();
    expect(latch.take(NORTH)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
  });

  it("returns a fresh frame every take", () => {
    const latch = new InputLatch();
    const a = latch.take(NORTH);
    a.web = true;
    expect(latch.take(NORTH).web).toBe(false);
  });
});

describe("touch routing", () => {
  const W = 1000;
  const setup = () => {
    const latch = new InputLatch();
    const orbits: [number, number, boolean][] = [];
    const router = new TouchRouter({ latch, orbit: (y, p, h) => orbits.push([y, p, h]) });
    return { latch, orbits, router };
  };

  it("holds the web from a thumb on the right and drops it on lift", () => {
    const { latch, router } = setup();
    router.down(1, 800, 500, W);
    expect(latch.take(NORTH).web).toBe(true);
    router.up(1);
    expect(latch.take(NORTH).web).toBe(false);
  });

  it("steers with a floating stick on the left, centred where the thumb lands", () => {
    const { latch, router } = setup();
    router.down(1, 200, 500, W);
    expect(latch.take(NORTH).mag).toBe(0);
    router.move(1, 200, 400);
    expect(latch.take(NORTH)).toMatchObject({ dir: 48, mag: 3, web: false });
    router.up(1);
    expect(latch.take(NORTH)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
  });

  it("plays with two thumbs, one per side", () => {
    const { latch, router, orbits } = setup();
    router.down(1, 200, 500, W);
    router.down(2, 800, 500, W);
    router.move(1, 260, 500);
    expect(latch.take(NORTH)).toMatchObject({ dir: 0, mag: 3, web: true });
    expect(orbits).toHaveLength(0);
  });

  it("orbits with two fingers on one side, dropping what the first finger held", () => {
    const { latch, router, orbits } = setup();
    router.down(1, 700, 500, W);
    router.down(2, 800, 500, W);
    expect(router.roleOf(1)).toBe("orbit");
    expect(latch.take(NORTH).web).toBe(false);
    router.move(1, 740, 500);
    router.move(2, 840, 500);
    const yaw = orbits.reduce((n, [y]) => n + y, 0);
    expect(yaw).toBeLessThan(0);
    router.up(2);
    expect(orbits.at(-1)).toEqual([0, 0, false]);
    expect(router.roleOf(1)).toBe("inert");
    expect(latch.take(NORTH).web).toBe(false);
  });

  it("drops every finger on reset", () => {
    const { latch, router } = setup();
    router.down(1, 200, 500, W);
    router.move(1, 260, 500);
    router.down(2, 800, 500, W);
    router.reset();
    expect(latch.take(NORTH)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
    expect(router.roleOf(1)).toBeNull();
  });
});
