import { describe, expect, it } from "vitest";

import type { City } from "@wgp/game-core/sim3d/contract";

import type { ChapterFrame } from "@/lib/cases/types";

import { bridgePoint, chapterNext, chapterOf, chapterWaypoint } from "./chapter-pins";

const city = { bridge: { deck: { x0: 1000, z0: 0, x1: 1400, z1: 200, y: 120 }, towers: [] } } as unknown as City;
const noBridge = { bridge: null } as unknown as City;
const hero = { x: 0, y: 0, z: 0 };

const chapter = (over: Partial<ChapterFrame>): ChapterFrame => ({
  id: "case-001",
  phase: "investigate",
  clues: [
    { id: "tabs", pos: { x: 900, y: 300, z: 0 }, found: false },
    { id: "cursor", pos: { x: 100, y: 300, z: 0 }, found: true },
    { id: "pixels", pos: { x: 400, y: 300, z: 0 }, found: false },
  ],
  captive: { pos: { x: 1200, y: 120, z: 100 }, restore: 0, freed: false },
  copies: [],
  ...over,
});

describe("chapter pins", () => {
  it("reads a frame's chapter, or none", () => {
    expect(chapterOf({} as never)).toBeNull();
    expect(chapterOf({ chapter: chapter({}) } as never)?.id).toBe("case-001");
  });

  it("puts the bridge pin on the deck's centre", () => {
    expect(bridgePoint(city)).toEqual({ x: 1200, y: 120, z: 100 });
    expect(bridgePoint(noBridge)).toBeNull();
  });

  it("heads for the nearest clue still out there, then the bridge, then Mary", () => {
    expect(chapterNext(chapter({}), city, hero)).toEqual({ x: 400, y: 300, z: 0 });
    expect(chapterNext(chapter({ phase: "standoff" }), city, hero)).toEqual({ x: 1200, y: 120, z: 100 });
    expect(chapterNext(chapter({ phase: "rescue" }), city, hero)).toEqual({ x: 1200, y: 120, z: 100 });
    expect(chapterNext(chapter({ phase: "rescue", captive: { pos: hero, restore: 1, freed: true } }), city, hero)).toBeNull();
    expect(chapterNext(chapter({ phase: "done" }), city, hero)).toBeNull();
  });

  it("drops the waypoint once the hero is on the deck or beside Mary", () => {
    expect(chapterWaypoint(chapter({}), city, hero)?.target).toBe("clue");
    expect(chapterWaypoint(chapter({ phase: "standoff" }), city, hero)?.target).toBe("bridge");
    expect(chapterWaypoint(chapter({ phase: "standoff" }), city, { x: 1150, y: 120, z: 100 })).toBeNull();
    expect(chapterWaypoint(chapter({ phase: "rescue" }), city, { x: 1100, y: 120, z: 100 })).toBeNull();
    expect(chapterWaypoint(chapter({ phase: "rescue" }), city, hero)?.target).toBe("mary");
  });
});
