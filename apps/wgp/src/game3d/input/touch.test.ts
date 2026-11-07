import { describe, expect, it } from "vitest";

import { LOOK_SLOP, LOOK_SPEED_MAX, LOOK_SPEED_MIN, TOUCH_LOOK_PITCH_PER_PX, TOUCH_LOOK_YAW_PER_PX, WEB_HOLD_MS, lookSpeed } from "./bindings";
import { InputLatch } from "./latch";
import { lookDelta, pastSlop, TouchRouter, type StickVisual } from "./touch";

const NORTH = { fx: 0, fz: -1 };
const W = 1000;

/** A router as a night has it (webAtOnce unset: the web the moment a thumb lands) or free roam on a roof (`roof`). */
const setup = (opts: { roof?: boolean; air?: () => boolean } = {}) => {
  const latch = new InputLatch();
  const orbits: [number, number, boolean][] = [];
  const sticks: StickVisual[] = [];
  const webAtOnce = opts.air ?? (opts.roof ? () => false : undefined);
  const router = new TouchRouter({ latch, orbit: (y, p, h) => orbits.push([y, p, h]), stick: (v) => sticks.push(v), webAtOnce });
  const yaw = () => orbits.reduce((n, [y]) => n + y, 0);
  const pitch = () => orbits.reduce((n, [, p]) => n + p, 0);
  return { latch, orbits, sticks, router, yaw, pitch };
};

/** Drag finger `id` from (x, y) by (dx, dy) in `steps` moves, `ms` apart, starting at time `t`. */
const drag = (router: TouchRouter, id: number, x: number, y: number, dx: number, dy: number, steps = 10, t = 0, ms = 8) => {
  for (let i = 1; i <= steps; i++) router.move(id, x + (dx * i) / steps, y + (dy * i) / steps, t + i * ms);
};

describe("the look gesture's maths", () => {
  it("turns mouse-like: right is yaw down (the chase camera's right), up looks up", () => {
    expect(lookDelta(100, 0).yaw).toBeCloseTo(-100 * TOUCH_LOOK_YAW_PER_PX);
    expect(lookDelta(-100, 0).yaw).toBeGreaterThan(0);
    expect(lookDelta(0, -100).pitch).toBeCloseTo(-100 * TOUCH_LOOK_PITCH_PER_PX);
  });

  it("splits the turn between fingers turning together", () => {
    expect(lookDelta(100, 40, 2).yaw).toBeCloseTo(lookDelta(50, 20).yaw);
    expect(lookDelta(100, 40, 0).yaw).toBeCloseTo(lookDelta(100, 40).yaw);
  });

  it("counts a drag only past the slop", () => {
    expect(pastSlop(LOOK_SLOP, 0)).toBe(false);
    expect(pastSlop(LOOK_SLOP + 0.5, 0)).toBe(true);
    expect(pastSlop(8, 8)).toBe(true);
  });

  it("keeps the look speed in range, on a step, 1 when unset", () => {
    expect(lookSpeed(undefined)).toBe(1);
    expect(lookSpeed("fast")).toBe(1);
    expect(lookSpeed(Number.NaN)).toBe(1);
    expect(lookSpeed(9)).toBe(LOOK_SPEED_MAX);
    expect(lookSpeed(0)).toBe(LOOK_SPEED_MIN);
    expect(lookSpeed(1.3)).toBe(1.25);
  });
});

