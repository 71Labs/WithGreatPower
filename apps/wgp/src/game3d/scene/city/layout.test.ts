import { describe, expect, it } from "vitest";

import { generateFixtureCity } from "../fixture-city";
import { buildCityLayout, KIND, SECTORS } from "./layout";
import { inferStreets } from "./streets";

const city = generateFixtureCity(7);

describe("fixture city", () => {
  it("is a valid contract City", () => {
    const { bounds } = city;
    expect(city.buildings.length).toBeGreaterThan(150);
    for (const b of city.buildings) {
      expect(b.x0).toBeGreaterThanOrEqual(bounds.x0);
      expect(b.x1).toBeLessThanOrEqual(bounds.x1);
      expect(b.z0).toBeGreaterThanOrEqual(bounds.z0);
      expect(b.z1).toBeLessThanOrEqual(bounds.z1);
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(b.z1).toBeGreaterThan(b.z0);
      expect(b.h).toBeGreaterThan(0);
      if (b.top) {
        expect(b.top.x0).toBeGreaterThanOrEqual(b.x0);
        expect(b.top.x1).toBeLessThanOrEqual(b.x1);
        expect(b.top.z0).toBeGreaterThanOrEqual(b.z0);
        expect(b.top.z1).toBeLessThanOrEqual(b.z1);
      }
    }
    // Footprints never overlap.
    const bs = city.buildings;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        expect(overlap).toBe(false);
      }
    // Rooftop props stand on their building's roof (or setback).
    for (const p of city.props) {
      if (p.buildingId === null) continue;
      const b = bs[p.buildingId];
      expect([b.h, b.top?.h ?? b.h]).toContain(p.at.y);
    }
    expect(city.zones).toHaveLength(5);
    for (const z of city.zones) {
      expect(z.bounds.x1).toBeGreaterThan(z.bounds.x0);
      expect(z.center.x).toBeGreaterThanOrEqual(z.bounds.x0);
      expect(z.center.x).toBeLessThanOrEqual(z.bounds.x1);
    }
    expect(city.river).not.toBeNull();
    expect(city.bridge?.towers).toHaveLength(4);
  });

  it("is stable for a seed", () => {
    expect(JSON.stringify(generateFixtureCity(7))).toBe(JSON.stringify(city));
    expect(JSON.stringify(generateFixtureCity(8))).not.toBe(JSON.stringify(city));
  });
});

describe("city layout", () => {
  const layout = buildCityLayout(city);

  it("puts every building and setback in one sector each", () => {
    expect(layout.sectors).toHaveLength(SECTORS * SECTORS);
    const buildings = layout.boxes.filter((b) => b.kind === KIND.building);
    const tops = layout.boxes.filter((b) => b.kind === KIND.top);
    expect(buildings).toHaveLength(city.buildings.length);
    expect(tops).toHaveLength(city.buildings.filter((b) => b.top).length);
    for (const b of layout.boxes) expect(b.sector).toBeGreaterThanOrEqual(0);
  });

  it("stays inside the triangle budget even if every sector were drawn", () => {
    const boxes = layout.boxes.length * 10;
    const hulls = layout.boxes.filter((b) => b.hull > 0).length * 10;
    const tanks = layout.tanks.length * 48 * 2;
    expect(boxes + hulls + tanks).toBeLessThan(34_000);
    // Landmarks and buildings are never LOD-dropped; only rooftop clutter is.
    for (const b of layout.boxes) if (b.kind === KIND.building || b.kind === KIND.top) expect(b.lod).toBe(0);
  });

  it("collects billboard texts for the atlas", () => {
    expect(layout.texts.length).toBeGreaterThan(0);
    expect(layout.texts.length).toBeLessThanOrEqual(8);
  });

  it("finds the street grid between the blocks", () => {
    const s = inferStreets(city);
    // 9 blocks: 8 streets between plus the two perimeter streets on each axis (one gap is the river).
    expect(s.xs.length).toBe(10);
    expect(s.zs.length).toBe(10);
    for (const st of [...s.xs, ...s.zs]) expect(st.w).toBeGreaterThan(100);
  });
});
