/**
 * The sim's rooftop props as the scene draws them. The sim places them with clearances round
 * the hero's spots but not round each other or a setback, so a few land where no prop could
 * stand; drawn as placed they poke through each other. Here, for the drawing only:
 *
 * - An antenna whose foot is inside its building's setback (the sim's coverage masts are pulled
 *   toward the roof's middle, which a setback may cover) rises from the setback's roof instead,
 *   and one under a water tower's tank that reaches above it rises from the tank's roof: its
 *   top, the web's anchor, stays exactly where the sim has it.
 * - Two masts on one spot are drawn as one, the taller: the other's top lies on it. A mast whose
 *   foot block would sit in another prop or hang off its roof is drawn without it (`bare`).
 * - An air-conditioning unit or a vent (decoration: no anchor, nothing the sim collides with)
 *   isn't drawn where it would stand inside a water tower's legs, a mast's foot, a billboard,
 *   a building or a setback, or another unit.
 *
 * Everything with an anchor (masts, water towers, billboards, cranes) is always drawn, and
 * always where the sim's anchor is. Pure data; the city layout and the checks use it.
 */
import type { Building, City, Prop } from "@wgp/game-core/sim3d/contract";

export interface DrawnProp {
  prop: Prop;
  /** Where its foot is drawn, and how tall it's drawn (an antenna lifted onto a setback is shorter). */
  y: number;
  h: number;
  /** An antenna drawn as a bare mast, without its foot block. */
  bare: boolean;
}

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

const overlaps = (a: Box, b: Box, pad = 0) => a.x0 < b.x1 - pad && a.x1 > b.x0 + pad && a.y0 < b.y1 - pad && a.y1 > b.y0 + pad && a.z0 < b.z1 - pad && a.z1 > b.z0 + pad;

/** Billboard legs' height (city/layout.ts) and an antenna's foot block. */
const BILLBOARD_LEGS = 34;
const MAST_FOOT = 9;
/** Two masts nearer than this are one (their foot blocks and top lights would meet). */
const SAME_MAST = 12;

/** What a prop occupies as drawn: a tower's legs (where a unit would stand among them), a mast's foot, a board on its legs, a unit's box. */
function footprint(p: Prop, y: number, h: number): Box {
  const { x, z } = p.at;
  switch (p.kind) {
    case "water-tower": {
      const r = p.w * 0.34 + 4;
      return { x0: x - r, y0: y, z0: z - r, x1: x + r, y1: y + h, z1: z + r };
    }
    case "antenna":
      return { x0: x - MAST_FOOT, y0: y, z0: z - MAST_FOOT, x1: x + MAST_FOOT, y1: y + h, z1: z + MAST_FOOT };
    case "billboard": {
      const turned = (p.facing & 1) === 1;
      const hw = (turned ? p.d : p.w) / 2;
      const hd = (turned ? p.w : p.d) / 2;
      return { x0: x - hw, y0: y, z0: z - hd, x1: x + hw, y1: y + BILLBOARD_LEGS + h, z1: z + hd };
    }
    case "vent":
      return { x0: x - 10, y0: y, z0: z - 10, x1: x + 10, y1: y + 31, z1: z + 10 };
    default:
      return { x0: x - p.w / 2, y0: y, z0: z - p.d / 2, x1: x + p.w / 2, y1: y + h, z1: z + p.d / 2 };
  }
}

