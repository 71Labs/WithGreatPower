/**
 * Sim events as scene effects: comic bursts where things happen, the card flip on a
 * perfect release, and a camera cut when the hero is moved further than a swing could
 * take him. Listens on the loop's bus; never touches game state.
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import type { LoopEvent3D } from "./loop3d";

/** The slice of the scene handle effects need. */
export interface EffectsTarget {
  burst(word: string, at: Vec3, opts?: { size?: number; life?: number; rise?: number }): void;
  flip(): void;
  cut(): void;
}

/** Bursts sit a little above the point they mark, so they don't hide the sticker. */
const above = (x: number, y: number, z: number, up = 60): Vec3 => ({ x, y: y + up, z });

export function sceneEffects(target: () => EffectsTarget | null) {
  return (ev: LoopEvent3D) => {
    const t = target();
    if (!t) return;
    switch (ev.type) {
      case "thwip":
        t.burst("THWIP!", above(ev.ax, ev.ay, ev.az, 40), { size: 64, life: 0.55, rise: 20 });
        break;
      case "release":
        if (ev.grade === "perfect") {
          t.burst("PERFECT!", above(ev.x, ev.y, ev.z), { size: 84, life: 0.8 });
          t.flip();
        }
        break;
      case "villain-hit":
        t.burst(ev.by === "sling" || ev.by === "web-bomb" ? "ZAP!" : ev.by === "gwei" ? "WHAM!" : "POW!", above(ev.x, ev.y, ev.z), { size: ev.double ? 130 : 110 });
        break;
      case "hero-hurt":
        t.burst("OOF!", above(ev.x, ev.y, ev.z), { size: 90, life: 0.8 });
        break;
      case "miss":
        t.burst(ev.water ? "SPLASH!" : "OOF!", above(ev.x, ev.y, ev.z, 40), { size: 90, life: 0.8 });
        break;
      case "blast":
        t.burst(ev.kind === "bomb" ? "WHAM!" : "POW!", above(ev.x, ev.y, ev.z, 20), { size: 100 });
        break;
      case "shield-pop":
        t.burst("ZAP!", above(ev.x, ev.y, ev.z), { size: 80, life: 0.6 });
        break;
      case "teleport":
        t.cut();
        break;
    }
  };
}
