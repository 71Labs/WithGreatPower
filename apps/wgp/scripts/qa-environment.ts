/**
 * The environment half of the anomaly sweep (launch/brand/hero/qa-anomalies.mjs plays the
 * nights; this checks the cities they're played in, without a browser): for many seeds'
 * patrol cities at villain levels 1, 4 and 9 and Case File 001's, the sim's city against the
 * scene's drawn one (city/layout.ts) and the crowd's plan (crowd/placement.ts):
 *
 * - props: standing on their roof (not floating or sunk), not hanging past its edge, not inside
 *   another building or a setback, not inside each other; the scene's rooftop detail (doors,
 *   ledges, lamps) not inside props;
 * - water towers and billboards inside buildings, specifically;
 * - z-fighting: two drawn boxes with a face in the same plane, facing the same way, overlapping;
 * - web anchors (the sim's prop anchors) with nothing drawn within reach;
 * - an ally (Zone.allyAt) not standing on what's drawn under them (a roof, a tower's lid);
 * - crowd spots inside a prop, a building or another person, or off their roof;
 * - roofs: a setback hanging past its building, a gap between a building and its setback.
 *
 *   pnpm --filter wgp exec tsx scripts/qa-environment.ts [--seeds 40] [--json out.json]
 *
 * Prints a ranked table (issue, cities, count, an example).
 */
import { readFileSync, writeFileSync } from "node:fs";

import { seedOf } from "@wgp/game-core/engine";
import { startRun } from "@wgp/game-core/replay";
import { chapterCity, CityIndex } from "@wgp/game-core/sim3d";
import type { City, Prop } from "@wgp/game-core/sim3d/contract";

import { buildCityLayout, KIND, type BoxSpec } from "../src/game3d/scene/city/layout";
import { CROWD_TIERS } from "../src/game3d/scene/crowd/lod";
import { planCrowd, type BodyInfo } from "../src/game3d/scene/crowd/placement";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const SEEDS = Number(opt("seeds", "40"));
const json = opt("json", "");

type Box3 = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};
interface Issue {
  id: string;
  severity: "high" | "med" | "low";
  city: string;
  v: number;
  at: string;
}
const issues: Issue[] = [];
const cities: { name: string; city: City }[] = [];

/* ------------------------------------------------------------------ the cities */

