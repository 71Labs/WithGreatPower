/**
 * Free roam's minimap on a canvas, in the sticker style of the night's (draw.ts): the city
 * round the hero, the same pins as the big map (roam-pins.ts) drawn small, the tracked task's
 * next step ringed (pinned to the rim with a wedge when it's off the disc), the hero's arrow
 * in the middle and a north tab. Another task's pins are faded; a done one is drawn with a
 * check, so status never rests on colour alone.
 */
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { NAV_COLORS as K } from "./colors";
import { drawCity, heroArrow } from "./draw";
import { clampToDisc, mapAngle, toMap, type MapView } from "./map";
import type { RoamPin, RoamTarget } from "./roam-pins";

export interface RoamMinimapScene {
  city: City;
  frame: RenderFrame3D;
  pins: readonly RoamPin[];
  target: RoamTarget | null;
  /** Canvas size, CSS px (square), and its pixel ratio. */
  size: number;
  dpr: number;
  /** Clockwise rotation (0: north up). */
  rotation: number;
  /** How many world units the radius shows. */
  radiusUnits: number;
  heroColor: string;
  /** 0–1 through the target's pulse, or null when still. */
  pulse: number | null;
}

/** The hero's heading on the map: the facing, else the velocity, else north. */
function heading(frame: RenderFrame3D): { x: number; z: number } {
  const f = frame.hero.facing;
  if (f && Math.hypot(f.x, f.z) > 1e-3) return { x: f.x, z: f.z };
  const v = frame.hero.vel;
  if (Math.hypot(v.x, v.z) > 1) return { x: v.x, z: v.z };
  return { x: 0, z: -1 };
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y);
  ctx.lineTo(x - r * 0.15, y + r * 0.4);
  ctx.lineTo(x + r * 0.55, y - r * 0.4);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = K.ink;
  ctx.stroke();
}

/** One pin, small, at (x, y). */
export function drawRoamPin(ctx: CanvasRenderingContext2D, p: RoamPin, x: number, y: number): void {
  ctx.save();
  if (p.task && !p.tracked && p.kind !== "giver") ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  switch (p.kind) {
    case "view":
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.done ? K.done : K.paper;
      ctx.fill();
      ctx.stroke();
      if (p.done) tick(ctx, x, y, 5);
      else {
        ctx.beginPath();
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
        ctx.stroke();
      }
      break;
    case "page":
      ctx.beginPath();
      ctx.roundRect(x - 4.5, y - 4.5, 9, 9, 2);
      ctx.fillStyle = K.edge;
      ctx.fill();
      ctx.lineWidth = 1.75;
      ctx.stroke();
      break;
    case "pixel":
      ctx.fillStyle = K.pixel;
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      ctx.lineWidth = 1.75;
      ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      break;
    case "tag":
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fillStyle = K.tag;
      ctx.fill();
      ctx.lineWidth = 1.75;
      ctx.stroke();
      break;
    case "bot":
      ctx.beginPath();
      ctx.roundRect(x - 7, y - 5, 14, 10, 3);
      ctx.fillStyle = K.next;
      ctx.fill();
      ctx.stroke();
      break;
    case "gate":
      if (p.done) ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = p.done ? K.done : K.paper;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = K.ink;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = K.gate;
      ctx.stroke();
      if (p.done) tick(ctx, x, y, 5);
      else if (p.order) {
        ctx.fillStyle = K.ink;
        ctx.font = "800 9px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(p.order), x, y + 0.5);
      }
      break;
    case "relay":
      if (p.done) ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.roundRect(x - 6.5, y - 6.5, 13, 13, 3);
      ctx.fillStyle = p.done ? K.edge : K.relay;
      ctx.fill();
      ctx.stroke();
      if (p.done) tick(ctx, x, y, 5);
      else {
        // The lit plug: a gold light in the box.
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = K.relayLit;
        ctx.fill();
      }
      break;
    case "giver":
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.done ? K.done : K.giver;
      if (p.done) ctx.globalAlpha *= 0.65;
      ctx.fill();
      ctx.stroke();
      if (p.done) tick(ctx, x, y, 5);
      else {
        ctx.fillStyle = K.ink;
        ctx.font = "900 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", x, y + 0.5);
      }
      break;
  }
  ctx.restore();
}

export function drawRoamMinimap(ctx: CanvasRenderingContext2D, s: RoamMinimapScene): void {
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
  drawCity(ctx, city, view, s.radiusUnits * 1.45 + 600, 1.25);

  const rim = R - 3;
  for (const p of s.pins) {
    // Found pages are clutter on a minimap; the big map keeps them.
    if (p.kind === "page" && p.done) continue;
    const m = toMap(view, p.x, p.z);
    if (Math.hypot(m.x - R, m.y - R) > rim - 6) continue;
    drawRoamPin(ctx, p, m.x, m.y);
  }

  // The tracked task's next step: a red ring (pulsing unless still), pinned to the rim with a wedge when it's off the disc.
  if (s.target) {
    const m = toMap(view, s.target.at.x, s.target.at.z);
    const c = clampToDisc(m.x, m.y, R, R, rim - 13);
    if (c.clamped) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(10, -7);
      ctx.lineTo(10, 7);
      ctx.closePath();
      ctx.fillStyle = K.next;
      ctx.lineWidth = 2;
      ctx.strokeStyle = K.ink;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = K.next;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = K.ink;
      ctx.stroke();
    } else {
      if (s.pulse !== null) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 12 + s.pulse * 10, 0, Math.PI * 2);
        ctx.globalAlpha = 1 - s.pulse;
        ctx.lineWidth = 3;
        ctx.strokeStyle = K.next;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = K.next;
      ctx.stroke();
    }
  }

  const h = heading(frame);
  heroArrow(ctx, R, R, mapAngle(view, h.x, h.z), 10, s.heroColor);

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

  ctx.beginPath();
  ctx.arc(R, R, R - 1, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
}
