/**
 * One texture atlas for every character card, built with the 2D sticker pipeline
 * (render/sprites.tsx `buildSprites`, which die-cuts each bust with a white border). Each
 * cell holds the sticker without its baked ink drop (the 3D card has a real edge instead);
 * a last cell holds the "WGP" stamp printed on every card's back. Alongside each cell, the
 * die-cut outline traced from the sticker's silhouette, ready to extrude.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace } from "three";

import type { SuitColors } from "@/components/cast";
import { CITY } from "@/game/style";
import { resolveFont } from "@/sim/render/draw";
import { buildSprites, type StickerSprite } from "@/sim/render/sprites";
import type { CastId } from "@wgp/game-core/cast";

import { chaikin, stickerOutline, type Pt } from "./contour";

export type CardKey = "hero" | "sybil-copy" | CastId;

export interface CardCell {
  /** uv rect of the sprite canvas in the atlas: u0, v0 (bottom), width, height. */
  rect: [number, number, number, number];
  /** Sprite canvas size and the art box inside it (px). */
  span: number;
  art: number;
  /** Ink drop the 2D sticker had (px): the flat card's offset ink quad uses it. */
  drop: number;
  /** Die-cut outline in sprite px (y down). */
  outline: Pt[];
}

export interface CardArt {
  texture: CanvasTexture;
  cells: Map<CardKey, CardCell>;
  stamp: [number, number, number, number];
}

const ATLAS = 1024;
const CELL = 256;
const GRID = ATLAS / CELL;
const MASK = 128;

function maskOf(sil: HTMLCanvasElement): Uint8Array {
  const c = document.createElement("canvas");
  c.width = MASK;
  c.height = MASK;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(sil, 0, 0, MASK, MASK);
  const data = ctx.getImageData(0, 0, MASK, MASK).data;
  const m = new Uint8Array(MASK * MASK);
  for (let i = 0; i < m.length; i++) m[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  return m;
}

function drawStamp(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.2);
  ctx.strokeStyle = CITY.neonRed;
  ctx.fillStyle = CITY.neonRed;
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
  ctx.lineWidth = size * 0.01;
  ctx.stroke();
  ctx.font = `800 ${Math.round(size * 0.13)}px ${resolveFont()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WGP", 0, size * 0.006);
  ctx.restore();
}

export async function buildCardArt(heroColors: SuitColors, ids: CastId[]): Promise<CardArt> {
  const unique = [...new Set(ids.filter((id) => id !== "node"))];
  // 200 px of art plus the sticker's border and drop fills a 256 cell with a few px to spare.
  const sprites = await buildSprites(heroColors, unique, 200);
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext("2d")!;
  const cells = new Map<CardKey, CardCell>();
  let slot = 0;
  const place = (key: CardKey, s: StickerSprite) => {
    if (slot >= GRID * GRID - 1) return;
    const span = s.canvas.width;
    const off = Math.floor((CELL - span) / 2);
    const x = (slot % GRID) * CELL + off;
    const y = Math.floor(slot / GRID) * CELL + off;
    slot += 1;
    // The sticker without its ink drop: mask the finished canvas by its silhouette.
    const front = document.createElement("canvas");
    front.width = span;
    front.height = span;
    const f = front.getContext("2d")!;
    f.drawImage(s.canvas, 0, 0);
    f.globalCompositeOperation = "destination-in";
    f.drawImage(s.flash, 0, 0);
    ctx.drawImage(front, x, y);
    const grid = maskOf(s.flash);
    const k = span / MASK;
    const outline = chaikin(stickerOutline(grid, MASK, MASK, 1.1)).map(([gx, gy]) => [gx * k, gy * k] as Pt);
    cells.set(key, {
      rect: [x / ATLAS, 1 - (y + span) / ATLAS, span / ATLAS, span / ATLAS],
      span,
      art: s.art,
      drop: Math.round(s.art * 0.04),
      outline,
    });
  };
  place("hero", sprites.hero);
  for (const id of unique) {
    const s = sprites.cast[id];
    if (s) place(id, s);
  }
  if (sprites.sybilCopy) place("sybil-copy", sprites.sybilCopy);
  // The stamp takes the last cell.
  const last = GRID * GRID - 1;
  const sx = (last % GRID) * CELL;
  const sy = Math.floor(last / GRID) * CELL;
  drawStamp(ctx, sx, sy, CELL);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return { texture, cells, stamp: [sx / ATLAS, 1 - (sy + CELL) / ATLAS, CELL / ATLAS, CELL / ATLAS] };
}