export function drawnProps(city: City): DrawnProp[] {
  const byId = new Map<number, Building>();
  for (const b of city.buildings) byId.set(b.id, b);
  const solids: Box[] = [];
  for (const b of city.buildings) {
    solids.push({ x0: b.x0, y0: 0, z0: b.z0, x1: b.x1, y1: b.h, z1: b.z1 });
    if (b.top) solids.push({ x0: b.top.x0, y0: b.h, z0: b.top.z0, x1: b.top.x1, y1: b.top.h, z1: b.top.z1 });
  }

  const out: DrawnProp[] = [];
  const structural: Box[] = [];
  // Everything with an anchor but the masts, as placed.
  const towers = city.props.filter((p) => p.kind === "water-tower");
  for (const p of city.props) {
    if (p.kind === "antenna" || p.kind === "ac" || p.kind === "vent") continue;
    out.push({ prop: p, y: p.at.y, h: p.h, bare: false });
    if (p.kind !== "crane") structural.push(footprint(p, p.at.y, p.h));
  }

  // Masts: lifted out of a setback or onto a tank, one per spot, bare where a foot won't fit.
  const masts: DrawnProp[] = [];
  /** The masts each drawn one stands for (itself and any it was merged with). */
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
      const r = Math.hypot(p.at.x - w.at.x, p.at.z - w.at.z);
      if (r > R + 3 || Math.abs(w.at.y - y) > 1) continue;
      bare = true;
      // Up through the tank: it stands on the tank's roof (the cone, where it meets it).
      const roofAt = w.at.y + w.h - (Math.min(r, R) / R) * w.h * 0.2;
      if (top > roofAt + 6) y = roofAt;
    }
    const drawn = { prop: p, y, h: Math.max(12, top - y), bare };
    // One mast for several when every one's top (its anchor) is on the tallest as drawn.
    const same = masts.findIndex((m, i) => {
      const hi = m.y + m.h >= top ? m : drawn;
      return Math.abs(m.y - y) < 1 && [...covers[i], p].every((q) => Math.hypot(hi.prop.at.x - q.at.x, hi.prop.at.z - q.at.z) < SAME_MAST && q.at.y + q.h >= hi.y && q.at.y + q.h <= hi.y + hi.h + 0.5);
    });
    if (same < 0) {
      masts.push(drawn);
      covers.push([p]);
    } else {
      covers[same].push(p);
      if (top > masts[same].y + masts[same].h) masts[same] = drawn;
    }
  }
  const feet: Box[] = [];
  for (const m of masts) {
    const p = m.prop;
    const foot = footprint(p, m.y, 12);
    const b = p.buildingId !== null ? byId.get(p.buildingId) : undefined;
    const roof = b ? (b.top && Math.abs(b.top.h - m.y) < 0.5 ? b.top : Math.abs(b.h - m.y) < 0.5 ? b : null) : null;
    const offRoof = !!roof && (foot.x0 < roof.x0 || foot.x1 > roof.x1 || foot.z0 < roof.z0 || foot.z1 > roof.z1);
    const inWall = solids.some((s) => !(Math.abs(s.y1 - m.y) < 0.5 && p.at.x >= s.x0 && p.at.x <= s.x1 && p.at.z >= s.z0 && p.at.z <= s.z1) && overlaps(foot, s, 0.5));
    if (!m.bare && (offRoof || inWall || feet.some((f) => overlaps(foot, f, 0.5)) || structural.some((s) => overlaps(foot, s, 0.5)))) m.bare = true;
    if (!m.bare) feet.push(foot);
    out.push(m);
    structural.push(m.bare ? { x0: p.at.x - 3, y0: m.y, z0: p.at.z - 3, x1: p.at.x + 3, y1: m.y + m.h, z1: p.at.z + 3 } : footprint(p, m.y, m.h));
  }

  // Then the units, wherever they fit.
  const units: Box[] = [];
  for (const p of city.props) {
    if (p.kind !== "ac" && p.kind !== "vent") continue;
    const box = footprint(p, p.at.y, p.h);
    const own = p.buildingId !== null ? byId.get(p.buildingId) : undefined;
    const standsOn = (s: Box) => Math.abs(s.y1 - p.at.y) < 0.5 && p.at.x >= s.x0 && p.at.x <= s.x1 && p.at.z >= s.z0 && p.at.z <= s.z1;
    if (structural.some((s) => overlaps(box, s, 0.5))) continue;
    if (units.some((u) => overlaps(box, u, 0.5))) continue;
    if (solids.some((s) => !standsOn(s) && overlaps(box, s, 0.5))) continue;
    // Off its roof's edge.
    if (own) {
      const roof = own.top && Math.abs(own.top.h - p.at.y) < 0.5 ? own.top : own;
      if (box.x0 < roof.x0 - 0.5 || box.x1 > roof.x1 + 0.5 || box.z0 < roof.z0 - 0.5 || box.z1 > roof.z1 + 0.5) continue;
    }
    units.push(box);
    out.push({ prop: p, y: p.at.y, h: p.h, bare: false });
  }
  return out;
}
