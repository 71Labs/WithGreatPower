/**
 * The night's city, generated from the patrol seed: a 9 × 9 grid of blocks (600 units,
 * 180-unit streets) with 1–4 lots each, heights by district, setback tops, accent
 * buildings, rooftop props and cranes. The four stops are zones about 3,000 units apart:
 * fight arenas are cleared blocks with four tall corner towers around one flat roof, the
 * stage (ruleset 4; zone.stage), Doc's arena is a bridge
 * over a river cut along a grid line, and errands are a rooftop with the ally. The hero
 * starts on a central roof.
 *
 * Buildings are solid boxes: land on a roof, slide along a wall. Webs stick to what you can
 * see: a facade (its roof edge, or a point high on the wall face), and prop anchors
 * (antenna tips, water-tower rims, billboards, cranes, cables). CityIndex hashes all of it in
 * 256-unit cells for collision, anchor search and the camera's raycast.
 *
 * Deterministic: only the seeded Rng, + − × ÷ and Math.sqrt / Math.floor.
 */
import { BILLBOARDS } from "../rules/content";
import { ALLY_CAST } from "../rules/data";
import type { DistrictId, Stop } from "../rules/types";

import {
  ALLEY_MIN,
  ARENA_CEILING,
  BILLBOARD_H,
  BILLBOARD_LEGS,
  BLOCK,
  BRIDGE_ACROSS,
  BRIDGE_DECK,
  BRIDGE_HALF,
  BRIDGE_TOWER,
  CELL,
  COVERAGE_RISE,
  DECK_HALF,
  GRID,
  HERO_RADIUS,
  PITCH,
  RIVER_WIDTH,
  STAGE_H,
  STAGE_INSET,
  STAGE_TOWER,
  STREET,
  STREET_BOUNCE_TOP,
  STREET_Y,
  WATER_TOWER_TOP,
} from "./constants";
import type { Bridge, Building, Cable, City, Prop, PropAnchor, Vec3, Zone } from "./contract";
import { len2 } from "./dmath";
import { mix, Rng } from "./rng";

/* ------------------------------------------------------------------ grid helpers */

/** Low edge of block i along either axis. */
export const blockMin = (i: number) => i * PITCH;
export const blockCenter = (i: number) => i * PITCH + BLOCK / 2;
/** The centre line of the street between block i − 1 and block i. */
export const streetLine = (i: number) => i * PITCH - STREET / 2;
/** The block the grid starts the hero on. */
export const START_BLOCK = 4;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;

/** Facing in quarter turns as a unit xz vector: 0 → +z, 1 → +x, 2 → −z, 3 → −x. */
export const FACING_DIR: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** Height ranges and habits by district, so each part of town reads differently (from 2D). */
const DISTRICT_STYLE: Record<DistrictId, { lo: number; hi: number; cranes: number; billboards: number; brown: number; tower: number }> = {
  "sector-7": { lo: 200, hi: 470, cranes: 0.45, billboards: 0.3, brown: 0, tower: 0.1 },
  "mempool-market": { lo: 210, hi: 430, cranes: 0.1, billboards: 0.45, brown: 0.1, tower: 0.05 },
  "bridge-district": { lo: 200, hi: 420, cranes: 0.2, billboards: 0.25, brown: 0.15, tower: 0.1 },
  "queens-block": { lo: 170, hi: 320, cranes: 0.05, billboards: 0.2, brown: 0.7, tower: 0 },
  "validator-heights": { lo: 320, hi: 640, cranes: 0.25, billboards: 0.2, brown: 0, tower: 0.45 },
};

/** Where on a sagging cable a point falls, t in [0, 1]. */
export function cablePoint(c: Cable, t: number): Vec3 {
  return {
    x: c.a.x + (c.b.x - c.a.x) * t,
    y: c.a.y + (c.b.y - c.a.y) * t - c.sag * 4 * t * (1 - t),
    z: c.a.z + (c.b.z - c.a.z) * t,
  };
}

/* ------------------------------------------------------------------ zone layout */

interface ZonePlan {
  bx: number;
  bz: number;
  cx: number;
  cz: number;
}

/** The river runs along `runs` (so the bridge crosses along the other axis), centred on street line `line`. */
interface RiverPlan {
  runs: "x" | "z";
  line: number;
  c: number;
}

const isDoc = (s: Stop | undefined) => s?.kind === "fight" && s.villain === "doc-octochain";

function planRiver(rng: Rng, plans: ZonePlan[], docAt: number): RiverPlan | null {
  const p = plans[docAt];
  const opts: { runs: "x" | "z"; line: number }[] = [];
  for (const line of [p.bx, p.bx + 1]) if (line >= 1 && line <= GRID - 1) opts.push({ runs: "z", line });
  for (const line of [p.bz, p.bz + 1]) if (line >= 1 && line <= GRID - 1) opts.push({ runs: "x", line });
  // A seeded shuffle, so the river isn't always on the same side.
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = opts[i];
    opts[i] = opts[j];
    opts[j] = t;
  }
  for (const o of opts) {
    const along = (q: { bx: number; bz: number }) => (o.runs === "z" ? q.bx : q.bz);
    const hit = (q: { bx: number; bz: number }) => along(q) === o.line - 1 || along(q) === o.line;
    if (hit({ bx: START_BLOCK, bz: START_BLOCK })) continue;
    if (plans.some((q, i) => i !== docAt && hit(q))) continue;
    return { ...o, c: streetLine(o.line) };
  }
  return null;
}

/** Pick a block for each stop, about ZONE_SPACING from the one before, and a river for Doc. */
function planZones(rng: Rng, stops: Stop[]): { plans: ZonePlan[]; river: RiverPlan | null } {
  const docAt = stops.findIndex(isDoc);
  const s0 = blockCenter(START_BLOCK);
  for (let attempt = 0; attempt < 80; attempt++) {
    const loose = attempt >= 40;
    const plans: ZonePlan[] = [];
    let px = s0;
    let pz = s0;
    let ok = true;
    for (let k = 0; k < stops.length && ok; k++) {
      const cands: [number, number][] = [];
      for (let bz = 0; bz < GRID; bz++) {
        for (let bx = 0; bx < GRID; bx++) {
          if (bx === START_BLOCK && bz === START_BLOCK) continue;
          const cx = blockCenter(bx);
          const cz = blockCenter(bz);
          const d = len2(cx - px, cz - pz);
          if (d < (loose ? 2000 : 2500) || d > (loose ? 4200 : 3500)) continue;
          if (len2(cx - s0, cz - s0) < 1500) continue;
          if (plans.some((p) => len2(p.cx - cx, p.cz - cz) < (loose ? 1500 : 1900))) continue;
          cands.push([bx, bz]);
        }
      }
      if (!cands.length) {
        ok = false;
        break;
      }
      const [bx, bz] = rng.pick(cands);
      plans.push({ bx, bz, cx: blockCenter(bx), cz: blockCenter(bz) });
      px = blockCenter(bx);
      pz = blockCenter(bz);
    }
    if (!ok) continue;
    if (docAt < 0) return { plans, river: null };
    const river = planRiver(rng, plans, docAt);
    if (!river) continue;
    const p = plans[docAt];
    if (river.runs === "z") p.cx = river.c;
    else p.cz = river.c;
    return { plans, river };
  }
  // Fallback for unusual stop lists: a fixed ring around the start, river on the first fit.
  const ring: [number, number][] = [
    [8, 4],
    [4, 8],
    [0, 4],
    [4, 0],
    [8, 8],
    [0, 8],
    [0, 0],
    [8, 0],
  ];
  const plans = stops.map((_, k) => {
    const [bx, bz] = ring[k % ring.length];
    return { bx, bz, cx: blockCenter(bx), cz: blockCenter(bz) };
  });
  let river: RiverPlan | null = null;
  if (docAt >= 0) {
    const p = plans[docAt];
    const line = p.bx >= GRID - 1 ? p.bx : p.bx + 1;
    river = { runs: "z", line, c: streetLine(line) };
    p.cx = river.c;
  }
  return { plans, river };
}

