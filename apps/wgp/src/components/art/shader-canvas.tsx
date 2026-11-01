"use client";

import { useEffect, useRef } from "react";

import { SCENES, paletteFallback, type SceneName } from "./scenes";
import { useOnScreen, useReducedMotion, type RGB } from "./use-art";

const VERTEX = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

type Palette = [string, string, string, string] | [RGB, RGB, RGB, RGB];

function toRgb(c: string | RGB): RGB {
  if (typeof c !== "string") return c;
  const hex = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

interface Renderer {
  draw: (time: number) => void;
  setPalette: (p: Palette) => void;
  resize: () => void;
  dispose: () => void;
}

function createRenderer(canvas: HTMLCanvasElement, fragment: string, seed: number, resolution: number): Renderer | null {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error("[vessel art] shader:", gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u("uRes");
  const uTime = u("uTime");
  const uSeed = u("uSeed");
  const uC = [u("uC0"), u("uC1"), u("uC2"), u("uC3")];
  gl.uniform1f(uSeed, (seed % 997) * 0.731);

  return {
    resize() {
      // Render below device resolution: each canvas pixel becomes a crisp dither cell.
      const w = Math.max(1, Math.round(canvas.clientWidth * resolution));
      const h = Math.max(1, Math.round(canvas.clientHeight * resolution));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    },
    setPalette(p) {
      p.forEach((c, i) => gl.uniform3fv(uC[i], toRgb(c)));
    },
    draw(time) {
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

/**
 * A procedural scene rendered with WebGL. It animates slowly only while on screen,
 * draws one still frame for reduced motion, and shows a CSS gradient in the same
 * palette when WebGL is unavailable. Decorative: hidden from assistive tech.
 */
export function ShaderCanvas({
  scene,
  palette,
  seed = 0,
  resolution = 0.5,
  fps = 30,
  speed = 1,
  className = "",
}: {
  scene: SceneName;
  palette: Palette;
  seed?: number;
  /** Canvas pixels per CSS pixel. 0.5 = 2px dither cells and a quarter of the work. */
  resolution?: number;
  fps?: number;
  speed?: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const onScreen = useOnScreen(wrapRef);
  const reduced = useReducedMotion();
  const timeRef = useRef(seed % 60);

  // Build the GL program for this scene.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas, SCENES[scene], seed, resolution);
    if (!renderer) return;
    rendererRef.current = renderer;
    renderer.resize();
    const ro = new ResizeObserver(() => {
      renderer.resize();
      renderer.draw(timeRef.current);
    });
    ro.observe(canvas);
    canvas.dataset.ready = "true";
    return () => {
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [scene, seed, resolution]);

  // Palette changes (theme) redraw immediately.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setPalette(palette);
    r.draw(timeRef.current);
  }, [palette, scene, seed, resolution]);

  // Animate only while visible and motion is allowed.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !onScreen || reduced) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = 1000 / fps;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      acc += dt;
      if (acc >= frame) {
        timeRef.current += (acc / 1000) * speed;
        acc = 0;
        r.draw(timeRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onScreen, reduced, fps, speed]);

  const fallback = typeof palette[0] === "string" ? paletteFallback(palette as [string, string, string, string]) : undefined;
  // Respect a position the caller sets (e.g. absolute inset-0); otherwise be the canvas's container.
  const positioned = /\b(absolute|fixed|sticky)\b/.test(className) ? "" : "relative";

  return (
    <div ref={wrapRef} aria-hidden className={`pointer-events-none overflow-hidden ${positioned} ${className}`} style={{ background: fallback }}>
      <canvas ref={canvasRef} className="absolute inset-0 size-full [image-rendering:pixelated]" />
    </div>
  );
}
