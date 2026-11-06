/**
 * Free roam's one city and everything placed in it, built once from ROAM_CITY_SEED and always
 * the same, so a page found on one outing stays found on the next.
 *
 * - The city: a patrol-style city (generateCity) on a fixed stop list, so the four allies keep
 *   their roofs and Doc's bridge crosses the river. Patrol nights never see it.
 * - Solids (added to roam's own CityIndex, never a patrol's): the rooftop AC units (taller here,
 *   to vault), water tanks to climb and stand on, antenna poles, and a sync mast per district.
 * - People: the four allies on their roofs, a dozen chatty civilians on the sidewalks and a few
 *   up top, and the jogger whose wallet the pickpocket bot took.
 * - Collectibles: twelve Daily Rug pages, five viewpoints, Mary Jpeg's eight pixels, Gas Goblin's
 *   four tags, and the bot's loop over the roofs.
 *
 * Pure and deterministic: placement is by hashed rank (mix) and plain arithmetic.
 */
import type { Stop } from "../../rules/types";
import { CityIndex, groundBelow, lineClear, overRiver } from "../city";
import { clearAt } from "../parkour/geometry";
import { HERO_RADIUS, WATER_TOWER_TOP } from "../constants";
import type { Building, City, DistrictId, Prop, Vec3 } from "../contract";
import { generateCity } from "../city";
import { len2 } from "../dmath";
import { mix } from "../rng";
import { ROAM_CITY_SEED } from "./constants";
import type { RoamFolk, RoamRoof, RoamSpot, RoamTag, RoamView, RoamWorld } from "./types";

/** The stops the roam city is built on: the allies' roofs and Doc's bridge (nobody fights here). */
export const ROAM_STOPS: Stop[] = [
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
  { kind: "errand", ally: "bearson", errand: "interview", district: "sector-7" },
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 1, boss: false, quest: false },
  { kind: "errand", ally: "mary-jpeg", errand: "selfie", district: "mempool-market" },
  { kind: "errand", ally: "uncle-gen", errand: "the-speech", district: "validator-heights" },
];

/** Rooftop AC units stand this tall in free roam (a patrol's are 24): something to vault. */
export const ROAM_AC_H = 52;
/** A viewpoint's mast: this tall above its roof, this wide (its top is the perch). */
export const MAST_H = 150;
export const MAST_HALF = 7;
/** Water tanks are solid columns this far either side of their centre. */
const TANK_HALF = 26;
/** Antenna poles are solid this far either side. */
const POLE_HALF = 5;

/** Whether a sphere touches nothing solid (the movement set's, sim3d/parkour/geometry.ts). */
export { clearAt };

/** A hashed rank for item i of a kind, so candidates are tried in a fixed shuffled order. */
const rank = (salt: number, i: number) => mix(ROAM_CITY_SEED ^ salt, i + 1);

function byRank<T>(items: T[], salt: number): T[] {
  return items.map((it, i) => ({ it, r: rank(salt, i) })).sort((a, b) => a.r - b.r).map((x) => x.it);
}

const roofOf = (b: Building) => (b.top ? { x0: b.top.x0, z0: b.top.z0, x1: b.top.x1, z1: b.top.z1, y: b.top.h } : { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y: b.h });

