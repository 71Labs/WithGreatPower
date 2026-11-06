"use client";

/**
 * The race's ghosts inside the canvas (an R3F child of the patrol Stage): every frame, each
 * ghost's pose at the player's own tick (the loop's view: the latest tick, `alpha` of the way
 * from the one before), drawn by GhostCutouts. A ghost at its run's end waits there a moment,
 * then fades; one right by the player fades too, so it never hides him.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Vector3 } from "three";

import { ghostPose, type GhostPose } from "@wgp/game-core/ghost";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import type { RunLoop } from "@/game3d/session";

import { GhostCutouts, type GhostDraw } from "./ghost-mesh";
import type { Race } from "./race";

/** Seconds a finished ghost waits at its end before it's gone. */
const LINGER = 2;

/** The ghosts' per-frame state: their poses at the player's tick, and the cut-outs that draw them. */
class GhostRig {
  readonly layer = new GhostCutouts();
  private readonly draws: GhostDraw[];
  private readonly poses: GhostPose[];

  constructor(private readonly race: Race) {
    this.draws = race.ghosts.map((g) => ({ x: 0, y: 0, z: 0, anchor: null, fade: 0, color: g.rgb }));
    this.poses = race.ghosts.map(() => ({ x: 0, y: 0, z: 0, fx: 1, fz: 0, action: "idle", anchor: null, done: false }));
  }

  frame(v: RenderFrame3D, eye: Vector3, dpr: number): void {
    const tick = Math.max(0, v.tick - 1 + v.alpha);
    const hero = v.hero.pos;
    for (let i = 0; i < this.race.ghosts.length; i++) {
      const g = this.race.ghosts[i];
      const p = ghostPose(g.track, tick, this.poses[i]);
      const d = this.draws[i];
      d.x = p.x;
      d.y = p.y;
      d.z = p.z;
      if (p.anchor) {
        d.anchor = d.anchor ?? { x: 0, y: 0, z: 0 };
        d.anchor.x = p.anchor.x;
        d.anchor.y = p.anchor.y;
        d.anchor.z = p.anchor.z;
      } else d.anchor = null;
      const near = Math.hypot(p.x - hero.x, p.y - hero.y, p.z - hero.z);
      const byPlayer = Math.min(1, Math.max(0.3, (near - 50) / 160));
      const after = (tick - g.track.ticks) / 60;
      const ended = after <= LINGER ? 1 : Math.max(0, 1 - (after - LINGER) / 0.6);
      d.fade = byPlayer * ended;
    }
    this.layer.update(this.draws, eye, dpr);
    const drawn = (this.race.drawn ??= { tick: 0, at: this.draws.map(() => ({ x: 0, y: 0, z: 0, fade: 0 })) });
    drawn.tick = tick;
    this.draws.forEach((d, i) => Object.assign(drawn.at[i], { x: d.x, y: d.y, z: d.z, fade: d.fade }));
  }

  dispose(): void {
    this.layer.dispose();
  }
}

export function GhostScene({ loop, race }: { loop: RunLoop; race: Race }) {
  const rig = useMemo(() => new GhostRig(race), [race]);
  useEffect(() => () => rig.dispose(), [rig]);
  useFrame((state) => rig.frame(loop.view, state.camera.position, state.viewport.dpr));
  return <primitive object={rig.layer.group} />;
}
