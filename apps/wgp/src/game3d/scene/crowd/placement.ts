/**
 * Where the city's people are, for a night: pure and seeded from the night's city seed (its
 * own generator, crowd/rng.ts, never the sim's), so the same night always shows the same
 * people in the same places. Nothing here reaches the sim or the score.
 *
 * - Rooftops: small groups at a roof's edge, looking out over the street, on roofs near the
 *   night's route (the start, then each stop in turn), so the hero swings past them.
 * - Sidewalks: walkers going round a block on its sidewalk, from the street grid the scene
 *   infers (city/streets.ts); never round an arena, the river or the bridge.
 * - Fights: spectators on the sidewalks across the street from the arena, and a group on a
 *   roof beside it, all facing in, at a safe distance (never inside an arena's bounds).
 * - Errands: a few onlookers on the ally's roof, on the far side from the hero's approach,
 *   beyond the space the sim keeps clear round the ally.
 *
 * Everyone keeps clear of the hero's start, of every arena, of the props on their roof, of the
 * street lamps and of each other.
 */
import type { Building, City, Prop, Zone } from "@wgp/game-core/sim3d/contract";

import { inferStreets, LAMP, lampStops, type StreetGrid } from "../city/streets";
import { CHANNEL } from "./clips";
import { CrowdRng, hash32 } from "./rng";

export type SpotKind = "roof" | "fight" | "errand";

/** Someone standing about. */
export interface Spot {
  kind: SpotKind;
  x: number;
  y: number;
  z: number;
  /** Which way they face when nothing's happening (0 is +z). */
  yaw: number;
  /** The stop they're there for, or −1. */
  zone: number;
  group: number;
  body: number;
  /** Their look, within their body's pool. */
  look: number;
  /** Their idle channel, and the one they react with. */
  idle: number;
  react: number;
  seed: number;
}

/** A sidewalk loop round a block: a rounded rectangle on the walk's centre line. */
export interface WalkPath {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  r: number;
  len: number;
}

export interface Walker {
  path: number;
  /** Where on the loop they start (arc length), and which way round they go. */
  s: number;
  dir: 1 | -1;
  body: number;
  look: number;
  channel: number;
  react: number;
  seed: number;
}

export interface CrowdPlan {
  spots: Spot[];
  walkers: Walker[];
  paths: WalkPath[];
}

/** How many of each, for a tier (crowd/lod.ts). */
export interface Density {
  roofGroups: number;
  /** Spectators per fight on the sidewalks, and groups on the roofs round it. */
  fight: number;
  fightRoofs: number;
  /** Onlookers per errand. */
  errand: number;
  walkers: number;
}

/** What the plan needs to know of each body. */
export interface BodyInfo {
  phone: boolean;
  /** Looks in its pool. */
  looks: number;
}

/* ------------------------------------------------------------------ rules */

/** Clearances (game units; the hero is 88 tall). */
export const CLEAR = {
  /** Around the hero's start point. */
  start: 260,
  /** Outside every fight arena's bounds (which already reach the streets' centre lines). */
  arena: 60,
  /** Spectators stand no further than this outside their arena. */
  arenaFar: 300,
  /** Walk loops keep this far from any arena (the spectators' sidewalks are theirs). */
  arenaWalk: 320,
  /** From the ally (the sim keeps 120 + the hero's radius + 24 clear round them). */
  allyMin: 190,
  allyMax: 250,
  /** Between two people. */
  person: 24,
  /** From a roof's edge (behind the parapet), and from a setback tier's walls. */
  roofEdge: 26,
  /** Beyond a prop's footprint. */
  prop: 20,
  /** From a street lamp's pole. */
  lamp: 20,
} as const;

/** The sidewalk's centre line sits this far in from the curb (the walk is 16 wide). */
export const WALK_INSET = 8;
/** Corner radius of the walk loops. */
export const WALK_CORNER = 14;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

/** Distance from a point to a rectangle (0 inside). */
export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

const fights = (city: City) => city.zones.filter((z) => z.kind === "fight");

/** Inside some fight arena's bounds, grown by `pad`. */
export function inArena(city: City, x: number, z: number, pad: number = CLEAR.arena): boolean {
  return fights(city).some((zn) => inRect(zn.bounds, x, z, pad));
}

