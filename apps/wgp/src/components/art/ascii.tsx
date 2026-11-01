"use client";

import { useEffect, useRef, useState } from "react";

import { skylineTone, terrainTone } from "@/lib/art/terrain";

import { useOnScreen, usePalette, useReducedMotion } from "./use-art";

/** Light to dark. The ramp reads as relief in a monospace grid. */
const RAMP = " .·:;-=+*x%#@";

/**
 * The hero's mountains drawn again as real ASCII: each cell of a monospace grid gets
 * the character whose density matches the terrain tone there. Drifts slowly while on
 * screen; a still frame for reduced motion. Decorative.
 */
export function AsciiTerrain({
  className = "",
  fontSize = 12,
  fps = 10,
  seed = 7,
  lift = -0.08,
  variant = "terrain",
}: {
  className?: string;
  fontSize?: number;
  fps?: number;
  seed?: number;
  /** Shifts the ranges down (negative) to leave room for content above. */
  lift?: number;
  /** Mountains, or the city skyline. */
  variant?: "terrain" | "skyline";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScreen = useOnScreen(wrapRef);
  const reduced = useReducedMotion();
  const palette = usePalette();
  const timeRef = useRef(seed);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !palette) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono") || "monospace";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const toCss = (c: [number, number, number], a: number) =>
      `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)} / ${a})`;

    let cols = 0;
    let rows = 0;
    let cellW = fontSize * 0.62;
    const cellH = fontSize * 1.15;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px ${family}`;
      cellW = ctx.measureText("M").width || cellW;
      cols = Math.ceil(w / cellW);
      rows = Math.ceil(h / cellH);
    };

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `${fontSize}px ${family}`;
      ctx.textBaseline = "top";
      const aspect = w / Math.max(1, h);
      // Bucket characters by color so we change fillStyle a handful of times per frame.
      const buckets: string[][] = [[], [], []];
      const pos: number[][] = [[], [], []];
      for (let r = 0; r < rows; r++) {
        const y = 1 - (r + 0.5) / rows;
        for (let c = 0; c < cols; c++) {
          // Stretch the land so a wide band shows a few big ranges, not a comb of peaks.
          const x = ((c + 0.5) / cols) * Math.min(aspect, 2.4);
          const raw =
            variant === "skyline"
              ? skylineTone(x, y - lift, timeRef.current, seed)
              : terrainTone(x, y, timeRef.current, { seed, octaves: 4, lift });
          // Mountains need a lift to read; the city's tones are already spread out.
          const tone = variant === "skyline" ? raw : Math.min(1, Math.pow(raw, 0.75) * 1.25);
          const i = Math.min(RAMP.length - 1, Math.floor(tone * RAMP.length));
          if (i <= 0) continue;
          const b = tone > 0.62 ? 2 : tone > 0.38 ? 1 : 0;
          buckets[b].push(RAMP[i]);
          pos[b].push(c * cellW, r * cellH);
        }
      }
      const styles = [toCss(palette.faint, 0.7), toCss(palette.ink, 0.7), toCss(palette.deep, 1)];
      for (let b = 0; b < 3; b++) {
        ctx.fillStyle = styles[b];
        const chars = buckets[b];
        const p = pos[b];
        for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], p[i * 2], p[i * 2 + 1]);
      }
    };

    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);

    let raf = 0;
    if (onScreen && !reduced) {
      let last = performance.now();
      const tick = (now: number) => {
        if (now - last >= 1000 / fps) {
          timeRef.current += (now - last) / 1000;
          last = now;
          draw();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [palette, onScreen, reduced, fontSize, fps, seed, lift, variant]);

  const positioned = /\b(absolute|fixed|sticky)\b/.test(className) ? "" : "relative";
  return (
    <div ref={wrapRef} aria-hidden className={`pointer-events-none ${positioned} ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );
}

const HULL = [
  "        |\\        ",
  "        | \\       ",
  "        |  \\      ",
  "        |___\\     ",
  "   _____|_____    ",
  "   \\  VESSEL  /   ",
  "    \\________/    ",
];

/**
 * A small ASCII vessel riding ASCII swell, for empty states: something is coming.
 * The boat bobs and the water rolls while visible; still for reduced motion.
 */
export function AsciiVessel({ className = "", width = 34 }: { className?: string; width?: number }) {
  const wrapRef = useRef<HTMLPreElement>(null);
  const onScreen = useOnScreen(wrapRef);
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!onScreen || reduced) return;
    const id = setInterval(() => setFrame((f) => f + 1), 220);
    return () => clearInterval(id);
  }, [onScreen, reduced]);

  const pad = Math.max(0, Math.floor((width - HULL[0].length) / 2));
  const bob = Math.round(Math.sin(frame * 0.6));
  const wave = (offset: number, chars: string) =>
    Array.from({ length: width }, (_, i) => chars[(i + offset) % chars.length]).join("");
  const lines = [
    ...(bob > 0 ? [" ".repeat(width)] : []),
    ...HULL.map((l) => (" ".repeat(pad) + l).padEnd(width).slice(0, width)),
    wave(frame, "~^~~-~^~~~-~"),
    wave(frame * 2 + 5, " ~  ~~   ~ ~~  "),
    ...(bob > 0 ? [] : [" ".repeat(width)]),
  ];

  return (
    <pre
      ref={wrapRef}
      aria-hidden
      className={`select-none font-mono text-[11px] leading-[13px] text-ink-faint ${className}`}
    >
      {lines.join("\n")}
    </pre>
  );
}
