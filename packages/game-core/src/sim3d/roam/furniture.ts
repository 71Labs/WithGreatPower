/**
 * Free roam's furniture (ruleset tag roam-2): everything the City draws that stands in the
 * hero's way, as one list both sides read, so what blocks him is exactly what's drawn.
 *
 * - The sim adds every part's `solid` box to roam's own CityIndex (world.ts roamGrid): he
 *   collides with it and slides along it, steps onto what's under STEP_UP, vaults what's
 *   under VAULT_MAX, climbs what's taller.
 * - The scene, given the roam city, draws its rooftop props from `props` (and nothing else:
 *   a unit the drawing would leave out is left out of the sim too) and draws `parts` box by
 *   box (scene/city/layout.ts, roam mode), where the patrol city draws its own decoration.
 *
 * What's here:
 * - Rooftop props as drawn (a port of the scene's drawnProps for the roam city): AC units and
 *   vents where they fit, water towers (legs, then the tank; flat-lidded in the City, so the
 *   top a perch, a page or a climber stands on is the top that's drawn), antennas and masts
 *   (the pole as wide as the sim's, its foot block, its light inside the top), billboards
 *   (board and legs as one slab: nobody fits under a board 34 up), cranes (mast, jibs,
 *   counterweight, cab, apex, hook and its cable).
 * - Street furniture: lamp posts, traffic signals (taller than a patrol night's, their heads
 *   hung clear of the hero and the cars), roof doors (stair bulkheads), and on Doc's bridge
 *   the rails along both edges (where a patrol night's deck lamps stand), the towers' beams
 *   and caps, the cables' hangers and the deck's truss.
 *
 * Not here (decoration under 6 units that a body passes no differently from paint): the
 * cornice trim. The City doesn't draw a patrol night's 6-unit parapets or fire escapes,
 * which can't be solid without changing how ledges are grabbed.
 *
 * Pure and deterministic (len2, + − × ÷, Math.floor/abs/min/max); built once per city.
 */
import { BILLBOARD_LEGS } from "../constants";
import type { Building, City, Prop } from "../contract";
import { cablePoint } from "../city";
import { len2, len3 } from "../dmath";

/** An axis-aligned box. */
export interface SolidBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** A rooftop (or street) prop as the City draws it: where its foot is drawn, how tall, and an antenna drawn without its foot block. */
export interface RoamDrawnProp {
  prop: Prop;
  y: number;
  h: number;
  bare: boolean;
}

/** How the scene draws a furniture part (scene/city/layout.ts maps each to a colour and a shader kind). */
export type PartLook =
  | "lamp-post"
  | "lamp-head"
  | "signal-post"
  | "signal-arm"
  | "signal-head"
  | "door"
  | "door-cap"
  | "rail"
  | "rail-cap"
  /** Solid only: drawn by the scene's own bridge (beams, caps, lamps, truss). */
  | "bridge";

/** A furniture part: its box, how it looks, whether the scene draws it, and a quarter-turn yaw (doors face their roof's middle). */
export interface FurniturePart extends SolidBox {
  look: PartLook;
  draw: boolean;
  /** Quarter turns about +y (0–3), for parts with a front (a door). */
  facing: number;
  seed: number;
}

export interface RoamFurniture {
  props: RoamDrawnProp[];
  parts: FurniturePart[];
}

/* ------------------------------------------------------------------ dimensions (both sides read these) */

/** Water towers: legs to this share of the height, spread this share of the width, this thick; the tank this wide. */
export const TANK_LEG_SHARE = 0.42;
export const TANK_LEG_SPREAD = 0.34;
export const TANK_LEG = 5;
/** Antennas: a pole this far either side (masts, 14 wide or more, MAST_HALF); its foot block; its light (the pole's top). */
export const POLE_HALF = 5;
export const MAST_HALF = 7;
export const ANTENNA_FOOT = { half: 9, h: 12 } as const;
export const ANTENNA_LIGHT = 10;
/** A vent: its stem and its cap. */
export const VENT = { stem: 6, stemH: 22, cap: 10, capH: 9 } as const;
/**
 * Street lamps in the City (a patrol night's): the post, and the head leaning out over the curb.
 * Kept low: a post stands 8 from a facade, and a tall one would cut every wall run short.
 */