/** The roam city's props: the patrol city's, AC units made taller, and a sync mast on each district's tallest free roof. */
function dressCity(city: City): City {
  const props: Prop[] = city.props.map((p) => (p.kind === "ac" ? { ...p, h: ROAM_AC_H } : p));
  const anchors = [...city.anchors];
  const zoneOf = (b: Building) => city.zones.some((z) => b.x0 < z.bounds.x1 && b.x1 > z.bounds.x0 && b.z0 < z.bounds.z1 && b.z1 > z.bounds.z0);
  const districts: DistrictId[] = ["sector-7", "mempool-market", "bridge-district", "queens-block", "validator-heights"];
  for (const d of districts) {
    let best: Building | null = null;
    for (const b of city.buildings) {
      if (b.district !== d || zoneOf(b)) continue;
      const r = roofOf(b);
      if (r.x1 - r.x0 < 70 || r.z1 - r.z0 < 70) continue;
      if (!best || r.y > roofOf(best).y) best = b;
    }
    if (!best) continue;
    const r = roofOf(best);
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    // Off the middle when a prop already stands there.
    const spots: [number, number][] = [
      [cx, cz],
      [cx + 30, cz + 30],
      [cx - 30, cz - 30],
      [cx + 30, cz - 30],
      [cx - 30, cz + 30],
    ];
    const free = spots.find(([x, z]) => props.every((p) => p.buildingId !== best!.id || p.at.y !== r.y || len2(p.at.x - x, p.at.z - z) > 50)) ?? spots[0];
    // Clear what stood in the way (a mast needs room to land round it).
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (p.buildingId === best.id && p.at.y === r.y && len2(p.at.x - free[0], p.at.z - free[1]) < 50) props.splice(i, 1);
    }
    props.push({ kind: "antenna", at: { x: free[0], y: r.y, z: free[1] }, facing: 0, w: MAST_HALF * 2, h: MAST_H, d: MAST_HALF * 2, buildingId: best.id });
    anchors.push({ at: { x: free[0], y: r.y + MAST_H, z: free[1] }, kind: "antenna" });
  }
  // Nobody fights here: the bridge's stage stays, its villain doesn't (no body is fetched for him).
  const zones = city.zones.map((z) => (z.villain ? { ...z, villain: null } : z));
  return { ...city, props, anchors, zones };
}

let cached: { city: City; world: RoamWorld } | null = null;

/** The roam city (built once and shared: nothing mutates it). */
export function roamCity(): City {
  return build().city;
}

/** The roam city's placements (built once). */
export function roamWorld(): RoamWorld {
  return build().world;
}

/**
 * Roam's own spatial index: the city's boxes plus its solids (AC units, tanks, poles, masts).
 * A fresh one per run (the index keeps query scratch), the same boxes every time.
 */
export function roamGrid(city: City): CityIndex {
  const g = new CityIndex(city);
  for (const p of city.props) {
    const { x, y, z } = p.at;
    if (p.kind === "ac") g.addSolid(x - p.w / 2, y, z - p.d / 2, x + p.w / 2, y + p.h, z + p.d / 2);
    else if (p.kind === "water-tower") g.addSolid(x - TANK_HALF, y, z - TANK_HALF, x + TANK_HALF, y + WATER_TOWER_TOP, z + TANK_HALF);
    else if (p.kind === "antenna") {
      const half = p.w >= MAST_HALF * 2 ? MAST_HALF : POLE_HALF;
      g.addSolid(x - half, y, z - half, x + half, y + p.h, z + half);
    }
  }
  return g;
}

function build(): { city: City; world: RoamWorld } {
  if (cached) return cached;
  const city = dressCity(generateCity(ROAM_CITY_SEED, ROAM_STOPS));
  const grid = roamGrid(city);
  cached = { city, world: place(city, grid) };
  return cached;
}

/* ------------------------------------------------------------------ placement */

/** The district a point is in: its nearest stop's (as the generator labels buildings). */
function districtAt(city: City, x: number, z: number): DistrictId {
  let best: DistrictId = "queens-block";
  let bd = Infinity;
  for (const zn of city.zones) {
    const d = len2(zn.center.x - x, zn.center.z - z);
    if (d < bd) {
      bd = d;
      best = zn.district;
    }
  }
  return best;
}

/** Inside a zone (an ally's roof clearing, the bridge's stage), where nothing else goes. */
function inZone(city: City, x: number, z: number, pad: number): boolean {
  return city.zones.some((zn) => x > zn.bounds.x0 - pad && x < zn.bounds.x1 + pad && z > zn.bounds.z0 - pad && z < zn.bounds.z1 + pad);
}

/** A feet-level point a body of radius r can stand at. */
function standable(grid: CityIndex, x: number, feet: number, z: number, r = HERO_RADIUS): boolean {
  return clearAt(grid, x, feet + r + 1, z, r) && groundBelow(grid, x, z, feet + 2) >= feet - 2;
}

interface Walk {
  x: number;
  z: number;
  /** The outward normal of the facade beside it (the street side). */
  nx: number;
  nz: number;
  len: number;
}