/** Where people may never stand: an arena, the start, the river, the bridge deck. */
export function forbidden(city: City, x: number, z: number): boolean {
  if (inArena(city, x, z)) return true;
  if (Math.hypot(x - city.start.x, z - city.start.z) < CLEAR.start) return true;
  if (city.river && inRect(city.river, x, z, 12)) return true;
  const deck = city.bridge?.deck;
  if (deck && inRect(deck, x, z, 40)) return true;
  return false;
}

/** The route the hero takes: the start, then every stop. */
export function route(city: City): { x: number; z: number }[] {
  return [{ x: city.start.x, z: city.start.z }, ...city.zones.map((z) => ({ x: z.center.x, z: z.center.z }))];
}

/** Distance from a point to the route's polyline. */
export function routeDistance(pts: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return pts.length === 1 ? Math.hypot(x - pts[0].x, z - pts[0].z) : best;
}

/** A prop's footprint as a circle (its widest side, turned any way; a water tower's tank overhangs its legs). */
const propRadius = (p: Prop) => (p.kind === "water-tower" ? p.w * 0.58 : Math.max(p.w, p.d) * 0.5) + CLEAR.prop;

/** The street lamps' poles (city/details.ts lamps them from the same stops). */
export function lampPoles(city: City, grid: StreetGrid): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const b = city.bounds;
  for (const s of grid.xs) for (const { at, side } of lampStops(grid.lampOrigin.z, b.z0 + 40, b.z1 - 40)) out.push({ x: s.c + side * (s.w / 2 + LAMP.curb), z: at });
  for (const s of grid.zs) for (const { at, side } of lampStops(grid.lampOrigin.x, b.x0 + 40, b.x1 - 40)) out.push({ x: at, z: s.c + side * (s.w / 2 + LAMP.curb) });
  return out;
}

/* ------------------------------------------------------------------ walk loops */

/** The blocks between the streets, as the sidewalk loops round them. */
export function walkPaths(city: City, grid: StreetGrid = inferStreets(city)): WalkPath[] {
  const cuts = (list: { c: number; w: number }[], lo: number, hi: number) => {
    const s = [...list].sort((a, b) => a.c - b.c);
    const edges: [number, number][] = [];
    let from = lo;
    for (const st of s) {
      edges.push([from, st.c - st.w / 2]);
      from = st.c + st.w / 2;
    }
    edges.push([from, hi]);
    return edges.filter(([a, b]) => b - a > 160);
  };
  const out: WalkPath[] = [];
  for (const [x0, x1] of cuts(grid.xs, city.bounds.x0, city.bounds.x1)) {
    for (const [z0, z1] of cuts(grid.zs, city.bounds.z0, city.bounds.z1)) {
      const r: Rect = { x0: x0 + WALK_INSET, z0: z0 + WALK_INSET, x1: x1 - WALK_INSET, z1: z1 - WALK_INSET };
      const bad =
        fights(city).some((zn) => rectDistanceRect(zn.bounds, r) < CLEAR.arenaWalk) ||
        (city.river !== null && rectDistanceRect(city.river, r) < 20) ||
        (city.bridge !== null && rectDistanceRect(city.bridge.deck, r) < 60);
      if (bad) continue;
      const rr = WALK_CORNER;
      const len = 2 * (r.x1 - r.x0 - 2 * rr) + 2 * (r.z1 - r.z0 - 2 * rr) + 2 * Math.PI * rr;
      out.push({ ...r, r: rr, len });
    }
  }
  return out;
}

function rectDistanceRect(a: Rect, b: Rect): number {
  const dx = Math.max(a.x0 - b.x1, 0, b.x0 - a.x1);
  const dz = Math.max(a.z0 - b.z1, 0, b.z0 - a.z1);
  return Math.hypot(dx, dz);
}

/**
 * A point on a walk loop at arc length `s` (wrapped), going round counter-clockwise seen from
 * above (+x, then +z, then −x, then −z): its position and the way it heads (yaw, 0 is +z).
 */
