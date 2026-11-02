import { describe, expect, it } from "vitest";

import { reduce } from "../src/rules/engine";
import type { Stop } from "../src/rules/types";
import { CityIndex, collideSphere, findAnchor, generateCity, groundBelow, raycastCity, type SphereHit } from "../src/sim3d/city";
import { ALLEY_MIN, ANCHOR_RANGE, GRID, PITCH, STREET_BOUNCE_TOP } from "../src/sim3d/constants";
import { len2 } from "../src/sim3d/dmath";
import { heroSave, STANDARD } from "./helpers";

/** The stops a real patrol would have tonight for this seed. */
function stopsFor(seed: number, night = 1): Stop[] {
  return reduce(heroSave(STANDARD, "City Test", night), { type: "start-patrol", seed }).patrol!.stops;
}

const docStops: Stop[] = [
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 2, boss: false, quest: false },
  { kind: "errand", ally: "gwei", errand: "team-up", district: "validator-heights" },
  { kind: "fight", villain: "sybil", district: "validator-heights", level: 2, boss: true, quest: false },
];

describe("generateCity", () => {
  it("is a pure function of the seed and the stops", () => {
    const a = generateCity(1234, docStops);
    const b = generateCity(1234, docStops);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generateCity(1235, docStops))).not.toBe(JSON.stringify(a));
  });

  it("lays out a 9 × 9 grid with the stops about 3,000 units apart, starting on a central roof", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const stops = stopsFor(seed * 7919, 1 + (seed % 9));
      const c = generateCity(seed, stops);
      expect(c.zones).toHaveLength(stops.length);
      expect(c.bounds.x1 - c.bounds.x0).toBe(GRID * PITCH + 180);
      let px = c.start.x;
      let pz = c.start.z;
      for (const z of c.zones) {
        const d = len2(z.center.x - px, z.center.z - pz);
        expect(d).toBeGreaterThan(1500);
        expect(d).toBeLessThan(4700);
        px = z.center.x;
        pz = z.center.z;
        if (z.kind === "errand") expect(z.allyAt).toBeTruthy();
      }
      // The start is on a roof.
      const grid = new CityIndex(c);
      expect(groundBelow(grid, c.start.x, c.start.z, 10_000)).toBe(c.start.y);
    }
  });

  it("puts Doc on a bridge over a river cut along a grid line, and only when he's out tonight", () => {
    const c = generateCity(42, docStops);
    expect(c.river).toBeTruthy();
    expect(c.bridge).toBeTruthy();
    const doc = c.zones[1];
    const r = c.river!;
    // The arena straddles the river, the deck crosses it.
    expect(doc.center.x >= r.x0 && doc.center.x <= r.x1 && doc.center.z >= r.z0 && doc.center.z <= r.z1).toBe(true);
    const deck = c.bridge!.deck;
    const across = c.bridge!.axis === "x" ? deck.x1 - deck.x0 : deck.z1 - deck.z0;
    expect(across).toBeGreaterThan(r.x1 - r.x0 < r.z1 - r.z0 ? r.x1 - r.x0 : r.z1 - r.z0);
    const noDoc = docStops.map((s) => (s.kind === "fight" && s.villain === "doc-octochain" ? { ...s, villain: "gas-goblin" as const } : s));
    const plain = generateCity(42, noDoc);
    expect(plain.river).toBeNull();
    expect(plain.bridge).toBeNull();
  });

  it("builds fight arenas from a cleared block with four tall corner towers", () => {
    const c = generateCity(7, docStops);
    const sybil = c.zones[3];
    const towers = c.buildings.filter((b) => b.h === 780 && b.x0 >= sybil.bounds.x0 && b.x1 <= sybil.bounds.x1 && b.z0 >= sybil.bounds.z0 && b.z1 <= sybil.bounds.z1);
    expect(towers).toHaveLength(4);
    expect(c.cables?.some((x) => x.kind === "arena")).toBe(true);
  });

  it("never overlaps buildings, keeps them in bounds, and leaves no crack the hero could wedge in", () => {
    for (const seed of [3, 99, 2024, 77777]) {
      const c = generateCity(seed, seed % 2 ? docStops : stopsFor(seed));
      const bs = c.buildings;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        expect(a.x0 >= c.bounds.x0 && a.x1 <= c.bounds.x1 && a.z0 >= c.bounds.z0 && a.z1 <= c.bounds.z1).toBe(true);
        if (a.top) expect(a.top.h).toBeGreaterThan(a.h);
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
          expect(ox > 0.001 && oz > 0.001).toBe(false);
          // Side by side along one axis: flush or at least ALLEY_MIN apart.
          if (oz > 0) expect(ox >= -0.001 || -ox >= ALLEY_MIN - 0.001).toBe(true);
          if (ox > 0) expect(oz >= -0.001 || -oz >= ALLEY_MIN - 0.001).toBe(true);
        }
      }
      // Billboards pick their text from the parody list; prop anchors for webs exist.
      expect(c.props.filter((p) => p.kind === "billboard").every((p) => typeof p.text === "string")).toBe(true);
      expect(c.anchors.length).toBeGreaterThan(200);
    }
  });

  it("leaves a web in reach from every roof and from the top of a miss's bounce on every street", () => {
    const c = generateCity(555, docStops);
    const grid = new CityIndex(c);
    for (const b of c.buildings) {
      const roofY = b.top ? b.top.h : b.h;
      const r = b.top ?? b;
      expect(grid.hasAnchor((r.x0 + r.x1) / 2, roofY + 26, (r.z0 + r.z1) / 2)).toBe(true);
    }
    // At the street sample points the city guarantees (every 120 units along each street line).
    for (let line = 1; line < GRID; line++) {
      const x = line * PITCH - 90;
      for (let z = c.bounds.z0 + 60; z < c.bounds.z1 - 60; z += 360) {
        if (c.river && x >= c.river.x0 && x <= c.river.x1) continue;
        expect(grid.hasAnchor(x, STREET_BOUNCE_TOP, z)).toBe(true);
      }
    }
  });

  it("keeps antennas rooftop-sized with their webs at the tip, the hero's spots clear of props, and Doc's bridge roomy", () => {
    for (const seed of [3, 99, 2024, 77777]) {
      const c = generateCity(seed, seed % 2 ? docStops : stopsFor(seed));
      const tips = new Set(c.anchors.filter((a) => a.kind === "antenna").map((a) => `${a.at.x},${a.at.y},${a.at.z}`));
      for (const p of c.props) {
        if (p.kind !== "antenna") continue;
        // Beside the 88-tall hero: rooftop antennas up to 150, a rare street mast 330; all thin.
        expect(p.w).toBeLessThanOrEqual(6);
        expect(p.h).toBeLessThanOrEqual(p.buildingId === null ? 330 : 150);
        expect(tips.has(`${p.at.x},${p.at.y + p.h},${p.at.z}`)).toBe(true);
      }
      // Where the hero stands (the start, each zone's centre, beside each ally) stays clear.
      const spots = [
        { x: c.start.x, z: c.start.z, r: 90 },
        ...c.zones.map((z) => ({ x: z.center.x, z: z.center.z, r: 90 })),
        ...c.zones.flatMap((z) => (z.allyAt ? [{ x: z.allyAt.x, z: z.allyAt.z, r: 120 + 26 + 24 }] : [])),
      ];
      for (const p of c.props) {
        if (p.kind === "crane" || p.buildingId === null) continue;
        // Gwei stands on her water tower.
        if (p.kind === "water-tower" && c.zones.some((z) => z.allyAt && z.allyAt.x === p.at.x && z.allyAt.z === p.at.z)) continue;
        for (const k of spots) expect(Math.hypot(p.at.x - k.x, p.at.z - k.z), `${p.kind} near a hero spot`).toBeGreaterThanOrEqual(k.r);
      }
      // Doc's tower legs stand beyond his reach (sway 120, shoulder 28, arm 305) and inside the arena.
      if (c.bridge) {
        const doc = c.zones.find((z) => z.villain === "doc-octochain")!;
        const half = c.bridge.towerHalf ?? 25;
        for (const t of c.bridge.towers) {
          const along = c.bridge.axis === "x" ? Math.abs(t.x - doc.center.x) : Math.abs(t.z - doc.center.z);
          expect(along - half).toBeGreaterThan(120 + 28 + 305 + 26);
          expect(along + half).toBeLessThan(c.bridge.axis === "x" ? doc.bounds.x1 - doc.center.x : doc.bounds.z1 - doc.center.z);
        }
      }
    }
  });

  it("finds anchors only in reach, above, in plain sight and facing the hero", () => {
    const c = generateCity(8, docStops);
    const grid = new CityIndex(c);
    for (let k = 0; k < 300; k++) {
      const x = 200 + ((k * 977) % 6400);
      const z = 200 + ((k * 613) % 6400);
      const y = 150 + ((k * 37) % 400);
      const a = findAnchor(grid, x, y, z, x + 150, y + 200, z, null);
      if (!a) continue;
      const d = Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2 + (a.z - z) ** 2);
      expect(d).toBeLessThanOrEqual(ANCHOR_RANGE + 1e-9);
      expect(a.y - y).toBeGreaterThanOrEqual(36);
    }
  });

  it("collides spheres with boxes and raycasts for the camera", () => {
    const c = generateCity(11, docStops);
    const grid = new CityIndex(c);
    const b = c.buildings.find((q) => !q.top && q.x1 - q.x0 > 150 && q.z1 - q.z0 > 150)!;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    // Dropping onto the roof lands on top.
    const body = { x: cx, y: b.h + 20, z: cz, vx: 0, vy: -300, vz: 0 };
    const hit: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };
    collideSphere(grid, body, 26, hit);
    expect(hit.top).toBe(true);
    expect(body.y).toBeCloseTo(b.h + 26, 6);
    expect(body.vy).toBe(0);
    // A ray from above straight down hits that roof first.
    const ray = raycastCity(grid, cx, 2000, cz, 0, -1, 0, 3000);
    expect(ray?.box).toBeGreaterThanOrEqual(0);
    expect(ray!.y).toBeCloseTo(b.h, 6);
    expect(ray!.ny).toBe(1);
    // Over the street it hits the street.
    const street = raycastCity(grid, -100, 500, -100, 0, -1, 0, 1000);
    expect(street?.box).toBe(-1);
  });
});