/** Sidewalk spots: the middle of each street-level facade, a step out from it. */
function sidewalks(city: City, grid: CityIndex): Walk[] {
  const out: Walk[] = [];
  for (const e of grid.edges) {
    if (e.y0 > 0.5 || e.hi - e.lo < 120) continue;
    const t = (e.lo + e.hi) / 2;
    const nx = e.axis === 1 ? e.n : 0;
    const nz = e.axis === 0 ? e.n : 0;
    const x = (e.axis === 0 ? t : e.c) + nx * 34;
    const z = (e.axis === 0 ? e.c : t) + nz * 34;
    if (overRiver(city, x, z) || inZone(city, x, z, 40)) continue;
    // Out on a street, not wedged in an alley: room in front.
    if (!standable(grid, x, 0, z, 22) || !clearAt(grid, x + nx * 70, 30, z + nz * 70, 28)) continue;
    out.push({ x, z, nx, nz, len: e.hi - e.lo });
  }
  return out;
}

/** Pick up to n items in rank order, each at least `gap` from every other picked (and from `avoid`). */
function spread<T extends { x: number; z: number }>(cands: T[], n: number, gap: number, avoid: { x: number; z: number }[] = []): T[] {
  const out: T[] = [];
  for (const c of cands) {
    if (out.length >= n) break;
    if (out.some((o) => len2(o.x - c.x, o.z - c.z) < gap)) continue;
    if (avoid.some((o) => len2(o.x - c.x, o.z - c.z) < gap * 0.6)) continue;
    out.push(c);
  }
  return out;
}

/** A clear spot on a roof (its top tier if it has one), inset from the edges, or null. */
function roofSpot(grid: CityIndex, b: Building, salt: number, lower = false): Vec3 | null {
  const r = lower && b.top ? { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y: b.h } : roofOf(b);
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if (w < 90 || d < 90) return null;
  for (let k = 0; k < 8; k++) {
    const h = mix(salt, b.id * 31 + k);
    const fx = 0.2 + 0.6 * ((h & 0xffff) / 0xffff);
    const fz = 0.2 + 0.6 * ((h >>> 16) / 0xffff);
    const x = r.x0 + w * fx;
    const z = r.z0 + d * fz;
    // A lower roof's spot must be off the tier standing on it.
    if (lower && b.top && x > b.top.x0 - 30 && x < b.top.x1 + 30 && z > b.top.z0 - 30 && z < b.top.z1 + 30) continue;
    if (standable(grid, x, r.y, z)) return { x, y: r.y, z };
  }
  return null;
}

