/**
 * A local stand-in for game-core's `generateCity` (packages/game-core/src/sim3d/city.ts),
 * so the scene can be built and judged before the real generator lands. It returns a valid
 * `City` per the frozen contract: a 9×9 grid of blocks split into lots, district heights
 * from the 2D world (src/sim/core/world.ts DISTRICT_STYLE), setback tops, rooftop props,
 * three construction cranes, a river along one grid line with the red bridge over it, and
 * five patrol stops.
 *
 * A scene fixture, never a sim input: stable for a seed, but not built with the sim's
 * deterministic math. It follows the same conventions as game-core's generator (contract v1.1):
 * - `Building.top.h` is the setback's roof height from the street (the tier spans h → top.h).
 * - `Prop.at` is the prop's base centre; `facing` turns the prop's front (+z) by quarter
 *   turns: 0 → +z, 1 → +x, 2 → −z, 3 → −x.
 * - Cranes stand on the street (`at.y = 0`): `h` is the mast, `w` the jib, `d` the mast width.
 * - `Bridge.towers` are the legs' top centres (square columns from the street), with `axis`
 *   and `towerHalf`; `City.cables` lists the bridge cables; errands set `Zone.allyAt`.
 */
import { BILLBOARDS } from "@wgp/game-core/content";
import type { Building, Cable, City, DistrictId, Prop, PropAnchor, Vec3, Zone } from "@wgp/game-core/sim3d/contract";

export const FIXTURE_GRID = {
  blocks: 9,
  block: 560,
  street: 150,
  river: 380,
  /** The river replaces the street after this block column. */
  riverAfter: 5,
  /** Sidewalk between the block edge and the buildings. */
  sidewalk: 16,
} as const;

const DISTRICT_HEIGHTS: Record<DistrictId, { lo: number; hi: number; billboards: number; tower: number }> = {
  "sector-7": { lo: 200, hi: 470, billboards: 0.16, tower: 0.32 },
  "mempool-market": { lo: 210, hi: 430, billboards: 0.34, tower: 0.25 },
  "bridge-district": { lo: 200, hi: 420, billboards: 0.16, tower: 0.3 },
  "queens-block": { lo: 170, hi: 320, billboards: 0.1, tower: 0.4 },
  "validator-heights": { lo: 380, hi: 760, billboards: 0.08, tower: 0.12 },
};

/** A small integer RNG (mulberry32): stable across runs for the same seed. */
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length) % list.length];
  }
}

function districtOf(col: number, row: number): DistrictId {
  if (col >= 3 && col <= 5 && row >= 3 && row <= 5) return "validator-heights";
  if (col === 5 || col === 6) return "bridge-district";
  if (col <= 2) return row <= 4 ? "sector-7" : "queens-block";
  if (col <= 4) return row >= 6 ? "queens-block" : "mempool-market";
  return "mempool-market";
}

interface Span {
  a: number;
  b: number;
}

/** Block extents along one axis, with the river gap after `riverAfter` (x only). */
function blockSpans(withRiver: boolean): { spans: Span[]; total: number; riverGap: Span | null } {
  const g = FIXTURE_GRID;
  const spans: Span[] = [];
  let x = 0;
  let riverGap: Span | null = null;
  for (let i = 0; i < g.blocks; i++) {
    spans.push({ a: x, b: x + g.block });
    x += g.block;
    if (i < g.blocks - 1) {
      const gap = withRiver && i === g.riverAfter ? g.river : g.street;
      if (withRiver && i === g.riverAfter) riverGap = { a: x, b: x + gap };
      x += gap;
    }
  }
  const half = x / 2;
  for (const s of spans) {
    s.a -= half;
    s.b -= half;
  }
  if (riverGap) {
    riverGap.a -= half;
    riverGap.b -= half;
  }
  return { spans, total: x, riverGap };
}

/** Split [a, b] into `n` parts with jittered cuts and an optional alley. */
function splitSpan(rng: Rng, a: number, b: number, n: number): Span[] {
  if (n <= 1) return [{ a, b }];
  const cuts = [a];
  for (let i = 1; i < n; i++) cuts.push(a + ((b - a) * i) / n + rng.range(-40, 40));
  cuts.push(b);
  const out: Span[] = [];
  for (let i = 0; i < n; i++) {
    const alley = rng.next() < 0.35 ? rng.range(10, 22) : 0;
    out.push({ a: cuts[i] + (i > 0 ? alley / 2 : 0), b: cuts[i + 1] - (i < n - 1 ? alley / 2 : 0) });
  }
  return out;
}

