/**
 * Case file 003, "Fee Strike", as the scene reads it: names for game-core's own types (the
 * frame's v1.8 `fee`, Gas Goblin among `villains`, and the case's sim events;
 * docs/chapters/case-003.md), plus small readers. Nothing here is read back by the sim.
 */
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

/** `RenderFrame3D.fee` (v1.8): null or absent on every other night. */
export type FeeFrame = NonNullable<RenderFrame3D["fee"]>;
export type FeePhase = FeeFrame["phase"];
export type FeeClue = FeeFrame["clues"][number];
export type FeeClueId = FeeClue["id"];
export type FeeMeter = FeeFrame["meter"];

/** The case's sim events the scene draws from (plus the bombs' and spikes' blasts). */
export type FeeEvent = Extract<
  SimEvent,
  { type: "fee-clue" | "meter-grab" | "chase-checkpoint" | "chase-lost" | "chase-escaped" | "chase-end" | "loaf" | "fee-spike" | "meter-cool" | "fees-cooled" }
>;

const EVENT_TYPES: ReadonlySet<string> = new Set(["fee-clue", "meter-grab", "chase-checkpoint", "chase-lost", "chase-escaped", "chase-end", "loaf", "fee-spike", "meter-cool", "fees-cooled"]);

export function isFeeEvent(ev: { type: string }): ev is FeeEvent {
  return EVENT_TYPES.has(ev.type);
}

/** The frame's case 003, or null on any other night. */
export function feeOf(frame: RenderFrame3D): FeeFrame | null {
  return frame.fee ?? null;
}

/** Gas Goblin in this frame (the chase's runner, then the fight's rival), if he's there. */
export function goblinOf(frame: RenderFrame3D): RenderFrame3D["villains"][number] | null {
  for (const v of frame.villains) if (v.id === "gas-goblin" && !v.copy) return v;
  return null;
}
