/**
 * Case File 001, "Missing: Mary Jpeg": a story chapter played as its own night. This file is
 * the chapter's setup and its shared pieces (a leaf: it imports nothing that steps the sim):
 *
 * - The city is a patrol city with one stop, Doc's bridge over the river in the Bridge
 *   District (city.ts), with a wider deck (CHAPTER_DECK_HALF) so the standoff has room to
 *   sidestep. The bridge zone is the Right-Clicker's.
 * - Three clues on reachable roofs, placed from the seed (placeClues): torn poster tabs, a
 *   cursor scorch on a billboard, and loose pixels close to the bridge. Found by coming within
 *   CLUE_REACH, in any order (findClues).
 * - Mary Jpeg stands frozen on the deck, MARY_ALONG from its middle, until she's restored.
 * - The Right-Clicker's paper copies are bodies on the villain (like Sybil's), spawned and
 *   popped here.
 *
 * The phases (chapter-step.ts and right-clicker.ts): investigate → standoff → rescue → done.
 * Patrol nights never reach any of this: `state.chapter` is null and every branch checks it.
 *
 * Deterministic: the seeded Rng, + − × ÷ and Math.sqrt / Math.floor only.
 */
import type { ClueId } from "../rules/chapters";
import type { ChapterId, Stop } from "../rules/types";

import { generateCity, type CityIndex } from "./city";
import { HERO_RADIUS, RULESET_VERSION } from "./constants";
import type { City, Zone } from "./contract";
import { len2 } from "./dmath";
import { mix, Rng } from "./rng";
import type { ChapterClue, ChapterState, SimState, Villain } from "./types";

/** The Right-Clicker's level: mercy as on nights 3–4 (combat.ts mercy(2) = 2/3), damage at 1.08×. */
export const CHAPTER_LEVEL = 2;
/** Blows to beat him. */
export const CHAPTER_HITS = 8;
/** The chapter bridge's deck, either side of its line (a patrol's is DECK_HALF, 120). */
export const CHAPTER_DECK_HALF = 240;
/** A clue is found within this of the hero's centre across, and CLUE_TALL times that up and down. */
export const CLUE_REACH = 140;
export const CLUE_TALL = 1.5;
/** Mary stands this far along the deck from its middle. */
export const MARY_ALONG = 430;
/** Restoring her takes this many ticks of holding the web beside her (3 s). */
export const RESTORE_TICKS = 180;
/** Beside her: within this across, and RESTORE_RISE up and down. */
export const RESTORE_REACH = 170;
export const RESTORE_RISE = 160;
/** A captive-restore event every this many ticks of restoring (a quarter second). */
export const RESTORE_EVENT_TICKS = 15;
/** Copies that interrupt the rescue; the second comes at SECOND_COPY_TICKS of restore, or SECOND_COPY_SECONDS in. */
export const RESCUE_COPIES = 2;
export const SECOND_COPY_TICKS = 72;
export const SECOND_COPY_SECONDS = 4;
/** After she's freed ("gm"), this beat before the night ends. */
export const FREED_SECONDS = 2.5;
/** A paper copy: its collision radius, and its centre's height over the deck (it stands the hero's height). */
export const COPY_RADIUS = 30;
export const COPY_HALF_H = 44;
/** CTRL+C stops once this many copies have been made (a long fight). */
export const MAX_COPIES = 24;

/**
 * The input log's ruleset field for a chapter: 0x0C001100 + the patrol ruleset it runs on,
 * read as hex "C 001 1 04" (Case File 001, chapter rules rev 1, ruleset 4), CHAPTER_RULESET
 * "c001-1". A patrol log carries RULESET_VERSION (4) there, so neither replays as the other.
 */
export function chapterLogRuleset(id: ChapterId): number {
  switch (id) {
    case "case-001":
      return 0x0c001100 + RULESET_VERSION;
  }
}

/** The chapter's one stop, as the city sees it: Doc's bridge in the Bridge District (he isn't there tonight). */
export function chapterStops(_id: ChapterId): Stop[] {
  return [{ kind: "fight", villain: "doc-octochain", district: "bridge-district", level: CHAPTER_LEVEL, boss: false, quest: false }];
}

/** The chapter's city from the run's seed: the bridge city with the wide deck, its zone the Right-Clicker's. */
export function chapterCity(id: ChapterId, seed: number): City {
  const city = generateCity(seed, chapterStops(id), { deckHalf: CHAPTER_DECK_HALF });
  if (city.zones[0]) city.zones[0].villain = "right-clicker";
  return city;
}

