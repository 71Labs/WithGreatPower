/**
 * Sound for the 3D night: the 2D game's mapping (src/audio/sim-audio.ts) on the 3D sim's
 * events, which carry the same fields plus z. Effects, voice lines and music through
 * src/audio/player; listens on the loop's bus and never touches game state.
 */
import type { Stop, VillainId } from "@wgp/game-core/types";

import type { VoiceId } from "@/audio/manifest";
import { playMusic, playSfx, playVoice, preloadSounds, stopMusic } from "@/audio/player";

import type { LoopEvent3D } from "./loop3d";

const TAUNT: Record<VillainId, VoiceId> = {
  "gas-goblin": "gas-goblin-taunt",
  "sandwich-man": "sandwich-man-taunt",
  "doc-octochain": "doc-octochain-taunt",
  sybil: "sybil-taunt",
};

/** What an ally says when you swing up to them. */
const GREETING: Partial<Record<string, VoiceId>> = {
  "mary-jpeg": "mary-jpeg-selfie",
  "uncle-gen": "uncle-gen-power",
  bearson: "bearson-menace",
  gwei: "gwei-backup",
};

/** A little pitch variety from the event's position, so repeats don't sound identical. */
const vary = (x: number) => 0.94 + (Math.abs(Math.round(x)) % 13) / 100;

export function nightAudio(stops: Stop[]) {
  preloadSounds("sfx", ["thwip", "swing", "release-perfect", "street-thud", "pow", "villain-hit"]);
  let boss = false;

  return (ev: LoopEvent3D) => {
    switch (ev.type) {
      case "go":
        playVoice("narrator-night");
        playMusic("patrol");
        break;
      case "thwip":
        playSfx("thwip", { rate: vary(ev.x + ev.z) });
        break;
      case "release":
        if (ev.grade === "perfect") {
          playSfx("release-perfect");
          playSfx("swing", { volume: 0.5, rate: vary(ev.y) });
        } else if (ev.grade === "good") playSfx("swing", { volume: 0.6, rate: vary(ev.y) });
        break;
      case "miss":
        playSfx("street-thud");
        break;
      case "villain-hit":
        playSfx(ev.by === "slam" || ev.by === "dash" ? "pow" : "villain-hit", { rate: vary(ev.x + ev.z) });
        if (ev.copy) playSfx("sybil-pop", { volume: 0.7 });
        break;
      case "hero-hurt":
        playSfx("hurt");
        break;
      case "blast":
        if (ev.kind === "bomb") playSfx("fee-bomb");
        else playSfx("pow", { volume: 0.8 });
        break;
      case "trap":
        playSfx("bread-clap");
        break;
      case "goo":
        playSfx("sybil-pop", { volume: 0.6 });
        break;
      case "clang":
        playSfx("chain-sweep", { volume: 0.5 });
        break;
      case "encounter": {
        const stop = stops[ev.index];
        boss = stop?.kind === "fight" && stop.boss;
        playVoice(TAUNT[ev.villain]);
        if (boss) playMusic("boss");
        break;
      }
      case "arrive": {
        const stop = stops[ev.index];
        const line = stop?.kind === "errand" ? GREETING[stop.ally] : undefined;
        if (line) playVoice(line);
        break;
      }
      case "gwei":
        playVoice("gwei-backup");
        break;
      case "fight-won":
        playSfx("webbed");
        if (boss) playMusic("victory", { loop: false });
        boss = false;
        break;
      case "ko":
        playSfx("ko");
        stopMusic();
        break;
    }
  };
}
