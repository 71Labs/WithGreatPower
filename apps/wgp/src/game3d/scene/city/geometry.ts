/**
 * The two shapes the whole city is instanced from, each with an `aHullDir` attribute for
 * the inverted-hull outline:
 *
 * - A unit box (x, z in [−0.5, 0.5], y in [0, 1]) without its bottom face (never seen;
 *   10 triangles). Its hull direction is the corner sign (±1, ±1, ±1), so every face moves
 *   out by exactly the outline width and the corners meet without gaps.
 * - A water-tower tank: a lathe (8 sides) of a cylinder body (0–0.78) and a conical roof
 *   that overhangs it (48 triangles), with smooth normals as its hull direction.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, LatheGeometry, Vector2 } from "three";

export function unitBox(): BufferGeometry {
  const box = new BoxGeometry(1, 1, 1);
  const pos = box.getAttribute("position") as BufferAttribute;
  const hull = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    hull[i * 3] = Math.sign(pos.getX(i));
    hull[i * 3 + 1] = Math.sign(pos.getY(i));
    hull[i * 3 + 2] = Math.sign(pos.getZ(i));
  }
  box.translate(0, 0.5, 0);
  // BoxGeometry groups: +x, −x, +y, −y, +z, −z. Drop −y.
  const index = box.getIndex()!;
  const bottom = box.groups[3];
  const kept: number[] = [];
  for (let i = 0; i < index.count; i++) {
    if (i >= bottom.start && i < bottom.start + bottom.count) continue;
    kept.push(index.getX(i));
  }
  const out = new BufferGeometry();
  out.setAttribute("position", pos);
  out.setAttribute("normal", box.getAttribute("normal"));
  out.setAttribute("aHullDir", new BufferAttribute(hull, 3));
  out.setIndex(kept);
  box.dispose();
  return out;
}

/** Fraction of the tank's height that is the body; the rest is the roof cone. */
export const TANK_BODY = 0.78;
/**
 * The eave's height (a fraction of the tank's): a flat-roofed tank (`aRoof` 1, one an ally
 * stands on) has its cone pressed down to here, a lid to stand on (city/shaders.ts).
 */
export const TANK_EAVE = TANK_BODY + 0.02;

export function tankGeometry(segments = 8): BufferGeometry {
  // No bottom disc: the tank sits on its legs and is only ever seen from the side or above.
  const pts = [
    new Vector2(0.5, 0),
    new Vector2(0.5, TANK_BODY),
    new Vector2(0.58, TANK_EAVE),
    new Vector2(0.0001, 1),
  ];
  const lathe = new LatheGeometry(pts, segments);
  const normal = lathe.getAttribute("normal") as BufferAttribute;
  const out = new BufferGeometry();
  out.setAttribute("position", lathe.getAttribute("position"));
  out.setAttribute("normal", normal);
  out.setAttribute("aHullDir", new BufferAttribute(new Float32Array(normal.array as Float32Array), 3));
  out.setIndex(lathe.getIndex());
  lathe.dispose();
  return out;
}
