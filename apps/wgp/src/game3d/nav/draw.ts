/**
 * Canvas 2D drawing for the minimap and the full city map, in the sticker style: a paper
 * map, buildings as flat blocks (taller is darker, setback tiers darker still) with ink
 * edges, the river and the bridge, a dotted route, pickup dots, character stickers for the
 * stops and an inked arrow for the hero.
 *
 * Everything is vector, drawn under the view's transform, so edges stay crisp at any zoom
 * and turn; the minimap culls to what's near the hero (a few dozen rectangles), cheap at
 * 18 Hz. Fills by height are worked out once per city.
 */
import type { Building, City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";
import { BLOCK, GRID, PITCH } from "@wgp/game-core/sim3d/constants";

import { chapterOf, drawChapterPins } from "./chapter-pins";
import { drawFeePins, feeEarly } from "./fee-pins";
import { NAV_COLORS as K } from "./colors";
import { clampToDisc, mapAngle, remainingRoute, stopPoint, toMap, type MapView } from "./map";

type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: Rgb, b: Rgb, t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

/** Per city: buildings lowest first (so a tall neighbour's ink edge sits on top) with their fills. */
interface CityPaint {
  order: Building[];
  fill: Map<Building, string>;
  top: Map<Building, string>;
}

const paints = new WeakMap<City, CityPaint>();

function paintOf(city: City): CityPaint {
  let p = paints.get(city);
  if (p) return p;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of city.buildings) {
    lo = Math.min(lo, b.h);
    hi = Math.max(hi, b.top ? b.top.h : b.h);
  }
  const span = Math.max(1, hi - lo);
  const low = hex(K.buildingLow);
  const high = hex(K.buildingHigh);
  const shade = (h: number) => Math.min(1, Math.pow(Math.max(0, h - lo) / span, 0.8));
  p = { order: [...city.buildings].sort((a, b) => a.h - b.h), fill: new Map(), top: new Map() };
  for (const b of city.buildings) {
    p.fill.set(b, mix(low, high, shade(b.h)));
    if (b.top) p.top.set(b, mix(low, high, Math.min(1, shade(b.top.h) + 0.12)));
  }
  paints.set(city, p);
  return p;
}

/**
 * The city under a view: streets, lots, buildings, the river and the bridge. `reach` (world
 * units from the view's centre) skips what's further; null draws everything. `ink` is the
 * building edge width, CSS px.
 */
