/**
 * Presentation-only city detail as more instanced boxes, so it costs no extra draw calls:
 *
 * - Buildings: a cornice ledge just under every roof edge, a low parapet on some roofs, a
 *   stair bulkhead with a door on others, and fire escapes on some street facades, their
 *   platforms under the window rows the toon shader draws.
 * - Streets: lamps that zigzag along every street (the ground shader paints their light
 *   pools from the same spacing) and a traffic signal at each crossing.
 *
 * Nothing here is solid to the sim. Roof-edge details stay low (the parapet is 6 units, the
 * cornice sits below the edge) so the web's roof-edge anchors stay where they're drawn, and
 * roof doors keep clear of props, stop centres and the ally. Everything is LOD 1 or 2: far
 * sectors and low tiers drop it.
 */
import type { Building, City, Prop } from "@wgp/game-core/sim3d/contract";

import { buildingFill, C, mixRgb, type RGB } from "../palette";
import { KIND, WINDOW_STYLE, windowStyle, type PushBox } from "./kinds";
import { inferStreets, LAMP, lampStops, type Street, type StreetGrid } from "./streets";

type Push = PushBox;

/** Detail levels a box can carry: 1 drops in far sectors; 2 also drops on the low tier. */
export const DETAIL_LOD = { near: 1, rich: 2 } as const;

const QUARTER = Math.PI / 2;
const IRON = mixRgb(C.ink, C.rooftop, 0.45);
const LEDGE = mixRgb(C.rooftop, C.ink, 0.15);

function hash01(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const inside = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** The toon shader's window grid on one face (windowMetrics + the margins in `windows`). */
function windowGrid(style: number, faceW: number, h: number) {
  const [cw, ch, gx, gy, bottom] =
    style === WINDOW_STYLE.strip ? [13, 38, 15, 21, 46] : style === WINDOW_STYLE.brown ? [20, 30, 18, 24, 58] : style === WINDOW_STYLE.wide ? [34, 20, 16, 21, 46] : [20, 26, 18, 21, 46];
  const cols = Math.floor((faceW - 34 + gx) / (cw + gx));
  const rows = Math.floor((h - 24 - bottom + gy) / (ch + gy));
  return { cw, ch, gx, gy, cols, rows };
}

export function addDetails(city: City, push: Push, streets: StreetGrid = inferStreets(city)): void {
  const blocked: Rect[] = city.buildings.map((b) => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }));
  const river = city.river;
  const deck = city.bridge?.deck ?? null;
  const keepClear = (x: number, z: number, pad: number) => {
    if (river && inside(river, x, z, pad)) return false;
    if (deck && inside(deck, x, z, pad + 30)) return false;
    return !blocked.some((r) => inside(r, x, z, pad));
  };
  const propsOf = new Map<number, Prop[]>();
  for (const p of city.props) if (p.buildingId !== null) propsOf.set(p.buildingId, [...(propsOf.get(p.buildingId) ?? []), p]);
  const spots = [city.start, ...city.zones.map((z) => z.center), ...city.zones.flatMap((z) => (z.allyAt ? [z.allyAt] : []))];
  for (const b of city.buildings) addBuildingDetail(b, propsOf.get(b.id) ?? [], spots, blocked, push);
  addStreetFurniture(city, streets, keepClear, push);
}

