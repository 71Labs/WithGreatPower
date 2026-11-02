/**
 * Character stickers for the canvas. Each cast bust (120×120 SVG) is rendered once with
 * renderToStaticMarkup, drawn into an offscreen canvas, and die-cut like a real
 * sticker: the art clipped to the sticker frame's rounded corners, a white border that
 * follows the silhouette, and a hard ink drop under it.
 */
import type { ReactElement } from "react";

import { AVATARS, HeroArt, type SuitColors } from "@/components/cast";
import type { CastId } from "@wgp/game-core/cast";
import { INK } from "@/game/style";

import { makeCanvas } from "./draw";

export interface StickerSprite {
  /** The finished sticker: art + white border + ink drop. */
  canvas: HTMLCanvasElement;
  /** A white silhouette of the same size, for hit flashes. */
  flash: HTMLCanvasElement;
  /** Pixel size of the 120-unit art box inside the canvas. */
  art: number;
  /** Padding around the art box, in pixels. */
  pad: number;
}

export interface SpriteSet {
  hero: StickerSprite;
  cast: Partial<Record<CastId, StickerSprite>>;
  /** Grey copies of The Sybil. */
  sybilCopy: StickerSprite | null;
}

type RenderToStaticMarkup = (el: ReactElement) => string;

async function markup(): Promise<RenderToStaticMarkup> {
  const mod = await import("react-dom/server");
  return mod.renderToStaticMarkup as RenderToStaticMarkup;
}

async function loadSvg(svg: string, px: number): Promise<HTMLImageElement> {
  const sized = svg.replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded bitmap stays usable after the URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function desaturate(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const v = Math.min(255, l * 0.75 + 70);
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
}

/** Die-cut a sticker from rendered art. */
function cut(img: CanvasImageSource, art: number, gray = false): StickerSprite {
  const border = Math.round(art * 0.065);
  const drop = Math.round(art * 0.04);
  const pad = border + drop + 2;
  const size = art + pad * 2;

  // The art, clipped to the sticker frame's inner radius (26 of 120).
  const a = makeCanvas(art, art);
  const actx = a.getContext("2d")!;
  actx.beginPath();
  actx.roundRect(0, 0, art, art, (art * 26) / 120);
  actx.clip();
  actx.drawImage(img, 0, 0, art, art);
  if (gray) desaturate(a);

  // The silhouette, grown by the border width.
  const sil = makeCanvas(size, size);
  const sctx = sil.getContext("2d")!;
  const steps = 28;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    sctx.drawImage(a, pad + Math.cos(t) * border, pad + Math.sin(t) * border);
  }
  sctx.drawImage(a, pad, pad);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = "#FFFFFF";
  sctx.fillRect(0, 0, size, size);

  const out = makeCanvas(size, size);
  const o = out.getContext("2d")!;
  // Ink drop: the silhouette in ink, offset down.
  const ink = makeCanvas(size, size);
  const ictx = ink.getContext("2d")!;
  ictx.drawImage(sil, 0, 0);
  ictx.globalCompositeOperation = "source-in";
  ictx.fillStyle = INK;
  ictx.fillRect(0, 0, size, size);
  o.drawImage(ink, 0, drop);
  o.drawImage(sil, 0, 0);
  o.drawImage(a, pad, pad);

  return { canvas: out, flash: sil, art, pad };
}

/** Build every sticker the game needs. `art` is the pixel size of the 120-unit box. */
export async function buildSprites(heroColors: SuitColors, ids: CastId[], art = 192): Promise<SpriteSet> {
  const render = await markup();
  const heroImg = await loadSvg(render(<HeroArt {...heroColors} />), art);
  const cast: SpriteSet["cast"] = {};
  let sybilCopy: StickerSprite | null = null;
  for (const id of [...new Set(ids)]) {
    // Rendered as an element, never called: the React Compiler memoizes components with hooks.
    const Art = AVATARS[id];
    const img = await loadSvg(render(<Art />), art);
    cast[id] = cut(img, art);
    if (id === "sybil") sybilCopy = cut(img, art, true);
  }
  return { hero: cut(heroImg, art), cast, sybilCopy };
}

/** Just the hero, for the menu backdrop. */
export async function buildHeroSprite(heroColors: SuitColors, art = 160): Promise<StickerSprite> {
  const render = await markup();
  return cut(await loadSvg(render(<HeroArt {...heroColors} />), art), art);
}

/**
 * Draw a sticker centred at (x, y) (canvas units, y down), `size` units across the art
 * box, rotated by `angle`, with optional squash/stretch and a white hit flash.
 */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  s: StickerSprite,
  x: number,
  y: number,
  size: number,
  angle = 0,
  sx = 1,
  sy = 1,
  flash = 0,
) {
  const k = size / s.art;
  const w = s.canvas.width * k;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.drawImage(s.canvas, -w / 2, -w / 2, w, w);
  if (flash > 0) {
    ctx.globalAlpha = Math.min(1, flash) * 0.85;
    ctx.drawImage(s.flash, -w / 2, -w / 2, w, w);
  }
  ctx.restore();
}
