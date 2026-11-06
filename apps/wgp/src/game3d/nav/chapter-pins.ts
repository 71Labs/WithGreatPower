/**
 * A case night's pins on the maps (`frame.chapter`, src/lib/cases/types.ts): each clue as a
 * gold magnifier (a mint tick once found, so the two differ by shape as well as colour) and
 * the bridge deck as a red cursor sign. The pin to head for next (the nearest clue still
 * out there, then the bridge, then Mary) holds to the minimap's rim with a wedge when it's
 * off the map. A normal night has no chapter and draws none of it.
 */
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { ChapterFrame } from "@/lib/cases/types";

import { NAV_COLORS as K } from "./colors";
import { clampToDisc, toMap, type MapView } from "./map";

export const chapterOf = (frame: RenderFrame3D): ChapterFrame | null => (frame as RenderFrame3D & { chapter?: ChapterFrame | null }).chapter ?? null;

/** The bridge deck's centre, where the Right-Clicker waits; null in a city without one. */
export function bridgePoint(city: City): Vec3 | null {
  const d = city.bridge?.deck;
  return d ? { x: (d.x0 + d.x1) / 2, y: d.y, z: (d.z0 + d.z1) / 2 } : null;
}

/**
 * Where the case's showdown is: the bridge deck (Case file 001), or the polling station on its
 * arena's stage (Case file 002); null in a city without one.
 */
export function chapterSite(chapter: Pick<ChapterFrame, "id">, city: City): Vec3 | null {
  if (chapter.id === "case-002") return city.zones[0]?.center ?? null;
  return bridgePoint(city);
}

/** Where to head next: the nearest clue still out there, then the bridge, then Mary; null once she's freed. Case file 002: the drop boxes, the station, then the ballot (the runner's, or the box). */
export function chapterNext(chapter: ChapterFrame, city: City, hero: Vec3): Vec3 | null {
  if (chapter.phase === "investigate") {
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (const c of chapter.clues) {
      if (c.found) continue;
      const d = Math.hypot(c.pos.x - hero.x, c.pos.z - hero.z);
      if (d < bestD) {
        bestD = d;
        best = c.pos;
      }
    }
    return best;
  }
  if (chapter.phase === "standoff" || chapter.phase === "lineup") return chapterSite(chapter, city);
  if (chapter.phase === "rescue" && chapter.vote) return chapter.vote.ballot?.state === "carried" ? chapter.vote.box : (chapter.vote.ballot?.pos ?? null);
  if (chapter.phase === "rescue") return chapter.captive && !chapter.captive.freed ? chapter.captive.pos : null;
  return null;
}

/** "stop": the station (the pin shows the stop's face, the Sybil's); "gen": Uncle Gen's ballot box. */
export type ChapterTarget = "clue" | "bridge" | "mary" | "stop" | "gen";

/**
 * Where the waypoint points on a case night, or null when there's nothing to point at:
 * the nearest clue while investigating; the bridge, then Mary, until the hero is there.
 */
export function chapterWaypoint(chapter: ChapterFrame, city: City, hero: Vec3): { point: Vec3; target: ChapterTarget } | null {
  const point = chapterNext(chapter, city, hero);
  if (!point) return null;
  const far = (d: number) => Math.hypot(point.x - hero.x, point.z - hero.z) > d;
  if (chapter.phase === "investigate") return { point, target: "clue" };
  if (chapter.vote) {
    if (chapter.phase === "lineup" || chapter.phase === "standoff") return far(500) ? { point, target: "stop" } : null;
    if (chapter.phase === "rescue") return chapter.vote.ballot?.state === "carried" && far(160) ? { point, target: "gen" } : null;
    return null;
  }
  if (chapter.phase === "standoff") return far(500) ? { point, target: "bridge" } : null;
  if (chapter.phase === "rescue") return far(260) ? { point, target: "mary" } : null;
  return null;
}

function magnifier(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.arc(x - s * 0.18, y - s * 0.18, s * 0.42, 0, Math.PI * 2);
  ctx.moveTo(x + s * 0.14, y + s * 0.14);
  ctx.lineTo(x + s * 0.55, y + s * 0.55);
  ctx.lineWidth = Math.max(1.6, s * 0.22);
  ctx.lineCap = "round";
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  ctx.lineCap = "butt";
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y + s * 0.02);
  ctx.lineTo(x - s * 0.12, y + s * 0.4);
  ctx.lineTo(x + s * 0.55, y - s * 0.38);
  ctx.lineWidth = Math.max(2, s * 0.26);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** A clue's pin at (x, y), radius r. */
export function cluePin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, found: boolean) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = found ? K.done : K.clue;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  if (found) tick(ctx, x, y, r * 0.9);
  else magnifier(ctx, x, y, r * 1.1);
}

/** The bridge's pin: a red sign with a white cursor on it. */
export function bridgePin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45);
  ctx.fillStyle = K.next;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  const s = r / 10;
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, y - 6.5 * s);
  ctx.lineTo(x - 4 * s, y + 5.5 * s);
  ctx.lineTo(x - 1 * s, y + 2.8 * s);
  ctx.lineTo(x + 1.4 * s, y + 7.5 * s);
  ctx.lineTo(x + 3.6 * s, y + 6.4 * s);
  ctx.lineTo(x + 1.3 * s, y + 1.9 * s);
  ctx.lineTo(x + 5 * s, y + 1.6 * s);
  ctx.closePath();
  ctx.fillStyle = K.edge;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
}

/** The case's pins on the round minimap (radius R about (R, R), the rim at `rim`). */
export function drawChapterPins(ctx: CanvasRenderingContext2D, frame: RenderFrame3D, city: City, view: MapView, R: number, rim: number): void {
  const chapter = chapterOf(frame);
  if (!chapter) return;
  const inside = (m: { x: number; y: number }, pad: number) => Math.hypot(m.x - R, m.y - R) < rim - pad;
  ctx.save();
  // Found clues first and faded, so the ones still out there sit on top.
  for (const found of [true, false]) {
    for (const c of chapter.clues) {
      if (c.found !== found) continue;
      const m = toMap(view, c.pos.x, c.pos.z);
      if (!inside(m, 10)) continue;
      ctx.globalAlpha = found ? 0.75 : 1;
      cluePin(ctx, m.x, m.y, 9, found);
    }
  }
  ctx.globalAlpha = 1;
  const bridge = chapterSite(chapter, city);
  if (bridge) {
    const m = toMap(view, bridge.x, bridge.z);
    if (inside(m, 12)) bridgePin(ctx, m.x, m.y, 10);
  }
  // The pin to head for, held to the rim with a wedge when it's off the map.
  const next = chapterNext(chapter, city, frame.hero.pos);
  if (next) {
    const m = toMap(view, next.x, next.z);
    const c = clampToDisc(m.x, m.y, R, R, rim - 13);
    if (c.clamped) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(11, -6);
      ctx.lineTo(11, 6);
      ctx.closePath();
      ctx.fillStyle = chapter.phase === "investigate" ? K.clue : K.next;
      ctx.lineWidth = 2;
      ctx.strokeStyle = K.ink;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (chapter.phase === "investigate") cluePin(ctx, c.x, c.y, 9, false);
      else bridgePin(ctx, c.x, c.y, 10);
    }
  }
  ctx.restore();
}