/* ------------------------------------------------------------------ generation */

export interface CityOptions {
  /**
   * Case File 001: the bridge deck's half width, wider than a patrol's DECK_HALF so the
   * standoff has room to sidestep a SCREENSHOT. Unset (every patrol night): DECK_HALF.
   */
  deckHalf?: number;
}

export function generateCity(seed: number, stops: Stop[], opts: CityOptions = {}): City {
  const rng = new Rng(mix(seed, 0x3d1c17));
  const { plans, river: rp } = planZones(rng, stops);
  const buildings: Building[] = [];
  const props: Prop[] = [];
  const anchors: PropAnchor[] = [];
  const cables: Cable[] = [];
  const bounds = { x0: -STREET, z0: -STREET, x1: GRID * PITCH, z1: GRID * PITCH };

  const river: City["river"] = rp
    ? rp.runs === "z"
      ? { x0: rp.c - RIVER_WIDTH / 2, z0: bounds.z0, x1: rp.c + RIVER_WIDTH / 2, z1: bounds.z1 }
      : { x0: bounds.x0, z0: rp.c - RIVER_WIDTH / 2, x1: bounds.x1, z1: rp.c + RIVER_WIDTH / 2 }
    : null;

  /** A block's usable rectangle, trimmed where the river eats into it. */
  const blockRect = (bx: number, bz: number): Rect => {
    const r = { x0: blockMin(bx), z0: blockMin(bz), x1: blockMin(bx) + BLOCK, z1: blockMin(bz) + BLOCK };
    if (river) {
      if (rp!.runs === "z") {
        if (bx === rp!.line - 1) r.x1 = river.x0;
        if (bx === rp!.line) r.x0 = river.x1;
      } else {
        if (bz === rp!.line - 1) r.z1 = river.z0;
        if (bz === rp!.line) r.z0 = river.z1;
      }
    }
    return r;
  };

  const districtAt = (x: number, z: number): DistrictId => {
    let best: DistrictId = "queens-block";
    let bestD = Infinity;
    plans.forEach((p, i) => {
      const d = len2(p.cx - x, p.cz - z);
      if (d < bestD) {
        bestD = d;
        best = stops[i].district;
      }
    });
    return best;
  };

  let nextId = 0;
  const blockOf: number[][] = Array.from({ length: GRID * GRID }, () => []);
  const addBuilding = (r: Rect, h: number, district: DistrictId, opts: { top?: Building["top"]; accent?: boolean; block?: number } = {}): Building => {
    const id = nextId++;
    const b: Building = {
      id,
      x0: r.x0,
      z0: r.z0,
      x1: r.x1,
      z1: r.z1,
      h,
      top: opts.top ?? null,
      district,
      tone: rng.int(0, 3),
      accent: opts.accent ?? rng.chance(district === "queens-block" ? 0.35 : 0.12),
      seed: mix(seed, 0xb17d + (id + 1) * 7919),
    };
    buildings.push(b);
    if (opts.block !== undefined) blockOf[opts.block].push(id);
    return b;
  };

  const addProp = (p: Prop) => {
    props.push(p);
    const { x, y, z } = p.at;
    switch (p.kind) {
      case "water-tower":
        anchors.push({ at: { x, y: y + WATER_TOWER_TOP, z }, kind: "tower" });
        break;
      case "antenna":
        anchors.push({ at: { x, y: y + p.h, z }, kind: "antenna" });
        break;
      case "billboard": {
        const top = y + BILLBOARD_LEGS + BILLBOARD_H;
        const half = p.w / 2 - 8;
        const [fx, fz] = FACING_DIR[p.facing];
        // The board spans perpendicular to the way it faces.
        anchors.push({ at: { x: x - fz * half, y: top, z: z - fx * half }, kind: "billboard" }, { at: { x: x + fz * half, y: top, z: z + fx * half }, kind: "billboard" });
        break;
      }
      case "crane": {
        const [fx, fz] = FACING_DIR[p.facing];
        anchors.push(
          { at: { x, y: p.h + 20, z }, kind: "crane" },
          { at: { x: x + fx * p.w, y: p.h - 4, z: z + fz * p.w }, kind: "crane" },
          { at: { x: x + fx * p.w * 0.55, y: p.h - 4, z: z + fz * p.w * 0.55 }, kind: "crane" },
        );
        break;
      }
    }
  };

  /**
   * Spots that stay clear of props: the hero's start, each zone's centre, and each ally with
   * the ring the hero is stood on beside them (v2: an AC unit used to sit inside the hero).
   */
  const keepClear: { x: number; z: number; r: number }[] = [];
  const clearOf = (x: number, z: number, half: number) => keepClear.every((k) => len2(x - k.x, z - k.z) >= k.r + half);

  // v2: rooftop antennas read as antennas beside the ~88-tall hero (v1: 130–230 tall, 8 wide).
  const antenna = (x: number, y: number, z: number, h: number, buildingId: number | null) => {
    if (clearOf(x, z, 12)) addProp({ kind: "antenna", at: { x, y, z }, facing: 0, w: 4, h, d: 4, buildingId });
  };
  const waterTower = (x: number, y: number, z: number, buildingId: number | null) => {
    if (clearOf(x, z, 40)) addProp({ kind: "water-tower", at: { x, y, z }, facing: 0, w: 70, h: WATER_TOWER_TOP, d: 70, buildingId });
  };
  const ac = (x: number, y: number, z: number, w: number, buildingId: number | null) => {
    if (clearOf(x, z, w * 0.75)) addProp({ kind: "ac", at: { x, y, z }, facing: 0, w, h: 24, d: w, buildingId });
  };

  /** Rooftop clutter and one tall thing a web can reach (the 2D decorate, in xz). */
  const decorate = (b: Building, d: (typeof DISTRICT_STYLE)[DistrictId], style: string) => {
    const roof: Rect = b.top ?? b;
    const roofY = b.top ? b.top.h : b.h;
    const rw = roof.x1 - roof.x0;
    const rd = roof.z1 - roof.z0;
    const at = (fx: number, fz: number) => [roof.x0 + rw * fx, roof.z0 + rd * fz] as const;
    const tall = rng.next();
    if (style === "tower" || tall < 0.34) {
      const [x, z] = at(rng.range(0.3, 0.7), rng.range(0.3, 0.7));
      antenna(x, roofY, z, rng.range(70, 120), b.id);
    } else if (tall < 0.7) {
      const [x, z] = at(rng.range(0.3, 0.7), rng.range(0.3, 0.7));
      waterTower(x, roofY, z, b.id);
    } else if (Math.max(rw, rd) > 170 && rng.chance(0.4 + d.billboards)) {
      // Face the nearer street: along the longer roof side, toward its outside.
      const alongX = rw >= rd;
      const len = alongX ? rw : rd;
      const w = Math.min(len - 30, rng.range(130, 190));
      const side = rng.chance(0.5) ? 1 : -1;
      const facing = (alongX ? (side > 0 ? 0 : 2) : side > 0 ? 1 : 3) as 0 | 1 | 2 | 3;
      const cx = (roof.x0 + roof.x1) / 2;
      const cz = (roof.z0 + roof.z1) / 2;
      const x = alongX ? cx : side > 0 ? roof.x1 - 20 : roof.x0 + 20;
      const z = alongX ? (side > 0 ? roof.z1 - 20 : roof.z0 + 20) : cz;
      addProp({ kind: "billboard", at: { x, y: roofY, z }, facing, text: rng.pick(BILLBOARDS), w, h: BILLBOARD_H, d: 8, buildingId: b.id });
    } else {
      const [x, z] = at(rng.range(0.25, 0.75), rng.range(0.25, 0.75));
      antenna(x, roofY, z, rng.range(70, 110), b.id);
    }
    // A lower roof gets clutter too.
    const acCount = rng.int(0, 2);
    for (let i = 0; i < acCount; i++) {
      const onLower = !!b.top && rng.chance(0.6);
      const r: Rect = onLower ? b : roof;
      const y = onLower ? b.h : roofY;
      const w = rng.range(28, 44);
      const x = r.x0 + 14 + rng.next() * Math.max(0, r.x1 - r.x0 - 28 - w) + w / 2;
      const z = r.z0 + 14 + rng.next() * Math.max(0, r.z1 - r.z0 - 28 - w) + w / 2;
      if (onLower && b.top && x > b.top.x0 - w && x < b.top.x1 + w && z > b.top.z0 - w && z < b.top.z1 + w) continue;
      if (!props.some((p) => p.buildingId === b.id && p.at.y === y && len2(p.at.x - x, p.at.z - z) < 50)) ac(x, y, z, w, b.id);
    }
    if (rng.chance(0.4)) {
      const x = roof.x0 + 12 + rng.next() * Math.max(0, rw - 24);
      const z = roof.z0 + 12 + rng.next() * Math.max(0, rd - 24);
      if (clearOf(x, z, 12)) addProp({ kind: "vent", at: { x, y: roofY, z }, facing: 0, w: 16, h: 30, d: 16, buildingId: b.id });
    }
  };

  /** Split a block into 1–4 lots, with shared walls or alleys at least ALLEY_MIN wide. */
  const subdivide = (r: Rect): Rect[] => {
    const inner = { x0: r.x0 + 12, z0: r.z0 + 12, x1: r.x1 - 12, z1: r.z1 - 12 };
    const split = (q: Rect, alongX: boolean): [Rect, Rect] => {
      const a = alongX ? q.x0 : q.z0;
      const b = alongX ? q.x1 : q.z1;
      const s = a + (b - a) * rng.range(0.35, 0.65);
      // Flush, or an alley wide enough to fall through: never a crack the hero could wedge in.
      const gap = rng.chance(0.5) ? 0 : rng.range(ALLEY_MIN, ALLEY_MIN + 40);
      if (alongX) return [{ ...q, x1: s - gap / 2 }, { ...q, x0: s + gap / 2 }];
      return [{ ...q, z1: s - gap / 2 }, { ...q, z0: s + gap / 2 }];
    };
    const roll = rng.next();
    const n = roll < 0.15 ? 1 : roll < 0.45 ? 2 : roll < 0.75 ? 3 : 4;
    const longX = inner.x1 - inner.x0 >= inner.z1 - inner.z0;
    if (n === 1) return [inner];
    const [a, b] = split(inner, longX);
    if (n === 2) return [a, b];
    if (n === 3) return rng.chance(0.5) ? [a, ...split(b, !longX)] : [...split(a, !longX), b];
    return [...split(a, !longX), ...split(b, !longX)];
  };

  /** Ordinary city: lots with buildings, or now and then a construction site with a crane. */
  const fillBlock = (bx: number, bz: number, avoid: Rect[]) => {
    const r = blockRect(bx, bz);
    const bi = bz * GRID + bx;
    let firstH = -1;
    for (const lot of subdivide(r)) {
      if (lot.x1 - lot.x0 < 90 || lot.z1 - lot.z0 < 90) continue;
      const cx = (lot.x0 + lot.x1) / 2;
      const cz = (lot.z0 + lot.z1) / 2;
      const district = districtAt(cx, cz);
      const d = DISTRICT_STYLE[district];
      if (avoid.some((a) => overlaps(a, lot))) continue;
      if (rng.chance(d.cranes * 0.25) && lot.x1 - lot.x0 > 160 && lot.z1 - lot.z0 > 160) {
        addProp({ kind: "crane", at: { x: cx, y: STREET_Y, z: cz }, facing: rng.int(0, 3) as 0 | 1 | 2 | 3, w: rng.range(200, 260), h: rng.range(600, 760), d: 30, buildingId: null });
        continue;
      }
      const fp = lot;
      const brown = rng.chance(d.brown);
      const tower = !brown && rng.chance(d.tower);
      let h = rng.range(d.lo, d.hi);
      if (tower) h = Math.min(720, h + rng.range(80, 180));
      if (brown) h = rng.range(170, 300);
      // No cliff walls inside a block: lots stay within reach of each other.
      if (firstH < 0) firstH = h;
      else h = Math.max(firstH - 260, Math.min(firstH + 260, h));
      const style = brown ? "brownstone" : tower ? "tower" : rng.chance(0.3) ? "setback" : rng.chance(0.2) ? "stepped" : "flat";
      let top: Building["top"] = null;
      const w = fp.x1 - fp.x0;
      const dd = fp.z1 - fp.z0;
      if (style === "setback" || style === "tower") {
        const tw = w * rng.range(0.5, 0.72);
        const td = dd * rng.range(0.5, 0.72);
        const tx = fp.x0 + (w - tw) / 2;
        const tz = fp.z0 + (dd - td) / 2;
        top = { x0: tx, z0: tz, x1: tx + tw, z1: tz + td, h: h + rng.range(60, 150) };
      } else if (style === "stepped") {
        const alongX = rng.chance(0.5);
        const f = rng.range(0.45, 0.6);
        const low = rng.chance(0.5);
        if (alongX) {
          const tw = w * f;
          top = { x0: low ? fp.x0 : fp.x1 - tw, z0: fp.z0, x1: low ? fp.x0 + tw : fp.x1, z1: fp.z1, h: h + rng.range(50, 110) };
        } else {
          const td = dd * f;
          top = { x0: fp.x0, z0: low ? fp.z0 : fp.z1 - td, x1: fp.x1, z1: low ? fp.z0 + td : fp.z1, h: h + rng.range(50, 110) };
        }
      }
      const b = addBuilding(fp, h, district, { top, block: bi });
      decorate(b, d, style);
    }
  };

  /* ---------------------------------------------------------------- zones */

  const used = new Set<number>();
  const zones: Zone[] = [];
  let bridge: Bridge | null = null;
  const docAvoid: Rect[] = [];

  // The launch roof: a central building with a water tower, a plaza around it.
  const s0 = blockCenter(START_BLOCK);
  used.add(START_BLOCK * GRID + START_BLOCK);
  keepClear.push({ x: s0 - 70, z: s0, r: 90 });
  for (let k = 0; k < stops.length; k++) {
    const p = plans[k];
    keepClear.push({ x: p.cx, z: p.cz, r: 90 });
  }
  {
    const district = districtAt(s0, s0);
    const b = addBuilding({ x0: s0 - 220, z0: s0 - 220, x1: s0 + 220, z1: s0 + 220 }, 300, district, { accent: false, block: START_BLOCK * GRID + START_BLOCK });
    waterTower(s0 + 110, 300, s0, b.id);
    ac(s0 - 160, 300, s0 + 120, 38, b.id);
    antenna(s0 - 120, 300, s0 - 150, 110, b.id);
  }

  stops.forEach((stop, index) => {
    const p = plans[index];
    const district = stop.district;
    const bi = p.bz * GRID + p.bx;
    if (stop.kind === "errand") {
      used.add(bi);
      const r = blockRect(p.bx, p.bz);
      const roofH = 310;
      const b = addBuilding({ x0: r.x0 + 40, z0: r.z0 + 40, x1: r.x1 - 40, z1: r.z1 - 40 }, roofH, district, { block: bi });
      const allyId = ALLY_CAST[stop.ally];
      let allyAt: Vec3;
      if (allyId === "gwei") {
        // She stands on the tower, so it goes up whatever is kept clear.
        addProp({ kind: "water-tower", at: { x: p.cx + 40, y: roofH, z: p.cz }, facing: 0, w: 70, h: WATER_TOWER_TOP, d: 70, buildingId: b.id });
        allyAt = { x: p.cx + 40, y: roofH + WATER_TOWER_TOP, z: p.cz };
        keepClear.push({ x: allyAt.x, z: allyAt.z, r: 120 + HERO_RADIUS + 24 });
        antenna(p.cx - 160, roofH, p.cz - 40, 110, b.id);
      } else {
        allyAt = { x: p.cx + 30, y: roofH, z: p.cz };
        // The hero is stood 120 from the ally, on whichever side he came from.
        keepClear.push({ x: allyAt.x, z: allyAt.z, r: 120 + HERO_RADIUS + 24 });
        antenna(p.cx - 150, roofH, p.cz - 100, 110, b.id);
        ac(p.cx + 200, roofH, p.cz + 170, 36, b.id);
      }
      // Corner masts so the roof can be reached from any side.
      antenna(b.x0 + 30, roofH, b.z0 + 30, 120, b.id);
      antenna(b.x1 - 30, roofH, b.z1 - 30, 120, b.id);
      zones.push({
        index,
        kind: "errand",
        district,
        center: { x: p.cx, y: roofH, z: p.cz },
        bounds: { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: roofH },
        villain: null,
        ally: stop.ally,
        allyAt,
      });
      return;
    }
    // v4: one bridge a night (a second Doc fight, which only tests ask for, gets a rooftop).
    if (isDoc(stop) && rp && !bridge) {
      // Doc's bridge across the river, his arena along it.
      const alongX = rp.runs === "z";
      const c = rp.c;
      const across = alongX ? p.cz : p.cx;
      const deckY = 200;
      const towerTop = 790;
      const half = 25;
      const box = (u0: number, u1: number, v0: number, v1: number): Rect =>
        alongX ? { x0: c + u0, x1: c + u1, z0: across + v0, z1: across + v1 } : { x0: across + v0, x1: across + v1, z0: c + u0, z1: c + u1 };
      const D = BRIDGE_DECK;
      const U = BRIDGE_TOWER;
      // v4: a wider deck (DECK_HALF either side; v3: 90), so a fight has room to sidestep.
      const W = opts.deckHalf ?? DECK_HALF;
      const deck = box(-D, D, -W, W);
      const towers: Vec3[] = [];
      // Legs flush against the deck's sides, so nothing can wedge between them; v2 stands
      // them beyond the reach of Doc's arms, so the fight has room.
      for (const u of [-U, U]) {
        for (const v of [-W - half, W + half]) {
          const t = box(u - half, u + half, v - half, v + half);
          towers.push({ x: (t.x0 + t.x1) / 2, y: towerTop, z: (t.z0 + t.z1) / 2 });
        }
      }
      bridge = { deck: { ...deck, y: deckY }, towers, axis: alongX ? "x" : "z", towerHalf: half };
      const pt = (u: number, y: number, v: number): Vec3 => (alongX ? { x: c + u, y, z: across + v } : { x: across + v, y, z: c + u });
      for (const v of [-W - half, W + half]) {
        cables.push(
          { a: pt(-(D - 20), deckY + 30, v), b: pt(-U, towerTop, v), sag: 40, kind: "bridge" },
          { a: pt(-U, towerTop, v), b: pt(U, towerTop, v), sag: 390, kind: "bridge" },
          { a: pt(U, towerTop, v), b: pt(D - 20, deckY + 30, v), sag: 40, kind: "bridge" },
        );
      }
      for (const t of towers) anchors.push({ at: { x: t.x, y: towerTop + 8, z: t.z }, kind: "tower" });
      const arena = box(-BRIDGE_HALF, BRIDGE_HALF, -BRIDGE_ACROSS, BRIDGE_ACROSS);
      // The lots kept clear around the deck are ruleset 3's (a 90-wide deck and 60 more), so the
      // rest of the city is unchanged; the arena's own margin covers the wider deck's legs. A
      // chapter's wider deck keeps its whole width clear, out to its ends.
      const keep = opts.deckHalf === undefined ? 90 + 60 : W + 60;
      const clear = box(-D - 60, D + 60, -keep, keep);
      docAvoid.push({ x0: arena.x0 - 20, z0: arena.z0 - 20, x1: arena.x1 + 20, z1: arena.z1 + 20 }, clear);
      zones.push({
        index,
        kind: "fight",
        district,
        center: alongX ? { x: c, y: deckY, z: across } : { x: across, y: deckY, z: c },
        bounds: { ...arena, h: ARENA_CEILING },
        villain: "doc-octochain",
        ally: null,
        allyAt: null,
        // The deck between his towers is the stage.
        stage: { ...box(-BRIDGE_HALF, BRIDGE_HALF, -W, W), y: deckY },
      });
      return;
    }
    // A fight arena: the block cleared, four tall towers at its corners, and between them one
    // flat roof, the stage (v4; v3 had five low roofs at four heights with alleys between).
    used.add(bi);
    const r = blockRect(p.bx, p.bz);
    const T = STAGE_TOWER;
    const H = 780;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const st: Rect = { x0: r.x0 + STAGE_INSET, z0: r.z0 + STAGE_INSET, x1: r.x1 - STAGE_INSET, z1: r.z1 - STAGE_INSET };
    // The towers stand on the stage's corners, flush with its sides: no pocket to wedge in.
    const corners: [number, number][] = [
      [st.x0, st.z0],
      [st.x1 - T, st.z0],
      [st.x0, st.z1 - T],
      [st.x1 - T, st.z1 - T],
    ];
    const inner: Vec3[] = [];
    for (const [x0, z0] of corners) {
      const t = addBuilding({ x0, z0, x1: x0 + T, z1: z0 + T }, H, district, { accent: false, block: bi });
      const ox = x0 < cx ? 1 : -1;
      const oz = z0 < cz ? 1 : -1;
      // An antenna at the outer corner. The towers' faces take webs anywhere up their walls
      // (v2; v1 hung invisible "flagpole" anchors 34 out from them).
      antenna(x0 + T / 2 - ox * 25, H, z0 + T / 2 - oz * 25, 90, t.id);
      const fx = ox > 0 ? x0 + T : x0;
      const fz = oz > 0 ? z0 + T : z0;
      inner.push({ x: fx, y: 680, z: fz });
    }
    // The stage itself: a cross of three roofs at one height, flush, between the towers (so no
    // box overlaps another). The middle stays bare; a little roof clutter sits by the towers.
    const stage: Rect[] = [
      { x0: st.x0 + T, z0: st.z0, x1: st.x1 - T, z1: st.z1 },
      { x0: st.x0, z0: st.z0 + T, x1: st.x0 + T, z1: st.z1 - T },
      { x0: st.x1 - T, z0: st.z0 + T, x1: st.x1, z1: st.z1 - T },
    ];
    const stageIds = stage.map((sr) => addBuilding(sr, STAGE_H, district, { accent: false, block: bi }).id);
    // Ruleset 3's five low roofs drew 20 times from the stream, the towers and the stage 7: draw
    // the rest, so the city outside the arenas comes out exactly as it did.
    for (let k = 0; k < 13; k++) rng.next();
    for (const [k, [x0, z0]] of corners.entries()) {
      if (k % 3 !== 0) continue;
      const ox = x0 < cx ? 1 : -1;
      const oz = z0 < cz ? 1 : -1;
      ac(x0 + T / 2 + ox * (T / 2 + 26), STAGE_H, z0 + T / 2 + oz * 22, 30, stageIds[0]);
    }
    // Lines between the towers: the four sides and both diagonals.
    const [a, b, c2, d2] = inner;
    for (const [p0, p1] of [
      [a, b],
      [c2, d2],
      [a, c2],
      [b, d2],
      [a, d2],
      [b, c2],
    ] as [Vec3, Vec3][]) {
      cables.push({ a: p0, b: p1, sag: 80, kind: "arena" });
    }
    zones.push({
      index,
      kind: "fight",
      district,
      center: { x: cx, y: STAGE_H, z: cz },
      bounds: { x0: r.x0 - STREET / 2, z0: r.z0 - STREET / 2, x1: r.x1 + STREET / 2, z1: r.z1 + STREET / 2, h: ARENA_CEILING },
      villain: stop.kind === "fight" ? stop.villain : null,
      ally: null,
      allyAt: null,
      stage: { ...st, y: STAGE_H },
    });
  });

  // Everything else is ordinary city.
  for (let bz = 0; bz < GRID; bz++) for (let bx = 0; bx < GRID; bx++) if (!used.has(bz * GRID + bx)) fillBlock(bx, bz, docAvoid);

  /* ---------------------------------------------------------------- wires across streets */

  const arenaBlock = new Set(plans.filter((_, i) => stops[i].kind === "fight" && !isDoc(stops[i])).map((p) => p.bz * GRID + p.bx));
  const riverLine = (alongZ: boolean, line: number) => !!rp && rp.line === line && (rp.runs === "z") === alongZ;
  for (let bz = 0; bz < GRID; bz++) {
    for (let bx = 0; bx < GRID; bx++) {
      for (const alongZ of [true, false]) {
        // alongZ: the street east of block (bx, bz), running along z; else the street north of it.
        const nx = alongZ ? bx + 1 : bx;
        const nz = alongZ ? bz : bz + 1;
        if (nx >= GRID || nz >= GRID) continue;
        const a = bz * GRID + bx;
        const b = nz * GRID + nx;
        if (arenaBlock.has(a) || arenaBlock.has(b)) continue;
        const wet = riverLine(alongZ, alongZ ? nx : nz);
        if (!wet && !rng.chance(0.45)) continue;
        const u = blockCenter(alongZ ? bz : bx) + rng.range(-160, 160);
        let near: Building | null = null;
        let far: Building | null = null;
        for (const id of blockOf[a]) {
          const q = buildings[id];
          const lo = alongZ ? q.z0 : q.x0;
          const hi = alongZ ? q.z1 : q.x1;
          if (u < lo + 20 || u > hi - 20) continue;
          if (!near || (alongZ ? q.x1 > near.x1 : q.z1 > near.z1)) near = q;
        }
        for (const id of blockOf[b]) {
          const q = buildings[id];
          const lo = alongZ ? q.z0 : q.x0;
          const hi = alongZ ? q.z1 : q.x1;
          if (u < lo + 20 || u > hi - 20) continue;
          if (!far || (alongZ ? q.x0 < far.x0 : q.z0 < far.z0)) far = q;
        }
        if (!near || !far) continue;
        const gap = alongZ ? far.x0 - near.x1 : far.z0 - near.z1;
        if (gap > (wet ? 560 : 420) || near.h < 120 || far.h < 120) continue;
        const ya = near.h + rng.range(70, 120);
        const yb = far.h + rng.range(70, 120);
        cables.push(
          alongZ
            ? { a: { x: near.x1 - 12, y: ya, z: u }, b: { x: far.x0 + 12, y: yb, z: u }, sag: rng.range(16, 34), kind: "wire" }
            : { a: { x: u, y: ya, z: near.z1 - 12 }, b: { x: u, y: yb, z: far.z0 + 12 }, sag: rng.range(16, 34), kind: "wire" },
        );
      }
    }
  }

  for (const c of cables) {
    const len = Math.sqrt((c.b.x - c.a.x) * (c.b.x - c.a.x) + (c.b.y - c.a.y) * (c.b.y - c.a.y) + (c.b.z - c.a.z) * (c.b.z - c.a.z));
    const step = c.kind === "wire" ? 60 : 105;
    const n = Math.max(1, Math.floor(len / step + 0.5));
    const inset = c.kind === "wire" ? 1 : 0;
    for (let k = inset; k <= n - inset; k++) {
      const at = cablePoint(c, k / n);
      if (c.kind === "bridge" && at.y < 290) continue;
      anchors.push({ at, kind: "cable" });
    }
  }

  const city: City = {
    seed,
    bounds,
    buildings,
    props,
    anchors,
    zones,
    river,
    bridge,
    start: { x: s0 - 70, y: 300, z: s0 },
    cables,
  };

  // Coverage: every roof needs something above it within reach. Add a mast where there isn't.
  const grid = new CityIndex(city);
  for (const b of buildings) {
    const tiers: [Rect, number][] = b.top ? [[b, b.h], [b.top, b.top.h]] : [[b, b.h]];
    for (const [r, y] of tiers) {
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      const pts: [number, number][] = [
        [cx, cz],
        [r.x0 + 30, r.z0 + 30],
        [r.x1 - 30, r.z0 + 30],
        [r.x0 + 30, r.z1 - 30],
        [r.x1 - 30, r.z1 - 30],
      ];
      for (const [px, pz] of pts) {
        if (b.top && r === b && px > b.top.x0 && px < b.top.x1 && pz > b.top.z0 && pz < b.top.z1) continue;
        if (grid.hasAnchor(px, y + HERO_RADIUS, pz, COVERAGE_RISE)) continue;
        const dx = cx - px;
        const dz = cz - pz;
        const d = len2(dx, dz) || 1;
        const k = Math.min(120, d);
        let ax = Math.max(r.x0 + 14, Math.min(r.x1 - 14, px + (dx / d) * k));
        let az = Math.max(r.z0 + 14, Math.min(r.z1 - 14, pz + (dz / d) * k));
        // Off a kept-clear spot: back toward the sample point.
        if (!clearOf(ax, az, 12)) {
          ax = Math.max(r.x0 + 14, Math.min(r.x1 - 14, px));
          az = Math.max(r.z0 + 14, Math.min(r.z1 - 14, pz));
        }
        const n = props.length;
        antenna(ax, y, az, 150, b.id);
        if (props.length > n) grid.addAnchor(anchors[anchors.length - 1]);
      }
    }
  }
  // Streets too: from the top of a miss's bounce there must be something to web. Facades
  // take webs up their walls, so this only adds a mast where no wall is tall enough nearby.
  const bounceY = STREET_BOUNCE_TOP;
  for (let line = 0; line <= GRID; line++) {
    const c = line === 0 ? -STREET / 2 : streetLine(line);
    for (let u = bounds.x0 + 60; u < bounds.x1 - 60; u += 120) {
      for (const alongX of [true, false]) {
        const px = alongX ? u : c;
        const pz = alongX ? c : u;
        if (river && px >= river.x0 && px <= river.x1 && pz >= river.z0 && pz <= river.z1) continue;
        if (grid.hasAnchor(px, bounceY, pz)) continue;
        const a: PropAnchor = { at: { x: px, y: 330, z: pz }, kind: "antenna" };
        props.push({ kind: "antenna", at: { x: px, y: STREET_Y, z: pz }, facing: 0, w: 6, h: 330, d: 6, buildingId: null });
        anchors.push(a);
        grid.addAnchor(a);
      }
    }
  }
  return city;
}

