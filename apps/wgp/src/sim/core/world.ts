/**
 * The night's city, generated from the patrol seed: a row of buildings scrolling right,
 * with the four stops as zones about 3,000 units apart. Fight zones are arenas between
 * two tall towers (or Doc's red bridge); errand zones are a rooftop with an ally on it.
 *
 * Buildings are one-way platforms: you pass in front of a facade and land on its roof.
 * Anchors are the things a web can stick to: roof corners, water towers, antennas,
 * billboards, cranes and cables.
 */
import { BILLBOARDS } from "@/game/style";
import { ALLY_CAST } from "@/game/data";
import type { DistrictId, Stop } from "@/game/types";

import { ARENA_HALF, START_X, ZONE_SPACING } from "./constants";
import { mix, Rng } from "./rng";
import type { Anchor, Bridge, Building, BuildingStyle, Cable, Crane, Platform, Prop, Vec, World, Zone } from "./types";

/** Height ranges and habits by district, so each stretch of the route reads differently. */
const DISTRICT_STYLE: Record<DistrictId, { lo: number; hi: number; cranes: number; billboards: number; brown: number; tower: number }> = {
  "sector-7": { lo: 200, hi: 470, cranes: 0.45, billboards: 0.3, brown: 0, tower: 0.1 },
  "mempool-market": { lo: 210, hi: 430, cranes: 0.1, billboards: 0.45, brown: 0.1, tower: 0.05 },
  "bridge-district": { lo: 200, hi: 420, cranes: 0.2, billboards: 0.25, brown: 0.15, tower: 0.1 },
  "queens-block": { lo: 170, hi: 320, cranes: 0.05, billboards: 0.2, brown: 0.7, tower: 0 },
  "validator-heights": { lo: 320, hi: 640, cranes: 0.25, billboards: 0.2, brown: 0, tower: 0.45 },
};

/** Where on a sagging cable a point falls, t in [0, 1]. */
export function cablePoint(c: Cable, t: number): Vec {
  return { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t - c.sag * 4 * t * (1 - t) };
}

/** The water tower's tank top above its roof. */
export const WATER_TOWER_TOP = 168;
/** Billboard legs. */
export const BILLBOARD_LEGS = 34;

export function zoneCenter(index: number): number {
  return START_X + ZONE_SPACING * (index + 1);
}

/** How much of the street a zone keeps for its own architecture. */
function zoneReach(z: Zone): number {
  if (z.kind === "errand") return 200;
  return z.bridge ? 780 : 700;
}

