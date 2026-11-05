/**
 * Case File 003's marks on the maps and the waypoint (`frame.fee`, render contract v1.6): each
 * clue as a gold magnifier (a mint tick once found, as Case File 001's), the fee meter as a red
 * gauge, and Gas Goblin through the chase as a red diamond. The mark to head for next (the
 * nearest clue, the meter, him, then the bakery and the meter again) holds to the minimap's rim
 * with a wedge when it's off the map. Every other night has no `fee` and draws none of it.
 */
import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { cluePin } from "./chapter-pins";
import { NAV_COLORS as K } from "./colors";
import { clampToDisc, toMap, type MapView } from "./map";

export type FeeFrame = NonNullable<RenderFrame3D["fee"]>;

export const feeOf = (frame: RenderFrame3D): FeeFrame | null => frame.fee ?? null;

/** Before the bakery (clues, the meter, the chase): the patrol's stop and route aren't the way to go. */
export const feeEarly = (frame: RenderFrame3D): boolean => {
  const f = feeOf(frame);
  return !!f && (f.phase === "investigate" || f.phase === "meter" || f.phase === "chase");
};

export type FeeMark = "clue" | "meter" | "goblin" | "bakery";

/** Where to head next on a Fee Strike night, and what it is; null once the case is done. */
export function feeNext(fee: FeeFrame, frame: RenderFrame3D): { point: Vec3; mark: FeeMark } | null {
  const hero = frame.hero.pos;
  switch (fee.phase) {
    case "investigate": {
      let best: Vec3 | null = null;
      let bestD = Infinity;
      for (const c of fee.clues) {
        if (c.found) continue;
        const d = Math.hypot(c.pos.x - hero.x, c.pos.z - hero.z);
        if (d < bestD) {
          bestD = d;
          best = c.pos;
        }
      }
      return best ? { point: best, mark: "clue" } : null;
    }
    case "meter":
      return { point: fee.meter.pos, mark: "meter" };
    case "chase": {
      const v = frame.villains[0];
      return v ? { point: v.pos, mark: "goblin" } : { point: fee.meter.pos, mark: "goblin" };
    }
    case "showdown":
      return { point: fee.bakery, mark: "bakery" };
    case "cool":
      return { point: fee.meter.pos, mark: "meter" };
    default:
      return null;
  }
}

/** The waypoint's target on a Fee Strike night ("stop" shows the stop's face: Gas Goblin), or null when there's nothing to point at. */
export function feeWaypoint(fee: FeeFrame, frame: RenderFrame3D): { point: Vec3; target: "clue" | "meter" | "stop" } | null {
  const next = feeNext(fee, frame);
  if (!next) return null;
  switch (next.mark) {
    case "clue":
      return { point: next.point, target: "clue" };
    case "meter":
      // Cooling, the cooling bar over the meter marks it (a pin there would sit on top of it).
      return fee.phase === "cool" ? null : { point: next.point, target: "meter" };
    case "goblin":
      return { point: next.point, target: "stop" };
    case "bakery":
      return frame.mode === "travel" ? { point: next.point, target: "stop" } : null;
  }
}

/** The fee meter's pin: a red disc with a dial's needle swung into the red. */
export function meterPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, cooled: boolean) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = cooled ? K.done : K.next;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  // The dial's arc and needle.
  ctx.beginPath();
  ctx.arc(x, y + r * 0.2, r * 0.55, Math.PI * 1.1, Math.PI * 1.9);
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = K.edge;
  ctx.stroke();
  const a = cooled ? Math.PI * 1.25 : Math.PI * 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.2);
  ctx.lineTo(x + Math.cos(a) * r * 0.6, y + r * 0.2 + Math.sin(a) * r * 0.6);
  ctx.lineWidth = Math.max(1.6, r * 0.2);
  ctx.lineCap = "round";
  ctx.strokeStyle = K.ink;
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** Gas Goblin through the chase: a red diamond. */
function goblinPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = K.next;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = K.ink;
  ctx.stroke();
}

/** The case's pins on the round minimap (radius R about (R, R), the rim at `rim`). */
export function drawFeePins(ctx: CanvasRenderingContext2D, frame: RenderFrame3D, view: MapView, R: number, rim: number): void {
  const fee = feeOf(frame);
  if (!fee) return;
  const inside = (m: { x: number; y: number }, pad: number) => Math.hypot(m.x - R, m.y - R) < rim - pad;
  ctx.save();
  for (const found of [true, false]) {
    for (const c of fee.clues) {
      if (c.found !== found) continue;
      const m = toMap(view, c.pos.x, c.pos.z);
      if (!inside(m, 10)) continue;
      ctx.globalAlpha = found ? 0.75 : 1;
      cluePin(ctx, m.x, m.y, 9, found);
    }
  }
  ctx.globalAlpha = 1;
  if (!fee.meter.carried) {
    const m = toMap(view, fee.meter.pos.x, fee.meter.pos.z);
    if (inside(m, 12)) meterPin(ctx, m.x, m.y, 10, fee.meter.cooled);
  }
  const v = fee.phase === "meter" || fee.phase === "chase" ? frame.villains[0] : undefined;
  if (v) {
    const m = toMap(view, v.pos.x, v.pos.z);
    if (inside(m, 12)) goblinPin(ctx, m.x, m.y, 10);
  }
  const next = feeNext(fee, frame);
  if (next && next.mark !== "bakery") {
    const m = toMap(view, next.point.x, next.point.z);
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
      ctx.fillStyle = next.mark === "clue" ? K.clue : K.next;
      ctx.lineWidth = 2;
      ctx.strokeStyle = K.ink;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (next.mark === "clue") cluePin(ctx, c.x, c.y, 9, false);
      else if (next.mark === "meter") meterPin(ctx, c.x, c.y, 10, false);
      else goblinPin(ctx, c.x, c.y, 10);
    }
  }
  ctx.restore();
}
