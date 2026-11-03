/**
 * A per-frame hook for the overlays drawn over the scene (the minimap, the waypoint, the
 * combo timer). The scene calls `run` once per animation frame, after it has moved the
 * camera, so an overlay placed from the pose lines up with the picture under it. Overlays
 * write the DOM or a canvas directly; nothing here goes through React state.
 */
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import type { CameraPose } from "./waypoint";

export interface TapFrame {
  frame: RenderFrame3D;
  /** The camera this frame, or null before the chase camera has a pose. */
  pose: CameraPose | null;
  /** The canvas, CSS px. */
  width: number;
  height: number;
  /** Seconds, monotonic. */
  time: number;
}

export type TapListener = (t: TapFrame) => void;

export class FrameTap {
  private readonly fns = new Set<TapListener>();
  private readonly ctx: TapFrame = { frame: null as unknown as RenderFrame3D, pose: null, width: 0, height: 0, time: 0 };

  on(fn: TapListener): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  run(frame: RenderFrame3D, pose: CameraPose | null, width: number, height: number): void {
    if (!this.fns.size) return;
    const c = this.ctx;
    c.frame = frame;
    c.pose = pose;
    c.width = width;
    c.height = height;
    c.time = performance.now() / 1000;
    for (const fn of this.fns) fn(c);
  }
}

/** Calls `fn` at most `hz` times a second (the minimap redraws at ~18 Hz, not every frame). */
export function throttled(hz: number, fn: TapListener): TapListener {
  let last = -Infinity;
  const every = 1 / hz;
  return (t) => {
    if (t.time - last < every) return;
    last = t.time;
    fn(t);
  };
}
