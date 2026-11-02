/**
 * The occlusion fade's per-frame input. The city shader fades every instance that comes
 * near the cone from the camera to the hero (and, in a fight, to the rival): wide at the
 * camera, so whatever crowds the lens thins out too, and narrow at the far end. Each end is
 * pulled back toward the camera a little first, so the wall the hero clings to never counts
 * as in the way, and nothing the hero stands over fades at all (its own roof, even with the
 * camera looking along it).
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";
import type { Vector4 } from "three";

import type { SharedUniforms } from "./materials";

export const OCCLUSION = {
  /** How far each end is pulled back toward the camera (world units). */
  pull: 46,
  /** Cone radii: outer (where the fade starts) and inner (fully faded), at the camera and at the end. */
  outerCam: 90,
  outerEnd: 10,
  innerCam: 40,
  innerEnd: 0,
} as const;

function setEnd(out: Vector4, cam: Vec3, at: Vec3 | null): void {
  if (!at) {
    out.w = 0;
    return;
  }
  const dx = cam.x - at.x;
  const dy = cam.y - at.y;
  const dz = cam.z - at.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > OCCLUSION.pull + 10)) {
    out.w = 0;
    return;
  }
  const k = OCCLUSION.pull / d;
  out.set(at.x + dx * k, at.y + dy * k, at.z + dz * k, 1);
}

/** Point the fade at the camera and up to two targets (null turns that end off). */
export function setOcclusion(u: SharedUniforms, cam: Vec3, a: Vec3 | null, b: Vec3 | null): void {
  u.uOccCam.value.set(cam.x, cam.y, cam.z);
  if (a) u.uOccHero.value.set(a.x, a.y, a.z, 1);
  else u.uOccHero.value.w = 0;
  setEnd(u.uOccA.value, cam, a);
  setEnd(u.uOccB.value, cam, a ? b : null);
}