/* ------------------------------------------------------------------ the spatial index */

/** A solid axis-aligned box: a building's main block or setback tier, the bridge deck or a tower leg. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** The building it belongs to, or −1 for the bridge. */
  building: number;
  kind: "main" | "top" | "deck" | "leg";
}

/**
 * A facade a web can stick to: the exposed part of one side of a box, from its roof edge at
 * `y` down to `y0` (the street, or the top of a flush lower neighbour). Webs hit it exactly:
 * on the roof edge, or a point on the wall face (v2; v1 floated the anchor on a cornice 30
 * out and 10 up). axis 0 runs along x at z = c; axis 1 runs along z at x = c. `n` is the
 * outward side (+1 or −1 along the other axis): only a hero beyond the facade on that side
 * may use it (so a hero pressed against a wall can web its top edge).
 */
export interface RoofEdge {
  axis: 0 | 1;
  /** The facade plane. */
  c: number;
  /** The same plane (kept for v1 readers). */
  face: number;
  lo: number;
  hi: number;
  /** The roof edge's height. */
  y: number;
  /** The lowest exposed height of the wall face. */
  y0: number;
  n: 1 | -1;
  building: number;
}

/** A uniform hash of 256-unit cells over the city: boxes, roof edges and prop anchors. */
export class CityIndex {
  readonly boxes: Box[] = [];
  readonly edges: RoofEdge[] = [];
  readonly anchors: PropAnchor[] = [];
  readonly ox: number;
  readonly oz: number;
  readonly nx: number;
  readonly nz: number;
  private boxCells: number[][];
  private edgeCells: number[][];
  private anchorCells: number[][];
  private boxSeen: number[] = [];
  private edgeSeen: number[] = [];
  private anchorSeen: number[] = [];
  private stamp = 0;