describe("touch on a night (the web the moment a thumb lands)", () => {
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

  it("plays with two thumbs, one per side, and a still web thumb never turns the camera", () => {
    const { latch, router, orbits } = setup();
    router.down(1, 200, 500, W);
    router.down(2, 800, 500, W);
    router.move(1, 260, 500);
    router.move(2, 806, 504);
    expect(latch.take(NORTH)).toMatchObject({ dir: 0, mag: 3, web: true });
    expect(orbits).toHaveLength(0);
  });

  it("looks round mid-swing: a web thumb that drags turns the camera and keeps the web", () => {
    const { latch, router, yaw, orbits } = setup();
    router.down(1, 700, 500, W);
    drag(router, 1, 700, 500, 200, 0);
    expect(latch.take(NORTH).web).toBe(true);
    expect(router.turns(1)).toBe(true);
    // The turn starts at the slop, so it's a little under the whole drag.
    expect(yaw()).toBeLessThan(0);
    expect(yaw()).toBeCloseTo(lookDelta(200 - LOOK_SLOP - 10, 0).yaw, 1);
    router.up(1);
    expect(orbits.at(-1)).toEqual([0, 0, false]);
    expect(latch.take(NORTH).web).toBe(false);
  });

  it("keeps the stick steering while another thumb looks (no more dropping it for a two-finger orbit)", () => {
    const { latch, router, yaw } = setup();
    router.down(1, 200, 500, W);
    router.move(1, 200, 400);
    router.down(2, 250, 300, W);
    expect(router.roleOf(2)).toBe("wait");
    drag(router, 2, 250, 300, -150, 0);
    expect(router.roleOf(2)).toBe("look");
    expect(yaw()).toBeGreaterThan(0);
    expect(latch.take(NORTH)).toMatchObject({ dir: 48, mag: 3, web: false });
  });

  it("shares the turn between two fingers dragging together (the midpoint moves)", () => {
    const one = setup();
    one.router.down(1, 700, 500, W);
    drag(one.router, 1, 700, 500, 120, 0);
    const two = setup();
    two.router.down(1, 700, 500, W);
    two.router.down(2, 800, 500, W);
    drag(two.router, 1, 700, 500, 20, 0, 2);
    drag(two.router, 2, 800, 500, 20, 0, 2);
    const before = two.yaw();
    for (let i = 1; i <= 10; i++) {
      two.router.move(1, 720 + i * 10, 500);
      two.router.move(2, 820 + i * 10, 500);
    }
    // Both moved 100 px: the pair turns as far as one finger moving 100 px.
    expect(two.yaw() - before).toBeCloseTo(lookDelta(100, 0).yaw);
    expect(two.latch.take(NORTH).web).toBe(true);
  });

  it("holds the web through a re-grip: a second thumb joins at once, the first lifts", () => {
    const { latch, router } = setup({ roof: true });
    router.down(1, 800, 500, W, 0);
    router.poll(WEB_HOLD_MS);
    expect(router.roleOf(1)).toBe("web");
    // On a roof a new thumb would wait, but one already holds the web: it joins at once.
    router.down(2, 760, 600, W, WEB_HOLD_MS + 10);
    expect(router.roleOf(2)).toBe("web");
    router.up(1);
    expect(latch.take(NORTH).web).toBe(true);
    router.up(2);
    expect(latch.take(NORTH).web).toBe(false);
  });

  it("hands the stick to a spare thumb when the first lifts, centred where that thumb is", () => {
    const { latch, router, sticks } = setup();
    router.down(1, 200, 500, W);
    router.move(1, 200, 400);
    router.down(2, 150, 600, W);
    router.up(1);
    expect(router.roleOf(2)).toBe("stick");
    expect(latch.take(NORTH).mag).toBe(0);
    expect(sticks.at(-1)).toEqual({ active: true, ox: 150, oy: 600, x: 150, y: 600 });
    router.move(2, 150, 500);
    expect(latch.take(NORTH)).toMatchObject({ dir: 48, mag: 3 });
  });

  it("doesn't hand the stick to a thumb that's looking", () => {
    const { latch, router } = setup();
    router.down(1, 200, 500, W);
    router.down(2, 150, 600, W);
    drag(router, 2, 150, 600, 60, 0);
    router.up(1);
    expect(router.roleOf(2)).toBe("look");
    expect(latch.take(NORTH).mag).toBe(0);
  });

  it("shows the stick where the thumb lands and hides it on lift", () => {
    const { router, sticks } = setup();
    router.down(1, 120, 600, W);
    expect(sticks.at(-1)).toEqual({ active: true, ox: 120, oy: 600, x: 120, y: 600 });
    router.move(1, 150, 560);
    expect(sticks.at(-1)).toEqual({ active: true, ox: 120, oy: 600, x: 150, y: 560 });
    router.up(1);
    expect(sticks.at(-1)?.active).toBe(false);
  });

  it("keeps the web held while a stick thumb lands, moves and lifts", () => {
    const { latch, router } = setup();
    router.down(1, 800, 500, W);
    for (let i = 0; i < 5; i++) {
      router.down(10 + i, 200, 500, W);
      router.move(10 + i, 200 + 30 * (i % 2 ? 1 : -1), 450);
      expect(latch.take(NORTH).web).toBe(true);
      router.up(10 + i);
    }
    expect(latch.take(NORTH)).toMatchObject({ web: true, mag: 0 });
  });

  it("never turns the camera from the stick", () => {
    const { router, orbits } = setup();
    router.down(1, 200, 500, W);
    drag(router, 1, 200, 500, 120, -90);
    expect(orbits).toHaveLength(0);
  });

  it("drops every finger on reset, and lets go of the camera", () => {
    const { latch, router, orbits } = setup();
    router.down(1, 200, 500, W);
    router.move(1, 260, 500);
    router.down(2, 800, 500, W);
    drag(router, 2, 800, 500, 80, 0);
    router.reset();
    expect(latch.take(NORTH)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
    expect(router.roleOf(1)).toBeNull();
    expect(orbits.at(-1)).toEqual([0, 0, false]);
  });
});

describe("touch in free roam on a roof (a thumb that drags first is a look)", () => {
  it("turns the camera with one finger on the open screen and never fires a web", () => {
    const { latch, router, yaw, pitch } = setup({ roof: true });
    router.down(1, 700, 400, W, 0);
    expect(router.roleOf(1)).toBe("wait");
    expect(latch.take(NORTH).web).toBe(false);
    drag(router, 1, 700, 400, -240, -60, 20, 0, 8);
    expect(router.roleOf(1)).toBe("look");
    // Still a look long after the hold time: it dragged first.
    router.poll(2000);
    expect(router.roleOf(1)).toBe("look");
    expect(latch.take(NORTH).web).toBe(false);
    expect(yaw()).toBeGreaterThan(0);
    expect(pitch()).toBeLessThan(0);
  });

  it("holds the web from a thumb that stays put for the hold time", () => {
    const { latch, router } = setup({ roof: true });
    router.down(1, 700, 400, W, 1000);
    router.poll(1000 + WEB_HOLD_MS - 1);
    expect(latch.take(NORTH).web).toBe(false);
    router.poll(1000 + WEB_HOLD_MS);
    expect(router.roleOf(1)).toBe("web");
    expect(latch.take(NORTH).web).toBe(true);
    router.up(1);
    expect(latch.take(NORTH).web).toBe(false);
  });

  it("decides on a late first move too: a still thumb that then drags holds the web and looks", () => {
    const { latch, router, yaw } = setup({ roof: true });
    router.down(1, 700, 400, W, 0);
    drag(router, 1, 700, 400, 100, 0, 10, WEB_HOLD_MS, 8);
    expect(router.roleOf(1)).toBe("web");
    expect(latch.take(NORTH).web).toBe(true);
    expect(yaw()).toBeLessThan(0);
  });

  it("does nothing for a quick tap", () => {
    const { latch, router, orbits } = setup({ roof: true });
    router.down(1, 700, 400, W, 0);
    router.move(1, 703, 402, 40);
    router.up(1);
    router.poll(WEB_HOLD_MS * 2);
    expect(latch.take(NORTH).web).toBe(false);
    expect(orbits).toHaveLength(0);
  });

  it("steers and looks at once: the stick thumb and a look thumb", () => {
    const { latch, router, yaw } = setup({ roof: true });
    router.down(1, 150, 700, W, 0);
    router.move(1, 150, 620, 10);
    router.down(2, 600, 400, W, 20);
    drag(router, 2, 600, 400, 200, 0, 20, 20, 8);
    expect(router.roleOf(1)).toBe("stick");
    expect(router.roleOf(2)).toBe("look");
    expect(latch.take(NORTH)).toMatchObject({ dir: 48, mag: 3, web: false });
    expect(yaw()).toBeCloseTo(lookDelta(200 - LOOK_SLOP - 10, 0).yaw, 1);
  });

  it("holds the web at once in the air (webAtOnce reads the hero's move each touch)", () => {
    let air = false;
    const { latch, router } = setup({ air: () => air });
    router.down(1, 700, 400, W, 0);
    expect(router.roleOf(1)).toBe("wait");
    router.up(1);
    air = true;
    router.down(2, 700, 400, W, 500);
    expect(router.roleOf(2)).toBe("web");
    expect(latch.take(NORTH).web).toBe(true);
  });

  it("says when a web-side thumb is waiting, so the controls know to poll", () => {
    const { router } = setup({ roof: true });
    router.down(1, 200, 400, W, 0);
    expect(router.waiting).toBe(false);
    router.down(2, 700, 400, W, 0);
    expect(router.waiting).toBe(true);
    router.poll(WEB_HOLD_MS);
    expect(router.waiting).toBe(false);
  });
});
