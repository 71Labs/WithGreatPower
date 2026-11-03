import { describe, expect, it } from "vitest";

import { classifyGpu, FpsProbe, FrameBudget, isMobileDevice, MIN_FRAME_SCALE, pickTier, QUALITY_PRESETS, sceneDpr, tierFromFrameTimes } from "./quality";

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

  it("classifies phone GPUs from budget to flagship", () => {
    expect(classifyGpu("Adreno (TM) 610", true)).toBe("weak");
    expect(classifyGpu("Adreno (TM) 619", true)).toBe("weak");
    expect(classifyGpu("Adreno (TM) 642L", true)).toBe("mid");
    expect(classifyGpu("Adreno (TM) 750", true)).toBe("strong");
    expect(classifyGpu("Mali-G52 MC2", true)).toBe("weak");
    expect(classifyGpu("Mali-G57 MC2", true)).toBe("weak");
    expect(classifyGpu("Mali-G78 MP14", true)).toBe("mid");
    expect(classifyGpu("Mali-G710 MC10", true)).toBe("mid");
    expect(classifyGpu("PowerVR Rogue GE8320", true)).toBe("weak");
    expect(classifyGpu("", true)).toBe("unknown");
  });
});

describe("the starting tier", () => {
  it("picks low on weak phones, small-memory phones and software renderers", () => {
    expect(pickTier({ gpuClass: "weak", memory: 8, cores: 8, mobile: true })).toBe("low");
    expect(pickTier({ gpuClass: "mid", memory: 4, cores: 8, mobile: true })).toBe("low");
    expect(pickTier({ gpuClass: "mid", memory: 8, cores: 4, mobile: true })).toBe("low");
    expect(pickTier({ gpuClass: "unknown", memory: 3, cores: 8, mobile: true })).toBe("low");
    // Two gigabytes is low whatever the GPU claims.
    expect(pickTier({ gpuClass: "strong", memory: 2, cores: 8, mobile: true })).toBe("low");
    expect(pickTier({ gpuClass: classifyGpu("SwiftShader Device"), memory: 8, cores: 16, mobile: false })).toBe("low");
  });

  it("gives mid-range and flagship phones medium, never high", () => {
    expect(pickTier({ gpuClass: "mid", memory: 8, cores: 8, mobile: true })).toBe("medium");
    expect(pickTier({ gpuClass: "strong", memory: 8, cores: 8, mobile: true })).toBe("medium");
    // Safari reports no memory: cores decide.
    expect(pickTier({ gpuClass: "mid", cores: 6, mobile: true })).toBe("medium");
    expect(pickTier({ gpuClass: "unknown", cores: 8, mobile: true })).toBe("medium");
  });

  it("gives strong desktops high", () => {
    expect(pickTier({ gpuClass: "strong", memory: 8, cores: 12, mobile: false })).toBe("high");
    expect(pickTier({ gpuClass: "strong", memory: 4, cores: 12, mobile: false })).toBe("medium");
  });

  it("knows phones and iPads (which ask for desktop pages) from desktops", () => {
    expect(isMobileDevice("Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", 5)).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", 0)).toBe(false);
  });

  it("caps a phone's pixel ratio by tier, whatever the screen's density", () => {
    for (const [w, h, d] of [
      [390, 844, 3],
      [844, 390, 3],
      [360, 780, 4],
    ]) {
      expect(sceneDpr(w, h, d, QUALITY_PRESETS.low)).toBe(1);
      expect(sceneDpr(w, h, d, QUALITY_PRESETS.medium)).toBe(1.5);
      expect(sceneDpr(w, h, d, QUALITY_PRESETS.high)).toBe(2);
    }
    // A low-density phone isn't pushed past its own screen.
    expect(sceneDpr(360, 780, 1.5, QUALITY_PRESETS.high)).toBe(1.5);
  });
});