export function generateWorld(seed: number, stops: Stop[]): World {
  const rng = new Rng(mix(seed, 0x51ed27));
  const buildings: Building[] = [];
  const cranes: Crane[] = [];
  const cables: Cable[] = [];
  const bridges: Bridge[] = [];
  const water: World["water"] = [];
  let nextId = 0;

  const zones: Zone[] = stops.map((stop, index) => {
    const x = zoneCenter(index);
    const bridge = stop.kind === "fight" && stop.villain === "doc-octochain";
    return {
      index,
      kind: stop.kind,
      stop,
      x,
      x0: x - ARENA_HALF,
      x1: x + ARENA_HALF,
      bridge,
      ally: null,
    };
  });

  const districtAt = (x: number): DistrictId => {
    for (const z of zones) if (x < z.x) return z.stop.district;
    return zones[zones.length - 1]?.stop.district ?? "queens-block";
  };

  const tones = 4;
  const addBuilding = (x0: number, w: number, h: number, style: BuildingStyle, district: DistrictId, props: Prop[] = [], top: Building["top"] = null) => {
    const b: Building = {
      id: nextId++,
      x0,
      w,
      h,
      top,
      style,
      tone: rng.int(0, tones - 1),
      accent: style !== "arena-tower" && rng.chance(district === "queens-block" ? 0.35 : 0.12),
      district,
      props,
      ledges: [],
      seed: mix(seed, 0xb17d + nextId * 7919),
    };
    buildings.push(b);
    return b;
  };

  /** Rooftop clutter and one tall thing a web can reach. */
  const decorate = (b: Building, d: (typeof DISTRICT_STYLE)[DistrictId]) => {
    const roofX0 = b.top ? b.top.x0 : b.x0;
    const roofW = b.top ? b.top.w : b.w;
    const roofY = b.top ? b.h + b.top.h : b.h;
    const tall = rng.next();
    const at = (f: number) => roofX0 + roofW * f;
    if (b.style === "tower" || tall < 0.34) {
      b.props.push({ kind: "antenna", x: at(rng.range(0.3, 0.7)), y: roofY, h: rng.range(130, 230) });
    } else if (tall < 0.7) {
      b.props.push({ kind: "water-tower", x: at(rng.range(0.3, 0.7)), y: roofY });
    } else if (roofW > 170 && rng.chance(0.4 + d.billboards)) {
      const w = Math.min(roofW - 30, rng.range(130, 190));
      b.props.push({ kind: "billboard", x: at(0.5) - w / 2, y: roofY, w, h: 64, text: rng.pick(BILLBOARDS) });
    } else {
      b.props.push({ kind: "antenna", x: at(rng.range(0.25, 0.75)), y: roofY, h: rng.range(140, 220) });
    }
    // A lower roof gets clutter too.
    const acCount = rng.int(0, 2);
    for (let i = 0; i < acCount; i++) {
      const onLower = b.top && rng.chance(0.6);
      const lx0 = onLower ? b.x0 : roofX0;
      const lw = onLower ? b.w : roofW;
      const ly = onLower ? b.h : roofY;
      const w = rng.range(28, 44);
      const x = lx0 + 14 + rng.next() * Math.max(0, lw - 28 - w);
      if (!b.props.some((p) => Math.abs(p.x - x) < 50 && p.y === ly)) b.props.push({ kind: "ac", x, y: ly, w });
    }
    if (rng.chance(0.4)) b.props.push({ kind: "vent", x: roofX0 + 12 + rng.next() * (roofW - 24), y: roofY });
  };

  /** Fill an open stretch of street with buildings. */
  const fill = (a: number, b: number) => {
    let x = a + rng.range(20, 80);
    let lastH = 300;
    while (x < b - 120) {
      const district = districtAt(x);
      const d = DISTRICT_STYLE[district];
      let w = rng.range(150, 300);
      if (x + w > b - 20) w = b - 20 - x;
      if (w < 110) break;
      const brown = rng.chance(d.brown);
      const tower = !brown && rng.chance(d.tower);
      let h = rng.range(d.lo, d.hi);
      if (tower) h = Math.min(720, h + rng.range(80, 180));
      if (brown) h = rng.range(170, 300);
      // No cliff walls: neighbours stay within reach of each other.
      h = Math.max(lastH - 260, Math.min(lastH + 260, h));
      const style: BuildingStyle = brown ? "brownstone" : tower ? "tower" : rng.chance(0.3) ? "setback" : rng.chance(0.2) ? "stepped" : "flat";
      let top: Building["top"] = null;
      if (style === "setback" || style === "tower") {
        const tw = w * rng.range(0.5, 0.72);
        top = { x0: x + (w - tw) / 2, w: tw, h: rng.range(60, 150) };
      } else if (style === "stepped") {
        const tw = w * rng.range(0.45, 0.6);
        top = { x0: rng.chance(0.5) ? x : x + w - tw, w: tw, h: rng.range(50, 110) };
      }
      const bld = addBuilding(x, w, h, style, district, [], top);
      decorate(bld, d);
      lastH = h + (top?.h ?? 0);
      const gap = rng.chance(0.18) ? rng.range(0, 16) : rng.range(50, 170);
      // A crane in a wide gap.
      if (gap > 120 && rng.chance(d.cranes) && x + w + gap < b - 60) {
        cranes.push({ x: x + w + gap / 2, h: rng.range(600, 760), jib: rng.range(200, 260), dir: rng.chance(0.5) ? 1 : -1 });
      }
      x += w + gap;
    }
  };

  // The launch roof, and the city behind it.
  const start = addBuilding(START_X - 220, 380, 300, "flat", districtAt(START_X));
  start.props.push({ kind: "water-tower", x: START_X + 110, y: 300 }, { kind: "ac", x: START_X - 190, y: 300, w: 38 });

  // Each zone's own architecture.
  const reserved: [number, number][] = [[START_X - 220, START_X + 160]];
  for (const z of zones) {
    const district = z.stop.district;
    if (z.kind === "errand") {
      const b = addBuilding(z.x - 170, 340, 310, district === "queens-block" ? "brownstone" : "flat", district);
      const allyId = z.stop.kind === "errand" ? ALLY_CAST[z.stop.ally] : "gwei";
      const onTower = allyId === "gwei";
      if (onTower) {
        b.props.push({ kind: "water-tower", x: z.x + 40, y: 310 });
        z.ally = { x: z.x + 40, y: 310 + WATER_TOWER_TOP, id: allyId, onTower };
        b.props.push({ kind: "antenna", x: z.x - 120, y: 310, h: 190 });
      } else {
        z.ally = { x: z.x + 30, y: 310, id: allyId, onTower };
        b.props.push({ kind: "antenna", x: z.x - 110, y: 310, h: 200 }, { kind: "ac", x: z.x + 100, y: 310, w: 36 });
      }
    } else if (z.bridge) {
      const deckY = 200;
      const br: Bridge = { x0: z.x - 780, x1: z.x + 780, deckY, towers: [z.x - 470, z.x + 470], towerTop: 790 };
      bridges.push(br);
      water.push({ x0: br.x0, x1: br.x1 });
      cables.push(
        { a: { x: br.x0 + 20, y: deckY + 30 }, b: { x: br.towers[0], y: br.towerTop }, sag: 40, kind: "bridge" },
        { a: { x: br.towers[0], y: br.towerTop }, b: { x: br.towers[1], y: br.towerTop }, sag: 390, kind: "bridge" },
        { a: { x: br.towers[1], y: br.towerTop }, b: { x: br.x1 - 20, y: deckY + 30 }, sag: 40, kind: "bridge" },
      );
    } else {
      const H = 780;
      const lt = addBuilding(z.x - ARENA_HALF - 120, 120, H, "arena-tower", district);
      const rt = addBuilding(z.x + ARENA_HALF, 120, H, "arena-tower", district);
      lt.props.push({ kind: "antenna", x: lt.x0 + 40, y: H, h: 150 });
      rt.props.push({ kind: "antenna", x: rt.x0 + 80, y: H, h: 150 });
      // Flagpoles on the inner faces, so the low roofs can reach a web.
      lt.ledges.push({ x: lt.x0 + lt.w + 34, y: 440 }, { x: lt.x0 + lt.w + 34, y: 640 });
      rt.ledges.push({ x: rt.x0 - 34, y: 440 }, { x: rt.x0 - 34, y: 640 });
      const inner = [
        { x0: z.x - 500, w: 230, h: 200 },
        { x0: z.x - 150, w: 300, h: 270 },
        { x0: z.x + 270, w: 230, h: 220 },
      ];
      inner.forEach((r, k) => {
        const b = addBuilding(r.x0, r.w, r.h, k === 1 ? "flat" : rng.chance(0.5) ? "flat" : "brownstone", district);
        if (k === 1) b.props.push({ kind: "water-tower", x: z.x + 70, y: r.h }, { kind: "ac", x: z.x - 110, y: r.h, w: 40 });
        else b.props.push({ kind: "ac", x: r.x0 + 40 + rng.next() * (r.w - 100), y: r.h, w: 34 });
      });
      cables.push({ a: { x: z.x - ARENA_HALF, y: 680 }, b: { x: z.x + ARENA_HALF, y: 680 }, sag: 80, kind: "arena" });
    }
    reserved.push([z.x - zoneReach(z), z.x + zoneReach(z)]);
  }

  const last = zones[zones.length - 1];
  const endX = (last ? last.x : START_X) + 1600;
  reserved.sort((p, q) => p[0] - q[0]);
  let cursor = START_X - 1500;
  for (const [a, b] of reserved) {
    if (a > cursor) fill(cursor, a);
    cursor = Math.max(cursor, b);
  }
  fill(cursor, endX + 600);
  buildings.sort((p, q) => p.x0 - q.x0);

  // Wires between close neighbours.
  for (let i = 0; i + 1 < buildings.length; i++) {
    const a = buildings[i];
    const b = buildings[i + 1];
    if (a.style === "arena-tower" || b.style === "arena-tower") continue;
    const gap = b.x0 - (a.x0 + a.w);
    if (gap < 40 || gap > 220 || !rng.chance(0.4)) continue;
    const ya = a.h + rng.range(70, 120);
    const yb = b.h + rng.range(70, 120);
    cables.push({ a: { x: a.x0 + a.w - 12, y: ya }, b: { x: b.x0 + 12, y: yb }, sag: rng.range(16, 34), kind: "wire" });
  }

  const platforms: Platform[] = [];
  for (const b of buildings) {
    platforms.push({ x0: b.x0, x1: b.x0 + b.w, y: b.h });
    if (b.top) platforms.push({ x0: b.top.x0, x1: b.top.x0 + b.top.w, y: b.h + b.top.h });
  }
  for (const br of bridges) platforms.push({ x0: br.x0, x1: br.x1, y: br.deckY });

  const anchors: Anchor[] = [];
  const corner = (x0: number, w: number, y: number) => {
    anchors.push({ x: x0 + 10, y: y + 10, kind: "corner" }, { x: x0 + w - 10, y: y + 10, kind: "corner" });
  };
  for (const b of buildings) {
    corner(b.x0, b.w, b.h);
    if (b.top) corner(b.top.x0, b.top.w, b.h + b.top.h);
    for (const l of b.ledges) anchors.push({ x: l.x, y: l.y, kind: "corner" });
    for (const p of b.props) {
      if (p.kind === "water-tower") anchors.push({ x: p.x, y: p.y + WATER_TOWER_TOP, kind: "tower" });
      else if (p.kind === "antenna") anchors.push({ x: p.x, y: p.y + p.h, kind: "antenna" });
      else if (p.kind === "billboard") {
        const top = p.y + BILLBOARD_LEGS + p.h;
        anchors.push({ x: p.x + 8, y: top, kind: "billboard" }, { x: p.x + p.w - 8, y: top, kind: "billboard" });
      }
    }
  }
  for (const c of cranes) {
    anchors.push({ x: c.x, y: c.h + 20, kind: "crane" }, { x: c.x + c.dir * c.jib, y: c.h - 4, kind: "crane" });
    anchors.push({ x: c.x + c.dir * c.jib * 0.55, y: c.h - 4, kind: "crane" });
  }
  for (const br of bridges) for (const tx of br.towers) anchors.push({ x: tx, y: br.towerTop + 8, kind: "tower" });
  for (const c of cables) {
    const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
    const step = c.kind === "wire" ? 60 : 105;
    const n = Math.max(1, Math.round(len / step));
    for (let k = c.kind === "wire" ? 1 : 0; k <= n - (c.kind === "wire" ? 1 : 0); k++) {
      const p = cablePoint(c, k / n);
      if (c.kind === "bridge" && p.y < 290) continue;
      anchors.push({ x: p.x, y: p.y, kind: "cable" });
    }
  }

  // Coverage: every stretch needs something above its roofs within reach. Add an antenna where there isn't.
  const roofAt = (x: number) => {
    let top = 0;
    for (const p of platforms) if (p.x1 > x - 200 && p.x0 < x + 200) top = Math.max(top, p.y);
    return top;
  };
  for (let x = START_X - 200; x < endX; x += 180) {
    const roof = roofAt(x);
    const ok = anchors.some((a) => a.x > x - 60 && a.x < x + 280 && a.y > roof + 70 && a.y < roof + 400);
    if (ok) continue;
    const host = buildings.find((b) => b.style !== "arena-tower" && b.x0 < x + 220 && b.x0 + b.w > x + 40);
    if (!host) continue;
    const roofX0 = host.top ? host.top.x0 : host.x0;
    const roofW = host.top ? host.top.w : host.w;
    const ry = host.h + (host.top?.h ?? 0);
    const ax = Math.max(roofX0 + 14, Math.min(roofX0 + roofW - 14, x + 120));
    const h = Math.max(120, Math.min(260, roof + 170 - ry));
    host.props.push({ kind: "antenna", x: ax, y: ry, h });
    anchors.push({ x: ax, y: ry + h, kind: "antenna" });
  }

  anchors.sort((p, q) => p.x - q.x);
  return { seed, buildings, cranes, cables, bridges, platforms, anchors, water, zones, startX: START_X, endX };
}

/** First anchor index with x ≥ value (binary search). */
export function anchorLowerBound(anchors: Anchor[], value: number): number {
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].x < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Is x over the river (a miss there is a splash)? */
export function overWater(world: World, x: number): boolean {
  return world.water.some((w) => x >= w.x0 && x <= w.x1);
}

/** Where to stand at the start of the swing to stop `index`. */
export function spawnPoint(world: World, index: number): Vec & { grounded: boolean } {
  if (index <= 0) return { x: START_X - 70, y: 300, grounded: true };
  const prev = world.zones[index - 1];
  const from = prev.x + zoneReach(prev) + 40;
  let best: Platform | null = null;
  for (const p of world.platforms) {
    if (p.x1 < from + 60 || p.x0 > from + 700) continue;
    if (!best || p.x0 < best.x0) best = p;
  }
  if (best) return { x: Math.max(best.x0 + 40, Math.min(best.x1 - 40, from + 60)), y: best.y, grounded: true };
  return { x: from + 60, y: 520, grounded: false };
}
