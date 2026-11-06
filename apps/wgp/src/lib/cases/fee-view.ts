/**
 * Case File 003 ("Fee Strike") in words, for the in-night HUD and the screen reader: pure
 * functions over the sim's HUD snapshot (`HudSnapshot.fee`, game3d/session/hud.ts feeHud) and
 * the case's sim events, unit-tested (fee-view.test.ts). The copy comes from game-core's own
 * content (rules/case-003.ts), so the HUD, the scene and the case files say the same thing.
 */
import { CHAPTERS, FEE_STRIKE_LINES, type FeeClueId } from "@wgp/game-core/chapters";
import { MAX_LOSSES, type SimEvent } from "@wgp/game-core/sim3d";

import type { FeeHud } from "@/sim/loop";

export type FeePhase = FeeHud["phase"];

/** The case's sim events (sim3d/types.ts SimEvent, Case File 003's). */
export type FeeEvent = Extract<
  SimEvent,
  { type: "fee-clue" | "meter-grab" | "chase-checkpoint" | "chase-lost" | "chase-escaped" | "chase-end" | "loaf" | "fee-spike" | "meter-cool" | "fees-cooled" }
>;

const FEE_EVENTS: ReadonlySet<string> = new Set(["fee-clue", "meter-grab", "chase-checkpoint", "chase-lost", "chase-escaped", "chase-end", "loaf", "fee-spike", "meter-cool", "fees-cooled"]);

export function isFeeEvent(ev: { type: string }): ev is FeeEvent {
  return FEE_EVENTS.has(ev.type);
}

const INFO = CHAPTERS["case-003"];

/** A clue's name and its note (a shopkeeper's line, or what the burn says). */
export function feeClue(id: FeeClueId): { name: string; note: string } {
  const c = INFO.clues.find((x) => x.id === id) ?? INFO.clues[0];
  return { name: c.name, note: c.note };
}

export interface FeeObjective {
  /** The verb phrase, and the count when there is one: "Find the clues" 1/3. */
  label: string;
  count: { found: number; total: number } | null;
}

/** The case's objective, from its phase (and, at the bakery, whether the fight is on). */
export function feeObjective(hud: Pick<FeeHud, "phase" | "cluesFound" | "clues">, mode?: string): FeeObjective {
  switch (hud.phase) {
    case "investigate":
      return { label: "Find the clues", count: { found: hud.cluesFound, total: hud.clues } };
    case "meter":
      return { label: "Find the fee meter", count: null };
    case "chase":
      return { label: "Chase Gas Goblin", count: null };
    case "showdown":
      return { label: mode === "travel" ? "Land on Aunt Mainnet’s roof" : "Stop Gas Goblin", count: null };
    case "cool":
      return { label: "Cool the fees", count: null };
    case "done":
      return { label: "Case closed", count: null };
  }
}

export type ChaseTone = "tail" | "close" | "behind" | "away" | "waiting";

/**
 * How the chase stands, in a word and a tone: right on his tail, keeping up, falling behind,
 * getting away (the escape meter filling), or him waiting after a loss.
 */
export function chaseCue(chase: NonNullable<FeeHud["chase"]>): { tone: ChaseTone; text: string } {
  if (chase.holding) return { tone: "waiting", text: "He’s waiting. Go!" };
  if (chase.warn) return { tone: "away", text: FEE_STRIKE_LINES.warn };
  if (chase.gap <= 300) return { tone: "tail", text: "On his tail" };
  if (chase.gap <= 750) return { tone: "close", text: "Keep up" };
  return { tone: "behind", text: "Falling behind" };
}

/** A line for screen readers when the case moves on. */
export function feePhaseLine(phase: FeePhase): string {
  switch (phase) {
    case "investigate":
      return "Case file 003, Fee Strike. Follow the fee-bomb burns and talk to the stuck shopkeepers: three clues in the Mempool Market.";
    case "meter":
      return "That’s every clue. Find the fee meter: Gas Goblin is perched on it.";
    case "chase":
      return `${FEE_STRIKE_LINES.grab} Swing after him and don’t fall too far behind.`;
    case "showdown":
      return FEE_STRIKE_LINES.showdown;
    case "cool":
      return `Gas Goblin’s webbed. ${FEE_STRIKE_LINES.cool}`;
    case "done":
      return `${FEE_STRIKE_LINES.cooled} Case closed.`;
  }
}

/** A line for screen readers (and captions) when a case event happens; null for ones too frequent to read. */
export function feeEventLine(ev: FeeEvent): { text: string; urgent: boolean } | null {
  switch (ev.type) {
    case "fee-clue": {
      const c = feeClue(ev.id);
      return { text: `Clue ${ev.found} of ${ev.of}: ${c.name.toLowerCase()}. ${c.note}`, urgent: true };
    }
    case "meter-grab":
      return { text: `${FEE_STRIKE_LINES.meter.note} ${FEE_STRIKE_LINES.grab}`, urgent: true };
    case "chase-checkpoint":
      return { text: "Checkpoint.", urgent: false };
    case "chase-lost":
      return { text: `${FEE_STRIKE_LINES.lost} ${ev.losses} of ${MAX_LOSSES} lost.`, urgent: true };
    case "chase-escaped":
      return { text: FEE_STRIKE_LINES.escaped, urgent: true };
    case "chase-end":
      return { text: FEE_STRIKE_LINES.showdown, urgent: true };
    case "loaf":
      return { text: `Aunt Mainnet tosses you yesterday’s loaf: plus ${ev.gained} health.`, urgent: true };
    case "fee-spike":
      return ev.hit ? { text: "Fee spike! It knocked you back.", urgent: true } : null;
    case "fees-cooled":
      return { text: `${FEE_STRIKE_LINES.cooled} Aunt Mainnet: “${INFO.captive.freed}”`, urgent: true };
    case "meter-cool":
      return null;
  }
}
