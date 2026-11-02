/**
 * Billboard faces as one canvas-text atlas: paper, a neon-red strip along the bottom and
 * the ink text (headline · tagline), the 2D renderer's `drawBillboardText` at atlas size.
 * Texture bytes are display sRGB, uploaded unconverted (see palette.ts).
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace } from "three";

import { CITY, INK, PAPER } from "@/game/style";
import { resolveFont } from "@/sim/render/draw";

export const BILLBOARD_GRID = { cols: 2, rows: 4, cellW: 512, cellH: 224 } as const;

export function billboardAtlas(texts: string[]): CanvasTexture {
  const { cols, rows, cellW, cellH } = BILLBOARD_GRID;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext("2d")!;
  const font = resolveFont();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const list = texts.length ? texts : [""];
  list.slice(0, cols * rows).forEach((text, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    const strip = Math.round(cellH * (13 / 86));
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, cellW, cellH);
    ctx.fillStyle = CITY.neonRed;
    ctx.fillRect(x, y + cellH - strip, cellW, strip);
    ctx.fillStyle = INK;
    ctx.fillRect(x, y + cellH - strip - 3, cellW, 5);
    const [head, tail] = text.split(" · ");
    const cx = x + cellW / 2;
    const textH = cellH - strip;
    const maxW = cellW - 56;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fit = (t: string, size: number) => {
      let s = size;
      ctx.font = `800 ${s}px ${font}`;
      while (s > 12 && ctx.measureText(t).width > maxW) {
        s -= 2;
        ctx.font = `800 ${s}px ${font}`;
      }
      return s;
    };
    if (tail) {
      const s1 = fit(head, 58);
      ctx.fillText(head, cx, y + textH * 0.4);
      fit(tail, Math.round(s1 * 0.62));
      ctx.fillText(tail, cx, y + textH * 0.4 + s1 * 0.95);
    } else {
      fit(head, 64);
      ctx.fillText(head, cx, y + textH / 2);
    }
  });
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}
