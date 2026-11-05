/**
 * Case file 001's render contract (v1.5), as the scene reads it. The gameplay build owns the
 * real types in `packages/game-core/src/sim3d/contract.ts`; until they land, these match the
 * spec (launch/out/chapters/case-001-spec.md) field for field, all optional on the frame, so
 * the merge is a type-level no-op:
 *
 * - `RenderFrame3D.chapter`: the chapter's phase, its clues, captive Mary and the paper copies;
 * - the villain union's `"right-clicker"`, its phases and its `aim` cone;
 * - the chapter's sim events.
 *
 * Nothing here is read back by the sim.
 */
import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

export const CHAPTER_ID = "case-001";

export type ChapterPhase = "investigate" | "standoff" | "rescue" | "done";
export type ClueId = "tabs" | "cursor" | "pixels";

export interface ChapterClue {
  id: ClueId;
  pos: Vec3;
  found: boolean;
}

export interface ChapterCaptive {
  pos: Vec3;
  /** 0 (saved: fully compressed) … 1 (restored to full quality). */
  restore: number;
  freed: boolean;
}

export interface ChapterCopy {
  id: number;
  pos: Vec3;
  yaw: number;
  alive: boolean;
}

/** `RenderFrame3D.chapter` (v1.5). */
export interface ChapterFrame {
  id: "case-001";
  phase: ChapterPhase;
  clues: ChapterClue[];
  captive: ChapterCaptive | null;
  copies: ChapterCopy[];
}

/** The Right-Clicker's villain phases (the frame villain's `state`). */
export type RightClickerPhase = "idle" | "aim" | "flash" | "recover" | "copy" | "drag" | "stunned";
export const RIGHT_CLICKER_PHASES: readonly RightClickerPhase[] = ["idle", "aim", "flash", "recover", "copy", "drag", "stunned"];

/** The SCREENSHOT's cone: a unit direction and the half-angle (radians). */
export interface VillainAim {
  dir: Vec3;
  half: number;
}

type FrameVillain = RenderFrame3D["villains"][number];

export type SceneVillainId = FrameVillain["id"] | "right-clicker";

/** A frame villain as the scene reads it: the contract's, widened by the chapter's fields. */
export type SceneVillain = Omit<FrameVillain, "id"> & { id: SceneVillainId; aim?: VillainAim | null };

/** The chapter's sim events. */
export type ChapterEvent =
  | { type: "clue-found"; id: ClueId }
  | { type: "screenshot"; hit: boolean }
  | { type: "copy-spawn"; id: number }
  | { type: "copy-pop"; id: number }
  | { type: "drag"; from: Vec3; to: Vec3 }
  | { type: "captive-restore"; p: number }
  | { type: "captive-freed" }
  | { type: "case-closed" };

const EVENT_TYPES: ReadonlySet<string> = new Set(["clue-found", "screenshot", "copy-spawn", "copy-pop", "drag", "captive-restore", "captive-freed", "case-closed"]);

export function isChapterEvent(ev: { type: string }): ev is ChapterEvent {
  return EVENT_TYPES.has(ev.type);
}

/** The frame's chapter, or null on a normal night. */
export function chapterOf(frame: RenderFrame3D): ChapterFrame | null {
  return (frame as RenderFrame3D & { chapter?: ChapterFrame | null }).chapter ?? null;
}

/** The frame's villains, widened to the chapter's. */
export function villainsOf(frame: RenderFrame3D): readonly SceneVillain[] {
  return frame.villains as readonly SceneVillain[];
}

/** The Right-Clicker in this frame, if he's there. */
export function rightClickerOf(frame: RenderFrame3D): SceneVillain | null {
  for (const v of villainsOf(frame)) if (v.id === "right-clicker" && !v.copy) return v;
  return null;
}
