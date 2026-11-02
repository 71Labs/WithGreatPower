import { describe, expect, it } from "vitest";

import { classifyGpu, FpsProbe, FrameBudget, MIN_FRAME_SCALE, QUALITY_PRESETS, sceneDpr, tierFromFrameTimes } from "./quality";

describe("quality tiers", () => {
  it("steps down on slow frames and up from low on fast ones, never to high", () => {
    const at = (fps: number) => new Array(60).fill(1 / fps);
    expect(tierFromFrameTimes(at(60), "high")).toBe("high");
    expect(tierFromFrameTimes(at(35), "high")).toBe("medium");
    expect(tierFromFrameTimes(at(35), "medium")).toBe("low");
    expect(tierFromFrameTimes(at(20), "high")).toBe("low");
    expect(tierFromFrameTimes(at(60), "low")).toBe("medium");
    expect(tierFromFrameTimes([], "medium")).toBe("medium");
  });

  it("answers once, after the warm-up", () => {
    const probe = new FpsProbe("medium", 5, 10);
    const answers = [];
    for (let i = 0; i < 40; i++) answers.push(probe.push(1 / 30));
    expect(answers.filter((a) => a !== null)).toEqual(["low"]);
  });

  it("caps the pixel ratio by tier and by the pixel budget", () => {
    expect(sceneDpr(390, 844, 3, QUALITY_PRESETS.medium)).toBe(1.5);
    expect(sceneDpr(390, 844, 3, QUALITY_PRESETS.low)).toBe(1);
    expect(sceneDpr(1200, 800, 2, QUALITY_PRESETS.high)).toBe(2);
    expect(sceneDpr(1440, 900, 2, QUALITY_PRESETS.high)).toBeCloseTo(Math.sqrt(4_000_000 / (1440 * 900)));
    // A 4K screen at high stays under its 4 MP budget.
    const dpr = sceneDpr(3840, 2160, 2, QUALITY_PRESETS.high);
    expect(3840 * 2160 * dpr * dpr).toBeLessThanOrEqual(4_000_001);
  });

  it("trades resolution for frame rate, and backs off when it doesn't help", () => {
    const fb = new FrameBudget();
    let scale = 1;
    for (let i = 0; i < 90; i++) scale = fb.push(1 / 30) ?? scale;
    expect(scale).toBeCloseTo(0.85);
    // Still 30 fps after the step: resolution wasn't the problem, so it steps back up.
    for (let i = 0; i < 90; i++) scale = fb.push(1 / 30) ?? scale;
    expect(scale).toBe(1);
    expect(MIN_FRAME_SCALE).toBeGreaterThan(0.5);
  });

  it("classifies GPUs", () => {
    expect(classifyGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)")).toBe("strong");
    expect(classifyGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)))")).toBe("weak");
    expect(classifyGpu("Adreno (TM) 650")).toBe("mid");
    expect(classifyGpu("Apple GPU", true)).toBe("mid");
  });
});