function addBuildingDetail(b: Building, props: Prop[], spots: { x: number; y: number; z: number }[], blocked: Rect[], push: Push) {
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const ref = { x: cx, z: cz };
  const seed = b.seed & 0xffffff;
  const fill: RGB = C.rooftop;

  // A cornice just under the roof edge: a dark ledge with its own ink line.
  if (b.h > 200) push({ x: cx, y: b.h - 19, z: cz, w: w + 10, h: 8, d: d + 10, color: LEDGE, kind: KIND.solid, hull: 0.7, ref, lod: DETAIL_LOD.near });

  // A low parapet on some roofs (6 units: the roof edge a web sticks to stays where it is drawn).
  if (hash01(seed + 301) < 0.35 && w > 80 && d > 80) {
    const t = 4;
    const ph = 6;
    push({ x: cx, y: b.h, z: b.z0 + t / 2, w, h: ph, d: t, color: fill, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
    push({ x: cx, y: b.h, z: b.z1 - t / 2, w, h: ph, d: t, color: fill, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
    push({ x: b.x0 + t / 2, y: b.h, z: cz, w: t, h: ph, d: d - 2 * t, color: fill, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
    push({ x: b.x1 - t / 2, y: b.h, z: cz, w: t, h: ph, d: d - 2 * t, color: fill, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
  }

  // A stair bulkhead with a roof door, in a free corner of the main roof, facing the middle.
  if (hash01(seed + 307) < 0.55 && w >= 130 && d >= 130) {
    const bw = 44;
    const bd = 36;
    const bh = 40;
    const start = Math.floor(hash01(seed + 311) * 4);
    for (let i = 0; i < 4; i++) {
      const k = (start + i) % 4;
      const x = k % 2 ? b.x1 - 26 - bw / 2 : b.x0 + 26 + bw / 2;
      const z = k < 2 ? b.z0 + 26 + bd / 2 : b.z1 - 26 - bd / 2;
      if (b.top && inside(b.top, x, z, 40)) continue;
      if (props.some((p) => p.at.y === b.h && Math.hypot(p.at.x - x, p.at.z - z) < 50 + Math.max(p.w, p.d) / 2)) continue;
      if (spots.some((s) => Math.abs(s.y - b.h) < 80 && Math.hypot(s.x - x, s.z - z) < 110)) continue;
      // Face the roof's middle: the door is on the box's +z face.
      const yaw = Math.atan2(cx - x, cz - z);
      const snapped = Math.round(yaw / QUARTER) * QUARTER;
      push({ x, y: b.h, z, w: bw, h: bh, d: bd, yaw: snapped, color: buildingFill(b.tone + 1, b.accent), kind: KIND.door, seed: seed + 13, hull: 0.8, ref, lod: DETAIL_LOD.near });
      push({ x, y: b.h + bh, z, w: bw + 8, h: 5, d: bd + 8, yaw: snapped, color: LEDGE, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
      break;
    }
  }

  // A fire escape on a street facade of some mid-rise buildings.
  if (b.h >= 200 && b.h <= 560 && hash01(seed + 317) < 0.35) addFireEscape(b, blocked, push, ref, seed);
}

/** The four facades by outward normal (x, z). */
const FACES: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function addFireEscape(b: Building, blocked: Rect[], push: Push, ref: { x: number; z: number }, seed: number) {
  const start = Math.floor(hash01(seed + 331) * 4);
  for (let i = 0; i < 4; i++) {
    const [nx, nz] = FACES[(start + i) % 4];
    const faceW = nx !== 0 ? b.z1 - b.z0 : b.x1 - b.x0;
    if (faceW < 130) continue;
    // Only on a facade with open air in front of it (a street, not a neighbour's wall).
    const plane = nx > 0 ? b.x1 : nx < 0 ? b.x0 : nz > 0 ? b.z1 : b.z0;
    const strip: Rect =
      nx !== 0
        ? { x0: Math.min(plane, plane + nx * 70), x1: Math.max(plane, plane + nx * 70), z0: b.z0, z1: b.z1 }
        : { x0: b.x0, x1: b.x1, z0: Math.min(plane, plane + nz * 70), z1: Math.max(plane, plane + nz * 70) };
    if (blocked.some((r) => overlaps(r, strip))) continue;
    const g = windowGrid(windowStyle(b), faceW, b.h);
    if (g.cols < 3 || g.rows < 3) continue;
    // Two middle columns; platforms under the top window rows, never the last two (a drop ladder's job).
    const span = 2 * g.cw + g.gx + 18;
    const floors = Math.min(5, g.rows - 2);
    const mid = nx !== 0 ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2;
    const depth = 24;
    const out = plane + (nx !== 0 ? nx : nz) * (depth / 2);
    const P = (u: number, y: number, o: number) => (nx !== 0 ? { x: o, y, z: u } : { x: u, y, z: o });
    const yaw = nx !== 0 ? QUARTER : 0;
    let lastY = 0;
    for (let r = 0; r < floors; r++) {
      const sill = b.h - (24 + r * (g.ch + g.gy) + g.ch) - 4;
      lastY = sill;
      const c = P(mid, sill, out);
      push({ x: c.x, y: c.y, z: c.z, w: span, h: 3, d: depth, yaw, color: IRON, kind: KIND.grate, hull: 0.6, ref, lod: DETAIL_LOD.rich });
      if (r + 1 < floors) {
        // The stair down to the next platform, switching back each floor.
        const below = b.h - (24 + (r + 1) * (g.ch + g.gy) + g.ch) - 4;
        const s = r % 2 ? 1 : -1;
        const from = P(mid + (s * span) / 2 - s * 6, sill + 2, plane + (nx !== 0 ? nx : nz) * (depth * 0.55));
        const to = P(mid - (s * span) / 2 + s * 10, below + 2, plane + (nx !== 0 ? nx : nz) * (depth * 0.55));
        push({ ...from, to, w: 3, h: 1, d: 6, color: IRON, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
      }
    }
    // Two corner posts from above the top platform down to the lowest one.
    const top = b.h - (24 + g.ch) - 4 + 15;
    for (const s of [-1, 1]) {
      const o = plane + (nx !== 0 ? nx : nz) * (depth - 1);
      const p0 = P(mid + (s * span) / 2, lastY, o);
      push({ x: p0.x, y: p0.y, z: p0.z, w: 2.5, h: top - lastY, d: 2.5, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
    }
    return;
  }
}

/** The street the river runs down is not a street. */
function isRiver(s: Street, alongZ: boolean, river: City["river"]): boolean {
  if (!river) return false;
  return alongZ ? s.c > river.x0 - s.w / 2 && s.c < river.x1 + s.w / 2 && river.z1 - river.z0 > river.x1 - river.x0 : s.c > river.z0 - s.w / 2 && s.c < river.z1 + s.w / 2 && river.x1 - river.x0 > river.z1 - river.z0;
}

function addStreetFurniture(city: City, streets: StreetGrid, keepClear: (x: number, z: number, pad: number) => boolean, push: Push) {
  const { bounds } = city;
  const lampOn = (x: number, z: number, toX: number, toZ: number) => {
    if (!keepClear(x, z, 4)) return;
    const ref = { x, z };
    push({ x, y: 0, z, w: 4, h: 66, d: 4, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
    // The head leans out over the curb, toward the road.
    push({ x: x + toX * 7, y: 60, z: z + toZ * 7, w: 16, h: 8, d: 16, color: C.windowWarm, kind: KIND.lamp, hull: 0, ref, lod: DETAIL_LOD.rich });
  };
  // Lamps along streets that run along z (at fixed x), spaced in z; then the other axis.
  for (const s of streets.xs) {
    if (isRiver(s, true, city.river)) continue;
    for (const { at, side } of lampStops(streets.lampOrigin.z, bounds.z0 + 40, bounds.z1 - 40)) {
      const x = s.c + side * (s.w / 2 + LAMP.curb);
      if (streets.zs.some((q) => Math.abs(at - q.c) < q.w / 2 + 20)) continue;
      lampOn(x, at, -side, 0);
    }
  }
  for (const s of streets.zs) {
    if (isRiver(s, false, city.river)) continue;
    for (const { at, side } of lampStops(streets.lampOrigin.x, bounds.x0 + 40, bounds.x1 - 40)) {
      const z = s.c + side * (s.w / 2 + LAMP.curb);
      if (streets.xs.some((q) => Math.abs(at - q.c) < q.w / 2 + 20)) continue;
      lampOn(at, z, 0, -side);
    }
  }

  // A traffic signal at each crossing, on one corner, its arm out over the street.
  streets.xs.forEach((sx, i) => {
    if (isRiver(sx, true, city.river)) return;
    streets.zs.forEach((sz, j) => {
      if (isRiver(sz, false, city.river)) return;
      const k = (i + j) % 2 ? 1 : -1;
      const x = sx.c + k * (sx.w / 2 + 8);
      const z = sz.c + k * (sz.w / 2 + 8);
      if (!keepClear(x, z, 6)) return;
      const ref = { x, z };
      const arm = Math.min(70, sz.w * 0.42);
      push({ x, y: 0, z, w: 5, h: 92, d: 5, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
      push({ x, y: 88, z, to: { x, y: 88, z: z - k * arm }, w: 3, h: 1, d: 3, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: DETAIL_LOD.rich });
      push({ x, y: 58, z: z - k * arm, w: 11, h: 30, d: 11, color: C.rooftop, kind: KIND.signal, seed: i * 31 + j * 7, hull: 0.6, ref, lod: DETAIL_LOD.rich });
    });
  });
}
