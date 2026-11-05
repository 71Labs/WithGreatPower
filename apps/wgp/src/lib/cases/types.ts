/**
 * The case files' shapes, from the gameplay build's contract (docs/chapters/case-001.md):
 * game-core's render frame (`RenderFrame3D.chapter`, the Right-Clicker among `villains`),
 * its sim events and save record, and the server's `GET /api/cases`. The UI imports them
 * from here, so the names it uses stay in one place.
 */
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import type { BadgeView, CaseView } from "@/server/db/cases";

export { CHAPTER_ID } from "@wgp/game-core/chapters";
export type { ClueId } from "@wgp/game-core/chapters";
export type { CaseRecord, ChapterId } from "@wgp/game-core/types";

/** `RenderFrame3D.chapter` (render contract v1.5): null on patrol nights. */
export type ChapterFrame = NonNullable<RenderFrame3D["chapter"]>;
export type ChapterPhase = ChapterFrame["phase"];

/** The Right-Clicker's state words (his `villains` entry's `state`). */
export type RightClickerPhase = "idle" | "aim" | "flash" | "recover" | "copy" | "drag" | "stunned" | "webbed";

/** The Right-Clicker as a `RenderFrame3D.villains` entry, with his SCREENSHOT cone (`aim`). */
export type RightClickerFrame = RenderFrame3D["villains"][number] & { id: "right-clicker" };

/** A frame the chapter UI reads (the same frame: the chapter fields are part of the contract). */
export type ChapterRenderFrame = RenderFrame3D;

/** The chapter's sim events. */
export type ChapterEvent = Extract<SimEvent, { type: "clue-found" | "screenshot" | "copy-spawn" | "copy-pop" | "drag" | "captive-restore" | "captive-freed" | "case-closed" }>;

/* ------------------------------------------------------------------ the server */

/** One entry of `GET /api/cases`. */
export type CaseRecordApi = CaseView;
export type BadgeStatus = BadgeView["status"];

export interface CasesResponse {
  signedIn: boolean;
  cases: CaseRecordApi[];
}