  constructor(readonly city: City) {
    const m = 512;
    this.ox = city.bounds.x0 - m;
    this.oz = city.bounds.z0 - m;
    this.nx = Math.floor((city.bounds.x1 + m - this.ox) / CELL) + 1;
    this.nz = Math.floor((city.bounds.z1 + m - this.oz) / CELL) + 1;
    const n = this.nx * this.nz;
    this.boxCells = Array.from({ length: n }, () => []);
    this.edgeCells = Array.from({ length: n }, () => []);
    this.anchorCells = Array.from({ length: n }, () => []);

    for (const b of city.buildings) {
      this.addBox({ x0: b.x0, y0: STREET_Y, z0: b.z0, x1: b.x1, y1: b.h, z1: b.z1, building: b.id, kind: "main" });
      if (b.top) this.addBox({ x0: b.top.x0, y0: b.h, z0: b.top.z0, x1: b.top.x1, y1: b.top.h, z1: b.top.z1, building: b.id, kind: "top" });
    }
    const br = city.bridge;
    if (br) {
      this.addBox({ x0: br.deck.x0, y0: br.deck.y - 24, z0: br.deck.z0, x1: br.deck.x1, y1: br.deck.y, z1: br.deck.z1, building: -1, kind: "deck" });
      const h = br.towerHalf ?? 25;
      for (const t of br.towers) this.addBox({ x0: t.x - h, y0: STREET_Y, z0: t.z - h, x1: t.x + h, y1: t.y, z1: t.z + h, building: -1, kind: "leg" });
    }
    // Facades: each side of each box, minus any stretch buried in a neighbour at roof height;
    // the wall face below is exposed down to the street or the tallest flush lower neighbour.
    const scratch: number[] = [];
    const nb = this.boxes.length;
    for (let i = 0; i < nb; i++) {
      const b = this.boxes[i];
      if (b.kind !== "main" && b.kind !== "top") continue;
      const y = b.y1;
      const sides: [0 | 1, number, number, number, 1 | -1][] = [
        [0, b.z0, b.x0, b.x1, -1],
        [0, b.z1, b.x0, b.x1, 1],
        [1, b.x0, b.z0, b.z1, -1],
        [1, b.x1, b.z0, b.z1, 1],
      ];
      for (const [axis, c, lo, hi, n] of sides) {
        let spans: [number, number][] = [[lo, hi]];
        // A neighbour covers the facade where it fills the space just outside it.
        const probe = c + n;
        const q = axis === 0 ? this.queryBoxes(lo, probe - 1, hi, probe + 1, scratch) : this.queryBoxes(probe - 1, lo, probe + 1, hi, scratch);
        const lower: Box[] = [];
        for (let k = 0; k < q; k++) {
          const o = this.boxes[scratch[k]];
          if (scratch[k] === i) continue;
          const inPerp = axis === 0 ? probe > o.z0 && probe < o.z1 : probe > o.x0 && probe < o.x1;
          if (!inPerp) continue;
          if (y < o.y0 || y > o.y1) {
            if (o.y1 < y) lower.push(o);
            continue;
          }
          const olo = axis === 0 ? o.x0 : o.z0;
          const ohi = axis === 0 ? o.x1 : o.z1;
          const next: [number, number][] = [];
          for (const [s0, s1] of spans) {
            if (ohi <= s0 || olo >= s1) next.push([s0, s1]);
            else {
              if (olo > s0) next.push([s0, olo]);
              if (ohi < s1) next.push([ohi, s1]);
            }
          }
          spans = next;
        }
        for (const [s0, s1] of spans) {
          if (s1 - s0 < 40) continue;
          // A tier's own wall starts at the roof it stands on (inside the main box, which the probe misses).
          let y0 = b.kind === "top" ? b.y0 : STREET_Y;
          for (const o of lower) {
            const olo = axis === 0 ? o.x0 : o.z0;
            const ohi = axis === 0 ? o.x1 : o.z1;
            if (ohi > s0 && olo < s1 && o.y1 > y0) y0 = o.y1;
          }
          this.addEdge({ axis, c, face: c, lo: s0, hi: s1, y, y0, n, building: b.building });
        }
      }
    }
    for (const a of city.anchors) this.addAnchor(a);
  }

