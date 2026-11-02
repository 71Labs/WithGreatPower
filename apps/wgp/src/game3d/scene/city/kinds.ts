/**
 * What a city box is: the kinds the toon shader branches on, the window layouts, and the
 * box spec every instance list is built from. Shared by layout.ts and details.ts.
 */
import type { Building, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { RGB } from "../palette";

/** What the toon shader draws on a box (aInfo.x). Keep in sync with shaders.ts. */
export const KIND = {
  building: 0,
  top: 1,
  solid: 2,
  ac: 3,
  light: 4,
  billboard: 5,
  lattice: 6,
  truss: 7,
  tank: 8,
  lamp: 9,
  signal: 10,
  door: 11,
  grate: 12,
} as const;

/** Window layouts from render/city.ts windowGrid. */
export const WINDOW_STYLE = { plain: 0, strip: 1, brown: 2, wide: 3 } as const;

export interface BoxSpec {
  /** Base centre (the bottom face's centre). */
  x: number;
  y: number;
  z: number;
  /** Size along the box's own x, y and z. */
  w: number;
  h: number;
  d: number;
  /** Turn about +y, radians. */
  yaw: number;
  /** A segment box instead: its local +y runs from (x, y, z) to `to`, `w` thick. */
  to?: Vec3;
  color: RGB;
  kind: number;
  seed: number;
  style: number;
  /** Outline (inverted hull) scale: 0 none, 1 full width. */
  hull: number;
  /** The point banded fog measures from, so a building and its props share a band. */
  ref: { x: number; z: number };
  /** Billboards: index into `CityLayout.texts`. */
  atlas: number;
  sector: number;
  /** 0: always drawn. 1: small rooftop clutter, dropped in far sectors. 2: street and facade detail, also dropped on the low tier. */
  lod: number;
}

/** A box before the layout fills in its sector (and the defaults). */
export type BoxInput = Omit<BoxSpec, "sector" | "atlas" | "style" | "yaw" | "seed" | "lod"> & Partial<Pick<BoxSpec, "atlas" | "style" | "yaw" | "seed" | "lod">>;
export type PushBox = (spec: BoxInput) => void;

function hash01(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The 2D renderer picks a window style per building style; the 3D city infers it from shape. */
export function windowStyle(b: Building): number {
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  if (b.h > 520 || (Math.min(w, d) < 160 && b.h > 380)) return WINDOW_STYLE.strip;
  if (b.district === "queens-block" && b.h < 300) return WINDOW_STYLE.brown;
  return hash01(b.seed + 3) < 0.25 ? WINDOW_STYLE.wide : WINDOW_STYLE.plain;
}
