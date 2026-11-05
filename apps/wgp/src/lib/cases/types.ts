/**
 * The case files' shapes, declared here to match the chapter spec
 * (launch/out/chapters/case-001-spec.md) until the gameplay build lands them in
 * game-core's contract (`RenderFrame3D.chapter`, the `"right-clicker"` villain, the sim
 * events) and the server (`GET /api/cases`, `Save.cases`). Every field is optional on the
 * frame, so a normal night (no chapter) reads exactly as it does today.
 *
 * When the contract gains these types, swap the declarations below for re-exports; the UI
 * only imports from this module.
 */
import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { Save } from "@wgp/game-core/types";

/** The only chapter so far. */
export const CHAPTER_ID = "case-001" as const;
export type ChapterId = typeof CHAPTER_ID;

export type ChapterPhase = "investigate" | "standoff" | "rescue" | "done";
export type ClueId = "tabs" | "cursor" | "pixels";

/** `RenderFrame3D.chapter` (render contract v1.5, additive). */
export interface ChapterFrame {
  id: ChapterId;
  phase: ChapterPhase;
  clues: { id: ClueId; pos: Vec3; found: boolean }[];
  captive: { pos: Vec3; restore: number /* 0..1 */; freed: boolean } | null;
  copies: { id: number; pos: Vec3; yaw: number; alive: boolean }[];
}

/** The Right-Clicker's state words (the villain's `state`). */
export type RightClickerPhase = "idle" | "aim" | "flash" | "recover" | "copy" | "drag" | "stunned";

/** The Right-Clicker as a `RenderFrame3D.villains` entry: the existing villain fields plus his aim cone. */
export interface RightClickerFrame {
  id: "right-clicker";
  copy?: boolean;
  pos: Vec3;
  /** Hits left, as every villain's. */
  hits: number;
  hitsMax: number;
  state: string;
  aim?: { dir: Vec3; half: number /* cone half-angle, radians */ } | null;
}

/** A render frame that may carry a chapter (and the Right-Clicker among its villains). */
export type ChapterRenderFrame = Omit<RenderFrame3D, "villains"> & {
  villains: (RenderFrame3D["villains"][number] | RightClickerFrame)[];
  chapter?: ChapterFrame | null;
};

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

/* ------------------------------------------------------------------ the server */

export type BadgeStatus = "none" | "queued" | "minted";

/** One entry of `GET /api/cases`. */
export interface CaseRecordApi {
  id: string;
  status: "new" | "cleared";
  /** Sim ticks (60 a second) of the best verified clear; null before one. */
  bestTicks: number | null;
  badge: { status: BadgeStatus; tx: string | null };
}

export interface CasesResponse {
  cases: CaseRecordApi[];
}

/** `Save.cases[id]` once the gameplay build adds it (a verified clear, or a guest's local one). */
export interface SavedCase {
  cleared: boolean;
  clearedAt?: string;
  bestTicks?: number;
}

export type SaveWithCases = Save & { cases?: Partial<Record<string, SavedCase>> };
