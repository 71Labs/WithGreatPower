/**
 * Sound for the 3D night: the shared night score (src/audio/night-score.ts) on the 3D
 * sim's events, which carry the same fields plus z. Effects, voice lines, ambience and
 * the score through src/audio/player; listens on the loop's bus and never touches game state.
 */
import type { Stop } from "@wgp/game-core/types";

import { nightScore } from "@/audio/night-score";

import type { LoopEvent3D } from "./loop3d";

export function nightAudio(stops: Stop[]): (ev: LoopEvent3D) => void {
  return nightScore(stops);
}