export function drawCity(ctx: CanvasRenderingContext2D, city: City, view: MapView, reach: number | null, ink: number): void {
  const paint = paintOf(city);
  const px = 1 / view.scale;
  const cx = view.x;
  const cz = view.z;
  const near = (x0: number, z0: number, x1: number, z1: number) => {
    if (reach === null) return true;
    const dx = Math.max(x0 - cx, 0, cx - x1);
    const dz = Math.max(z0 - cz, 0, cz - z1);
    return dx * dx + dz * dz < reach * reach;
  };

  ctx.save();
  ctx.translate(view.cx, view.cy);
  ctx.rotate(view.rotation);
  ctx.scale(view.scale, view.scale);
  ctx.translate(-cx, -cz);
  ctx.lineJoin = "round";

  const { x0, z0, x1, z1 } = city.bounds;
  ctx.fillStyle = K.street;
  ctx.fillRect(x0 - 4000, z0 - 4000, x1 - x0 + 8000, z1 - z0 + 8000);
  ctx.fillStyle = K.lot;
  for (let bx = 0; bx < GRID; bx++)
    for (let bz = 0; bz < GRID; bz++) {
      const lx = bx * PITCH;
      const lz = bz * PITCH;
      if (near(lx, lz, lx + BLOCK, lz + BLOCK)) ctx.fillRect(lx, lz, BLOCK, BLOCK);
    }

  ctx.strokeStyle = K.ink;
  for (const b of paint.order) {
    if (!near(b.x0, b.z0, b.x1, b.z1)) continue;
    ctx.fillStyle = paint.fill.get(b)!;
    ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    ctx.lineWidth = ink * px;
    ctx.strokeRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    const t = b.top;
    if (t) {
      ctx.fillStyle = paint.top.get(b)!;
      ctx.fillRect(t.x0, t.z0, t.x1 - t.x0, t.z1 - t.z0);
      ctx.lineWidth = ink * 0.75 * px;
      ctx.strokeRect(t.x0, t.z0, t.x1 - t.x0, t.z1 - t.z0);
    }
  }

  const r = city.river;
  if (r && near(r.x0, r.z0, r.x1, r.z1)) {
    ctx.fillStyle = K.water;
    ctx.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
    // Two flat ripple lines along the channel.
    const alongZ = r.z1 - r.z0 > r.x1 - r.x0;
    ctx.strokeStyle = K.waterEdge;
    ctx.lineWidth = 1.5 * px;
    ctx.lineCap = "round";
    ctx.setLineDash([14 * px, 18 * px]);
    for (const f of [0.33, 0.67]) {
      if (alongZ) {
        const x = r.x0 + (r.x1 - r.x0) * f;
        line(ctx, x, r.z0, x, r.z1);
      } else {
        const z = r.z0 + (r.z1 - r.z0) * f;
        line(ctx, r.x0, z, r.x1, z);
      }
    }
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    ctx.strokeStyle = K.ink;
    ctx.lineWidth = (ink + 0.5) * px;
    if (alongZ) {
      line(ctx, r.x0, r.z0, r.x0, r.z1);
      line(ctx, r.x1, r.z0, r.x1, r.z1);
    } else {
      line(ctx, r.x0, r.z0, r.x1, r.z0);
      line(ctx, r.x0, r.z1, r.x1, r.z1);
    }
  }
  const bridge = city.bridge;
  if (bridge && near(bridge.deck.x0, bridge.deck.z0, bridge.deck.x1, bridge.deck.z1)) {
    const d = bridge.deck;
    ctx.fillStyle = K.bridge;
    ctx.fillRect(d.x0, d.z0, d.x1 - d.x0, d.z1 - d.z0);
    ctx.strokeStyle = K.ink;
    ctx.lineWidth = (ink + 0.5) * px;
    ctx.strokeRect(d.x0, d.z0, d.x1 - d.x0, d.z1 - d.z0);
    const half = bridge.towerHalf ?? 30;
    ctx.fillStyle = K.ink;
    for (const t of bridge.towers) ctx.fillRect(t.x - half, t.z - half, half * 2, half * 2);
  }
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, ax: number, az: number, bx: number, bz: number) {
  ctx.beginPath();
  ctx.moveTo(ax, az);
  ctx.lineTo(bx, bz);
  ctx.stroke();
}

/* ------------------------------------------------------------------ stickers */

/**
 * A character face as a die-cut sticker at `px` device px: a white rounded square, the
 * light card behind the art, an ink outline (the HUD's Face, as a bitmap).
 */
export function stickerBitmap(art: CanvasImageSource, px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  const ink = Math.max(1.5, px * 0.045);
  const edge = px * 0.09;
  const r = px * 0.28;
  ctx.beginPath();
  ctx.roundRect(ink / 2, ink / 2, px - ink, px - ink, r);
  ctx.fillStyle = K.edge;
  ctx.fill();
  ctx.lineWidth = ink;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  const inner = ink / 2 + edge;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(inner, inner, px - inner * 2, px - inner * 2, Math.max(1, r - edge));
  ctx.clip();
  ctx.fillStyle = K.card;
  ctx.fillRect(0, 0, px, px);
  ctx.drawImage(art, inner, inner, px - inner * 2, px - inner * 2);
  ctx.restore();
  return c;
}

/* ------------------------------------------------------------------ shared marks */

