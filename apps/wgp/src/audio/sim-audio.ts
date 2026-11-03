/**
 * Sound for the 2D city: the shared night score (./night-score) on the 2D loop's events.
 * Listens on the loop's bus next to the renderer; never touches game state.
 */
import type { Stop } from "@wgp/game-core/types";
import type { LoopEvent } from "@/sim/loop";

import { nightScore } from "./night-score";

export function simAudio(stops: Stop[]): (ev: LoopEvent) => void {
  return nightScore(stops);
}