function place(city: City, grid: CityIndex): RoamWorld {
  const s = city.start;
  const spawn = { x: s.x, y: s.y, z: s.z, fx: 1, fz: 0 };
  const folks: RoamFolk[] = [];
  const addFolk = (f: Omit<RoamFolk, "id">) => folks.push({ ...f, id: folks.length });

  // The allies, on their roofs.
  const allyKey: Record<string, string> = { "aunt-mainnet": "aunt", bearson: "bearson", "mary-jpeg": "mary", "uncle-gen": "uncle" };
  const allyTask: Record<string, { gives: RoamFolk["gives"]; takes: RoamFolk["takes"] }> = {
    "aunt-mainnet": { gives: "bread", takes: null },
    "uncle-gen": { gives: null, takes: "bread" },
    "mary-jpeg": { gives: "pixels", takes: "pixels" },
    bearson: { gives: "graffiti", takes: "graffiti" },
  };
  for (const zn of city.zones) {
    if (zn.kind !== "errand" || !zn.ally || !zn.allyAt) continue;
    const a = zn.allyAt;
    const t = allyTask[zn.ally];
    addFolk({ key: allyKey[zn.ally], body: -1, cast: zn.ally === "aunt-mainnet" ? "aunt-mainnet" : zn.ally === "uncle-gen" ? "uncle-gen" : zn.ally === "mary-jpeg" ? "mary-jpeg" : "bearson", x: a.x, y: a.y, z: a.z, yaw: 0, gives: t.gives, takes: t.takes });
  }

  // The civilians: the jogger near the start (the pickpocket's victim), then the talkers, spread out.
  const walks = byRank(sidewalks(city, grid), 0xc1f);
  const near = walks.filter((w) => {
    const d = len2(w.x - s.x, w.z - s.z);
    return d > 420 && d < 900;
  });
  const victim = near[0] ?? walks[0];
  const yawOf = (w: Walk) => {
    // Facing the street, a little along it.
    if (w.nx > 0.5) return 1.5708;
    if (w.nx < -0.5) return -1.5708;
    return w.nz > 0 ? 0 : 3.1416;
  };
  addFolk({ key: "dev", body: 1, cast: null, x: victim.x, y: 0, z: victim.z, yaw: yawOf(victim), gives: "pickpocket", takes: "pickpocket" });
  const TALKERS: { key: string; body: number }[] = [
    { key: "notary", body: 2 },
    { key: "influencer", body: 3 },
    { key: "landlord", body: 4 },
    { key: "miner", body: 5 },
    { key: "intern", body: 6 },
    { key: "kid", body: 7 },
    { key: "auditor", body: 0 },
    { key: "hodler", body: 2 },
    { key: "maxi", body: 5 },
    { key: "barista", body: 3 },
  ];
  const picked = spread(walks, TALKERS.length, 760, [victim, ...folks]);
  picked.forEach((w, i) => addFolk({ key: TALKERS[i].key, body: TALKERS[i].body, cast: null, x: w.x, y: 0, z: w.z, yaw: yawOf(w), gives: null, takes: null }));
  // Two up on the roofs, near the start: the city's people live up there too.
  const ROOFERS: { key: string; body: number }[] = [
    { key: "gardener", body: 4 },
    { key: "pigeon", body: 6 },
  ];
  const roofCands = byRank(
    city.buildings.filter((b) => !inZone(city, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0) && len2((b.x0 + b.x1) / 2 - s.x, (b.z0 + b.z1) / 2 - s.z) < 1800 && roofOf(b).y < 420),
    0xf00f,
  )
    .map((b) => roofSpot(grid, b, 0x700f))
    .filter((p): p is Vec3 => p !== null && len2(p.x - s.x, p.z - s.z) > 400);
  spread(roofCands, ROOFERS.length, 700, folks).forEach((p, i) => addFolk({ key: ROOFERS[i].key, body: ROOFERS[i].body, cast: null, x: p.x, y: p.y, z: p.z, yaw: 0, gives: null, takes: null }));

  // Viewpoints: the masts dressCity put up.
  const views: RoamView[] = [];
  for (const p of city.props) {
    if (p.kind !== "antenna" || p.w < MAST_HALF * 2 || p.buildingId === null) continue;
    views.push({ x: p.at.x, y: p.at.y + p.h, z: p.at.z, roof: p.at.y, district: districtAt(city, p.at.x, p.at.z), building: p.buildingId });
  }

  // Daily Rug pages: on roofs high and low, on the lower roofs of setbacks, on water tanks and down in the street.
  const taken: { x: number; z: number }[] = [...folks, ...views];
  const pages: RoamSpot[] = [];
  const pushPages = (spots: Vec3[], n: number) => {
    for (const p of spread(spots, n, 820, [...taken, ...pages])) pages.push({ x: p.x, y: p.y, z: p.z, district: districtAt(city, p.x, p.z) });
  };
  const free = city.buildings.filter((b) => !inZone(city, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 60));
  const tall = [...free].sort((a, b) => roofOf(b).y - roofOf(a).y);
  pushPages(tall.slice(0, 24).map((b) => roofSpot(grid, b, 0x9a6e)).filter((p): p is Vec3 => p !== null), 3);
  pushPages(
    byRank(free.filter((b) => b.top), 0x5e7b)
      .map((b) => roofSpot(grid, b, 0x5e7c, true))
      .filter((p): p is Vec3 => p !== null),
    2,
  );
  pushPages(
    byRank(city.props.filter((p) => p.kind === "water-tower" && !inZone(city, p.at.x, p.at.z, 60)), 0x7a4c).map((p) => ({ x: p.at.x, y: p.at.y + WATER_TOWER_TOP, z: p.at.z })),
    2,
  );
  pushPages(
    byRank(walks, 0x57ee7).map((w) => ({ x: w.x - w.nx * 4, y: 0, z: w.z - w.nz * 4 })),
    2,
  );
  pushPages(
    byRank(free, 0x2007)
      .map((b) => roofSpot(grid, b, 0x2008))
      .filter((p): p is Vec3 => p !== null),
    12 - pages.length,
  );

  // Mary Jpeg's pixels: on the roofs round hers, and two stuck high on walls (caught on the climb).
  const mary = folks.find((f) => f.key === "mary")!;
  const pixels: RoamSpot[] = [];
  const marySpots = byRank(
    free.filter((b) => {
      const d = len2((b.x0 + b.x1) / 2 - mary.x, (b.z0 + b.z1) / 2 - mary.z);
      return d > 260 && d < 1150;
    }),
    0x919e1,
  )
    .map((b) => roofSpot(grid, b, 0x919e2))
    .filter((p): p is Vec3 => p !== null);
  for (const p of spread(marySpots, 6, 240, [...taken, ...pages])) pixels.push({ x: p.x, y: p.y, z: p.z, district: districtAt(city, p.x, p.z) });
  const wallPx = byRank(
    grid.edges.filter((e) => {
      const t = (e.lo + e.hi) / 2;
      const x = e.axis === 0 ? t : e.c;
      const z = e.axis === 0 ? e.c : t;
      if (!(e.y0 < 0.5 && e.y > 200 && e.hi - e.lo > 120 && len2(x - mary.x, z - mary.z) < 1100 && len2(x - mary.x, z - mary.z) > 300)) return false;
      // On a street wall (room below to start the climb from), not down an alley.
      const nx = e.axis === 1 ? e.n : 0;
      const nz = e.axis === 0 ? e.n : 0;
      return !overRiver(city, x + nx * 60, z + nz * 60) && clearAt(grid, x + nx * 40, HERO_RADIUS + 1, z + nz * 40, HERO_RADIUS) && clearAt(grid, x + nx * 90, 30, z + nz * 90, 28);
    }),
    0x919e3,
  ).map((e) => {
    const t = (e.lo + e.hi) / 2;
    const nx = e.axis === 1 ? e.n : 0;
    const nz = e.axis === 0 ? e.n : 0;
    return { x: (e.axis === 0 ? t : e.c) + nx * (HERO_RADIUS + 6), y: e.y * 0.6, z: (e.axis === 0 ? e.c : t) + nz * (HERO_RADIUS + 6) };
  });
  for (const p of spread(wallPx, 8 - pixels.length, 240, [...pixels, ...pages])) pixels.push({ x: p.x, y: p.y, z: p.z, district: districtAt(city, p.x, p.z) });

  // Gas Goblin's tags round Bearson's roof: high on street walls, with room in front to frame them.
  const bearson = folks.find((f) => f.key === "bearson")!;
  const tagCands: RoamTag[] = [];
  for (const e of byRank([...grid.edges], 0x6a5)) {
    if (e.y0 > 0.5 || e.hi - e.lo < 150 || e.y < 220) continue;
    const t = (e.lo + e.hi) / 2;
    const nx = e.axis === 1 ? e.n : 0;
    const nz = e.axis === 0 ? e.n : 0;
    const x = e.axis === 0 ? t : e.c;
    const z = e.axis === 0 ? e.c : t;
    const d = len2(x - bearson.x, z - bearson.z);
    if (d < 300 || d > 1700 || overRiver(city, x + nx * 200, z + nz * 200)) continue;
    const y = Math.min(e.y - 50, Math.max(130, e.y * 0.5));
    // Room in front to frame it from, inside the city (a street, not the edge of the map).
    const fx = x + nx * 260;
    const fz = z + nz * 260;
    const cb = city.bounds;
    if (fx < cb.x0 + 60 || fx > cb.x1 - 60 || fz < cb.z0 + 60 || fz > cb.z1 - 60) continue;
    if (!clearAt(grid, x + nx * 220, y, z + nz * 220, 34) || !clearAt(grid, fx, HERO_RADIUS + 1, fz, HERO_RADIUS)) continue;
    tagCands.push({ x: x + nx * 1, y, z: z + nz * 1, nx, nz });
  }
  const tags = spread(tagCands, 4, 520);

  // The pickpocket bot's loop: roofs round the jogger, each a hop from the last.
  const botPath = botLoop(city, new CityIndex(city), victim);

  // The river's banks: clear street spots beside it, every 240 along each side.
  const banks: RoamWorld["banks"] = [];
  const rv = city.river;
  if (rv) {
    const alongZ = rv.z1 - rv.z0 > rv.x1 - rv.x0;
    const lo = alongZ ? rv.z0 : rv.x0;
    const hi = alongZ ? rv.z1 : rv.x1;
    for (let u = lo + 120; u < hi - 60; u += 240) {
      for (const side of [-1, 1]) {
        const x = alongZ ? (side < 0 ? rv.x0 - 40 : rv.x1 + 40) : u;
        const z = alongZ ? u : side < 0 ? rv.z0 - 40 : rv.z1 + 40;
        if (standable(grid, x, 0, z)) banks.push({ x0: x, z0: z, x1: x, z1: z });
      }
    }
  }

  return { spawn, folks, pages, views, pixels, tags, botPath, banks };
}