export function heroArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.75, size * 0.72);
  ctx.lineTo(-size * 0.38, 0);
  ctx.lineTo(-size * 0.75, -size * 0.72);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = K.edge;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function dottedPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string, width: number, gap: number) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.setLineDash([0.01, gap]);
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function pickupDots(ctx: CanvasRenderingContext2D, frame: RenderFrame3D, view: MapView, r: number, inside: (x: number, y: number) => boolean) {
  const list = frame.pickups;
  if (!list) return;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = K.ink;
  for (const p of list) {
    if (p.taken) continue;
    const m = toMap(view, p.pos.x, p.pos.z);
    if (!inside(m.x, m.y)) continue;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    if (p.kind === "bits") {
      // A filled gold dot…
      ctx.fillStyle = K.bits;
      ctx.fill();
      ctx.stroke();
    } else {
      // …and a hollow cyan hoop, so they differ by shape, not only colour.
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = K.ink;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = K.ring;
      ctx.stroke();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = K.ink;
    }
  }
  ctx.restore();
}

/** The hero's heading on the map: the facing, else the velocity, else north. */
function heading(frame: RenderFrame3D): { x: number; z: number } {
  const f = frame.hero.facing;
  if (f && Math.hypot(f.x, f.z) > 1e-3) return { x: f.x, z: f.z };
  const v = frame.hero.vel;
  if (Math.hypot(v.x, v.z) > 1) return { x: v.x, z: v.z };
  return { x: 0, z: -1 };
}

/* ------------------------------------------------------------------ the minimap */

export interface MinimapScene {
  city: City;
  frame: RenderFrame3D;
  /** Canvas size, CSS px (the canvas is square), and its pixel ratio. */
  size: number;
  dpr: number;
  /** Clockwise rotation (0: north up). */
  rotation: number;
  /** How many world units the radius shows. */
  radiusUnits: number;
  /** Face stickers by zone index (missing ones draw a plain disc until they load). */
  sticker(zone: number): HTMLCanvasElement | null;
  heroColor: string;
  /** 0–1 through the next stop's pulse, or null when still. */
  pulse: number | null;
}

export function drawMinimap(ctx: CanvasRenderingContext2D, s: MinimapScene): void {
  const { size, dpr, frame, city } = s;
  const R = size / 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, R, 0, Math.PI * 2);
  ctx.clip();

  const hero = frame.hero.pos;
  const view: MapView = { x: hero.x, z: hero.z, scale: R / s.radiusUnits, rotation: s.rotation, cx: R, cy: R };
  // Out to the corners of the square the disc sits in, plus a building's width.
  drawCity(ctx, city, view, s.radiusUnits * 1.45 + 600, 1.25);

  // The arena you're fighting in.
  const zone = city.zones[frame.stop];
  if (zone && zone.kind === "fight" && (frame.mode === "intro" || frame.mode === "fight" || frame.mode === "won")) {
    const b = zone.bounds;
    const corners = [toMap(view, b.x0, b.z0), toMap(view, b.x1, b.z0), toMap(view, b.x1, b.z1), toMap(view, b.x0, b.z1)];
    ctx.save();
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = K.next;
    ctx.stroke();
    ctx.restore();
  }

  // The route: the leg you're on in ink, the legs after it fainter (a patrol's; a case's marks lead instead).
  const travelling = (frame.mode === "travel" || frame.mode === "intro") && !chapterOf(frame) && !feeEarly(frame);
  const route = remainingRoute(city, frame);
  const pts = chapterOf(frame) || feeEarly(frame) ? [] : [toMap(view, hero.x, hero.z), ...route.map((p) => toMap(view, p.x, p.z))];
  if (pts.length > 2) dottedPath(ctx, pts.slice(1), K.routeLater, 2.5, 6);
  if (pts.length > 1 && travelling) dottedPath(ctx, pts.slice(0, 2), K.route, 3, 6);

  const rim = R - 3;
  pickupDots(ctx, frame, view, 3, (x, y) => Math.hypot(x - R, y - R) < rim - 3);

  // A case night has its own marks (drawChapterPins below), not the patrol's stops.
  const patrol = !chapterOf(frame) && !feeEarly(frame);

  // Later stops, faint and small, when they're on the map.
  for (let i = city.zones.length - 1; patrol && i > frame.stop; i--) {
    const p = stopPoint(city.zones[i]);
    const m = toMap(view, p.x, p.z);
    if (Math.hypot(m.x - R, m.y - R) > rim - 10) continue;
    ctx.globalAlpha = 0.6;
    stickerAt(ctx, s.sticker(i), m.x, m.y, 18);
    ctx.globalAlpha = 1;
  }

  // The next stop: its sticker, ringed and pulsing, pinned to the rim when it's off the map.
  if (patrol && zone && frame.mode !== "done") {
    const p = stopPoint(zone);
    const m = toMap(view, p.x, p.z);
    const c = clampToDisc(m.x, m.y, R, R, rim - 15);
    if (s.pulse !== null && !c.clamped) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 16 + s.pulse * 12, 0, Math.PI * 2);
      ctx.globalAlpha = 1 - s.pulse;
      ctx.lineWidth = 3;
      ctx.strokeStyle = K.next;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (c.clamped) {
      // A wedge on the rim pointing on toward it.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.beginPath();
      ctx.moveTo(23, 0);
      ctx.lineTo(13, -7);
      ctx.lineTo(13, 7);
      ctx.closePath();
      ctx.fillStyle = K.next;
      ctx.lineWidth = 2;
      ctx.strokeStyle = K.ink;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = K.next;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = K.ink;
    ctx.stroke();
    stickerAt(ctx, s.sticker(frame.stop), c.x, c.y, 24);
  }

  // A case night's clues and the bridge (nothing on a normal night).
  drawChapterPins(ctx, frame, city, view, R, rim);
  // Case File 003's clues, meter and Gas Goblin.
  drawFeePins(ctx, frame, view, R, rim);

  const h = heading(frame);
  heroArrow(ctx, R, R, mapAngle(view, h.x, h.z), 9, s.heroColor);

  // North: a little ink tab on the rim.
  const north = mapAngle(view, 0, -1);
  const nx = R + Math.cos(north) * (R - 12);
  const ny = R + Math.sin(north) * (R - 12);
  ctx.beginPath();
  ctx.arc(nx, ny, 8, 0, Math.PI * 2);
  ctx.fillStyle = K.ink;
  ctx.fill();
  ctx.fillStyle = K.paper;
  ctx.font = "800 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", nx, ny + 0.5);
  ctx.restore();

  // The inner ink ring of the sticker.
  ctx.beginPath();
  ctx.arc(R, R, R - 1, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
}

