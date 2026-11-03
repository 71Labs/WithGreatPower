/**
 * Quality tiers for the 3D city, the GPU check that picks one, the FPS probe that steps
 * down after a slow start, and the frame budget that trades resolution for frame rate.
 * Ported from blastoff (session/quality.ts, session/gpu.ts, battle/camera-fx.ts and
 * session/graphics-budget.ts). Pure TS apart from `detectGpu`, which reads one throwaway
 * WebGL context.
 */

export type QualityTier = "low" | "medium" | "high";

export interface QualityPreset {
  tier: QualityTier;
  /** Device pixel ratio ceiling before the pixel budget and frame budget. */
  maxDpr: number;
  /** Multisampling (a context attribute: changing it needs a new canvas). */
  antialias: boolean;
  /** Ink hulls on small rooftop props (buildings, towers and the bridge always get them). */
  propOutlines: boolean;
  /** Star points in the sky. */
  stars: number;
  /** The far skyline ring at the horizon. */
  skyline: boolean;
  /** Drawing-buffer pixels the tier may use. */
  pixelBudget: number;
  /** Cars driving the streets (0: no traffic, and no draw calls for it). */
  cars: number;
  /** Ben-Day dots on shadow faces and in the far fog bands. */
  halftone: boolean;
  /** Near-sector detail: 1 is rooftop clutter only; 2 adds lamps, signals, fire escapes and parapets. */
  detail: 1 | 2;
  /** Comic speed lines at high speed (always off under reduced motion). */
  speedLines: boolean;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  low: { tier: "low", maxDpr: 1, antialias: false, propOutlines: false, stars: 60, skyline: true, pixelBudget: 1_200_000, cars: 0, halftone: false, detail: 1, speedLines: false },
  medium: { tier: "medium", maxDpr: 1.5, antialias: false, propOutlines: true, stars: 140, skyline: true, pixelBudget: 2_000_000, cars: 120, halftone: true, detail: 2, speedLines: true },
  high: { tier: "high", maxDpr: 2, antialias: true, propOutlines: true, stars: 220, skyline: true, pixelBudget: 4_000_000, cars: 240, halftone: true, detail: 2, speedLines: true },
};

export const TIERS: QualityTier[] = ["low", "medium", "high"];

/* ------------------------------------------------------------------ gpu */

export type GpuClass = "strong" | "mid" | "weak" | "unknown";

export function classifyGpu(renderer: string, mobile = false): GpuClass {
  const r = renderer.toLowerCase();
  if (!r) return "unknown";
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/.test(r)) return "weak";
  if (/apple m\d/.test(r)) return "strong";
  if (/apple/.test(r)) return mobile ? "mid" : "unknown";
  if (/nvidia|geforce|quadro|rtx|gtx/.test(r)) return /rtx|gtx (1[0-9]{3}|16\d0)|titan/.test(r) ? "strong" : "mid";
  if (/amd|radeon|ati /.test(r)) return /rx\s?(5[5-9]\d\d|[6-9]\d\d\d|vega)|radeon pro|780m|680m|890m/.test(r) ? "strong" : "mid";
  if (/intel/.test(r)) return /arc/.test(r) ? "strong" : /iris|xe/.test(r) ? "mid" : "weak";
  const adreno = /adreno[^0-9]*(\d{3})/.exec(r);
  if (adreno) return Number(adreno[1]) >= 730 ? "strong" : Number(adreno[1]) >= 640 ? "mid" : "weak";
  const mali = /mali-g(\d{2,3})/.exec(r);
  if (mali) return Number(mali[1]) >= 610 || (Number(mali[1]) >= 76 && Number(mali[1]) < 100) ? "mid" : "weak";
  if (/mali|powervr|img /.test(r)) return "weak";
  return "unknown";
}

let gpuCache: { renderer: string; gpuClass: GpuClass } | null = null;

/** A phone or tablet, by user agent; iPadOS asks for desktop pages but has a touch screen. */
export function isMobileDevice(ua: string, maxTouchPoints = 0): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

const browserIsMobile = () => typeof navigator !== "undefined" && isMobileDevice(navigator.userAgent, navigator.maxTouchPoints || 0);

/** The GPU this browser draws with, from one throwaway context (released at once). */
export function detectGpu(): { renderer: string; gpuClass: GpuClass } {
  if (gpuCache) return gpuCache;
  gpuCache = { renderer: "", gpuClass: "unknown" };
  if (typeof document === "undefined") return gpuCache;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gpuCache = { renderer, gpuClass: classifyGpu(renderer, browserIsMobile()) };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // No WebGL 2: the caller shows the 2D fallback.
  }
  return gpuCache;
}

/** What a browser says about its device, for the starting tier. */
export interface DeviceHints {
  gpuClass: GpuClass;
  /** navigator.deviceMemory, GB (Chromium only, rounded down and capped at 8; undefined elsewhere). */
  memory?: number;
  /** navigator.hardwareConcurrency. */
  cores?: number;
  mobile: boolean;
}

/**
 * The starting tier: high on strong GPUs with room to spare, medium (the phone default) on
 * mid-range or unknown ones, low on weak or software renderers and small-memory devices
 * (4 GB or 4 cores and under), and low on 2 GB whatever the GPU. Pure; the FPS probe
 * corrects a wrong guess after the first seconds of play.
 */
