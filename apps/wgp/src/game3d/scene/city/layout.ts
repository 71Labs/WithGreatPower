/**
 * The city as instance lists: every building, setback, rooftop prop, crane and bridge part,
 * plus the presentation detail from details.ts (ledges, roof doors, fire escapes, lamps,
 * signals), becomes a box (one unit-box geometry, instanced) or a water-tower tank (one
 * lathe, instanced). Pure data, no three.js: the mesh builder turns it into instance
 * attributes, and tests can count it.
 *
 * Boxes are grouped into 4×4 city sectors so each sector's instanced mesh has a tight
 * bounding sphere and three.js can frustum-cull it.
 */
import type { Building, Cable, City, Prop, Vec3 } from "@wgp/game-core/sim3d/contract";
import { ANTENNA_LIGHT, poleHalf, type FurniturePart, type RoamFurniture } from "@wgp/game-core/sim3d/roam";

import { C, buildingFill, mixRgb, type RGB } from "../palette";
import { addDetails, DETAIL_LOD } from "./details";
import { TANK_EAVE } from "./geometry";
import { drawnProps } from "./props";
import { KIND, WINDOW_STYLE, windowStyle, type BoxSpec, type PushBox } from "./kinds";

export { KIND, WINDOW_STYLE, windowStyle, type BoxSpec } from "./kinds";

export const SECTORS = 4;

export interface TankSpec {
  /** Base of the tank (top of the legs). */
  x: number;
  y: number;
  z: number;
  /** Diameter and full height (body + conical roof). */
  w: number;
  h: number;
  seed: number;
  ref: { x: number; z: number };
  /**
   * An ally stands on it (Gwei Stacy's errand): its roof is drawn flat, a lid at the tower's
   * full height (the sim's `Zone.allyAt`), instead of a cone whose point she'd hover over.
   */
  flat: boolean;
}

export interface SectorBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface CityLayout {
  boxes: BoxSpec[];
  tanks: TankSpec[];
  sectors: SectorBounds[];
  /** Distinct billboard texts, in atlas order. */
  texts: string[];
}

/** The highest roof of a building: `Building.top.h` is the setback's roof height from the street. */
export function topRoof(b: Building): number {
  return b.top ? b.top.h : b.h;
}

const QUARTER = Math.PI / 2;

type Push = PushBox;