export function generateFixtureCity(seed = 7): City {
  const rng = new Rng(seed ^ 0x51ed27);
  const g = FIXTURE_GRID;
  const xs = blockSpans(true);
  const zs = blockSpans(false);
  const bounds = {
    x0: xs.spans[0].a - g.street,
    x1: xs.spans[xs.spans.length - 1].b + g.street,
    z0: zs.spans[0].a - g.street,
    z1: zs.spans[zs.spans.length - 1].b + g.street,
  };

  const buildings: Building[] = [];
  const props: Prop[] = [];
  const anchors: PropAnchor[] = [];
  const blockOf: { col: number; row: number; ids: number[] }[] = [];

  // Construction sites: a lot each, with a crane instead of a building.
  const sites = new Set<string>(["1:6", "7:2", "4:7"]);

  for (let col = 0; col < g.blocks; col++) {
    for (let row = 0; row < g.blocks; row++) {
      const district = districtOf(col, row);
      const style = DISTRICT_HEIGHTS[district];
      const bx = xs.spans[col];
      const bz = zs.spans[row];
      const inner = { x0: bx.a + g.sidewalk, x1: bx.b - g.sidewalk, z0: bz.a + g.sidewalk, z1: bz.b - g.sidewalk };
      const pattern = rng.next();
      const nx = district === "validator-heights" ? (pattern < 0.5 ? 1 : 2) : pattern < 0.55 ? 2 : pattern < 0.8 ? 3 : 1;
      const nz = district === "validator-heights" ? 2 : rng.next() < 0.6 ? 2 : rng.next() < 0.5 ? 1 : 3;
      const ids: number[] = [];
      const lotsX = splitSpan(rng, inner.x0, inner.x1, nx);
      const lotsZ = splitSpan(rng, inner.z0, inner.z1, nz);
      let lotIndex = 0;
      for (const lx of lotsX) {
        for (const lz of lotsZ) {
          const site = lotIndex === 0 && sites.has(`${col}:${row}`);
          lotIndex += 1;
          if (site) {
            const facing = rng.pick([0, 1, 2, 3] as const);
            props.push({
              kind: "crane",
              at: { x: (lx.a + lx.b) / 2, y: 0, z: (lz.a + lz.b) / 2 },
              facing,
              w: rng.range(260, 320),
              h: rng.range(760, 920),
              d: 26,
              buildingId: null,
            });
            continue;
          }
          const inset = rng.next() < 0.5 ? 0 : rng.range(2, 10);
          const x0 = lx.a + inset;
          const x1 = lx.b - inset;
          const z0 = lz.a + inset;
          const z1 = lz.b - inset;
          if (x1 - x0 < 90 || z1 - z0 < 90) continue;
          let h = rng.range(style.lo, style.hi);
          // Validator Heights peaks toward the middle.
          if (district === "validator-heights" && col === 4 && row === 4) h += 180;
          h = Math.round(h);
          const w = x1 - x0;
          const d = z1 - z0;
          let top: Building["top"] = null;
          if (h > 360 && rng.next() < 0.5 && w > 150 && d > 150) {
            const fx = rng.range(0.18, 0.3);
            const fz = rng.range(0.18, 0.3);
            const shiftX = rng.range(-0.08, 0.08) * w;
            const shiftZ = rng.range(-0.08, 0.08) * d;
            top = {
              x0: Math.round(x0 + w * fx + shiftX),
              x1: Math.round(x1 - w * fx + shiftX),
              z0: Math.round(z0 + d * fz + shiftZ),
              z1: Math.round(z1 - d * fz + shiftZ),
              h: Math.round(h + rng.range(80, 190)),
            };
          }
          const id = buildings.length;
          const b: Building = {
            id,
            x0: Math.round(x0),
            z0: Math.round(z0),
            x1: Math.round(x1),
            z1: Math.round(z1),
            h,
            top,
            district,
            tone: rng.int(0, 3),
            accent: district !== "validator-heights" && rng.next() < 0.15,
            seed: Math.floor(rng.next() * 0xffffff),
          };
          buildings.push(b);
          ids.push(id);
          addRoofProps(rng, b, style, props, anchors, bx, bz);
        }
      }
      blockOf.push({ col, row, ids });
    }
  }

  // Crane anchors: the jib tips.
  for (const p of props) {
    if (p.kind !== "crane") continue;
    const dir = facingDir(p.facing);
    anchors.push({ at: { x: p.at.x + dir.x * p.w, y: p.h + 8, z: p.at.z + dir.z * p.w }, kind: "crane" });
  }

  // The river and the bridge over it, on the street between rows 4 and 5: four legs, six cables.
  const riverGap = xs.riverGap!;
  const river = { x0: riverGap.a, x1: riverGap.b, z0: bounds.z0, z1: bounds.z1 };
  const zc = (zs.spans[4].b + zs.spans[5].a) / 2;
  const deck = { x0: river.x0 - 70, x1: river.x1 + 70, z0: zc - 46, z1: zc + 46, y: 120 };
  const towerHalf = 16;
  const towerTop = 470;
  const towers: Vec3[] = [];
  for (const x of [river.x0 + 64, river.x1 - 64]) for (const z of [deck.z0 - towerHalf, deck.z1 + towerHalf]) towers.push({ x, y: towerTop, z });
  const cables: Cable[] = [];
  for (const z of [deck.z0 - towerHalf, deck.z1 + towerHalf]) {
    const a = { x: river.x0 + 64, y: towerTop, z };
    const b = { x: river.x1 - 64, y: towerTop, z };
    cables.push(
      { a: { x: deck.x0 + 8, y: deck.y + 20, z }, b: a, sag: 20, kind: "bridge" },
      { a, b, sag: 230, kind: "bridge" },
      { a: b, b: { x: deck.x1 - 8, y: deck.y + 20, z }, sag: 20, kind: "bridge" },
    );
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      anchors.push({ at: { x: a.x + (b.x - a.x) * t, y: towerTop - 230 * 4 * t * (1 - t), z }, kind: "cable" });
    }
  }
  for (const t of towers) anchors.push({ at: { ...t, y: t.y + 8 }, kind: "tower" });

  // Five stops, one per district.
  const byId = (id: number) => buildings[id];
  const tallestIn = (col: number, row: number): Building => {
    const blk = blockOf.find((b) => b.col === col && b.row === row)!;
    return blk.ids.map(byId).reduce((a, b) => (roofTop(b) > roofTop(a) ? b : a));
  };
  const blockBounds = (col: number, row: number, extra: number) => {
    const blk = blockOf.find((b) => b.col === col && b.row === row)!;
    const tall = Math.max(...blk.ids.map((id) => roofTop(byId(id))));
    return {
      x0: xs.spans[col].a - g.street / 2,
      x1: xs.spans[col].b + g.street / 2,
      z0: zs.spans[row].a - g.street / 2,
      z1: zs.spans[row].b + g.street / 2,
      h: tall + extra,
    };
  };
  const roofCentre = (b: Building): Vec3 =>
    b.top ? { x: (b.top.x0 + b.top.x1) / 2, y: b.top.h, z: (b.top.z0 + b.top.z1) / 2 } : { x: (b.x0 + b.x1) / 2, y: b.h, z: (b.z0 + b.z1) / 2 };

  const stops: { kind: Zone["kind"]; col: number; row: number; villain: Zone["villain"]; ally: Zone["ally"] }[] = [
    { kind: "fight", col: 1, row: 2, villain: "gas-goblin", ally: null },
    { kind: "errand", col: 2, row: 6, villain: null, ally: "aunt-mainnet" },
    { kind: "fight", col: 7, row: 6, villain: "sandwich-man", ally: null },
    { kind: "errand", col: 4, row: 3, villain: null, ally: "mary-jpeg" },
  ];
  const zones: Zone[] = stops.map((s, index) => {
    const b = tallestIn(s.col, s.row);
    const center = roofCentre(b);
    return {
      index,
      kind: s.kind,
      district: districtOf(s.col, s.row),
      center,
      bounds: blockBounds(s.col, s.row, 420),
      villain: s.villain,
      ally: s.ally,
      allyAt: s.ally ? { x: center.x + 30, y: center.y, z: center.z } : null,
    };
  });
  zones.push({
    index: zones.length,
    kind: "fight",
    district: "bridge-district",
    center: { x: (deck.x0 + deck.x1) / 2, y: deck.y, z: zc },
    bounds: { x0: deck.x0 - 200, x1: deck.x1 + 200, z0: zc - 520, z1: zc + 520, h: 900 },
    villain: "doc-octochain",
    ally: null,
    allyAt: null,
  });

  // The hero starts on the roof nearest the city centre.
  const central = buildings.reduce((a, b) => {
    const da = ((a.x0 + a.x1) / 2) ** 2 + ((a.z0 + a.z1) / 2) ** 2;
    const db = ((b.x0 + b.x1) / 2) ** 2 + ((b.z0 + b.z1) / 2) ** 2;
    return db < da ? b : a;
  });

  return {
    seed,
    bounds,
    buildings,
    props,
    anchors,
    zones,
    river,
    bridge: { deck, towers, axis: "x", towerHalf },
    start: roofCentre(central),
    cables,
  };
}