/**
 * The bot's run: from a roof by the jogger, roof to roof, each next one within a hop (a gap of
 * at most 360, a step of at most 200 up or down, the arc clear of buildings), circling the
 * jogger. Back the way it came if the loop doesn't close. Feet points at each roof's middle.
 * `grid` is the plain city's (the bot hops its rooftop clutter).
 */
function botLoop(city: City, grid: CityIndex, v: { x: number; z: number }): RoamRoof[] {
  const roofs = city.buildings
    .filter((b) => {
      const r = roofOf(b);
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      return r.y >= 140 && r.y <= 460 && r.x1 - r.x0 >= 90 && r.z1 - r.z0 >= 90 && !inZone(city, cx, cz, 40) && len2(cx - v.x, cz - v.z) < 1500;
    })
    .map((b) => {
      const r = roofOf(b);
      return { b, r, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
    });
  type R = (typeof roofs)[number];
  const gap = (a: R, b: R) => {
    const dx = Math.max(0, Math.max(a.r.x0, b.r.x0) - Math.min(a.r.x1, b.r.x1));
    const dz = Math.max(0, Math.max(a.r.z0, b.r.z0) - Math.min(a.r.z1, b.r.z1));
    return len2(dx, dz);
  };
  const hop = (a: R, b: R) => {
    if (gap(a, b) > 360 || b.r.y - a.r.y > 200 || a.r.y - b.r.y > 200) return false;
    // The arc over the gap stays clear: the line between the roofs, lifted over the higher one.
    const top = Math.max(a.r.y, b.r.y) + 60;
    return lineClear(grid, a.x, top, a.z, b.x, top, b.z);
  };
  const angle = (p: { x: number; z: number }) => {
    // A cheap monotone stand-in for atan2 (0–4 round the circle), enough to order by.
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    const s = Math.abs(dx) + Math.abs(dz) || 1;
    const t = dx / s;
    return dz >= 0 ? 1 - t : 3 + t;
  };
  if (!roofs.length) return [];
  let start = roofs[0];
  for (const r of roofs) if (len2(r.x - v.x, r.z - v.z) < len2(start.x - v.x, start.z - v.z)) start = r;
  const path: R[] = [start];
  for (let k = 0; k < 9; k++) {
    const cur = path[path.length - 1];
    const a0 = angle(cur);
    let best: R | null = null;
    let bestScore = -Infinity;
    for (const r of roofs) {
      if (path.includes(r) || !hop(cur, r)) continue;
      let da = angle(r) - a0;
      if (da < 0) da += 4;
      // Onward round the circle, at a fair distance out, not too far a step.
      const d = len2(r.x - v.x, r.z - v.z);
      const score = (da > 0.02 && da < 1.4 ? 2 - da : -3) - Math.abs(d - 650) / 600 - len2(r.x - cur.x, r.z - cur.z) / 1400;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) break;
    path.push(best);
  }
  const pts = path.map((r) => ({ x: r.x, y: r.r.y, z: r.z, x0: r.r.x0, z0: r.r.z0, x1: r.r.x1, z1: r.r.z1 }));
  if (path.length >= 3 && hop(path[path.length - 1], path[0])) return pts;
  // Back the way it came.
  return [...pts, ...pts.slice(1, -1).reverse()];
}
