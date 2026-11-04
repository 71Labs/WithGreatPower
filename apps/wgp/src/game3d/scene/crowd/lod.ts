/**
 * The crowd's budgets and per-person maths, pure (crowd.ts applies them every frame):
 *
 * - Density per tier: none on the sidewalks and only a few people at the stops and on the
 *   roofs on low; more on medium; most on high, which alone loads the full bodies for the
 *   people near the camera.
 * - Who's drawn: the nearest within the tier's distance and on screen, the full bodies first
 *   up to their cap, the light ones after.
 * - Animation level of detail: a pose block refreshes at 30 Hz near the camera, 15 Hz further
 *   out and 8 Hz far away (the blocks are shared, so it's per block, at its nearest user).
 * - Fades (the cast's ordered dither): people fade in at the edge of the draw distance, and
 *   out right in front of the camera, where the hero lands among them, and wherever they
 *   stand between the camera and the hero (or his rival in a fight).
 */
import { FOG } from "../palette";
import type { QualityTier } from "../quality";
import type { CivilianId } from "./civilians";
import type { Density } from "./placement";

export interface CrowdTier {
  density: Density;
  /** Which bodies it loads (all of them if unset): each one costs two draw calls when drawn. */
  bodies?: readonly CivilianId[];
  /** Load the full bodies, for the people nearest the camera. */
  near: boolean;
  /** Most people drawn as full bodies, and in all. */
  nearMax: number;
  max: number;
  /** Camera distances: full bodies inside `nearDist`; nobody beyond `farDist`. */
  nearDist: number;
  farDist: number;
}

export const CROWD_TIERS: Record<QualityTier, CrowdTier> = {
  low: { density: { roofGroups: 3, fight: 3, fightRoofs: 1, errand: 2, walkers: 0 }, bodies: ["civ-office", "civ-jogger", "civ-auntie", "civ-kid"], near: false, nearMax: 0, max: 10, nearDist: 0, farDist: 1400 },
  medium: { density: { roofGroups: 9, fight: 8, fightRoofs: 2, errand: 3, walkers: 44 }, near: false, nearMax: 0, max: 32, nearDist: 0, farDist: 1900 },
  high: { density: { roofGroups: 16, fight: 12, fightRoofs: 3, errand: 4, walkers: 96 }, near: true, nearMax: 16, max: 72, nearDist: 720, farDist: 2600 },
};

/** Seconds between pose refreshes for a block whose nearest user is `d` from the camera. */
export function animInterval(d: number): number {
  return d < 800 ? 1 / 30 : d < 1600 ? 1 / 15 : 1 / 8;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Dither fade (0 shown … 1 gone) from the distance to the camera: gone up close, in at the far edge. */
export function distanceFade(d: number, farDist: number): number {
  return Math.max(1 - smoothstep(70, 150, d), smoothstep(farDist * 0.82, farDist, d));
}

/** Gone where the hero stands among them (horizontal distance, height difference). */
export function heroFade(dxz: number, dy: number): number {
  return Math.abs(dy) < 130 ? 1 - smoothstep(38, 80, dxz) : 0;
}

/**
 * Faded when standing on the line from the camera to a target (the hero, a rival): `px..pz`
 * the person's chest, `cx..cz` the camera, `tx..tz` the target.
 */
export function lineFade(px: number, py: number, pz: number, cx: number, cy: number, cz: number, tx: number, ty: number, tz: number): number {
  const dx = tx - cx;
  const dy = ty - cy;
  const dz = tz - cz;
  const l2 = dx * dx + dy * dy + dz * dz;
  if (l2 < 1) return 0;
  const t = ((px - cx) * dx + (py - cy) * dy + (pz - cz) * dz) / l2;
  if (t < 0.04 || t > 0.94) return 0;
  const d = Math.hypot(px - (cx + dx * t), py - (cy + dy * t), pz - (cz + dz * t));
  return 0.85 * (1 - smoothstep(30, 56, d));
}

/** Fog like the cast's: half the city's, by the distance bands. */
export function fogFor(d: number): number {
  const b = FOG.bands;
  const band = d < b[0] ? 0 : d < b[1] ? 1 : d < b[2] ? 2 : 3;
  return FOG.amount[band] * 0.5;
}

/** Reaction hysteresis: start within `REACT_IN` of the hero, stop past `REACT_OUT`. */
export const REACT_IN = 470;
export const REACT_OUT = 680;
/** A reaction plays at least this long (s). */
export const REACT_HOLD = 2.6;

export function wantsReaction(reacting: boolean, dHero: number): boolean {
  return reacting ? dHero < REACT_OUT : dHero < REACT_IN;
}

/**
 * Who gets drawn: `order` (indices by camera distance, nearest first) split between the full
 * bodies (inside `nearDist`, up to `nearMax`) and the light ones, `max` in all.
 */
export function splitBands(order: ArrayLike<number>, dist: ArrayLike<number>, tier: Pick<CrowdTier, "nearMax" | "max" | "nearDist">, near: number[], far: number[]): void {
  near.length = 0;
  far.length = 0;
  for (let k = 0; k < order.length && near.length + far.length < tier.max; k++) {
    const i = order[k];
    if (near.length < tier.nearMax && dist[i] < tier.nearDist) near.push(i);
    else far.push(i);
  }
}