export function walkAt(p: WalkPath, s: number, out: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
  const r = p.r;
  const W = p.x1 - p.x0 - 2 * r;
  const D = p.z1 - p.z0 - 2 * r;
  const q = Math.PI * r * 0.5;
  let u = ((s % p.len) + p.len) % p.len;
  const seg = (x: number, z: number, dx: number, dz: number) => {
    out.x = x;
    out.z = z;
    out.yaw = Math.atan2(dx, dz);
    return out;
  };
  const arc = (cx: number, cz: number, a0: number) => {
    const a = a0 + u / r;
    // Counter-clockwise from above, in x–z: heading is the tangent (−sin a, cos a).
    return seg(cx + Math.cos(a) * r, cz + Math.sin(a) * r, -Math.sin(a), Math.cos(a));
  };
  if (u < W) return seg(p.x0 + r + u, p.z0, 1, 0);
  u -= W;
  if (u < q) return arc(p.x1 - r, p.z0 + r, -Math.PI / 2);
  u -= q;
  if (u < D) return seg(p.x1, p.z0 + r + u, 0, 1);
  u -= D;
  if (u < q) return arc(p.x1 - r, p.z1 - r, 0);
  u -= q;
  if (u < W) return seg(p.x1 - r - u, p.z1, -1, 0);
  u -= W;
  if (u < q) return arc(p.x0 + r, p.z1 - r, Math.PI / 2);
  u -= q;
  if (u < D) return seg(p.x0, p.z1 - r - u, 0, -1);
  u -= D;
  return arc(p.x0 + r, p.z0 + r, Math.PI);
}

/* ------------------------------------------------------------------ the plan */

const IDLE = ["stand-a", "stand-b", "talk", "stand-a", "stand-b", "phone"];
const REACT = ["wave", "cheer-a", "point", "photo", "look-up", "fist", "cheer-b", "clap"];
const WATCH = ["clap", "fist", "point", "photo", "look-up", "cheer-b", "stand-a", "talk"];
const WALK = ["walk-a", "walk-b", "walk-c", "walk-a", "walk-b", "walk-c", "strut", "walk-phone"];

/** A channel from a list, skipping phone moves for a body with no phone. */
function channelFor(list: string[], body: BodyInfo, h: number): number {
  for (let k = 0; k < list.length; k++) {
    const id = list[(h + k) % list.length];
    if ((id === "phone" || id === "photo" || id === "walk-phone") && !body.phone) continue;
    return CHANNEL[id];
  }
  return CHANNEL["stand-a"];
}