/** Rotate a local (x, z) offset by a prop's quarter-turn facing (0 → +z front). */
function turn(facing: number, lx: number, lz: number): { x: number; z: number } {
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

/**
 * `roam`: the City's furniture (game-core sim3d/roam/furniture.ts): its props are drawn from
 * that list (the sim's solids are the same boxes), water tanks flat-lidded, antennas as wide as
 * the sim's poles, and its lamps, signals, roof doors and bridge rails box by box, where a patrol
 * city draws its own decoration (details.ts: here only the cornices).
 */
export function buildCityLayout(city: City, opts: { details?: boolean; roam?: RoamFurniture | null } = {}): CityLayout {
  const boxes: BoxSpec[] = [];
  const tanks: TankSpec[] = [];
  const texts: string[] = [];
  const { x0, x1, z0, z1 } = city.bounds;
  const sx = (x1 - x0) / SECTORS;
  const sz = (z1 - z0) / SECTORS;
  const sectors: SectorBounds[] = [];
  for (let j = 0; j < SECTORS; j++) {
    for (let i = 0; i < SECTORS; i++) sectors.push({ x0: x0 + i * sx, z0: z0 + j * sz, x1: x0 + (i + 1) * sx, z1: z0 + (j + 1) * sz });
  }
  const sectorOf = (x: number, z: number) => {
    const i = Math.min(SECTORS - 1, Math.max(0, Math.floor((x - x0) / sx)));
    const j = Math.min(SECTORS - 1, Math.max(0, Math.floor((z - z0) / sz)));
    return j * SECTORS + i;
  };
  const byId = new Map<number, Building>();
  for (const b of city.buildings) byId.set(b.id, b);

  const push: Push = (spec) => {
    const mx = spec.to ? (spec.x + spec.to.x) / 2 : spec.x;
    const mz = spec.to ? (spec.z + spec.to.z) / 2 : spec.z;
    boxes.push({ yaw: 0, seed: 0, style: 0, atlas: 0, lod: 0, ...spec, sector: sectorOf(mx, mz) });
  };

  for (const b of city.buildings) {
    const fill = buildingFill(b.tone, b.accent);
    const ref = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
    push({
      x: ref.x,
      y: 0,
      z: ref.z,
      w: b.x1 - b.x0,
      h: b.h,
      d: b.z1 - b.z0,
      color: fill,
      kind: KIND.building,
      seed: b.seed & 0xffffff,
      style: windowStyle(b),
      hull: 1,
      ref,
    });
    if (b.top) {
      const t = b.top;
      push({
        x: (t.x0 + t.x1) / 2,
        y: b.h,
        z: (t.z0 + t.z1) / 2,
        w: t.x1 - t.x0,
        h: Math.max(1, t.h - b.h),
        d: t.z1 - t.z0,
        color: fill,
        kind: KIND.top,
        seed: (b.seed + 77) & 0xffffff,
        style: WINDOW_STYLE.plain,
        hull: 1,
        ref,
      });
    }
  }

  // Where allies stand: a water tower with one on top gets a flat roof (TankSpec.flat).
  const allies = city.zones.flatMap((z) => (z.allyAt ? [z.allyAt] : []));
  const carries = (p: Prop) => p.kind === "water-tower" && allies.some((a) => Math.abs(a.x - p.at.x) < 1 && Math.abs(a.z - p.at.z) < 1 && Math.abs(a.y - (p.at.y + p.h)) < 1);
  // The props as drawn: none inside another or inside a setback (city/props.ts; the City's, the sim's list).
  const roam = opts.roam ?? null;
  for (const d of roam ? roam.props : drawnProps(city)) {
    const p = d.y === d.prop.at.y && d.h === d.prop.h ? d.prop : { ...d.prop, at: { ...d.prop.at, y: d.y }, h: d.h };
    const owner = p.buildingId !== null ? byId.get(p.buildingId) : undefined;
    const ref = owner ? { x: (owner.x0 + owner.x1) / 2, z: (owner.z0 + owner.z1) / 2 } : { x: p.at.x, z: p.at.z };
    addProp(p, ref, push, tanks, texts, roam ? p.kind === "water-tower" : carries(p), d.bare, !!roam);
  }

  if (city.bridge) addBridge(city, push, !roam);
  for (const c of city.cables ?? []) addCable(c, city, push);
  if (opts.details !== false) addDetails(city, push, undefined, { cornicesOnly: !!roam });
  if (roam) for (const part of roam.parts) if (part.draw) addPart(part, city, push);

  return { boxes, tanks, sectors, texts };
}

function addProp(p: Prop, ref: { x: number; z: number }, push: Push, tanks: TankSpec[], texts: string[], flat = false, bare = false, roam = false) {
  const { x, y, z } = p.at;
  const yaw = (p.facing & 3) * QUARTER;
  const at = (lx: number, lz: number) => {
    const o = turn(p.facing, lx, lz);
    return { x: x + o.x, z: z + o.z };
  };
  const seed = Math.floor(x * 7 + z * 13) & 0xffffff;
  switch (p.kind) {
    case "water-tower": {
      const legH = p.h * 0.42;
      const tankH = p.h - legH;
      const r = p.w * 0.34;
      for (const [lx, lz] of [
        [-r, -r],
        [r, -r],
        [-r, r],
        [r, r],
      ]) {
        push({ x: x + lx, y, z: z + lz, w: 5, h: legH + 2, d: 5, color: C.ink, kind: KIND.solid, hull: 0, ref });
      }
      // Braces halfway up the legs.
      push({ x, y: y + legH * 0.45, z: z - r, w: r * 2, h: 3, d: 3, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: 1 });
      push({ x, y: y + legH * 0.45, z: z + r, w: r * 2, h: 3, d: 3, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: 1 });
      // A flat roof is pressed down to the eave: the tank is drawn taller so its lid is at the top.
      tanks.push({ x, y: y + legH, z, w: p.w, h: flat ? tankH / TANK_EAVE : tankH, seed, ref, flat });
      break;
    }
    case "antenna": {
      // A bare mast (city/props.ts) has no foot block: it rises straight from where it stands.
      if (!bare) push({ x, y, z, w: 18, h: 12, d: 18, color: C.rooftop, kind: KIND.solid, hull: 0, ref, lod: 1 });
      const foot = bare ? 0 : 10;
      if (roam) {
        // The City's: as wide as the sim's pole (it's climbed, and stood on), bands round it
        // instead of crossbars sticking out, and the light the top of the pole (the perch).
        const wide = poleHalf(p) * 2;
        push({ x, y: y + foot, z, w: wide, h: p.h - foot - ANTENNA_LIGHT, d: wide, color: C.ink, kind: KIND.solid, hull: 0.5, ref });
        for (let i = 1; i <= 2; i++) push({ x, y: y + (p.h * i) / 3, z, w: wide + 1.5, h: 3, d: wide + 1.5, color: C.rooftop, kind: KIND.solid, hull: 0, ref, lod: 1 });
        push({ x, y: y + p.h - ANTENNA_LIGHT, z, w: wide + 1, h: ANTENNA_LIGHT, d: wide + 1, color: C.neonRed, kind: KIND.light, seed, hull: 0, ref });
        break;
      }
      push({ x, y: y + foot, z, w: 5, h: p.h - foot, d: 5, color: C.ink, kind: KIND.solid, hull: 0, ref });
      for (let i = 1; i <= 2; i++) {
        const half = 14 - i * 3;
        push({ x, y: y + (p.h * i) / 3, z, w: half * 2, h: 3, d: 3, yaw: i % 2 ? 0 : QUARTER, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: 1 });
      }
      push({ x, y: y + p.h, z, w: 10, h: 10, d: 10, color: C.neonRed, kind: KIND.light, seed, hull: 0, ref });
      break;
    }
    case "ac":
      push({ x, y, z, w: p.w, h: p.h, d: p.d, yaw, color: C.cable, kind: KIND.ac, seed, hull: 0, ref, lod: 1 });
      break;
    case "vent":
      push({ x, y, z, w: 12, h: 22, d: 12, color: C.steel, kind: KIND.solid, hull: 0, ref, lod: 1 });
      push({ x, y: y + 22, z, w: 20, h: 9, d: 20, color: C.rooftop, kind: KIND.solid, hull: 0, ref, lod: 1 });
      break;
    case "billboard": {
      const legs = 34;
      for (const lx of [-0.3 * p.w, 0.3 * p.w]) {
        const o = at(lx, 0);
        push({ x: o.x, y, z: o.z, w: 5, h: legs + 4, d: 5, color: C.ink, kind: KIND.solid, hull: 0, ref });
      }
      const mid = at(0, 0);
      push({ x: mid.x, y: y + legs * 0.5, z: mid.z, w: p.w * 0.6, h: 3, d: 3, yaw, color: C.ink, kind: KIND.solid, hull: 0, ref, lod: 1 });
      let index = texts.indexOf(p.text ?? "");
      if (index < 0) {
        index = texts.length;
        texts.push(p.text ?? "");
      }
      push({ x: mid.x, y: y + legs, z: mid.z, w: p.w, h: p.h, d: p.d, yaw, color: C.paper, kind: KIND.billboard, atlas: index, hull: 1, ref });
      break;
    }
    case "crane": {
      const mw = p.d;
      const top = y + p.h;
      push({ x, y, z, w: mw, h: p.h, d: mw, color: C.crane, kind: KIND.lattice, seed, hull: 0, ref });
      // Jib forward, counter-jib back, both along the facing.
      const jib = at(0, p.w / 2 - 6);
      push({ x: jib.x, y: top - 4, z: jib.z, w: 16, h: 16, d: p.w + 12, yaw, color: C.crane, kind: KIND.solid, hull: 0.8, ref });
      // The counter-jib a hair slimmer than the jib it meets over the mast: no shared faces to flicker.
      const cj = at(0, -p.w * 0.175);
      push({ x: cj.x, y: top - 4, z: cj.z, w: 15, h: 15, d: p.w * 0.35, yaw, color: C.crane, kind: KIND.solid, hull: 0.8, ref });
      const cw = at(0, -p.w * 0.3);
      push({ x: cw.x, y: top - 30, z: cw.z, w: 36, h: 26, d: 36, yaw, color: C.rooftop, kind: KIND.solid, hull: 0.8, ref });
      push({ x, y: top - 44, z, w: 36, h: 32, d: 36, yaw, color: C.crane, kind: KIND.solid, hull: 0.8, ref });
      // The apex and its pendant lines to both jib ends.
      push({ x, y: top + 12, z, w: 6, h: 40, d: 6, color: C.ink, kind: KIND.solid, hull: 0, ref });
      const tip = at(0, p.w);
      const back = at(0, -p.w * 0.35);
      push({ x, y: top + 50, z, to: { x: tip.x, y: top + 12, z: tip.z }, w: 2.5, h: 1, d: 2.5, color: C.ink, kind: KIND.solid, hull: 0, ref });
      push({ x, y: top + 50, z, to: { x: back.x, y: top + 12, z: back.z }, w: 2.5, h: 1, d: 2.5, color: C.ink, kind: KIND.solid, hull: 0, ref });
      // The hook, hanging from 70% along the jib.
      const hook = at(0, p.w * 0.7);
      push({ x: hook.x, y: top - 170, z: hook.z, w: 2.5, h: 166, d: 2.5, color: C.ink, kind: KIND.solid, hull: 0, ref });
      push({ x: hook.x, y: top - 186, z: hook.z, w: 12, h: 16, d: 12, color: C.rooftop, kind: KIND.solid, hull: 0.6, ref });
      break;
    }
  }
}

const LEDGE = mixRgb(C.rooftop, C.ink, 0.15);
const RAIL_CAP = mixRgb(C.bridge, C.ink, 0.2);

/**
 * A piece of the City's furniture, box by box (game-core sim3d/roam/furniture.ts: the sim's
 * solid is this box): lamps and signals as a patrol night's details draw them, a roof door in its
 * building's colours facing the roof's middle, the bridge's rails in its red. Near sectors draw
 * them on every tier (a post that stops you is never left out).
 */
function addPart(part: FurniturePart, city: City, push: Push) {
  const x = (part.x0 + part.x1) / 2;
  const z = (part.z0 + part.z1) / 2;
  const w = part.x1 - part.x0;
  const h = part.y1 - part.y0;
  const d = part.z1 - part.z0;
  const ref = { x, z };
  const base = { x, y: part.y0, z, w, h, d, ref, lod: DETAIL_LOD.near };
  switch (part.look) {
    case "lamp-post":
    case "signal-post":
    case "signal-arm":
      push({ ...base, color: C.ink, kind: KIND.solid, hull: 0 });
      break;
    case "lamp-head":
      push({ ...base, color: C.windowWarm, kind: KIND.lamp, hull: 0 });
      break;
    case "signal-head":
      push({ ...base, color: C.rooftop, kind: KIND.signal, seed: part.seed, hull: 0.6 });
      break;
    case "door":
    case "door-cap": {
      // Its own front on +z: turned to face the way it faces, its local width and depth back.
      const odd = (part.facing & 1) === 1;
      const turned = { ...base, w: odd ? d : w, d: odd ? w : d, yaw: part.facing * QUARTER };
      if (part.look === "door-cap") {
        push({ ...turned, color: LEDGE, kind: KIND.solid, hull: 0 });
        break;
      }
      const owner = city.buildings.find((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && Math.abs(b.h - part.y0) < 0.5);
      push({ ...turned, color: owner ? buildingFill(owner.tone + 1, owner.accent) : C.rooftop, kind: KIND.door, seed: part.seed, hull: 0.8, ref: owner ? { x: (owner.x0 + owner.x1) / 2, z: (owner.z0 + owner.z1) / 2 } : ref });
      break;
    }
    case "rail":
      push({ ...base, color: C.bridge, kind: KIND.solid, hull: 0.7, lod: 0 });
      break;
    case "rail-cap":
      push({ ...base, color: RAIL_CAP, kind: KIND.solid, hull: 0.5, lod: 0 });
      break;
    default:
      break;
  }
}

/** The red bridge: the deck with its truss, the tower legs (square columns from the street) with beams and caps, lamps. */
function addBridge(city: City, push: Push, lamps = true) {
  const br = city.bridge!;
  const { deck } = br;
  const alongX = br.axis ? br.axis === "x" : deck.x1 - deck.x0 >= deck.z1 - deck.z0;
  // u runs along the deck, v across it.
  const u0 = alongX ? deck.x0 : deck.z0;
  const u1 = alongX ? deck.x1 : deck.z1;
  const v0 = alongX ? deck.z0 : deck.x0;
  const v1 = alongX ? deck.z1 : deck.x1;
  const vc = (v0 + v1) / 2;
  const P = (u: number, y: number, v: number): Vec3 => (alongX ? { x: u, y, z: v } : { x: v, y, z: u });
  const U = (p: Vec3) => (alongX ? p.x : p.z);
  const V = (p: Vec3) => (alongX ? p.z : p.x);
  const yaw = alongX ? 0 : QUARTER;
  const red = C.bridge;
  const cap = mixRgb(C.bridge, C.ink, 0.2);
  const ref = (u: number) => {
    const p = P(u, 0, vc);
    return { x: p.x, z: p.z };
  };
  const box = (u: number, y: number, v: number, lenU: number, h: number, lenV: number, color: RGB, kind: number, hull: number, lod = 0) => {
    const p = P(u, y, v);
    push({ x: p.x, y: p.y, z: p.z, w: lenU, h, d: lenV, yaw, color, kind, hull, ref: ref(u), lod });
  };
  const deckDepth = 44;
  box((u0 + u1) / 2, deck.y - deckDepth, vc, u1 - u0, deckDepth, v1 - v0, red, KIND.truss, 1);

  // Legs, then the legs that share a spot along the deck become one tower: beams and a cap.
  const half = br.towerHalf ?? 25;
  const groups: Vec3[][] = [];
  for (const t of br.towers) {
    box(U(t), -30, V(t), half * 2, t.y + 30, half * 2, red, KIND.solid, 1);
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
    for (const y of [top - 70, deck.y + (top - deck.y) * 0.55, deck.y + 90]) box(u, y, mid, half * 1.2, 18, vb - va, red, KIND.solid, 1);
    box(u, top, mid, half * 2 + 10, 24, vb - va + half * 2 + 16, cap, KIND.solid, 1);
  }

  // Lamps along both edges (the City's bridge has its rails there instead: furniture.ts).
  if (!lamps) return;
  for (let u = u0 + 60; u < u1 - 30; u += 160) {
    for (const v of [v0 + 4, v1 - 4]) {
      box(u, deck.y, v, 3, 42, 3, C.ink, KIND.solid, 0, 1);
      box(u, deck.y + 42, v, 10, 10, 10, C.windowLit, KIND.solid, 0.5);
    }
  }
}

/** A point on a sagging cable (game-core's cablePoint). */
function cablePoint(c: Cable, t: number): Vec3 {
  return { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t - c.sag * 4 * t * (1 - t), z: c.a.z + (c.b.z - c.a.z) * t };
}

const BUNTING: RGB[] = [C.neonRed, C.windowLit, C.neonMint];

/**
 * A cable as a chain of segment boxes: bridge cables cream and inked with hangers to the deck,
 * arena lines paper with bunting, street wires as thin ink.
 */
function addCable(c: Cable, city: City, push: Push) {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z);
  const n = Math.max(3, Math.min(14, Math.round(len / (c.kind === "wire" ? 90 : 70))));
  const style =
    c.kind === "bridge"
      ? { w: 11, color: C.cable, hull: 0.45, lod: 0 }
      : c.kind === "arena"
        ? { w: 6, color: C.paper, hull: 0.6, lod: 0 }
        : { w: 2.5, color: C.ink, hull: 0, lod: 1 };
  const mid = cablePoint(c, 0.5);
  const ref = { x: mid.x, z: mid.z };
  for (let i = 0; i < n; i++) {
    const p = cablePoint(c, i / n);
    const q = cablePoint(c, (i + 1) / n);
    push({ x: p.x, y: p.y, z: p.z, to: q, w: style.w, h: 1, d: style.w, color: style.color, kind: KIND.solid, hull: style.hull, ref, lod: style.lod });
  }
  if (c.kind === "bridge" && city.bridge) {
    const deckY = city.bridge.deck.y;
    const count = Math.round(len / 46);
    for (let i = 1; i < count; i++) {
      const p = cablePoint(c, i / count);
      if (p.y - deckY < 30) continue;
      push({ x: p.x, y: deckY, z: p.z, w: 2.5, h: p.y - deckY, d: 2.5, color: C.cable, kind: KIND.solid, hull: 0, ref, lod: 1 });
    }
  }
  if (c.kind === "arena") {
    const count = Math.round(len / 60);
    const yaw = Math.atan2(c.b.x - c.a.x, c.b.z - c.a.z) + QUARTER;
    for (let i = 1; i < count; i++) {
      const p = cablePoint(c, i / count);
      push({ x: p.x, y: p.y - 24, z: p.z, w: 18, h: 22, d: 2, yaw, color: BUNTING[i % 3], kind: KIND.solid, hull: 0, ref, lod: 1 });
    }
  }
}