  private cellRange(x0: number, z0: number, x1: number, z1: number): [number, number, number, number] {
    const cx0 = Math.max(0, Math.min(this.nx - 1, Math.floor((x0 - this.ox) / CELL)));
    const cz0 = Math.max(0, Math.min(this.nz - 1, Math.floor((z0 - this.oz) / CELL)));
    const cx1 = Math.max(0, Math.min(this.nx - 1, Math.floor((x1 - this.ox) / CELL)));
    const cz1 = Math.max(0, Math.min(this.nz - 1, Math.floor((z1 - this.oz) / CELL)));
    return [cx0, cz0, cx1, cz1];
  }

  private insert(cells: number[][], id: number, x0: number, z0: number, x1: number, z1: number) {
    const [cx0, cz0, cx1, cz1] = this.cellRange(x0, z0, x1, z1);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) cells[cz * this.nx + cx].push(id);
  }

  private addBox(b: Box) {
    this.boxes.push(b);
    this.boxSeen.push(0);
    this.insert(this.boxCells, this.boxes.length - 1, b.x0, b.z0, b.x1, b.z1);
  }

  private addEdge(e: RoofEdge) {
    this.edges.push(e);
    this.edgeSeen.push(0);
    const id = this.edges.length - 1;
    if (e.axis === 0) this.insert(this.edgeCells, id, e.lo, e.c, e.hi, e.c);
    else this.insert(this.edgeCells, id, e.c, e.lo, e.c, e.hi);
  }

  addAnchor(a: PropAnchor) {
    this.anchors.push(a);
    this.anchorSeen.push(0);
    this.insert(this.anchorCells, this.anchors.length - 1, a.at.x, a.at.z, a.at.x, a.at.z);
  }

  private query(cells: number[][], seen: number[], x0: number, z0: number, x1: number, z1: number, out: number[]): number {
    const stamp = ++this.stamp;
    const [cx0, cz0, cx1, cz1] = this.cellRange(x0, z0, x1, z1);
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = cells[cz * this.nx + cx];
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          if (seen[id] === stamp) continue;
          seen[id] = stamp;
          out[n++] = id;
        }
      }
    }
    return n;
  }

  /** Box ids whose cells touch the rectangle, in a fixed order. Returns how many were written to `out`. */
  queryBoxes(x0: number, z0: number, x1: number, z1: number, out: number[]): number {
    return this.query(this.boxCells, this.boxSeen, x0, z0, x1, z1, out);
  }

  queryEdges(x0: number, z0: number, x1: number, z1: number, out: number[]): number {
    return this.query(this.edgeCells, this.edgeSeen, x0, z0, x1, z1, out);
  }

  queryAnchors(x0: number, z0: number, x1: number, z1: number, out: number[]): number {
    return this.query(this.anchorCells, this.anchorSeen, x0, z0, x1, z1, out);
  }

  /** Whether a hero at (x, y, z) could web something at least `minRise` above, in any direction (the coverage passes). */
  hasAnchor(x: number, y: number, z: number, minRise = 36): boolean {
    return findAnchor(this, x, y, z, x, y + 150, z, null, 420, 70, minRise) !== null;
  }
}