export const ROAM_LAMP = { post: 2, h: 66, head: 8, headH: 8, lean: 7, headAt: 60 } as const;
/** Traffic signals in the City: the post on the corner, the arm out over the street, the head hung from it clear of the hero and a car. */
export const ROAM_SIGNAL = { post: 2.5, h: 140, arm: 1.5, head: 5.5, headH: 30, headUp: 100 } as const;
/** Roof doors: the bulkhead (taller than STEP_UP: vaulted, not stepped onto) and its cap. */
export const ROOF_DOOR = { w: 44, d: 36, h: 44, capW: 52, capD: 44, capH: 5 } as const;
/**
 * Doc's bridge's rails: this tall, this thick (a flush wall, its cap a band of it), along both deck
 * edges. Tall enough that hanging from the top on the deck's side keeps the body clear of the deck.
 */
export const BRIDGE_RAIL = { h: 80, t: 10, capH: 5 } as const;
/** The rails come in lengths about this long. */
const RAIL_PIECE = 60;

/** Street lamps: spacing along a street, distance from the curb onto the walk (the ground shader paints their pools from the same numbers). */
const LAMP_SPACING = 260;
const LAMP_CURB = 8;
const MAX_STREETS = 16;

/* ------------------------------------------------------------------ helpers */

function hash01(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const overlaps = (a: SolidBox, b: SolidBox, pad = 0) => a.x0 < b.x1 - pad && a.x1 > b.x0 + pad && a.y0 < b.y1 - pad && a.y1 > b.y0 + pad && a.z0 < b.z1 - pad && a.z1 > b.z0 + pad;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SolidBox => ({ x0, y0, z0, x1, y1, z1 });
/** A box centred on (x, z), half sizes hx and hz, from y0 to y1. */
const around = (x: number, z: number, hx: number, hz: number, y0: number, y1: number) => box(x - hx, y0, z - hz, x + hx, y1, z + hz);

/** A local (x, z) offset turned by a prop's quarter-turn facing (0 → +z front), as the scene turns it. */
export function turnLocal(facing: number, lx: number, lz: number): { x: number; z: number } {
  switch (facing & 3) {
    case 1:
      return { x: lz, z: -lx };
    case 2:
      return { x: -lx, z: -lz };
    case 3:
      return { x: -lz, z: lx };
    default:
      return { x: lx, z: lz };
  }
}

/** A box of local size (w across, d along the facing), turned by a quarter-turn facing, centred at (x, z). */
function turned(x: number, z: number, facing: number, w: number, d: number, y0: number, y1: number): SolidBox {
  const odd = (facing & 1) === 1;
  return around(x, z, (odd ? d : w) / 2, (odd ? w : d) / 2, y0, y1);
}

/* ------------------------------------------------------------------ rooftop props as drawn */

/** What a prop occupies as drawn, for fitting the units in (a tower's legs, a mast's foot, a board on its legs, a unit). */
function footprint(p: Prop, y: number, h: number): SolidBox {
  const { x, z } = p.at;
  switch (p.kind) {
    case "water-tower": {
      const r = p.w * TANK_LEG_SPREAD + 4;
      return around(x, z, r, r, y, y + h);
    }
    case "antenna":
      return around(x, z, ANTENNA_FOOT.half, ANTENNA_FOOT.half, y, y + h);
    case "billboard": {
      const odd = (p.facing & 1) === 1;
      return around(x, z, (odd ? p.d : p.w) / 2, (odd ? p.w : p.d) / 2, y, y + BILLBOARD_LEGS + h);
    }
    case "vent":
      return around(x, z, VENT.cap, VENT.cap, y, y + VENT.stemH + VENT.capH);
    default:
      return around(x, z, p.w / 2, p.d / 2, y, y + h);
  }
}

/**
 * The roam city's props as the City draws them (the scene's drawnProps, for this city): masts
 * lifted out of a setback or onto a tank's lid, one per spot, bare where a foot won't fit; then
 * AC units and vents wherever they fit (none inside a tower's legs, a mast's foot, a billboard,
 * a building or a setback, another unit, or off its roof).
 */
export function roamProps(city: City): RoamDrawnProp[] {
  const byId = new Map<number, Building>();
  for (const b of city.buildings) byId.set(b.id, b);
  const solids: SolidBox[] = [];
  for (const b of city.buildings) {
    solids.push(box(b.x0, 0, b.z0, b.x1, b.h, b.z1));
    if (b.top) solids.push(box(b.top.x0, b.h, b.top.z0, b.top.x1, b.top.h, b.top.z1));
  }
  const out: RoamDrawnProp[] = [];
  const structural: SolidBox[] = [];
  const towers = city.props.filter((p) => p.kind === "water-tower");
  for (const p of city.props) {
    if (p.kind === "antenna" || p.kind === "ac" || p.kind === "vent") continue;
    out.push({ prop: p, y: p.at.y, h: p.h, bare: false });
    if (p.kind !== "crane") structural.push(footprint(p, p.at.y, p.h));
  }

  const masts: RoamDrawnProp[] = [];
  const covers: Prop[][] = [];
  for (const p of city.props) {
    if (p.kind !== "antenna") continue;
    const b = p.buildingId !== null ? byId.get(p.buildingId) : undefined;
    const t = b?.top;
    const top = p.at.y + p.h;
    let y = p.at.y;
    let bare = false;
    if (t && p.at.y < t.h - 0.5 && p.at.x > t.x0 && p.at.x < t.x1 && p.at.z > t.z0 && p.at.z < t.z1) y = t.h;
    for (const w of towers) {
      const R = w.w * 0.58;
      const r = len2(p.at.x - w.at.x, p.at.z - w.at.z);
      if (r > R + 3 || Math.abs(w.at.y - y) > 1) continue;
      bare = true;
      // Up through the tank: it stands on the tank's flat lid.
      const lid = w.at.y + w.h;
      if (top > lid + 6) y = lid;
    }
    const drawn = { prop: p, y, h: Math.max(12, top - y), bare };
    const same = masts.findIndex((m, i) => {
      const hi = m.y + m.h >= top ? m : drawn;
      return Math.abs(m.y - y) < 1 && [...covers[i], p].every((q) => len2(hi.prop.at.x - q.at.x, hi.prop.at.z - q.at.z) < 12 && q.at.y + q.h >= hi.y && q.at.y + q.h <= hi.y + hi.h + 0.5);
    });
    if (same < 0) {
      masts.push(drawn);
      covers.push([p]);
    } else {
      covers[same].push(p);
      if (top > masts[same].y + masts[same].h) masts[same] = drawn;
    }
  }
  const feet: SolidBox[] = [];
  for (const m of masts) {
    const p = m.prop;
    const foot = footprint(p, m.y, ANTENNA_FOOT.h);
    const b = p.buildingId !== null ? byId.get(p.buildingId) : undefined;
    const roof = b ? (b.top && Math.abs(b.top.h - m.y) < 0.5 ? b.top : Math.abs(b.h - m.y) < 0.5 ? b : null) : null;
    const offRoof = !!roof && (foot.x0 < roof.x0 || foot.x1 > roof.x1 || foot.z0 < roof.z0 || foot.z1 > roof.z1);
    const inWall = solids.some((s) => !(Math.abs(s.y1 - m.y) < 0.5 && p.at.x >= s.x0 && p.at.x <= s.x1 && p.at.z >= s.z0 && p.at.z <= s.z1) && overlaps(foot, s, 0.5));
    if (!m.bare && (offRoof || inWall || feet.some((f) => overlaps(foot, f, 0.5)) || structural.some((s) => overlaps(foot, s, 0.5)))) m.bare = true;
    if (!m.bare) feet.push(foot);
    out.push(m);
    const half = poleHalf(p);
    structural.push(m.bare ? around(p.at.x, p.at.z, half, half, m.y, m.y + m.h) : footprint(p, m.y, m.h));
  }

  const units: SolidBox[] = [];
  for (const p of city.props) {
    if (p.kind !== "ac" && p.kind !== "vent") continue;
    const b0 = footprint(p, p.at.y, p.h);
    const own = p.buildingId !== null ? byId.get(p.buildingId) : undefined;
    const standsOn = (s: SolidBox) => Math.abs(s.y1 - p.at.y) < 0.5 && p.at.x >= s.x0 && p.at.x <= s.x1 && p.at.z >= s.z0 && p.at.z <= s.z1;
    if (structural.some((s) => overlaps(b0, s, 0.5))) continue;
    if (units.some((u) => overlaps(b0, u, 0.5))) continue;
    if (solids.some((s) => !standsOn(s) && overlaps(b0, s, 0.5))) continue;
    if (own) {
      const roof = own.top && Math.abs(own.top.h - p.at.y) < 0.5 ? own.top : own;
      if (b0.x0 < roof.x0 - 0.5 || b0.x1 > roof.x1 + 0.5 || b0.z0 < roof.z0 - 0.5 || b0.z1 > roof.z1 + 0.5) continue;
    }
    units.push(b0);
    out.push({ prop: p, y: p.at.y, h: p.h, bare: false });
  }
  return out;
}

/** An antenna's pole: a sync mast's (14 wide or more) or a plain pole's half width. */
export const poleHalf = (p: Prop) => (p.w >= MAST_HALF * 2 ? MAST_HALF : POLE_HALF);

/** A water tower's tank in plan: an octagon (the drawn lathe's 8 sides) as three boxes inside it. */
const TANK_BOXES: [number, number][] = [
  [0.705, 0.705],
  [0.87, 0.3],
  [0.3, 0.87],
];

/** The solid boxes of a prop as drawn. */
export function propSolids(d: RoamDrawnProp, out: SolidBox[] = []): SolidBox[] {
  const p = d.prop;
  const { x, z } = p.at;
  const y = d.y;
  switch (p.kind) {
    case "ac":
      out.push(turned(x, z, p.facing, p.w, p.d, y, y + d.h));
      break;
    case "vent":
      out.push(around(x, z, VENT.stem, VENT.stem, y, y + VENT.stemH), around(x, z, VENT.cap, VENT.cap, y + VENT.stemH, y + VENT.stemH + VENT.capH));
      break;
    case "water-tower": {
      // Under the tank: the legs (nobody fits between them, under a tank 70 up); then the tank to its lid.
      const legH = d.h * TANK_LEG_SHARE;
      const r = p.w * TANK_LEG_SPREAD + TANK_LEG / 2;
      out.push(around(x, z, r, r, y, y + legH));
      const R = p.w / 2;
      for (const [a, b] of TANK_BOXES) out.push(around(x, z, R * a, R * b, y + legH, y + d.h));
      break;
    }
    case "antenna": {
      const half = poleHalf(p);
      out.push(around(x, z, half, half, y, y + d.h));
      if (!d.bare) out.push(around(x, z, ANTENNA_FOOT.half, ANTENNA_FOOT.half, y, y + ANTENNA_FOOT.h));
      break;
    }
    case "billboard": {
      // The board on its legs, as one slab from the roof (the hero doesn't fit under it).
      const odd = (p.facing & 1) === 1;
      out.push(around(x, z, (odd ? p.d : p.w) / 2, (odd ? p.w : p.d) / 2, y, y + BILLBOARD_LEGS + d.h));
      break;
    }
    case "crane": {
      const top = y + p.h;
      const at = (lx: number, lz: number) => {
        const o = turnLocal(p.facing, lx, lz);
        return { x: x + o.x, z: z + o.z };
      };
      const mw = p.d / 2;
      out.push(around(x, z, mw, mw, y, top));
      const jib = at(0, p.w / 2 - 6);
      out.push(turned(jib.x, jib.z, p.facing, 16, p.w + 12, top - 4, top + 12));
      const cj = at(0, -p.w * 0.175);
      out.push(turned(cj.x, cj.z, p.facing, 15, p.w * 0.35, top - 4, top + 11));
      const cw = at(0, -p.w * 0.3);
      out.push(around(cw.x, cw.z, 18, 18, top - 30, top - 4));
      out.push(around(x, z, 18, 18, top - 44, top - 12));
      out.push(around(x, z, 3, 3, top + 12, top + 52));
      const hook = at(0, p.w * 0.7);
      out.push(around(hook.x, hook.z, 1.25, 1.25, top - 170, top - 4));
      out.push(around(hook.x, hook.z, 6, 6, top - 186, top - 170));
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ streets */

export interface RoamStreet {
  /** Centre line on the axis, and full width curb to curb. */
  c: number;
  w: number;
}

function gaps(intervals: [number, number][], lo: number, hi: number, alley: number, minGap: number, sidewalk: number): RoamStreet[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + alley) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const out: RoamStreet[] = [];
  let cursor = lo;
  for (const [a, b] of merged) {
    if (a - cursor >= minGap) out.push({ c: (a + cursor) / 2, w: Math.max(20, a - cursor - sidewalk * 2) });
    cursor = Math.max(cursor, b);
  }
  if (hi - cursor >= minGap) out.push({ c: (hi + cursor) / 2, w: Math.max(20, hi - cursor - sidewalk * 2) });
  return out.slice(0, MAX_STREETS);
}

/** The streets, inferred from the building footprints as the scene's ground shader paints them (scene/city/streets.ts). */
export function roamStreets(city: City): { xs: RoamStreet[]; zs: RoamStreet[]; lampOrigin: { x: number; z: number } } {
  const sx = gaps(
    city.buildings.map((b) => [b.x0, b.x1]),
    city.bounds.x0,
    city.bounds.x1,
    30,
    70,
    16,
  );
  const sz = gaps(
    city.buildings.map((b) => [b.z0, b.z1]),
    city.bounds.z0,
    city.bounds.z1,
    30,
    70,
    16,
  );
  return { xs: sx, zs: sz, lampOrigin: { x: sx[0]?.c ?? city.bounds.x0, z: sz[0]?.c ?? city.bounds.z0 } };
}

function lampStops(origin: number, lo: number, hi: number): { at: number; side: 1 | -1 }[] {
  const out: { at: number; side: 1 | -1 }[] = [];
  const first = Math.ceil((lo - origin) / LAMP_SPACING - 0.5);
  for (let n = first; ; n++) {
    const at = origin + (n + 0.5) * LAMP_SPACING;
    if (at > hi) break;
    if (at >= lo) out.push({ at, side: ((n % 2) + 2) % 2 === 0 ? 1 : -1 });
  }
  return out;
}

const inside = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

function isRiver(s: RoamStreet, alongZ: boolean, river: City["river"]): boolean {
  if (!river) return false;
  return alongZ ? s.c > river.x0 - s.w / 2 && s.c < river.x1 + s.w / 2 && river.z1 - river.z0 > river.x1 - river.x0 : s.c > river.z0 - s.w / 2 && s.c < river.z1 + s.w / 2 && river.x1 - river.x0 > river.z1 - river.z0;
}

/* ------------------------------------------------------------------ the furniture */

/** A spot something mustn't be built on (a page, a person, the spawn): feet point and how far to keep. */
export interface KeepClear {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * Everything the City draws in the hero's way. `keep` are the content's spots (folks, pages,
 * pixels, perches, banks, the spawn): no lamp, signal or door is put up on one, so nothing the
 * city placed ends up inside furniture.
 */
export function roamFurniture(city: City, keep: KeepClear[] = []): RoamFurniture {
  const props = roamProps(city);
  const parts: FurniturePart[] = [];
  const add = (b: SolidBox, look: PartLook, draw = true, facing = 0, seed = 0) => parts.push({ ...b, look, draw, facing, seed });
  const free = (b: SolidBox, pad: number) => keep.every((k) => k.y > b.y1 + 2 || k.y < b.y0 - 120 || k.x < b.x0 - k.r - pad || k.x > b.x1 + k.r + pad || k.z < b.z0 - k.r - pad || k.z > b.z1 + k.r + pad);

  const blocked = city.buildings.map((b) => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }));
  const river = city.river;
  const deck = city.bridge?.deck ?? null;
  const groundClear = (x: number, z: number, pad: number) => {
    if (river && inside(river, x, z, pad)) return false;
    if (deck && inside(deck, x, z, pad + 30)) return false;
    return !blocked.some((r) => inside(r, x, z, pad));
  };
  const streets = roamStreets(city);
  const { bounds } = city;

  // Street lamps, zigzagging along every street (where the ground shader paints their pools).
  const L = ROAM_LAMP;
  const lamp = (x: number, z: number, toX: number, toZ: number) => {
    if (!groundClear(x, z, 4)) return;
    const post = around(x, z, L.post, L.post, 0, L.h);
    if (!free(post, 8)) return;
    add(post, "lamp-post");
    add(around(x + toX * L.lean, z + toZ * L.lean, L.head, L.head, L.headAt, L.headAt + L.headH), "lamp-head");
  };
  for (const s of streets.xs) {
    if (isRiver(s, true, river)) continue;
    for (const { at, side } of lampStops(streets.lampOrigin.z, bounds.z0 + 40, bounds.z1 - 40)) {
      if (streets.zs.some((q) => Math.abs(at - q.c) < q.w / 2 + 20)) continue;
      lamp(s.c + side * (s.w / 2 + LAMP_CURB), at, -side, 0);
    }
  }
  for (const s of streets.zs) {
    if (isRiver(s, false, river)) continue;
    for (const { at, side } of lampStops(streets.lampOrigin.x, bounds.x0 + 40, bounds.x1 - 40)) {
      if (streets.xs.some((q) => Math.abs(at - q.c) < q.w / 2 + 20)) continue;
      lamp(at, s.c + side * (s.w / 2 + LAMP_CURB), 0, -side);
    }
  }

  // A traffic signal at each crossing, on one corner, its arm out over the street and the head
  // hung clear of the hero and the cars.
  const S = ROAM_SIGNAL;
  streets.xs.forEach((sx, i) => {
    if (isRiver(sx, true, river)) return;
    streets.zs.forEach((sz, j) => {
      if (isRiver(sz, false, river)) return;
      const k = (i + j) % 2 ? 1 : -1;
      const x = sx.c + k * (sx.w / 2 + 8);
      const z = sz.c + k * (sz.w / 2 + 8);
      if (!groundClear(x, z, 6)) return;
      const post = around(x, z, S.post, S.post, 0, S.h);
      if (!free(post, 8)) return;
      const arm = Math.min(70, sz.w * 0.42);
      add(post, "signal-post", true, 0, i * 31 + j * 7);
      add(box(x - S.arm, S.h - 6, Math.min(z, z - k * arm), x + S.arm, S.h - 3, Math.max(z, z - k * arm)), "signal-arm");
      add(around(x, z - k * arm, S.head, S.head, S.headUp, S.headUp + S.headH), "signal-head", true, 0, i * 31 + j * 7);
    });
  });

  // Roof doors: a stair bulkhead in a free corner of some main roofs, facing the roof's middle.
  const D = ROOF_DOOR;
  const spots = [city.start, ...city.zones.map((zn) => zn.center), ...city.zones.flatMap((zn) => (zn.allyAt ? [zn.allyAt] : []))];
  const propsOf = new Map<number, Prop[]>();
  for (const p of city.props) if (p.buildingId !== null) propsOf.set(p.buildingId, [...(propsOf.get(p.buildingId) ?? []), p]);
  for (const b of city.buildings) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const seed = b.seed & 0xffffff;
    if (!(hash01(seed + 307) < 0.55 && w >= 130 && d >= 130)) continue;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const own = propsOf.get(b.id) ?? [];
    const start = Math.floor(hash01(seed + 311) * 4);
    for (let i = 0; i < 4; i++) {
      const k = (start + i) % 4;
      const x = k % 2 ? b.x1 - 26 - D.w / 2 : b.x0 + 26 + D.w / 2;
      const z = k < 2 ? b.z0 + 26 + D.d / 2 : b.z1 - 26 - D.d / 2;
      if (b.top && inside(b.top, x, z, 40)) continue;
      if (own.some((p) => p.at.y === b.h && len2(p.at.x - x, p.at.z - z) < 50 + Math.max(p.w, p.d) / 2)) continue;
      if (spots.some((sp) => Math.abs(sp.y - b.h) < 80 && len2(sp.x - x, sp.z - z) < 110)) continue;
      // Face the roof's middle (the door is on the bulkhead's front): the nearer axis.
      const dx = cx - x;
      const dz = cz - z;
      const facing = Math.abs(dz) >= Math.abs(dx) ? (dz >= 0 ? 0 : 2) : dx >= 0 ? 1 : 3;
      const body = turned(x, z, facing, D.w, D.d, b.h, b.h + D.h);
      if (!free(body, 10)) continue;
      add(body, "door", true, facing, seed + 13);
      add(turned(x, z, facing, D.capW, D.capD, b.h + D.h, b.h + D.h + D.capH), "door-cap", true, facing);
      break;
    }
  }

  // Doc's bridge: rails along both deck edges (new in the City), and as solids only (the scene
  // draws them) its truss under the deck, its towers' beams and caps, and its lamps.
  const br = city.bridge;
  if (br) {
    const dk = br.deck;
    const alongX = br.axis ? br.axis === "x" : dk.x1 - dk.x0 >= dk.z1 - dk.z0;
    const u0 = alongX ? dk.x0 : dk.z0;
    const u1 = alongX ? dk.x1 : dk.z1;
    const v0 = alongX ? dk.z0 : dk.x0;
    const v1 = alongX ? dk.z1 : dk.x1;
    /** A box from u/v ranges. */
    const uv = (ua: number, ub: number, y0: number, y1: number, va: number, vb: number) => (alongX ? box(ua, y0, va, ub, y1, vb) : box(va, y0, ua, vb, y1, ub));
    const R = BRIDGE_RAIL;
    // One wall each side (no seams to wedge in), its cap in lengths (a ledge pulled up onto is
    // stood on near where it's grabbed, not at the middle of the bridge).
    const pieces = Math.max(1, Math.round((u1 - u0) / RAIL_PIECE));
    for (const [va, vb] of [
      [v0, v0 + R.t],
      [v1 - R.t, v1],
    ]) {
      add(uv(u0, u1, dk.y, dk.y + R.h - R.capH, va, vb), "rail");
      for (let k = 0; k < pieces; k++) add(uv(u0 + ((u1 - u0) * k) / pieces, u0 + ((u1 - u0) * (k + 1)) / pieces, dk.y + R.h - R.capH, dk.y + R.h, va, vb), "rail-cap");
    }
    add(uv(u0, u1, dk.y - 44, dk.y - 24, v0, v1), "bridge", false);
    const half = br.towerHalf ?? 25;
    const U = (p: { x: number; z: number }) => (alongX ? p.x : p.z);
    const V = (p: { x: number; z: number }) => (alongX ? p.z : p.x);
    const groups: { x: number; y: number; z: number }[][] = [];
    for (const t of br.towers) {
      const g = groups.find((q) => Math.abs(U(q[0]) - U(t)) < half * 2);
      if (g) g.push(t);
      else groups.push([t]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const vs = g.map(V);
      const va = Math.min(...vs);
      const vb = Math.max(...vs);
      const u = g.reduce((sum, t) => sum + U(t), 0) / g.length;
      const top = Math.min(...g.map((t) => t.y));
      const mid = (va + vb) / 2;
      for (const y of [top - 70, dk.y + (top - dk.y) * 0.55, dk.y + 90]) add(uv(u - half * 0.6, u + half * 0.6, y, y + 18, mid - (vb - va) / 2, mid + (vb - va) / 2), "bridge", false);
      const capV = (vb - va + half * 2 + 16) / 2;
      add(uv(u - half - 5, u + half + 5, top, top + 24, mid - capV, mid + capV), "bridge", false);
    }
    // (The City draws no deck lamps: the rails stand where they stood.)
    // The hangers from the main cables down to the deck's level (thin, but solid like a lamp post).
    for (const c of city.cables ?? []) {
      if (c.kind !== "bridge") continue;
      const count = Math.round(len3(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z) / 46);
      for (let i = 1; i < count; i++) {
        const p = cablePoint(c, i / count);
        if (p.y - dk.y < 30) continue;
        add(around(p.x, p.z, 1.25, 1.25, dk.y, p.y), "bridge", false);
      }
    }
  }
  return { props, parts };
}

/** Every solid box of the furniture: the props', then the parts', in a fixed order. */
export function furnitureSolids(f: RoamFurniture): SolidBox[] {
  const out: SolidBox[] = [];
  for (const d of f.props) propSolids(d, out);
  for (const p of f.parts) out.push(p);
  return out;
}
