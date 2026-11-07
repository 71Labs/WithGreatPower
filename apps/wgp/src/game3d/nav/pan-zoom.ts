/**
 * The big map's camera: which world point sits in the middle of the map and how far it's
 * zoomed in over the fit-the-whole-city view, and the gestures that move it (drag, pinch,
 * the wheel, the buttons, the keys). North up throughout. Pure: no DOM.
 *
 * - Zoom 1 fits the whole city; the camera zooms in to MAX_ZOOM, never out past the fit.
 * - Clamped so the map never pans off the city: on each axis, while the view is wider than
 *   the city it stays centred on it; zoomed in, the city's edge stops at the view's edge.
 * - A zoom (pinch, wheel, a button at a point) keeps the world point under the fingers, the
 *   cursor or the given point where it is.
 */
import type { City } from "@wgp/game-core/sim3d/contract";

import { fitCity, type MapView } from "./map";

/** Where the map looks: the world point at its middle, and the zoom over the fit (1 = the whole city). */
export interface MapCam {
  x: number;
  z: number;
  zoom: number;
}

/** The map's frame: its size (CSS px) and the padding the fit leaves round the city. */
export interface MapFrame {
  bounds: City["bounds"];
  w: number;
  h: number;
  pad: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** One press of a zoom button (or a + / − key): this factor in or out. */
export const ZOOM_STEP = 1.6;
/** "Center on me" zooms to at least this, so the hero's street reads. */
export const CENTRE_ZOOM = 2.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The whole city, centred. */
export function fitCam(bounds: City["bounds"]): MapCam {
  return { x: (bounds.x0 + bounds.x1) / 2, z: (bounds.z0 + bounds.z1) / 2, zoom: 1 };
}

/** The canvas px per world unit at zoom 1 (the fit). */
export function fitScale(f: MapFrame): number {
  return fitCity(f.bounds, Math.max(1, f.w), Math.max(1, f.h), f.pad).scale;
}

/** The camera as a MapView (toMap draws with it). */
export function camView(f: MapFrame, cam: MapCam): MapView {
  return { x: cam.x, z: cam.z, scale: fitScale(f) * cam.zoom, rotation: 0, cx: f.w / 2, cy: f.h / 2 };
}

/** The world point under a canvas point (the inverse of toMap). */
export function fromMap(view: MapView, sx: number, sy: number): { x: number; z: number } {
  const dx = sx - view.cx;
  const dy = sy - view.cy;
  const c = Math.cos(view.rotation);
  const s = Math.sin(view.rotation);
  // toMap rotates (dx, dy) by +rotation: undo it, then the scale.
  return { x: view.x + (c * dx + s * dy) / view.scale, z: view.z + (-s * dx + c * dy) / view.scale };
}

/** The camera kept in range: zoom in [MIN_ZOOM, MAX_ZOOM], and the view on the city. */
export function clampCam(f: MapFrame, cam: MapCam): MapCam {
  const zoom = clamp(Number.isFinite(cam.zoom) ? cam.zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const scale = fitScale(f) * zoom;
  const { x0, z0, x1, z1 } = f.bounds;
  const pad = f.pad / scale;
  const axis = (v: number, lo: number, hi: number, half: number) => {
    const min = lo - pad + half;
    const max = hi + pad - half;
    // Wider than the city (plus its padding): centred on it.
    if (min >= max) return (lo + hi) / 2;
    return clamp(Number.isFinite(v) ? v : (lo + hi) / 2, min, max);
  };
  return { zoom, x: axis(cam.x, x0, x1, f.w / 2 / scale), z: axis(cam.z, z0, z1, f.h / 2 / scale) };
}

/** Drag the map by (dx, dy) CSS px: the city moves with the finger. */
export function panBy(f: MapFrame, cam: MapCam, dx: number, dy: number): MapCam {
  const scale = fitScale(f) * cam.zoom;
  return clampCam(f, { ...cam, x: cam.x - dx / scale, z: cam.z - dy / scale });
}

/** Zoom by `factor` about the canvas point (sx, sy): the world point there stays there. */
export function zoomAt(f: MapFrame, cam: MapCam, factor: number, sx = f.w / 2, sy = f.h / 2): MapCam {
  const zoom = clamp(cam.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1), MIN_ZOOM, MAX_ZOOM);
  const before = fromMap(camView(f, cam), sx, sy);
  const scale = fitScale(f) * zoom;
  // Put `before` back under (sx, sy) at the new scale.
  return clampCam(f, { zoom, x: before.x - (sx - f.w / 2) / scale, z: before.z - (sy - f.h / 2) / scale });
}

/** A point on the canvas, CSS px. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * A pinch from where two fingers started (`a0`, `b0`, with the camera then) to where they are
 * now: the zoom follows their spread, and the world point under their starting midpoint follows
 * the midpoint (so a pinch also pans).
 */
export function pinch(f: MapFrame, start: MapCam, a0: Pt, b0: Pt, a1: Pt, b1: Pt): MapCam {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const zoom = clamp(start.zoom * (d0 > 1 ? d1 / d0 : 1), MIN_ZOOM, MAX_ZOOM);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const held = fromMap(camView(f, start), m0.x, m0.y);
  const scale = fitScale(f) * zoom;
  return clampCam(f, { zoom, x: held.x - (m1.x - f.w / 2) / scale, z: held.z - (m1.y - f.h / 2) / scale });
}

/** Centre on a world point, zoomed in at least to `zoom`. */
export function centreOn(f: MapFrame, cam: MapCam, x: number, z: number, zoom = CENTRE_ZOOM): MapCam {
  return clampCam(f, { x, z, zoom: Math.max(cam.zoom, zoom) });
}

/** A wheel's turn as a zoom factor: smooth for trackpads, a sensible step for a mouse's notches. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  // Lines (Firefox) and pages count as more pixels each.
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.exp(-clamp(px, -240, 240) * 0.0022);
}

/** Whether the camera is (about) the same: skip a redraw. */
export const sameCam = (a: MapCam, b: MapCam) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3 && Math.abs(a.zoom - b.zoom) < 1e-6;