/** The bridge's axis as a unit xz vector (the way the deck runs). */
export function deckAxis(city: City): { x: number; z: number } {
  return city.bridge?.axis === "z" ? { x: 0, z: 1 } : { x: 1, z: 0 };
}

/* ------------------------------------------------------------------ the clues */

interface Spot {
  x: number;
  y: number;
  z: number;
  /** At the foot of a billboard (the cursor scorch's place). */
  board: boolean;
  dStart: number;
  dBridge: number;
}

/** Roof spots a clue can lie on: the top of every building low enough to land on, clear of its props. */
function roofSpots(city: City, zone: Zone): Spot[] {
  const out: Spot[] = [];
  const c = zone.center;
  const st = city.start;
  const b0 = zone.bounds;
  const cb = city.bounds;
  for (const b of city.buildings) {
    const roof: { x0: number; z0: number; x1: number; z1: number } = b.top ?? b;
    const y = b.top ? b.top.h : b.h;
    if (roof.x1 - roof.x0 < 120 || roof.z1 - roof.z0 < 120 || y < 170 || y > 480) continue;
    const cx = (roof.x0 + roof.x1) / 2;
    const cz = (roof.z0 + roof.z1) / 2;
    if (cx > b0.x0 - 200 && cx < b0.x1 + 200 && cz > b0.z0 - 200 && cz < b0.z1 + 200) continue;
    if (cx < cb.x0 + 150 || cx > cb.x1 - 150 || cz < cb.z0 + 150 || cz > cb.z1 - 150) continue;
    const dStart = len2(cx - st.x, cz - st.z);
    if (dStart < 650) continue;
    const on = city.props.filter((p) => p.buildingId === b.id && p.at.y === y);
    const board = on.find((p) => p.kind === "billboard");
    let spot: { x: number; z: number } | null = board ? { x: board.at.x, z: board.at.z } : null;
    if (!spot) {
      const w = roof.x1 - roof.x0;
      const d = roof.z1 - roof.z0;
      const tries: [number, number][] = [
        [0.5, 0.5],
        [0.3, 0.3],
        [0.7, 0.7],
        [0.3, 0.7],
        [0.7, 0.3],
      ];
      for (const [fx, fz] of tries) {
        const x = roof.x0 + w * fx;
        const z = roof.z0 + d * fz;
        if (on.every((p) => len2(p.at.x - x, p.at.z - z) >= (p.w > p.d ? p.w : p.d) / 2 + 36)) {
          spot = { x, z };
          break;
        }
      }
    }
    if (!spot) continue;
    out.push({ x: spot.x, y, z: spot.z, board: !!board, dStart, dBridge: len2(spot.x - c.x, spot.z - c.z) });
  }
  return out;
}

/** How strict each pass is: pixels' distance from the bridge, the others' least, spacing, and the detour allowed. */
const PASSES: { near: [number, number]; far: number; spread: number; detour: number }[] = [
  { near: [500, 1150], far: 800, spread: 850, detour: 1.6 },
  { near: [400, 1500], far: 600, spread: 650, detour: 2.1 },
  { near: [0, 1e9], far: 0, spread: 300, detour: 1e9 },
];

/**
 * The three clues, from the seed: pixels on a roof near the bridge (its trail leads there), the
 * cursor at the foot of a billboard if one fits, tabs on another roof, all spread apart and
 * within a detour of the way from the start to the bridge. Order: tabs, cursor, pixels.
 */
export function placeClues(city: City, rng: Rng): ChapterClue[] {
  const zone = city.zones[0];
  const spots = zone ? roofSpots(city, zone) : [];
  // A seeded shuffle, so ties go a different way each night.
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = spots[i];
    spots[i] = spots[j];
    spots[j] = t;
  }
  const st = city.start;
  const c = zone ? zone.center : st;
  const base = len2(c.x - st.x, c.z - st.z) || 1;
  for (const pass of PASSES) {
    const apart = (a: Spot, others: (Spot | undefined)[]) => others.every((o) => !o || len2(o.x - a.x, o.z - a.z) >= pass.spread);
    const onWay = (a: Spot) => a.dStart + a.dBridge <= pass.detour * base;
    const pixels = spots.find((a) => a.dBridge >= pass.near[0] && a.dBridge <= pass.near[1] && onWay(a));
    if (!pixels) continue;
    const fits = (a: Spot, others: (Spot | undefined)[]) => a !== pixels && a.dBridge >= pass.far && onWay(a) && apart(a, others);
    const cursor = spots.find((a) => a.board && fits(a, [pixels])) ?? spots.find((a) => fits(a, [pixels]));
    if (!cursor) continue;
    const tabs = spots.find((a) => a !== cursor && fits(a, [pixels, cursor]));
    if (!tabs) continue;
    const clue = (id: ClueId, a: Spot): ChapterClue => ({ id, x: a.x, y: a.y, z: a.z, found: false });
    return [clue("tabs", tabs), clue("cursor", cursor), clue("pixels", pixels)];
  }
  // A city with no roofs to spare (never seen): around the start roof.
  const y = st.y;
  return [
    { id: "tabs", x: st.x + 160, y, z: st.z, found: false },
    { id: "cursor", x: st.x - 120, y, z: st.z + 150, found: false },
    { id: "pixels", x: st.x - 120, y, z: st.z - 150, found: false },
  ];
}

