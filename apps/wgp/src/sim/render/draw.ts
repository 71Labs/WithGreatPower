/**
 * Drawing helpers for the sticker look on Canvas 2D: flat fills, ink outlines, rounded
 * corners, the white "shine" stroke the characters have, and comic starbursts.
 */
import { INK } from "@/game/style";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Mix two #rrggbb colors (flat, for cel-shade bands). */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** A rectangle with independent top and bottom corner radii (canvas y down). */
export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, rTop: number, rBottom = rTop) {
  const t = Math.max(0, Math.min(rTop, w / 2, h / 2));
  const b = Math.max(0, Math.min(rBottom, w / 2, h / 2));
  ctx.moveTo(x + t, y);
  ctx.lineTo(x + w - t, y);
  if (t) ctx.arcTo(x + w, y, x + w, y + t, t);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - b);
  if (b) ctx.arcTo(x + w, y + h, x + w - b, y + h, b);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + b, y + h);
  if (b) ctx.arcTo(x, y + h, x, y + h - b, b);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + t);
  if (t) ctx.arcTo(x, y, x + t, y, t);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

/** Fill then outline the current path, the sticker way. */
export function inked(ctx: Ctx, fill: string | null, line: number, stroke = INK) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (line > 0) {
    ctx.lineWidth = line;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

export function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | null, line: number, rBottom = r) {
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r, rBottom);
  inked(ctx, fill, line);
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string | null, line: number, stroke = INK) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  inked(ctx, fill, line, stroke);
}

export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, color = INK) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();
}

/** The white shine stroke near a top-left corner, like the highlights on every character. */
export function shine(ctx: Ctx, x: number, y: number, len: number, width: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + len * 0.7);
  ctx.quadraticCurveTo(x, y, x + len, y);
  ctx.lineWidth = width;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.stroke();
}

/** A four-point sparkle star. */
export function sparkle(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}

/** A jagged comic starburst around (x, y). `seed` keeps its spikes stable. */
export function starburst(ctx: Ctx, x: number, y: number, rx: number, ry: number, spikes: number, seed: number) {
  ctx.beginPath();
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const n = spikes * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 === 0 ? 1 + rnd() * 0.18 : 0.66 + rnd() * 0.08;
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A cheap deterministic hash → [0, 1), for per-thing variation in the renderer. */
export function hash01(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The page's font stack, resolved (canvas can't read CSS variables). */
export function resolveFont(): string {
  if (typeof document === "undefined") return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