export function roofTop(b: Building): number {
  return b.top ? b.top.h : b.h;
}

export function facingDir(f: Prop["facing"]): { x: number; z: number } {
  return f === 0 ? { x: 0, z: 1 } : f === 1 ? { x: 1, z: 0 } : f === 2 ? { x: 0, z: -1 } : { x: -1, z: 0 };
}

/** Water towers, antennas, billboards, ACs and vents on a roof, avoiding the setback. */
function addRoofProps(
  rng: Rng,
  b: Building,
  style: { billboards: number; tower: number },
  props: Prop[],
  anchors: PropAnchor[],
  bx: Span,
  bz: Span,
) {
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const clearOfTop = (x: number, z: number, r: number) =>
    !b.top || x + r < b.top.x0 || x - r > b.top.x1 || z + r < b.top.z0 || z - r > b.top.z1;
  // Corner slots, inset from the parapet.
  const slots = [
    { x: b.x0 + 0.27 * w, z: b.z0 + 0.27 * d },
    { x: b.x1 - 0.27 * w, z: b.z0 + 0.27 * d },
    { x: b.x0 + 0.27 * w, z: b.z1 - 0.27 * d },
    { x: b.x1 - 0.27 * w, z: b.z1 - 0.27 * d },
  ];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const free = slots.filter((s) => clearOfTop(s.x, s.z, 40));

  // A billboard along the roof edge that faces the nearest street.
  if (b.h < 420 && w > 170 && d > 120 && rng.next() < style.billboards) {
    const edges = [
      { gap: b.z0 - bz.a, facing: 2 as const, at: { x: cx, z: b.z0 + 14 } },
      { gap: bz.b - b.z1, facing: 0 as const, at: { x: cx, z: b.z1 - 14 } },
      { gap: b.x0 - bx.a, facing: 3 as const, at: { x: b.x0 + 14, z: cz } },
      { gap: bx.b - b.x1, facing: 1 as const, at: { x: b.x1 - 14, z: cz } },
    ].sort((p, q) => p.gap - q.gap);
    const e = edges[0];
    const bw = Math.min(e.facing % 2 === 0 ? w : d, 220) - 30;
    if (clearOfTop(e.at.x, e.at.z, 30)) {
      props.push({
        kind: "billboard",
        at: { x: e.at.x, y: b.h, z: e.at.z },
        facing: e.facing,
        text: BILLBOARDS[rng.int(0, BILLBOARDS.length - 1)],
        w: Math.round(bw),
        h: 86,
        d: 8,
        buildingId: b.id,
      });
      anchors.push({ at: { x: e.at.x, y: b.h + 34 + 86, z: e.at.z }, kind: "billboard" });
    }
  }

  if (free.length && w >= 150 && d >= 150 && rng.next() < style.tower) {
    const s = free.shift()!;
    props.push({ kind: "water-tower", at: { x: s.x, y: b.h, z: s.z }, facing: 0, w: 62, h: 168, d: 62, buildingId: b.id });
    anchors.push({ at: { x: s.x, y: b.h + 168, z: s.z }, kind: "tower" });
  }

  if (rng.next() < (b.top ? 0.55 : 0.2)) {
    const ah = Math.round(rng.range(120, 260));
    const at = b.top
      ? { x: (b.top.x0 + b.top.x1) / 2 + rng.range(-0.2, 0.2) * (b.top.x1 - b.top.x0), y: b.top.h, z: (b.top.z0 + b.top.z1) / 2 }
      : free.length
        ? { ...free.shift()!, y: b.h }
        : null;
    if (at) {
      props.push({ kind: "antenna", at, facing: 0, w: 18, h: ah, d: 18, buildingId: b.id });
      anchors.push({ at: { x: at.x, y: at.y + ah, z: at.z }, kind: "antenna" });
    }
  }

  const acs = rng.next() < 0.55 ? rng.int(1, 2) : 0;
  for (let i = 0; i < acs && free.length; i++) {
    const s = free.shift()!;
    const aw = Math.round(rng.range(34, 46));
    props.push({ kind: "ac", at: { x: s.x, y: b.h, z: s.z }, facing: rng.pick([0, 1, 2, 3] as const), w: aw, h: Math.round(aw * 0.62), d: 30, buildingId: b.id });
  }
  if (free.length && rng.next() < 0.3) {
    const s = free.shift()!;
    props.push({ kind: "vent", at: { x: s.x, y: b.h, z: s.z }, facing: 0, w: 20, h: 30, d: 20, buildingId: b.id });
  }
}