/* ------------------------------------------------------------------ anchor search */

export interface AnchorPick {
  x: number;
  y: number;
  z: number;
  /** "edge" for a roof edge, "wall" for a point on a wall face, else the prop anchor's kind. */
  kind: "edge" | "wall" | PropAnchor["kind"];
}

interface Candidate {
  score: number;
  rank: number;
  x: number;
  y: number;
  z: number;
  kind: AnchorPick["kind"];
}

const scratchIds: number[] = [];
const losIds: number[] = [];
const pool: Candidate[] = [];
/** How many of the best candidates get a line-of-sight check before giving up. */
const LOS_TRIES = 12;
/** Swings whose lowest point would come within this of the street are marked down. */
const SAFE_BOTTOM = 90;

/** Whether the straight line from a to b crosses no box (the web would pass through a building). */
export function lineClear(grid: CityIndex, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  return lineBlocker(grid, ax, ay, az, bx, by, bz) < 0;
}

/** The first box (index in grid.boxes) the line from a to b passes through, or −1. */
export function lineBlocker(grid: CityIndex, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const n = grid.queryBoxes(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), losIds);
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[losIds[k]];
    let t0 = 0.0001;
    let t1 = 0.9999;
    if (dx === 0) {
      if (ax <= b.x0 || ax >= b.x1) continue;
    } else {
      let ta = (b.x0 - ax) / dx;
      let tb = (b.x1 - ax) / dx;
      if (ta > tb) {
        const t = ta;
        ta = tb;
        tb = t;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 >= t1) continue;
    }
    if (dy === 0) {
      if (ay <= b.y0 || ay >= b.y1) continue;
    } else {
      let ta = (b.y0 - ay) / dy;
      let tb = (b.y1 - ay) / dy;
      if (ta > tb) {
        const t = ta;
        ta = tb;
        tb = t;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 >= t1) continue;
    }
    if (dz === 0) {
      if (az <= b.z0 || az >= b.z1) continue;
    } else {
      let ta = (b.z0 - az) / dz;
      let tb = (b.z1 - az) / dz;
      if (ta > tb) {
        const t = ta;
        ta = tb;
        tb = t;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 >= t1) continue;
    }
    return losIds[k];
  }
  return -1;
}

