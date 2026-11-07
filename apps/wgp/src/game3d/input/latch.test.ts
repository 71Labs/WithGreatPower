import { describe, expect, it } from "vitest";

import { InputLatch } from "./latch";

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
