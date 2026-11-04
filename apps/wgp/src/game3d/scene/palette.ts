/**
 * The 2D sticker palette (src/game/style.ts) as raw sRGB triplets for the 3D shaders.
 *
 * Every scene material is a ShaderMaterial that works in display sRGB end to end: colors go
 * in as the hex values the 2D renderer paints, textures are uploaded without color-space
 * conversion, and the canvas runs with `flat` and `linear` so nothing tone maps or converts
 * on the way out. A wall in 3D is the exact #5E66B8 of the 2D wall.
 */
import { CITY, INK, PAPER } from "@/game/style";

export type RGB = [number, number, number];

/** "#RRGGBB" → [r, g, b] in 0–1, no color management. */
export function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Mix two sRGB triplets (flat cel bands, like `mix` in render/draw.ts). */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Colors the 2D renderer keeps local to city.ts. */
export const WATER = "#2E3A8C";
export const STREET_CURB = "#2A2E62";
export const STEEL = "#AEB4BD";
export const CRANE_YELLOW = CITY.windowLit;
/** 3D-only street and roof colours, picked to sit inside the night palette. */
export const SIDEWALK = "#353A78";
export const CURB_EDGE = "#4A509A";
export const LAMP_POOL = "#4C4C8E";
export const TAR = "#24285C";
export const GRAVEL = "#3F4488";

export const C = {
  ink: rgb(INK),
  paper: rgb(PAPER),
  white: rgb("#FFFFFF"),
  skyTop: rgb(CITY.skyTop),
  skyMid: rgb(CITY.skyMid),
  skyLow: rgb(CITY.skyLow),
  star: rgb(CITY.star),
  rooftop: rgb(CITY.rooftop),
  windowLit: rgb(CITY.windowLit),
  windowWarm: rgb(CITY.windowWarm),
  windowDark: rgb(CITY.windowDark),
  street: rgb(CITY.street),
  streetLine: rgb(CITY.streetLine),
  curb: rgb(STREET_CURB),
  water: rgb(WATER),
  cable: rgb(CITY.cable),
  bridge: rgb(CITY.bridge),
  neonRed: rgb(CITY.neonRed),
  neonMint: rgb(CITY.neonMint),
  waterTower: rgb(CITY.waterTower),
  waterTowerBand: rgb(CITY.waterTowerBand),
  steel: rgb(STEEL),
  crane: rgb(CRANE_YELLOW),
  sidewalk: rgb(SIDEWALK),
  curbEdge: rgb(CURB_EDGE),
  lampPool: rgb(LAMP_POOL),
  tar: rgb(TAR),
  gravel: rgb(GRAVEL),
} as const;

/** Car bodies: taxis most often, then the 2D palette's warm and neon fills. */
export const CAR_COLORS: readonly RGB[] = [CITY.windowLit, CITY.windowLit, CITY.windowLit, CITY.neonRed, PAPER, CITY.neonMint, ...CITY.accentBuildings, STEEL].map(rgb);

/** Building fill for a contract `Building`: night blues by tone, or a warm accent. */
export function buildingFill(tone: number, accent: boolean): RGB {
  const list = accent ? CITY.accentBuildings : CITY.near;
  const i = ((tone % list.length) + list.length) % list.length;
  return rgb(list[i]);
}

/**
 * The moon sticker on the sky dome (sky.ts): its azimuth (radians from +z toward +x), its
 * elevation and its width (radians). The river's reflection and the halo read it too.
 */
export const MOON = { azimuth: 2.3, elevation: 0.3, width: 0.17 } as const;

/** A unit vector toward the moon. */
export function moonDirection(): RGB {
  const { azimuth: a, elevation: e } = MOON;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

/**
 * Banded fog: distance thresholds (world units from the camera, measured on the ground plane
 * to each building's centre) and how far each band mixes toward the low sky. Flat steps, never
 * a gradient, so depth reads as the 2D renderer's far / mid / near layers.
 */
export const FOG = {
  bands: [1500, 2700, 4100] as const,
  amount: [0, 0.3, 0.52, 0.7] as const,
  color: C.skyLow,
};

/**
 * Ink widths in CSS px. Silhouettes thin with depth, a touch past LINE.near → LINE.far so the
 * near city reads bolder; creases stay detail-thin and thin again in the far bands.
 */
export const INK_PX = {
  hullNear: 3.25,
  hullFar: 1.25,
  /** View depths (world units) over which the hull thins. */
  hullDepthNear: 300,
  hullDepthFar: 3000,
  crease: 1.5,
} as const;

/**
 * Comic print: Ben-Day dots on the shadow faces and over the far fog bands, on a 45° screen
 * `cell` CSS px apart. Dot radii are shares of the cell (0.71 covers it).
 */
export const HALFTONE = {
  cell: 5,
  /** The −x face (tint 0.76) and the ±z faces (0.84). */
  shadow: 0.34,
  side: 0.2,
  /** Fog bands 2 and 3. */
  far: [0.2, 0.3] as const,
} as const;