export function pickTier({ gpuClass, memory, cores = 4, mobile }: DeviceHints): QualityTier {
  if (memory !== undefined && memory <= 2) return "low";
  const small = (memory !== undefined && memory <= 4) || cores <= 4;
  switch (gpuClass) {
    case "strong":
      return small || mobile ? "medium" : "high";
    case "mid":
      return small ? "low" : "medium";
    case "weak":
      return "low";
    default:
      return small ? "low" : "medium";
  }
}

/** This browser's starting tier (pickTier over its GPU, memory, cores and form). */
export function detectTier(): QualityTier {
  if (typeof navigator === "undefined") return "medium";
  return pickTier({
    gpuClass: detectGpu().gpuClass,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    cores: navigator.hardwareConcurrency || 4,
    mobile: browserIsMobile(),
  });
}

export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ fps probe */

/**
 * Tier after a probe, from the median frame time (one-off hitches don't count): below
 * 40 fps steps down one tier, below 28 goes straight to low, a low tier holding 57+ steps up
 * to medium. Never steps up to high on its own.
 */
export function tierFromFrameTimes(frameTimes: readonly number[], current: QualityTier): QualityTier {
  if (frameTimes.length === 0) return current;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const fps = median > 0 ? 1 / median : 60;
  if (fps < 28) return "low";
  if (fps < 40) return current === "high" ? "medium" : "low";
  if (fps >= 57 && current === "low") return "medium";
  return current;
}

/** Collects frame times; `push` returns the suggested tier once, after warmup + samples. */
export class FpsProbe {
  private seen = 0;
  private done = false;
  private readonly samples: number[] = [];

  constructor(
    private readonly current: QualityTier,
    private readonly warmup = 45,
    private readonly sampleFrames = 120,
  ) {}

  push(dt: number): QualityTier | null {
    if (this.done) return null;
    this.seen += 1;
    if (this.seen <= this.warmup) return null;
    if (dt > 0 && dt < 0.5) this.samples.push(dt);
    if (this.samples.length < this.sampleFrames) return null;
    this.done = true;
    return tierFromFrameTimes(this.samples, this.current);
  }
}

/** A rolling fps readout (median of the last frames), for the debug overlay. */
export class FpsMeter {
  private readonly frames = new Float32Array(90);
  private i = 0;
  private n = 0;

  push(dt: number): void {
    if (!(dt > 0) || dt > 0.5) return;
    this.frames[this.i] = dt;
    this.i = (this.i + 1) % this.frames.length;
    this.n = Math.min(this.n + 1, this.frames.length);
  }

  get fps(): number {
    if (this.n === 0) return 0;
    const sorted = Array.from(this.frames.subarray(0, this.n)).sort((a, b) => a - b);
    return 1 / sorted[Math.floor(this.n / 2)];
  }
}

/* ------------------------------------------------------------------ pixel and frame budgets */

/** The DPR for a canvas: the tier's ceiling, the device, and a cap on drawing-buffer pixels. */
export function sceneDpr(width: number, height: number, deviceDpr: number, preset: QualityPreset): number {
  const safe = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);
  const pixels = safe(width, 1) * safe(height, 1);
  return Math.max(0.5, Math.min(safe(deviceDpr, 1), preset.maxDpr, Math.sqrt(preset.pixelBudget / pixels)));
}

export const MIN_FRAME_SCALE = 0.6;
const WINDOW_FRAMES = 90;
const CALM_WINDOWS = 6;
const STEP = 0.85;
const TARGET_FRAME = 1 / 60;

/**
 * Adaptive resolution: when the median frame of a ~1.5 s window runs well under 60 fps the
 * pixel ratio scale steps down 15% (to MIN_FRAME_SCALE at most); after six calm windows it
 * steps back up. A step down that doesn't speed things up (a 30 Hz battery-saver cap, a busy
 * CPU) is undone and the scale is left alone for a while. `push` answers a new scale or null.
 */
export class FrameBudget {
  scale = 1;
  private readonly frames: number[] = [];
  private calm = 0;
  private backoff = 0;
  private trial: number | null = null;

  push(dt: number): number | null {
    if (!(dt > 0) || dt > 0.25) return null;
    this.frames.push(dt);
    if (this.frames.length < WINDOW_FRAMES) return null;
    const sorted = this.frames.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.frames.length = 0;
    if (this.trial !== null) {
      const helped = median < this.trial * 0.9;
      this.trial = null;
      if (!helped) {
        this.backoff = 20;
        return this.set(Math.min(1, this.scale / STEP));
      }
    }
    if (this.backoff > 0) {
      this.backoff -= 1;
      return null;
    }
    if (median > TARGET_FRAME * 1.25 && this.scale > MIN_FRAME_SCALE) {
      this.calm = 0;
      this.trial = median;
      return this.set(Math.max(MIN_FRAME_SCALE, this.scale * STEP));
    }
    if (median <= TARGET_FRAME * 1.08) {
      this.calm += 1;
      if (this.calm >= CALM_WINDOWS && this.scale < 1) {
        this.calm = 0;
        return this.set(Math.min(1, this.scale / STEP));
      }
    } else {
      this.calm = 0;
    }
    return null;
  }

  private set(scale: number): number | null {
    if (Math.abs(scale - this.scale) < 1e-3) return null;
    this.scale = scale;
    return scale;
  }
}