export function planCrowd(city: City, bodies: BodyInfo[], density: Density, seed: number = city.seed): CrowdPlan {
  const spots: Spot[] = [];
  const walkers: Walker[] = [];
  const grid = inferStreets(city);
  const paths = walkPaths(city, grid);
  if (!bodies.length) return { spots, walkers, paths };
  const lamps = lampPoles(city, grid);
  const pts = route(city);
  let group = 0;

  const person = (kind: SpotKind, x: number, y: number, z: number, yaw: number, zone: number, rng: CrowdRng, idle: string[], react: string[]) => {
    const body = rng.int(bodies.length);
    const h = hash32(seed, spots.length, 77);
    spots.push({ kind, x, y, z, yaw, zone, group, body, look: rng.int(Math.max(1, bodies[body].looks)), idle: channelFor(idle, bodies[body], h), react: channelFor(react, bodies[body], h >>> 8), seed: h });
  };
  const roomy = (x: number, z: number) => spots.every((s) => Math.hypot(s.x - x, s.z - z) >= CLEAR.person);
  const towers = city.props.filter((p) => p.kind === "water-tower");
  const clearOfLamps = (x: number, z: number) => lamps.every((l) => Math.hypot(l.x - x, l.z - z) >= CLEAR.lamp);

  /**
   * A spot on a roof is fine: inside the roof, off the tier, clear of its props and of a
   * neighbour's tank hanging over it.
   */
  const onRoof = (b: Building, props: Prop[], x: number, z: number) => {
    const e = CLEAR.roofEdge;
    if (!(x > b.x0 + e && x < b.x1 - e && z > b.z0 + e && z < b.z1 - e)) return false;
    if (b.top && inRect(b.top, x, z, e)) return false;
    if (props.some((p) => Math.hypot(p.at.x - x, p.at.z - z) < propRadius(p))) return false;
    if (towers.some((p) => p.buildingId !== b.id && Math.abs(p.at.y - b.h) < 120 && Math.hypot(p.at.x - x, p.at.z - z) < propRadius(p))) return false;
    return !forbidden(city, x, z) && roomy(x, z);
  };
  const propsOf = new Map<number, Prop[]>();
  for (const p of city.props) if (p.buildingId !== null) propsOf.set(p.buildingId, [...(propsOf.get(p.buildingId) ?? []), p]);

  /** A group along one roof edge (side 0 −z, 1 +x, 2 +z, 3 −x), facing out, or toward `face`. */
  const roofGroup = (b: Building, side: number, n: number, rng: CrowdRng, kind: SpotKind, zone: number, face: { x: number; z: number } | null, idle: string[], react: string[]) => {
    const props = propsOf.get(b.id) ?? [];
    const along = side % 2 === 0 ? b.x1 - b.x0 : b.z1 - b.z0;
    const inset = CLEAR.roofEdge + 10 + rng.range(0, 10);
    const t0 = rng.range(0.25, 0.75) * along;
    const spacing = rng.range(28, 36);
    let placed = 0;
    for (let k = 0; k < n * 3 && placed < n; k++) {
      const off = t0 + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * spacing);
      if (off < 0 || off > along) continue;
      const jitter = rng.range(-6, 6);
      let x: number, z: number, out: number;
      if (side === 0) [x, z, out] = [b.x0 + off, b.z0 + inset + jitter, Math.PI];
      else if (side === 1) [x, z, out] = [b.x1 - inset - jitter, b.z0 + off, Math.PI / 2];
      else if (side === 2) [x, z, out] = [b.x0 + off, b.z1 - inset - jitter, 0];
      else [x, z, out] = [b.x0 + inset + jitter, b.z0 + off, -Math.PI / 2];
      if (!onRoof(b, props, x, z)) continue;
      const yaw = face ? Math.atan2(face.x - x, face.z - z) : out + rng.range(-0.5, 0.5);
      person(kind, x, b.h, z, yaw, zone, rng, idle, react);
      placed++;
    }
    if (placed) group++;
    return placed;
  };

  /* -------------------------------------------------------------- fights */
  const fightRng = new CrowdRng(seed, 11);
  const rings = density.fight > 0 ? spectatorRings(city, grid) : [];
  for (const zone of fights(city)) {
    const want = density.fight;
    if (want <= 0) continue;
    const b = zone.bounds;
    const centre = { x: zone.center.x, z: zone.center.z };
    // Sidewalk points round the arena at a safe distance, facing in.
    const cands: { x: number; z: number }[] = [];
    for (const p of rings) {
      const step = 26;
      const tmp = { x: 0, z: 0, yaw: 0 };
      for (let s = 0; s < p.len; s += step) {
        walkAt(p, s, tmp);
        const d = rectDistance(b, tmp.x, tmp.z);
        if (d < CLEAR.arena + 10 || d > CLEAR.arenaFar) continue;
        if (forbidden(city, tmp.x, tmp.z) || !clearOfLamps(tmp.x, tmp.z)) continue;
        cands.push({ x: tmp.x, z: tmp.z });
      }
    }
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < want && cands.length; tries++) {
      const c = cands[fightRng.int(cands.length)];
      const size = Math.min(want - placed, 2 + fightRng.int(3));
      let got = 0;
      for (const q of cands) {
        if (got >= size) break;
        if (Math.hypot(q.x - c.x, q.z - c.z) > 70 || !roomy(q.x, q.z)) continue;
        person("fight", q.x, 0, q.z, Math.atan2(centre.x - q.x, centre.z - q.z) + fightRng.range(-0.25, 0.25), zone.index, fightRng, IDLE, WATCH);
        got++;
      }
      if (got) group++;
      placed += got;
    }
    // Groups on roofs round the arena, at the edges that face it: the fight's two-shot looks
    // across the arena at the city, so these are the spectators it sees.
    const near = city.buildings.filter((bd) => {
      const d = rectDistance(b, (bd.x0 + bd.x1) / 2, (bd.z0 + bd.z1) / 2);
      return d > CLEAR.arena + 40 && d < 420 && bd.x1 - bd.x0 > 100 && bd.z1 - bd.z0 > 100;
    });
    const sidesUsed = new Set<number>();
    for (let k = 0; k < 12 && sidesUsed.size < density.fightRoofs && near.length; k++) {
      const bd = near[fightRng.int(near.length)];
      const cx = (bd.x0 + bd.x1) / 2;
      const cz = (bd.z0 + bd.z1) / 2;
      const dx = centre.x - cx;
      const dz = centre.z - cz;
      const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0;
      // One group per side of the arena, so they ring it.
      if (sidesUsed.has(side)) continue;
      if (roofGroup(bd, side, 3 + fightRng.int(2), fightRng, "fight", zone.index, centre, IDLE, WATCH)) sidesUsed.add(side);
    }
  }

  /* -------------------------------------------------------------- errands */
  const errandRng = new CrowdRng(seed, 12);
  city.zones.forEach((zone, i) => {
    if (zone.kind !== "errand" || !zone.allyAt || density.errand <= 0) return;
    const ally = zone.allyAt;
    // The roof under the ally (or under Gwei's water tower): the highest one not above them.
    const roof = city.buildings.filter((bd) => inRect(bd, ally.x, ally.z) && bd.h <= ally.y + 1).sort((a, c) => c.h - a.h)[0] ?? null;
    if (!roof) return;
    const props = propsOf.get(roof.id) ?? [];
    // On a setback tier, the onlookers share the tier's roof.
    const tier = roof.top && inRect(roof.top, ally.x, ally.z) && Math.abs(roof.top.h - ally.y) < 1 ? roof.top : null;
    const fits = (x: number, z: number) => (tier ? inRect(tier, x, z, -CLEAR.roofEdge) && !forbidden(city, x, z) && roomy(x, z) && props.every((p) => Math.hypot(p.at.x - x, p.at.z - z) >= propRadius(p)) : onRoof(roof, props, x, z));
    const prev = pts[i] ?? pts[0];
    // The hero comes in from the last stop: the onlookers stand on the far side, fanned out.
    const away = Math.atan2(ally.x - prev.x, ally.z - prev.z);
    let placed = 0;
    for (let k = 0; k < 24 && placed < density.errand; k++) {
      const a = away + errandRng.range(-1.1, 1.1);
      const r = errandRng.range(CLEAR.allyMin, CLEAR.allyMax);
      const x = ally.x + Math.sin(a) * r;
      const z = ally.z + Math.cos(a) * r;
      if (!fits(x, z)) continue;
      person("errand", x, tier ? tier.h : roof.h, z, Math.atan2(ally.x - x, ally.z - z), zone.index, errandRng, ["talk", "stand-a", "phone", "stand-b"], ["wave", "photo", "clap", "cheer-a", "point"]);
      placed++;
    }
    if (placed) group++;
  });

  /* -------------------------------------------------------------- rooftops */
  const roofRng = new CrowdRng(seed, 13);
  const roofs = city.buildings.filter((bd) => {
    const cx = (bd.x0 + bd.x1) / 2;
    const cz = (bd.z0 + bd.z1) / 2;
    if (bd.x1 - bd.x0 < 110 || bd.z1 - bd.z0 < 110) return false;
    if (inArena(city, cx, cz, 160)) return false;
    if (inRect(bd, city.start.x, city.start.z, 40)) return false;
    if (city.zones.some((zn) => zn.kind === "errand" && inRect(zn.bounds, cx, cz))) return false;
    return routeDistance(pts, cx, cz) < 900;
  });
  // Nearer the route first, shuffled within that.
  const order = roofs.map((bd) => ({ bd, key: routeDistance(pts, (bd.x0 + bd.x1) / 2, (bd.z0 + bd.z1) / 2) / 900 + roofRng.next() * 0.8 })).sort((a, b) => a.key - b.key);
  let groups = 0;
  for (const { bd } of order) {
    if (groups >= density.roofGroups) break;
    const n = 2 + roofRng.int(3);
    if (roofGroup(bd, roofRng.int(4), n, roofRng, "roof", -1, null, IDLE, REACT)) groups++;
  }

  /* -------------------------------------------------------------- walkers */
  const walkRng = new CrowdRng(seed, 14);
  if (paths.length && density.walkers > 0) {
    const weight = paths.map((p) => 1 / (1 + routeDistance(pts, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) / 1200));
    const total = weight.reduce((a, b) => a + b, 0);
    const per = new Array<number>(paths.length).fill(0);
    for (let n = 0; n < density.walkers; n++) {
      let u = walkRng.next() * total;
      let i = 0;
      while (i < paths.length - 1 && u > weight[i]) u -= weight[i++];
      if (per[i] >= 4) continue;
      per[i]++;
      const body = walkRng.int(bodies.length);
      const h = hash32(seed, n, 91);
      walkers.push({ path: i, s: walkRng.next() * paths[i].len, dir: walkRng.chance(0.5) ? 1 : -1, body, look: walkRng.int(Math.max(1, bodies[body].looks)), channel: channelFor(WALK, bodies[body], h), react: channelFor(["look-up", "point", "wave", "photo"], bodies[body], h >>> 8), seed: h });
    }
  }
  return { spots, walkers, paths };
}

/** Sidewalk loops for spectators: every block's, the arenas' neighbours included. */
function spectatorRings(city: City, grid: StreetGrid): WalkPath[] {
  return walkPaths({ ...city, zones: city.zones.filter((z: Zone) => z.kind !== "fight") }, grid);
}
