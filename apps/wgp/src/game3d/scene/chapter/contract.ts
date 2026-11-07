/**
 * Case file 001's render contract as the scene reads it: names for game-core's own types
 * (`RenderFrame3D.chapter`, the Right-Clicker among `villains` with his `aim`, and the
 * chapter's sim events; docs/chapters/case-001.md), plus small readers. Nothing here is read
 * back by the sim.
 */
import { CHAPTER_ID } from "@wgp/game-core/chapters";
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { raceRival } from "../roam/frontrun";

export { CHAPTER_ID };
export type { ClueId } from "@wgp/game-core/chapters";

/** `RenderFrame3D.chapter` (v1.5): null on patrol nights. */
export type ChapterFrame = NonNullable<RenderFrame3D["chapter"]>;
export type ChapterPhase = ChapterFrame["phase"];
export type ChapterClue = ChapterFrame["clues"][number];
export type ChapterCaptive = NonNullable<ChapterFrame["captive"]>;
export type ChapterCopy = ChapterFrame["copies"][number];

/** A frame villain, the Right-Clicker among them. */
export type SceneVillain = RenderFrame3D["villains"][number];
export type SceneVillainId = SceneVillain["id"];
/** The SCREENSHOT's cone: a unit xz direction and the half-angle (radians). */
export type VillainAim = NonNullable<SceneVillain["aim"]>;

/** The Right-Clicker's state words; "webbed" from the win on. */
export type RightClickerPhase = "idle" | "aim" | "flash" | "recover" | "copy" | "drag" | "stunned" | "webbed";
/** The phases a fight runs through (the lab's choices). */
export const RIGHT_CLICKER_PHASES: readonly RightClickerPhase[] = ["idle", "aim", "flash", "recover", "copy", "drag", "stunned"];

/** The chapter's sim events. */
export type ChapterEvent = Extract<SimEvent, { type: "clue-found" | "screenshot" | "copy-spawn" | "copy-pop" | "drag" | "captive-restore" | "captive-freed" | "case-closed" | "voter-mark" | "fork-call" | "fork" | "recount" | "ballot" }>;

// Case file 002 adds the voter marks, the fork vote, the recount and the ballot (vote/vote-scene.ts).
const EVENT_TYPES: ReadonlySet<string> = new Set(["clue-found", "screenshot", "copy-spawn", "copy-pop", "drag", "captive-restore", "captive-freed", "case-closed", "voter-mark", "fork-call", "fork", "recount", "ballot"]);

export function isChapterEvent(ev: { type: string }): ev is ChapterEvent {
  return EVENT_TYPES.has(ev.type);
}

/** The frame's chapter, or null on a normal night. */
export function chapterOf(frame: RenderFrame3D): ChapterFrame | null {
  return frame.chapter ?? null;
}

const withRival: SceneVillain[] = [];

/** The frame's villains (free roam's Front-run adds Sandwich Man while its race is on: roam/frontrun.ts). */
export function villainsOf(frame: RenderFrame3D): readonly SceneVillain[] {
  const rival = raceRival(frame);
  if (!rival) return frame.villains;
  withRival.length = 0;
  withRival.push(...frame.villains, rival);
  return withRival;
}

/** The Right-Clicker in this frame, if he's there. */
export function rightClickerOf(frame: RenderFrame3D): SceneVillain | null {
  for (const v of frame.villains) if (v.id === "right-clicker" && !v.copy) return v;
  return null;
}
