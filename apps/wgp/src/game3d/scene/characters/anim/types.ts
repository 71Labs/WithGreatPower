/**
 * What every animator gets from the scene: the city's surfaces (the roof under a point, a
 * ray against the boxes), whether motion is reduced, and whether this tier runs secondary
 * physics on this character.
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import type { Footing } from "../../camera/raycast";

export interface AnimContext {
  /** The highest surface at or below y under (x, z): a roof, the deck, or the street. */
  ground(x: number, z: number, y: number): number;
  /**
   * The roof a sphere (radius r, centre x y z) stands on as the sim stands the hero: the one
   * under its centre within `reach` below, else the edge it rests on (camera/raycast.ts
   * `footingBelow`). Writes and returns `out`. Absent in tests: `ground` under the centre.
   */
  footing?(x: number, z: number, y: number, r: number, reach: number, out: Footing): Footing;
  /** Distance along a unit direction to the first box, or null within `max`. */
  ray(o: Vec3, dir: Vec3, max: number): number | null;
  reducedMotion: boolean;
  /** Springs and wobble on (off for allies on the low tier). */
  secondary: boolean;
  /** The hero's drawn position, for anyone who looks at or turns toward them. */
  hero: Vec3;
}
