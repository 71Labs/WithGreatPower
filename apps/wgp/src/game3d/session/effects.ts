/**
 * Sim events as scene effects: comic bursts where things happen, the hero's somersault on
 * a perfect release, a slack strand when a web finds nothing, and a camera cut when the
 * hero is moved further than a swing could take him. Listens on the loop's bus; never
 * touches game state.
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import type { LoopEvent3D } from "./loop3d";

/** The slice of the scene handle effects need. */
export interface EffectsTarget {
  burst(word: string, at: Vec3, opts?: { size?: number; life?: number; rise?: number }): void;
  flip(): void;
  cut(): void;
  /** A web that found nothing to stick to: the strand flies out and drops. */
  fizzle?(): void;
  /** A strike at a villain in reach (ruleset 4): the hero throws a punch. */
  punch?(): void;
}

/**
 * Ruleset 4: the big wind-ups get a word over the villain the moment they start, so the rhythm
 * reads (dodge now), and Sandwich Man's hop over your web gets its joke.
 */
const TELEGRAPH: Record<string, string> = {
  "Glider dive": "DIVE!",
  "Front-run": "FRONT-RUN!",
  "Cross-chain slam": "SLAM!",
  "Front-runs your web": "HOP!",
};

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
        // The last hit lands biggest.
        t.burst(ev.by === "sling" || ev.by === "web-bomb" ? "ZAP!" : ev.by === "gwei" ? "WHAM!" : ev.hits === 0 ? "KAPOW!" : "POW!", above(ev.x, ev.y, ev.z), { size: ev.double || ev.hits === 0 ? 130 : 110 });
        break;
      case "strike":
        t.punch?.();
        break;
      case "zip":
        t.burst("THWIP!", above(ev.tx, ev.ty, ev.tz, 40), { size: 64, life: 0.5, rise: 20 });
        break;
      case "clang":
        // His guard (or Doc's arms) turned the blow: a small, quick word, so a wasted hit reads.
        t.burst(ev.reason === "arms" ? "CLANG!" : "BLOCK!", above(ev.x, ev.y, ev.z, 50), { size: 70, life: 0.45, rise: 16 });
        break;
      case "villain-attack": {
        const word = TELEGRAPH[ev.label];
        if (word) t.burst(word, above(ev.x, ev.y, ev.z, 70), { size: 84, life: 0.7, rise: 24 });
        break;
      }
      case "hero-hurt":
        t.burst("OOF!", above(ev.x, ev.y, ev.z), { size: 90, life: 0.8 });
        break;
      case "miss":
        t.burst(ev.water ? "SPLASH!" : "OOF!", above(ev.x, ev.y, ev.z, 40), { size: 90, life: 0.8 });
        break;
      case "blast":
        t.burst(ev.kind === "bomb" ? "WHAM!" : "POW!", above(ev.x, ev.y, ev.z, 20), { size: 100 });
        break;
      case "fizzle":
        t.fizzle?.();
        break;
      case "pickup":
        // Ruleset 3: a token is a Bit (the server mints one each); a ring boosts the swing.
        t.burst(ev.kind === "ring" ? "BOOST!" : "+1 BIT!", above(ev.x, ev.y, ev.z, 40), { size: ev.kind === "ring" ? 96 : 84, life: 0.7, rise: 30 });
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
