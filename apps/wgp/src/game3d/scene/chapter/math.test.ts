import { describe, expect, it } from "vitest";

import { chapterOf, isChapterEvent, rightClickerOf } from "./contract";
import {
  aimCharge,
  AIM_TICKS,
  clueGlow,
  copyWobble,
  CONE_RANGE,
  FLAKE_LIFE,
  flakeAt,
  flashAlpha,
  FLASH_PEAK,
  FLASH_SECONDS,
  GLOW_FOUND,
  inCone,
  jpegLook,
  pixelTrail,
  pulseAlpha,
  PULSE_SECONDS,
  yawOfDir,
} from "./math";

const o = { x: 0, y: 0, z: 0 };

describe("the SCREENSHOT cone", () => {
  const dir = { x: 0, y: 0, z: 1 };
  it("holds points within the half-angle and range", () => {
    expect(inCone(o, dir, 0.3, { x: 0, y: 0, z: 400 })).toBe(true);
    expect(inCone(o, dir, 0.3, { x: 100, y: 50, z: 400 })).toBe(true); // atan(100/400) ≈ 0.245
    expect(inCone(o, dir, 0.3, { x: 150, y: 0, z: 400 })).toBe(false); // ≈ 0.359
    expect(inCone(o, dir, 0.3, { x: 0, y: 0, z: -100 })).toBe(false);
    expect(inCone(o, dir, 0.3, { x: 0, y: 0, z: CONE_RANGE + 1 })).toBe(false);
  });
  it("ignores height and works for any heading", () => {
    const d = { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 };
    expect(inCone({ x: 10, y: 300, z: 10 }, d, 0.2, { x: 210, y: 0, z: -190 })).toBe(true);
    expect(inCone({ x: 10, y: 300, z: 10 }, d, 0.2, { x: -190, y: 0, z: -190 })).toBe(false);
  });
  it("charges over the aim and yaws along its direction", () => {
    expect(aimCharge(0)).toBe(0);
    expect(aimCharge(AIM_TICKS / 2)).toBeCloseTo(0.5);
    expect(aimCharge(AIM_TICKS * 3)).toBe(1);
    expect(yawOfDir(0, 1)).toBeCloseTo(0);
    expect(yawOfDir(1, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe("the flash and its reduced-motion pulse", () => {
  it("flashes once and clears", () => {
    expect(flashAlpha(0)).toBeCloseTo(FLASH_PEAK);
    expect(flashAlpha(FLASH_SECONDS / 2)).toBeLessThan(FLASH_PEAK / 2);
    expect(flashAlpha(FLASH_SECONDS)).toBe(0);
    expect(flashAlpha(-0.1)).toBe(0);
  });
  it("never goes past the peak a photosensitive-safe flash allows", () => {
    for (let t = 0; t < 0.5; t += 0.01) expect(flashAlpha(t)).toBeLessThanOrEqual(FLASH_PEAK);
  });
  it("pulses up and back down", () => {
    expect(pulseAlpha(0)).toBeCloseTo(0);
    expect(pulseAlpha(PULSE_SECONDS / 2)).toBeCloseTo(1);
    expect(pulseAlpha(PULSE_SECONDS)).toBe(0);
  });
});

describe("Mary's compression", () => {
  it("follows 1 − restore", () => {
    expect(jpegLook(0).strength).toBe(1);
    expect(jpegLook(0.5).strength).toBeCloseTo(0.5);
    expect(jpegLook(1).strength).toBe(0);
    expect(jpegLook(2).strength).toBe(0);
    expect(jpegLook(-1).strength).toBe(1);
  });
  it("gets coarser as she's more compressed", () => {
    const a = jpegLook(0);
    const b = jpegLook(0.5);
    const c = jpegLook(1);
    expect(a.levels).toBeLessThan(b.levels);
    expect(b.levels).toBeLessThan(c.levels);
    expect(a.pixelsTall).toBeLessThan(b.pixelsTall);
    expect(a.snap).toBeGreaterThan(b.snap);
    expect(c.snap).toBe(0);
  });
});

describe("paper copies and clues", () => {
  it("wobble a little, each on its own beat", () => {
    for (let t = 0; t < 10; t += 0.37) {
      const [lean, sway] = copyWobble(3, t);
      expect(Math.abs(lean)).toBeLessThanOrEqual(0.07);
      expect(Math.abs(sway)).toBeLessThanOrEqual(0.09);
    }
    expect(copyWobble(1, 2)).not.toEqual(copyWobble(2, 2));
  });
  it("dims a clue's glow once found", () => {
    expect(clueGlow(false, 5)).toBe(1);
    expect(clueGlow(true, 0)).toBe(1);
    expect(clueGlow(true, 0.3)).toBeLessThan(1);
    expect(clueGlow(true, 2)).toBeCloseTo(GLOW_FOUND);
  });
});

describe("the pixel trail", () => {
  const from = { x: 100, y: 0, z: 100 };
  const to = { x: 1100, y: 0, z: 100 };
  it("is deterministic and leads toward the target", () => {
    const a = pixelTrail(from, to, 40, 500, 7);
    expect(a).toEqual(pixelTrail(from, to, 40, 500, 7));
    expect(a).not.toEqual(pixelTrail(from, to, 40, 500, 8));
    for (const c of a) {
      expect(c.x).toBeGreaterThanOrEqual(from.x - 1);
      expect(c.x).toBeLessThanOrEqual(from.x + 500 + 1);
      expect(Math.abs(c.z - from.z)).toBeLessThanOrEqual(30);
    }
  });
  it("bunches near the clue, shrinks along and mixes in teal", () => {
    const a = pixelTrail(from, to, 60, 500, 3);
    const nearHalf = a.filter((c) => c.along < 0.5).length;
    expect(nearHalf).toBeGreaterThan(a.length / 2);
    const first = a.slice(0, 10).reduce((s, c) => s + c.size, 0);
    const last = a.slice(-10).reduce((s, c) => s + c.size, 0);
    expect(first).toBeGreaterThan(last);
    expect(a.some((c) => c.colour === 3)).toBe(true);
    expect(a.some((c) => c.colour !== 3)).toBe(true);
  });
  it("stops at the target when it's closer than the trail", () => {
    for (const c of pixelTrail(from, { x: 200, y: 0, z: 100 }, 20, 500, 1)) expect(c.x).toBeLessThanOrEqual(200 + 1);
  });
});

describe("confetti", () => {
  it("flies up and out, then lands and goes", () => {
    const early = flakeAt(4, 11, 0.2);
    expect(early.alive).toBe(true);
    expect(early.y).toBeGreaterThan(0);
    expect(Math.hypot(early.x, early.z)).toBeGreaterThan(5);
    const late = { ...flakeAt(4, 11, FLAKE_LIFE - 0.01) };
    expect(late.y).toBeLessThan(early.y);
    expect(flakeAt(4, 11, FLAKE_LIFE).alive).toBe(false);
  });
  it("throws a pixel burst harder", () => {
    const a = flakeAt(2, 5, 0.3, 1);
    const b = { ...flakeAt(2, 5, 0.3, 1.8) };
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(Math.hypot(a.x, a.z));
  });
});

describe("the chapter contract", () => {
  const base = {
    tick: 0,
    alpha: 1,
    hero: { pos: o, vel: o, anchor: null, grounded: true, hp: 1, maxHp: 1, fluid: 0, hurtFlash: 0, shield: false },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "fight" as const,
    timeScale: 1,
  };
  it("reads no chapter on a normal night", () => {
    expect(chapterOf(base)).toBeNull();
    expect(rightClickerOf(base)).toBeNull();
  });
  it("reads the chapter and the Right-Clicker when they're there", () => {
    const chapter = { id: "case-001", phase: "standoff", clues: [], captive: null, copies: [] };
    const rc = { id: "right-clicker", copy: false, pos: o, hits: 0, hitsMax: 8, state: "aim", aim: { dir: { x: 0, y: 0, z: 1 }, half: 0.3 } };
    const frame = { ...base, chapter, villains: [rc] } as unknown as typeof base;
    expect(chapterOf(frame)?.phase).toBe("standoff");
    expect(rightClickerOf(frame)?.aim?.half).toBe(0.3);
  });
  it("knows its events", () => {
    expect(isChapterEvent({ type: "clue-found" })).toBe(true);
    expect(isChapterEvent({ type: "captive-freed" })).toBe(true);
    expect(isChapterEvent({ type: "thwip" })).toBe(false);
  });
});