/**
 * The anchor nearest the desired point (dx, dy, dz) among everything a hero at (hx, hy, hz)
 * can web, in any direction: within minRange..range, at least minRise above, facades only
 * from their outward side (the nearest point of the wall face, roof edge included), inside
 * `area` when given, and in plain sight. Swings that would bottom out near the street are
 * marked down. The city's coverage passes use it; the hero's own choice (swing.ts) also
 * predicts each swing. Ties go to facades before prop anchors, then to the lower id.
 */
export function findAnchor(
  grid: CityIndex,
  hx: number,
  hy: number,
  hz: number,
  dx: number,
  dy: number,
  dz: number,
  area: { x0: number; z0: number; x1: number; z1: number } | null,
  range = 420,
  minRange = 70,
  minRise = 36,
): AnchorPick | null {
  let count = 0;
  const r2 = range * range;
  const min2 = minRange * minRange;
  const add = (x: number, y: number, z: number, d2: number, rank: number, kind: AnchorPick["kind"]) => {
    // Where the swing bottoms out (straight below the anchor, a rope's length down).
    const bottom = y - Math.sqrt(d2);
    const low = bottom < SAFE_BOTTOM ? SAFE_BOTTOM - bottom : 0;
    const score = (x - dx) * (x - dx) + (y - dy) * (y - dy) + (z - dz) * (z - dz) + 6 * low * low;
    const c = pool[count] ?? (pool[count] = { score: 0, rank: 0, x: 0, y: 0, z: 0, kind: "edge" });
    c.score = score;
    c.rank = rank;
    c.x = x;
    c.y = y;
    c.z = z;
    c.kind = kind;
    count += 1;
  };
  const ids = scratchIds;
  const n = grid.queryEdges(hx - range, hz - range, hx + range, hz + range, ids);
  for (let k = 0; k < n; k++) {
    const id = ids[k];
    const e = grid.edges[id];
    // The wall point at the wanted height (clamped to the exposed face), or the roof edge.
    const lowest = Math.max(e.y0, hy + minRise);
    if (lowest > e.y) continue;
    const y = dy < lowest ? lowest : dy > e.y ? e.y : dy;
    const rise = y - hy;
    // Outward side only: the hero must be outside this facade.
    const perpH = e.axis === 0 ? hz : hx;
    if ((perpH - e.face) * e.n <= 0) continue;
    const rh2 = r2 - rise * rise;
    if (rh2 <= 0) continue;
    const dPerp = e.c - perpH;
    const left = rh2 - dPerp * dPerp;
    if (left < 0) continue;
    const along = e.axis === 0 ? hx : hz;
    const w = Math.sqrt(left);
    let lo = Math.max(e.lo, along - w);
    let hi = Math.min(e.hi, along + w);
    if (area) {
      const perpOk = e.axis === 0 ? e.c >= area.z0 && e.c <= area.z1 : e.c >= area.x0 && e.c <= area.x1;
      if (!perpOk) continue;
      lo = Math.max(lo, e.axis === 0 ? area.x0 : area.z0);
      hi = Math.min(hi, e.axis === 0 ? area.x1 : area.z1);
    }
    if (lo > hi) continue;
    const want = e.axis === 0 ? dx : dz;
    const t = want < lo ? lo : want > hi ? hi : want;
    const px = e.axis === 0 ? t : e.c;
    const pz = e.axis === 0 ? e.c : t;
    const hd2 = (px - hx) * (px - hx) + rise * rise + (pz - hz) * (pz - hz);
    if (hd2 < min2) continue;
    add(px, y, pz, hd2, id, y < e.y ? "wall" : "edge");
  }
  const m = grid.queryAnchors(hx - range, hz - range, hx + range, hz + range, ids);
  for (let k = 0; k < m; k++) {
    const id = ids[k];
    const a = grid.anchors[id].at;
    const rise = a.y - hy;
    if (rise < minRise) continue;
    if (area && (a.x < area.x0 || a.x > area.x1 || a.z < area.z0 || a.z > area.z1)) continue;
    const hd2 = (a.x - hx) * (a.x - hx) + rise * rise + (a.z - hz) * (a.z - hz);
    if (hd2 > r2 || hd2 < min2) continue;
    add(a.x, a.y, a.z, hd2, 1e9 + id, grid.anchors[id].kind);
  }
  // Best first; the first few in plain sight win.
  for (let tries = 0; tries < LOS_TRIES && tries < count; tries++) {
    let bi = tries;
    for (let i = tries + 1; i < count; i++) {
      const a = pool[i];
      const b = pool[bi];
      if (a.score < b.score || (a.score === b.score && a.rank < b.rank)) bi = i;
    }
    const c = pool[bi];
    pool[bi] = pool[tries];
    pool[tries] = c;
    if (lineClear(grid, hx, hy, hz, c.x, c.y, c.z)) return { x: c.x, y: c.y, z: c.z, kind: c.kind };
  }
  return null;
}