const NAMES = ["Peter Parquet", "Miles Mempool", "Gwen Gasless", "Ben Blockly", "May Merkle", "Otto Oracle", "Ada Ledger", "Sam Satoshi"];
/** A hero save to start patrol nights from (the night and the name make the seed). */
const HERO = JSON.parse(readFileSync(opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json"), "utf8"));
for (const level of [1, 4, 9]) {
  const night = level === 1 ? 1 : 2 * level - 1;
  for (let k = 0; k < SEEDS; k++) {
    const save = structuredClone(HERO);
    save.night = night;
    save.patrol = null;
    save.nightDone = false;
    save.hero.name = `${NAMES[k % NAMES.length]} ${Math.floor(k / NAMES.length) || ""}`.trim();
    save.hero.level = level;
    const run = startRun(save, seedOf(night, save.hero.name));
    cities.push({ name: `patrol-l${level}-${k}`, city: run.sim.city });
  }
}
for (let k = 0; k < SEEDS; k++)
  cities.push({
    name: `case001-${k}`,
    city: chapterCity("case-001", seedOf(4, `case-001:${NAMES[k % NAMES.length]} ${k}`)),
  });

/* ------------------------------------------------------------------ helpers */

const overlap = (a: Box3, b: Box3, pad = 0) => a.x0 < b.x1 - pad && a.x1 > b.x0 + pad && a.y0 < b.y1 - pad && a.y1 > b.y0 + pad && a.z0 < b.z1 - pad && a.z1 > b.z0 + pad;
const depth = (a: Box3, b: Box3) => Math.min(a.x1 - b.x0, b.x1 - a.x0, a.y1 - b.y0, b.y1 - a.y0, a.z1 - b.z0, b.z1 - a.z0);
const r = (n: number) => Math.round(n);

type DrawnPropLike = Prop & { bare?: boolean };

/**
 * A prop's drawn extent (city/layout.ts addProp) as boxes: a tower's legs square up to its tank
 * and the tank above (round, by its bounding square), a billboard's board on its legs, a mast
 * (its foot block unless it's bare), a unit's box.
 */
function propBoxes(p: DrawnPropLike): Box3[] {
  const { x, y, z } = p.at;
  const turned = (p.facing & 1) === 1;
  const hw = (turned ? p.d : p.w) / 2;
  const hd = (turned ? p.w : p.d) / 2;
  switch (p.kind) {
    case "water-tower": {
      // Four legs (5 square, city/layout.ts) and the tank on them.
      const lr = p.w * 0.34;
      const R = p.w * 0.58;
      const legH = p.h * 0.42;
      const leg = (sx: number, sz: number): Box3 => ({ x0: x + sx * lr - 2.5, y0: y, z0: z + sz * lr - 2.5, x1: x + sx * lr + 2.5, y1: y + legH + 2, z1: z + sz * lr + 2.5 });
      return [leg(-1, -1), leg(1, -1), leg(-1, 1), leg(1, 1), { x0: x - R, y0: y + legH, z0: z - R, x1: x + R, y1: y + p.h, z1: z + R }];
    }
    case "billboard":
      return [{ x0: x - hw, y0: y, z0: z - hd, x1: x + hw, y1: y + 34 + p.h, z1: z + hd }];
    case "antenna": {
      const f = p.bare ? 2.5 : 9;
      return [{ x0: x - f, y0: y, z0: z - f, x1: x + f, y1: y + p.h + 10, z1: z + f }];
    }
    case "vent":
      return [{ x0: x - 10, y0: y, z0: z - 10, x1: x + 10, y1: y + 31, z1: z + 10 }];
    case "crane":
      return [{ x0: x - p.d / 2, y0: y, z0: z - p.d / 2, x1: x + p.d / 2, y1: y + p.h, z1: z + p.d / 2 }];
    default:
      return [{ x0: x - hw, y0: y, z0: z - hd, x1: x + hw, y1: y + p.h, z1: z + hd }];
  }
}

/** The bounding box of a prop's boxes. */
function propBox(p: DrawnPropLike): Box3 {
  const bs = propBoxes(p);
  return {
    x0: Math.min(...bs.map((b) => b.x0)),
    y0: Math.min(...bs.map((b) => b.y0)),
    z0: Math.min(...bs.map((b) => b.z0)),
    x1: Math.max(...bs.map((b) => b.x1)),
    y1: Math.max(...bs.map((b) => b.y1)),
    z1: Math.max(...bs.map((b) => b.z1)),
  };
}

/** How deep a box goes into a prop's drawn boxes (0: it doesn't). */
function intoProp(box: Box3, p: DrawnPropLike, pad = 0.5): number {
  let worst = 0;
  for (const b of propBoxes(p)) if (overlap(box, b, pad)) worst = Math.max(worst, depth(box, b));
  return worst;
}

/** A drawn box's world AABB (turned boxes by their bounding square; line boxes by their ends). */
function specBox(b: BoxSpec): Box3 {
  if (b.to)
    return {
      x0: Math.min(b.x, b.to.x) - b.w / 2,
      y0: Math.min(b.y, b.to.y),
      z0: Math.min(b.z, b.to.z) - b.d / 2,
      x1: Math.max(b.x, b.to.x) + b.w / 2,
      y1: Math.max(b.y, b.to.y) + b.h,
      z1: Math.max(b.z, b.to.z) + b.d / 2,
    };
  const c = Math.abs(Math.cos(b.yaw));
  const s = Math.abs(Math.sin(b.yaw));
  const hx = (b.w * c + b.d * s) / 2;
  const hz = (b.w * s + b.d * c) / 2;
  return {
    x0: b.x - hx,
    y0: b.y,
    z0: b.z - hz,
    x1: b.x + hx,
    y1: b.y + b.h,
    z1: b.z + hz,
  };
}

const crowdBodies: BodyInfo[] = Array.from({ length: 8 }, (_, i) => ({
  phone: i % 3 === 0,
  looks: 12,
}));
type Drawn = ((city: City) => { prop: Prop; y: number; h: number; bare?: boolean }[]) | null;

/* ------------------------------------------------------------------ the checks */

function check(drawn: Drawn): void {
  console.log(drawn ? "props: as drawn (city/props.ts)" : "props: as the sim placed them");

  for (const { name, city } of cities) {
    const add = (id: string, severity: Issue["severity"], v: number, at: string) => issues.push({ id, severity, city: name, v: Math.round(v * 10) / 10, at });
    const blds: (Box3 & { id: number; kind: "main" | "top" })[] = [];
    for (const b of city.buildings) {
      blds.push({
        x0: b.x0,
        y0: 0,
        z0: b.z0,
        x1: b.x1,
        y1: b.h,
        z1: b.z1,
        id: b.id,
        kind: "main",
      });
      if (b.top)
        blds.push({
          x0: b.top.x0,
          y0: b.h,
          z0: b.top.z0,
          x1: b.top.x1,
          y1: b.top.h,
          z1: b.top.z1,
          id: b.id,
          kind: "top",
        });
    }
    /** The roof under (x, z) at or below y, and its box. */
    const roofUnder = (x: number, z: number, y: number) => {
      let best: (typeof blds)[number] | null = null;
      for (const b of blds) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 <= y + 0.5 && (!best || b.y1 > best.y1)) best = b;
      return best;
    };

    // Roofs: a setback past its building, or not sitting on it.
    for (const b of city.buildings) {
      if (!b.top) continue;
      const t = b.top;
      const over = Math.max(b.x0 - t.x0, t.x1 - b.x1, b.z0 - t.z0, t.z1 - b.z1);
      if (over > 0.5) add("roof-setback-overhang", "med", over, `building ${b.id}`);
    }

    // Props, as the scene draws them (city/props.ts when there is one; else as the sim placed them).
    const drawnList = drawn
      ? drawn(city).map((d) => ({
          ...d.prop,
          at: { ...d.prop.at, y: d.y },
          h: d.h,
          bare: d.bare,
        }))
      : city.props;
    const props = drawnList.map((p) => ({ p, box: propBox(p) }));
    for (const { p, box } of props) {
      const owner = p.buildingId !== null ? city.buildings.find((b) => b.id === p.buildingId) : null;
      if (p.kind === "crane" && !owner) continue;
      const under = roofUnder(p.at.x, p.at.z, p.at.y);
      const gap = under ? p.at.y - under.y1 : p.at.y;
      if (Math.abs(gap) > 1) add(gap > 0 ? "prop-floating" : "prop-sunk", "high", Math.abs(gap), `${p.kind} at ${r(p.at.x)},${r(p.at.y)},${r(p.at.z)}`);
      // Hanging past the roof it stands on (its base footprint; a crane's jib is meant to).
      if (under && p.kind !== "crane") {
        const fp =
          p.kind === "water-tower"
            ? {
                x0: p.at.x - p.w * 0.34,
                z0: p.at.z - p.w * 0.34,
                x1: p.at.x + p.w * 0.34,
                z1: p.at.z + p.w * 0.34,
              }
            : box;
        const over = Math.max(under.x0 - fp.x0, fp.x1 - under.x1, under.z0 - fp.z0, fp.z1 - under.z1);
        if (over > 2) add("prop-over-edge", "high", over, `${p.kind} at ${r(p.at.x)},${r(p.at.y)},${r(p.at.z)}`);
      }
      // Inside a building or a setback (not the roof it stands on).
      for (const b of blds) {
        if (b === under) continue;
        const d = intoProp(b, p);
        if (d > 0) {
          const id = p.kind === "water-tower" || p.kind === "billboard" ? "tower-or-billboard-in-building" : "prop-in-building";
          add(id, "high", d, `${p.kind} at ${r(p.at.x)},${r(p.at.y)},${r(p.at.z)} in building ${b.id} (${b.kind})`);
        }
      }
    }
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        const a = props[i];
        const b = props[j];
        if (a.p.kind === "crane" || b.p.kind === "crane") continue;
        if (!overlap(a.box, b.box, 0.5)) continue;
        const d = Math.max(0, ...propBoxes(a.p).map((x) => intoProp(x, b.p)));
        if (d > 0) add("props-intersect", "high", d, `${a.p.kind} at ${r(a.p.at.x)},${r(a.p.at.z)} and ${b.p.kind} at ${r(b.p.at.x)},${r(b.p.at.z)}`);
      }
    }

    // The scene's drawn city: detail boxes inside props; coplanar faces.
    const layout = buildCityLayout(city);
    const isDetail = (b: BoxSpec) => b.kind === KIND.door || b.kind === KIND.grate || b.kind === KIND.lamp || b.kind === KIND.signal;
    const details = layout.boxes.filter((b) => isDetail(b as BoxSpec));
    for (const d of details) {
      const db = specBox(d);
      for (const { p } of props) {
        if (p.kind === "crane") continue;
        const dd = intoProp(db, p, 1);
        if (dd > 0) add("detail-in-prop", "med", dd, `${Object.entries(KIND).find(([, v]) => v === d.kind)?.[0]} at ${r(d.x)},${r(d.y)},${r(d.z)} in ${p.kind}`);
      }
    }
    // Z-fighting: unturned boxes with a face on the same plane, facing the same way, overlapping in area.
    const flat = layout.boxes.filter((b) => !b.to && Math.abs(Math.sin(b.yaw)) < 1e-6).map((b) => ({ b, box: specBox(b) }));
    const grid = new Map<string, number[]>();
    const cell = 200;
    flat.forEach(({ box }, i) => {
      for (let cx = Math.floor(box.x0 / cell); cx <= Math.floor(box.x1 / cell); cx++)
        for (let cz = Math.floor(box.z0 / cell); cz <= Math.floor(box.z1 / cell); cz++) (grid.get(`${cx},${cz}`) ?? grid.set(`${cx},${cz}`, []).get(`${cx},${cz}`)!).push(i);
    });
    const seen = new Set<string>();
    let zf = 0;
    for (const list of grid.values()) {
      for (let a = 0; a < list.length; a++) {
        for (let c = a + 1; c < list.length; c++) {
          const i = Math.min(list[a], list[c]);
          const j = Math.max(list[a], list[c]);
          const key = `${i},${j}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const A = flat[i].box;
          const B = flat[j].box;
          // Same plane: x faces, z faces, the top face (boxes have no bottom).
          const area = (u0: number, u1: number, v0: number, v1: number, p0: number, p1: number, q0: number, q1: number) =>
            Math.max(0, Math.min(u1, p1) - Math.max(u0, p0)) * Math.max(0, Math.min(v1, q1) - Math.max(v0, q0));
          let worst = 0;
          if (Math.abs(A.x0 - B.x0) < 0.05) worst = Math.max(worst, area(A.y0, A.y1, A.z0, A.z1, B.y0, B.y1, B.z0, B.z1));
          if (Math.abs(A.x1 - B.x1) < 0.05) worst = Math.max(worst, area(A.y0, A.y1, A.z0, A.z1, B.y0, B.y1, B.z0, B.z1));
          if (Math.abs(A.z0 - B.z0) < 0.05) worst = Math.max(worst, area(A.y0, A.y1, A.x0, A.x1, B.y0, B.y1, B.x0, B.x1));
          if (Math.abs(A.z1 - B.z1) < 0.05) worst = Math.max(worst, area(A.y0, A.y1, A.x0, A.x1, B.y0, B.y1, B.x0, B.x1));
          if (Math.abs(A.y1 - B.y1) < 0.05) worst = Math.max(worst, area(A.x0, A.x1, A.z0, A.z1, B.x0, B.x1, B.z0, B.z1));
          // Hidden inside buildings (two cornices meeting where two buildings touch): no flicker to
          // see. Sampled over the shared part, just inside the boxes' tops.
          let shown = 0;
          if (worst > 4) {
            const x0 = Math.max(A.x0, B.x0);
            const x1 = Math.min(A.x1, B.x1);
            const z0 = Math.max(A.z0, B.z0);
            const z1 = Math.min(A.z1, B.z1);
            const y = Math.min(A.y1, B.y1) - 0.1;
            for (let u = 0; u < 4; u++)
              for (let v = 0; v < 4; v++) {
                const x = x0 + ((x1 - x0) * (u + 0.5)) / 4;
                const z = z0 + ((z1 - z0) * (v + 0.5)) / 4;
                if (!blds.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1)) shown++;
              }
          }
          if (worst > 4 && shown > 0) {
            zf++;
            if (zf <= 3) {
              const ka = Object.entries(KIND).find(([, v]) => v === flat[i].b.kind)?.[0];
              const kb = Object.entries(KIND).find(([, v]) => v === flat[j].b.kind)?.[0];
              add("z-fighting", "high", worst, `${ka} ${r(flat[i].b.x)},${r(flat[i].b.y)},${r(flat[i].b.z)} and ${kb} ${r(flat[j].b.x)},${r(flat[j].b.y)},${r(flat[j].b.z)}`);
            }
          }
        }
      }
    }
    if (zf > 3) add("z-fighting (more in this city)", "high", zf - 3, "");

    // Web anchors with nothing drawn near them.
    const index = new CityIndex(city);
    const drawnBoxes = layout.boxes.map(specBox);
    for (const a of index.anchors) {
      let best = Infinity;
      for (const d of drawnBoxes) {
        const dx = Math.max(d.x0 - a.at.x, 0, a.at.x - d.x1);
        const dy = Math.max(d.y0 - a.at.y, 0, a.at.y - d.y1);
        const dz = Math.max(d.z0 - a.at.z, 0, a.at.z - d.z1);
        best = Math.min(best, Math.hypot(dx, dy, dz));
      }
      for (const t of layout.tanks) {
        const dr = Math.max(0, Math.hypot(a.at.x - t.x, a.at.z - t.z) - t.w * 0.58);
        const dy = Math.max(0, t.y - a.at.y, a.at.y - (t.y + t.h));
        best = Math.min(best, Math.hypot(dr, dy));
      }
      if (best > 10) add("anchor-in-air", "high", best, `${a.kind} at ${r(a.at.x)},${r(a.at.y)},${r(a.at.z)}`);
      if (a.kind !== "cable" && blds.some((b) => a.at.x > b.x0 + 1 && a.at.x < b.x1 - 1 && a.at.z > b.z0 + 1 && a.at.z < b.z1 - 1 && a.at.y > b.y0 && a.at.y < b.y1 - 1))
        add("anchor-inside-building", "high", 1, `${a.kind} at ${r(a.at.x)},${r(a.at.y)},${r(a.at.z)}`);
    }

    // Allies: on what's drawn under them.
    for (const z of city.zones) {
      if (!z.allyAt) continue;
      const at = z.allyAt;
      const tank = layout.tanks.find((t) => Math.hypot(t.x - at.x, t.z - at.z) < 2);
      const surface = tank ? (tank.flat ? tank.y + tank.h * 0.8 : tank.y + tank.h) : (roofUnder(at.x, at.z, at.y)?.y1 ?? 0);
      if (Math.abs(surface - at.y) > 1) add("ally-off-surface", "high", Math.abs(surface - at.y), `${z.ally} at ${r(at.x)},${r(at.y)},${r(at.z)} (drawn surface ${r(surface)})`);
      if (tank && !tank.flat) add("ally-on-cone-point", "high", tank.h * 0.2, `${z.ally} on a pointed tank roof at ${r(at.x)},${r(at.z)}`);
    }

    // The crowd (the high tier's plan, the most people).
    const plan = planCrowd(city, crowdBodies, CROWD_TIERS.high.density);
    for (const s of plan.spots) {
      const body: Box3 = {
        x0: s.x - 6,
        y0: s.y,
        z0: s.z - 6,
        x1: s.x + 6,
        y1: s.y + 80,
        z1: s.z + 6,
      };
      for (const { p } of props) {
        const d = intoProp(body, p, 0);
        if (d > 0) add("crowd-in-prop", "high", d, `${s.kind} spot at ${r(s.x)},${r(s.y)},${r(s.z)} in ${p.kind}`);
      }
      for (const b of blds) if (overlap(body, b, 0.5) && !(s.y >= b.y1 - 0.5)) add("crowd-in-building", "high", depth(body, b), `${s.kind} spot at ${r(s.x)},${r(s.y)},${r(s.z)} in building ${b.id}`);
      const under = roofUnder(s.x, s.z, s.y);
      const floor = under ? under.y1 : 0;
      if (Math.abs(floor - s.y) > 1 && !(city.bridge && s.y === city.bridge.deck.y))
        add("crowd-off-floor", "high", Math.abs(floor - s.y), `${s.kind} spot at ${r(s.x)},${r(s.y)},${r(s.z)} (floor ${r(floor)})`);
    }
    for (let i = 0; i < plan.spots.length; i++) {
      for (let j = i + 1; j < plan.spots.length; j++) {
        const a = plan.spots[i];
        const b = plan.spots[j];
        if (Math.abs(a.y - b.y) < 5 && Math.hypot(a.x - b.x, a.z - b.z) < 10) add("crowd-inside-each-other", "med", 10 - Math.hypot(a.x - b.x, a.z - b.z), `${r(a.x)},${r(a.z)}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ the table */

function report(): void {
  const rank = { high: 0, med: 1, low: 2 };
  const rows = new Map<
    string,
    {
      id: string;
      severity: Issue["severity"];
      count: number;
      cities: Set<string>;
      worst: Issue;
    }
  >();
  for (const i of issues) {
    const row = rows.get(i.id) ?? {
      id: i.id,
      severity: i.severity,
      count: 0,
      cities: new Set<string>(),
      worst: i,
    };
    row.count++;
    row.cities.add(i.city);
    if (i.v > row.worst.v) row.worst = i;
    rows.set(i.id, row);
  }
  const table = [...rows.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
  console.log(`${cities.length} cities (patrol levels 1, 4, 9 × ${SEEDS} seeds; Case File 001 × ${SEEDS})`);
  console.log("severity  issue                              count  cities  worst");
  for (const t of table) console.log(`${t.severity.padEnd(9)} ${t.id.padEnd(34)} ${String(t.count).padStart(5)}  ${String(t.cities.size).padStart(6)}  ${t.worst.v} (${t.worst.city}: ${t.worst.at})`);
  if (!table.length) console.log("(nothing found)");
  if (json)
    writeFileSync(
      json,
      JSON.stringify(
        {
          cities: cities.length,
          table: table.map((t) => ({ ...t, cities: t.cities.size })),
          issues: issues.slice(0, 2000),
        },
        null,
        1,
      ),
    );
}

// The scene's own prop rules (city/props.ts), when this checkout has them.
import("../src/game3d/scene/city/props")
  .then(
    (m) => m.drawnProps as Drawn,
    () => null,
  )
  .then((drawn) => {
    check(drawn);
    report();
  });