function stickerAt(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement | null, x: number, y: number, size: number) {
  if (img) {
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = K.edge;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
}

/* ------------------------------------------------------------------ the full map */

export interface FullMapScene {
  city: City;
  frame: RenderFrame3D;
  view: MapView;
  /** Canvas size, CSS px, and its pixel ratio. */
  width: number;
  height: number;
  dpr: number;
  heroColor: string;
}

/** The whole city north up: the night's route (legs done in a faint solid line, the rest dotted), pickups and the hero. Stops are drawn by the page over it. */
export function drawFullMap(ctx: CanvasRenderingContext2D, s: FullMapScene): void {
  const { width, height, dpr, view, city, frame } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawCity(ctx, city, view, null, 1.25);

  // A case night's marks are pinned by the page; its one patrol stop has no route to draw.
  const patrol = !chapterOf(frame) && !feeEarly(frame);
  const all: Vec3[] = patrol ? [city.start, ...city.zones.map(stopPoint)] : [];
  const done = all.slice(0, Math.min(all.length, frame.stop + 1)).map((p) => toMap(view, p.x, p.z));
  if (done.length > 1) {
    ctx.save();
    ctx.beginPath();
    done.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = K.routeLater;
    ctx.stroke();
    ctx.restore();
  }
  const hero = frame.hero.pos;
  const ahead = patrol ? [toMap(view, hero.x, hero.z), ...remainingRoute(city, frame).map((p) => toMap(view, p.x, p.z))] : [];
  if (ahead.length > 2) dottedPath(ctx, ahead.slice(1), K.routeLater, 3, 8);
  if (ahead.length > 1 && frame.mode !== "done") dottedPath(ctx, ahead.slice(0, 2), K.route, 3.5, 8);
  pickupDots(ctx, frame, view, 3.5, () => true);
  const h = heading(frame);
  heroArrow(ctx, toMap(view, hero.x, hero.z).x, toMap(view, hero.x, hero.z).y, mapAngle(view, h.x, h.z), 12, s.heroColor);
}