/* ------------------------------------------------------------------ collision */

export interface SphereHit {
  /** Touched anything. */
  hit: boolean;
  /** Came to rest on a top face (a roof or the deck). */
  top: boolean;
  topY: number;
  wall: boolean;
  /** The last wall's outward normal in xz, and the top of its box (when `wall`). */
  wallNx: number;
  wallNz: number;
  wallTop: number;
  ceiling: boolean;
}

/**
 * Push a sphere out of every box it overlaps and drop its velocity into each surface.
 * Top faces (normal mostly up) report `top`, so the caller can land; anything else slides.
 * v2: so does a V of contacts whose combined push is mostly up (resting on a ledge's edge
 * against a wall), so nothing can hang wedged in a crack, never landing and never falling.
 */
export function collideSphere(
  grid: CityIndex,
  body: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  r: number,
  out: SphereHit,
): SphereHit {
  out.hit = false;
  out.top = false;
  out.topY = 0;
  out.wall = false;
  out.wallNx = 0;
  out.wallNz = 0;
  out.wallTop = 0;
  out.ceiling = false;
  const ids = scratchIds;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let pass = 0; pass < 2; pass++) {
    const n = grid.queryBoxes(body.x - r, body.z - r, body.x + r, body.z + r, ids);
    let moved = false;
    for (let k = 0; k < n; k++) {
      const b = grid.boxes[ids[k]];
      if (body.y - r >= b.y1 || body.y + r <= b.y0) continue;
      const qx = body.x < b.x0 ? b.x0 : body.x > b.x1 ? b.x1 : body.x;
      const qy = body.y < b.y0 ? b.y0 : body.y > b.y1 ? b.y1 : body.y;
      const qz = body.z < b.z0 ? b.z0 : body.z > b.z1 ? b.z1 : body.z;
      let nx = body.x - qx;
      let ny = body.y - qy;
      let nz = body.z - qz;
      const d2 = nx * nx + ny * ny + nz * nz;
      if (d2 >= r * r) continue;
      let push: number;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        nx /= d;
        ny /= d;
        nz /= d;
        push = r - d;
      } else {
        // The centre is inside: leave by the nearest face.
        const faces = [body.x - b.x0, b.x1 - body.x, body.y - b.y0, b.y1 - body.y, body.z - b.z0, b.z1 - body.z];
        let f = 0;
        for (let i = 1; i < 6; i++) if (faces[i] < faces[f]) f = i;
        nx = f === 0 ? -1 : f === 1 ? 1 : 0;
        ny = f === 2 ? -1 : f === 3 ? 1 : 0;
        nz = f === 4 ? -1 : f === 5 ? 1 : 0;
        push = faces[f] + r;
      }
      body.x += nx * push;
      body.y += ny * push;
      body.z += nz * push;
      sx += nx * push;
      sy += ny * push;
      sz += nz * push;
      const vn = body.vx * nx + body.vy * ny + body.vz * nz;
      if (vn < 0) {
        body.vx -= vn * nx;
        body.vy -= vn * ny;
        body.vz -= vn * nz;
      }
      out.hit = true;
      moved = true;
      if (ny > 0.7) {
        out.top = true;
        out.topY = b.y1;
      } else if (ny < -0.7) out.ceiling = true;
      else {
        out.wall = true;
        const h = Math.sqrt(nx * nx + nz * nz) || 1;
        out.wallNx = nx / h;
        out.wallNz = nz / h;
        out.wallTop = b.y1;
      }
    }
    if (!moved) break;
  }
  if (out.hit && !out.top) {
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sl > 1e-9 && sy > 0.7 * sl) {
      out.top = true;
      out.topY = body.y - r;
    }
  }
  return out;
}

const probe = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const probeHit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };

/**
 * Whether a sphere at (x, y, z) stands on something: lowered 2 units, it would be pushed back
 * up by a top face or a V of contacts (v2; v1 asked only for a top face under the centre).
 */
export function supported(grid: CityIndex, x: number, y: number, z: number, r: number): boolean {
  probe.x = x;
  probe.y = y - 2;
  probe.z = z;
  probe.vx = 0;
  probe.vy = 0;
  probe.vz = 0;
  collideSphere(grid, probe, r, probeHit);
  return probeHit.top;
}

/** Whether something solid holds up a foot at (x, footY, z): a top face within 2 units under it. */
export function supportAt(grid: CityIndex, x: number, footY: number, z: number): boolean {
  const ids = scratchIds;
  const n = grid.queryBoxes(x, z, x, z, ids);
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[ids[k]];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && footY - b.y1 < 2 && footY - b.y1 > -2) return true;
  }
  return false;
}

/** The highest top face under (x, z) at or below y, or the street. */
export function groundBelow(grid: CityIndex, x: number, z: number, y: number): number {
  let best = STREET_Y;
  const ids = scratchIds;
  const n = grid.queryBoxes(x, z, x, z, ids);
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[ids[k]];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 <= y + 1 && b.y1 > best) best = b.y1;
  }
  return best;
}

/** Is (x, z) over the river (a miss there is a splash)? */
export function overRiver(city: City, x: number, z: number): boolean {
  const r = city.river;
  return !!r && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

export interface RayHit {
  /** Distance along the (normalised) ray. */
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** The box index in CityIndex.boxes, or −1 for the street. */
  box: number;
}

/**
 * The first solid thing along a ray from (ox, oy, oz) in direction (dx, dy, dz), up to
 * `maxT` (in units of the direction's length; pass a unit direction for distances). The
 * street plane counts. Only boxes in the hash cells under the ray are tested, so a camera ray costs a few
 * cells. Shared with the scene's chase camera.
 */
export function raycastCity(grid: CityIndex, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
  let bestT = maxT;
  let hit: RayHit | null = null;
  if (dy < 0) {
    const t = (STREET_Y - oy) / dy;
    if (t >= 0 && t < bestT) {
      bestT = t;
      hit = { t, x: ox + dx * t, y: STREET_Y, z: oz + dz * t, nx: 0, ny: 1, nz: 0, box: -1 };
    }
  }
  const ex = ox + dx * maxT;
  const ez = oz + dz * maxT;
  const ids = scratchIds;
  const n = grid.queryBoxes(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), ids);
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[ids[k]];
    let t0 = 0;
    let t1 = bestT;
    let axis = -1;
    let sign = 0;
    const slab = (o: number, d: number, lo: number, hi: number, a: number): boolean => {
      if (d === 0) return o >= lo && o <= hi;
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      let s = -1;
      if (ta > tb) {
        const tmp = ta;
        ta = tb;
        tb = tmp;
        s = 1;
      }
      if (ta > t0) {
        t0 = ta;
        axis = a;
        sign = s;
      }
      if (tb < t1) t1 = tb;
      return t0 <= t1;
    };
    if (!slab(ox, dx, b.x0, b.x1, 0) || !slab(oy, dy, b.y0, b.y1, 1) || !slab(oz, dz, b.z0, b.z1, 2)) continue;
    if (axis < 0 || t0 >= bestT) continue;
    bestT = t0;
    hit = {
      t: t0,
      x: ox + dx * t0,
      y: oy + dy * t0,
      z: oz + dz * t0,
      nx: axis === 0 ? sign : 0,
      ny: axis === 1 ? sign : 0,
      nz: axis === 2 ? sign : 0,
      box: ids[k],
    };
  }
  return hit;
}