/** The chapter's opening state: the clues placed, Mary frozen at one end of the deck. */
export function setupChapter(id: ChapterId, city: City, _grid: CityIndex, seed: number): ChapterState {
  const rng = new Rng(mix(seed, 0xc0011));
  const clues = placeClues(city, rng);
  const zone = city.zones[0];
  const a = deckAxis(city);
  const side = rng.chance(0.5) ? 1 : -1;
  const c = zone?.center ?? city.start;
  const y = zone?.stage?.y ?? c.y;
  return {
    id,
    phase: "investigate",
    clues,
    captive: { x: c.x + a.x * MARY_ALONG * side, y, z: c.z + a.z * MARY_ALONG * side, restore: 0, freed: false },
    savedT: 0,
    aimX: 1,
    aimZ: 0,
    dragT: 0,
    dragX: 0,
    dragZ: 0,
    rescueT: 0,
    rescueCopies: 0,
    copies: 0,
    copyWind: [],
    copyCd: [],
  };
}

/** Clues the hero is touching are found; the last one starts the standoff. */
export function findClues(s: SimState) {
  const c = s.chapter;
  if (!c || c.phase !== "investigate") return;
  const h = s.hero;
  const r = CLUE_REACH;
  let found = 0;
  for (const k of c.clues) {
    if (!k.found) {
      const dx = k.x - h.x;
      const dz = k.z - h.z;
      if (dx <= r && dx >= -r && dz <= r && dz >= -r) {
        const dy = (k.y + HERO_RADIUS - h.y) / CLUE_TALL;
        if (dx * dx + dz * dz + dy * dy <= r * r) {
          k.found = true;
          s.events.push({ type: "clue-found", id: k.id, x: k.x, y: k.y, z: k.z, found: c.clues.filter((q) => q.found).length, of: c.clues.length });
        }
      }
    }
    if (k.found) found += 1;
  }
  if (found === c.clues.length) c.phase = "standoff";
}

/** The clue the route points at while investigating: the nearest one not yet found. */
export function nextClue(s: SimState): ChapterClue | null {
  const c = s.chapter;
  if (!c || c.phase !== "investigate") return null;
  const h = s.hero;
  let best: ChapterClue | null = null;
  let bestD = Infinity;
  for (const k of c.clues) {
    if (k.found) continue;
    const d = len2(k.x - h.x, k.z - h.z);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Whether the hero is beside Mary (restoring range). */
export function besideCaptive(s: SimState): boolean {
  const c = s.chapter;
  if (!c || c.captive.freed) return false;
  const h = s.hero;
  const m = c.captive;
  const dy = h.y - (m.y + HERO_RADIUS);
  return len2(h.x - m.x, h.z - m.z) <= RESTORE_REACH && dy <= RESTORE_RISE && dy >= -RESTORE_RISE;
}

/* ------------------------------------------------------------------ paper copies */

/** A paper copy at (x, z) on the deck (a body on the Right-Clicker, not real, like Sybil's). */
export function spawnCopy(s: SimState, v: Villain, x: number, z: number, floor: number, cooldown = 0) {
  const c = s.chapter!;
  const id = c.copies;
  c.copies += 1;
  const y = floor + COPY_HALF_H;
  v.bodies.push({ x, y, z, real: false, alive: true, slot: id, shootT: 0, vx: 0, vy: 0, vz: 0 });
  c.copyWind.push(0);
  c.copyCd.push(cooldown);
  s.events.push({ type: "copy-spawn", id, x, y, z });
}

/** Pop one copy (a hit, or swept away). */
export function popCopy(s: SimState, b: Villain["bodies"][number]) {
  if (!b.alive) return;
  b.alive = false;
  s.events.push({ type: "copy-pop", id: b.slot, x: b.x, y: b.y, z: b.z });
}

/** Pop every copy still standing. */
export function popCopies(s: SimState, v: Villain) {
  for (const b of v.bodies) popCopy(s, b);
}
