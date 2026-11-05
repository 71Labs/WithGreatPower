/**
 * Typed stand-ins for what the gameplay build sends, so the case files and the chapter
 * HUD can be built and checked before it lands. Development only: the pages pick one with
 * `?cases=<name>` (the case files) or `?chapter=<name>` (the patrol HUD), and production
 * builds ignore both (see useCaseFiles and chapterFixtureName).
 */
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { CaseRecordApi, CasesResponse, ChapterFrame, ChapterPhase, RightClickerFrame, RightClickerPhase } from "./types";
import type { LocalCase } from "./view";

/* ------------------------------------------------------------------ the case files */

/** 4:16.4 at 60 ticks a second. */
export const FIXTURE_TICKS = 15_384;
export const FIXTURE_TX = "8xJ3kKqHnQf2mYtV1cD7rLw9sPzA4bE6uN5oG0hR";

export interface CasesFixture {
  signedIn: boolean;
  /** What `GET /api/cases` answers: a list, an error, or nothing yet. */
  result: CasesResponse | "error" | "loading";
  /** This browser's marks, in place of localStorage's. */
  local?: Partial<Record<string, LocalCase>>;
}

const TOKEN = "trophy:badge:case-001";

/** A `GET /api/cases` entry, as the server sends it. */
const record = (over: Partial<CaseRecordApi> = {}): CaseRecordApi => ({
  id: "case-001",
  number: "001",
  title: "Missing: Mary Jpeg",
  status: "new",
  clearedAt: null,
  bestTicks: null,
  badge: { status: "none", tokenId: TOKEN, tx: null },
  active: null,
  ...over,
});

const CLEARED = { status: "cleared" as const, clearedAt: "2026-11-05T21:14:00.000Z", bestTicks: FIXTURE_TICKS };

export type CasesFixtureName = "new" | "progress" | "closed-queued" | "closed-minted" | "guest" | "guest-closed" | "loading" | "error" | "empty";

export const CASES_FIXTURES: Record<CasesFixtureName, CasesFixture> = {
  new: { signedIn: true, result: { signedIn: true, cases: [record()] } },
  progress: { signedIn: true, result: { signedIn: true, cases: [record({ active: { runId: "run_fixture", expiresAt: "2026-11-05T22:00:00.000Z" } })] } },
  "closed-queued": { signedIn: true, result: { signedIn: true, cases: [record({ ...CLEARED, badge: { status: "queued", tokenId: TOKEN, tx: null } })] } },
  "closed-minted": { signedIn: true, result: { signedIn: true, cases: [record({ ...CLEARED, badge: { status: "minted", tokenId: TOKEN, tx: FIXTURE_TX } })] } },
  guest: { signedIn: false, result: { signedIn: false, cases: [record()] } },
  "guest-closed": { signedIn: false, result: { signedIn: false, cases: [record()] }, local: { "case-001": { cleared: true, bestTicks: FIXTURE_TICKS + 912 } } },
  loading: { signedIn: true, result: "loading" },
  error: { signedIn: true, result: "error" },
  empty: { signedIn: true, result: { signedIn: true, cases: [] } },
};

export const isCasesFixture = (name: string | null): name is CasesFixtureName => !!name && Object.hasOwn(CASES_FIXTURES, name);

/* ------------------------------------------------------------------ the night */

export type ChapterFixtureName = "investigate" | "standoff" | "rescue" | "done";

export const CHAPTER_FIXTURES: readonly ChapterFixtureName[] = ["investigate", "standoff", "rescue", "done"];

export const isChapterFixture = (name: string | null): name is ChapterFixtureName => !!name && (CHAPTER_FIXTURES as readonly string[]).includes(name);

/** Three roofs in the Bridge District (any district, in a city without one), nearest the hero first. */
function clueSpots(city: City, near: Vec3): Vec3[] {
  const inDistrict = city.buildings.filter((b) => b.district === "bridge-district");
  const pool = inDistrict.length >= 3 ? inDistrict : city.buildings;
  return [...pool]
    .map((b) => ({ b, d: Math.hypot((b.x0 + b.x1) / 2 - near.x, (b.z0 + b.z1) / 2 - near.z) }))
    .sort((a, b) => a.d - b.d)
    .filter((_, i) => i % 3 === 1)
    .slice(0, 3)
    .map(({ b }) => ({ x: (b.x0 + b.x1) / 2, y: b.top ? b.top.h : b.h, z: (b.z0 + b.z1) / 2 }));
}

/**
 * A chapter frame for a HUD state, laid out on the night's real city: the clues on roofs
 * near the hero, the Right-Clicker and Mary on the bridge (Mary beside the hero in the
 * rescue, so the restore bar shows over her).
 */
export function chapterFixture(name: ChapterFixtureName, city: City, hero: Vec3, opts: { aim?: RightClickerPhase } = {}): { chapter: ChapterFrame; villain: RightClickerFrame | null } {
  const spots = clueSpots(city, hero);
  const found = name === "investigate" ? 1 : 3;
  const clues = (["tabs", "cursor", "pixels"] as const).map((id, i) => ({ id, pos: spots[i] ?? hero, found: i < found }));
  const deck = city.bridge?.deck;
  const bridge: Vec3 = deck ? { x: (deck.x0 + deck.x1) / 2, y: deck.y, z: (deck.z0 + deck.z1) / 2 } : hero;
  const phase: ChapterPhase = name;
  const beside: Vec3 = { x: hero.x + 90, y: hero.y, z: hero.z - 40 };
  const chapter: ChapterFrame = {
    id: "case-001",
    phase,
    clues,
    captive: name === "rescue" ? { pos: beside, restore: 0.62, freed: false } : name === "done" ? { pos: bridge, restore: 1, freed: true } : { pos: bridge, restore: 0, freed: false },
    copies: name === "standoff" ? [{ id: 1, pos: { x: bridge.x + 60, y: bridge.y + 44, z: bridge.z }, yaw: 0, alive: true }] : [],
  };
  const villain: RightClickerFrame | null =
    name === "standoff"
      ? { id: "right-clicker", copy: false, pos: bridge, hits: 5, hitsMax: 8, state: opts.aim ?? "aim", aim: opts.aim === undefined || opts.aim === "aim" ? { dir: { x: 1, y: 0, z: 0 }, half: 0.3 } : null }
      : null;
  return { chapter, villain };
}

/** The frame with a fixture's chapter (and the Right-Clicker) laid over it: a copy, the loop's own frame untouched. */
export function withChapterFixture(frame: RenderFrame3D, fixture: { chapter: ChapterFrame; villain: RightClickerFrame | null }): RenderFrame3D {
  const villains = fixture.villain ? [...frame.villains, fixture.villain] : frame.villains;
  return { ...frame, villains, chapter: fixture.chapter };
}
