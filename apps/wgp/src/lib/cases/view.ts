/**
 * What the case files show, worked out from the server's record, the save and this
 * browser's own marks: pure functions, unit-tested (view.test.ts), no React or DOM.
 *
 * - caseStatus: New, In progress (started here, not closed yet) or Closed.
 * - badgeView: the "Case closed" badge's state in words (and a NearBlocks link once minted).
 * - chapterHud / objective / villainCue: the in-night HUD's view of `frame.chapter`.
 */
import { EXPLORER_URL } from "@/lib/near/config";
import type { ChapterHud as SimChapterHud } from "@/sim/loop";

import { clueCopy } from "./content";
import {
  CHAPTER_ID,
  type BadgeStatus,
  type CaseRecord,
  type CaseRecordApi,
  type ChapterEvent,
  type ChapterPhase,
  type ChapterRenderFrame,
  type ClueId,
  type RightClickerFrame,
  type RightClickerPhase,
} from "./types";

/** The sim's rate: ticks per second (game-core sim3d SIM_HZ). */
export const TICKS_PER_SECOND = 60;

/* ------------------------------------------------------------------ status */

export type CaseStatus = "new" | "in-progress" | "closed";

/** This browser's own record of a case: started here, or cleared here as a guest. */
export interface LocalCase {
  /** The intro was opened (no longer "New" in the dock). */
  seenAt?: number;
  startedAt?: number;
  cleared?: boolean;
  clearedAt?: string;
  bestTicks?: number;
}

export interface CaseSources {
  /** `GET /api/cases` for this case (signed in), if it answered. */
  api?: CaseRecordApi | null;
  /** `Save.cases[id]`: the account's (verified) or a guest's browser save (unverified). */
  saved?: Pick<CaseRecord, "cleared" | "bestTicks"> | null;
  local?: LocalCase | null;
}

export function caseStatus({ api, saved, local }: CaseSources): CaseStatus {
  if (api?.status === "cleared" || saved?.cleared || local?.cleared) return "closed";
  // A run of it in flight on the server, or started from this browser.
  if (api?.active || local?.startedAt) return "in-progress";
  return "new";
}

/** The best clear any source knows of, in ticks; null before one. */
export function bestTicks({ api, saved, local }: CaseSources): number | null {
  const all = [api?.bestTicks, saved?.bestTicks, local?.bestTicks].filter((t): t is number => typeof t === "number" && t > 0);
  return all.length ? Math.min(...all) : null;
}

export const STATUS_LABEL: Record<CaseStatus, string> = { new: "New", "in-progress": "In progress", closed: "Closed" };

/** "4:07.3": minutes, seconds and tenths. */
export function formatTicks(ticks: number): string {
  const tenths = Math.max(0, Math.round((ticks / TICKS_PER_SECOND) * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/** The same time in words, for screen readers: "4 minutes 7.3 seconds". */
export function spokenTicks(ticks: number): string {
  const tenths = Math.max(0, Math.round((ticks / TICKS_PER_SECOND) * 10));
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  const sec = `${s} second${s === 1 ? "" : "s"}`;
  return m ? `${m} minute${m === 1 ? "" : "s"} ${sec}` : sec;
}

/* ------------------------------------------------------------------ the badge */

export type BadgeView =
  /** A guest: the clear stays in this browser; signing in files it. */
  | { kind: "sign-in"; label: string; detail: string }
  /** Signed in, not closed yet. */
  | { kind: "locked"; label: string; detail: string }
  /** Signed in and closed, the mint not sent yet (or a clear from before signing in). */
  | { kind: "pending"; label: string; detail: string }
  | { kind: "queued"; label: string; detail: string }
  | { kind: "minted"; label: string; detail: string; href: string | null }
  /** Signed in, but the server couldn't be asked. */
  | { kind: "unknown"; label: string; detail: string };

export const txUrl = (tx: string) => `${EXPLORER_URL}/txns/${encodeURIComponent(tx)}`;

export function badgeView(opts: { signedIn: boolean; status: CaseStatus; badge?: { status: BadgeStatus; tx: string | null } | null; failed?: boolean }): BadgeView {
  const { signedIn, status, badge, failed } = opts;
  if (!signedIn)
    return status === "closed"
      ? { kind: "sign-in", label: "Sign in to file the case", detail: "Your clear is saved in this browser. Sign in, close it again, and it’s filed with your hero." }
      : { kind: "sign-in", label: "Sign in to file the case", detail: "Guests can play it. Signed in, your clear is filed with your hero." };
  if (failed && !badge) return { kind: "unknown", label: "Badge not checked", detail: "Couldn’t reach the case files just now." };
  if (badge?.status === "minted") return { kind: "minted", label: "Badge minted", detail: "“Case closed” is on NEAR, on your hero.", href: badge.tx ? txUrl(badge.tx) : null };
  if (badge?.status === "queued") return { kind: "queued", label: "Badge queued", detail: "Minting on NEAR now. It shows here once it lands." };
  if (status === "closed") return { kind: "pending", label: "Badge on its way", detail: "Your clear is filed. The badge follows shortly." };
  return { kind: "locked", label: "“Case closed” badge", detail: "Close the case to file it with your hero." };
}

/* ------------------------------------------------------------------ the night's HUD */

export interface ChapterHud {
  phase: ChapterPhase;
  clues: { id: ClueId; found: boolean }[];
  found: number;
  total: number;
  /**
   * The Right-Clicker, while he's on the deck. `open`: a blow lands now (his reload, a broken
   * drag's stagger), from the sim's HUD when it has one, else read off his state.
   */
  villain: { phase: RightClickerPhase; hits: number; hitsMax: number; open: boolean } | null;
  /** 0–1 during the rescue, else null. */
  restore: number | null;
  /** The hero stands beside Mary: holding the web restores her (the sim's HUD). */
  beside: boolean;
  /** Frozen by a SCREENSHOT right now (the sim's HUD). */
  saved: boolean;
  freed: boolean;
}

const PHASES: readonly RightClickerPhase[] = ["idle", "aim", "flash", "recover", "copy", "drag", "stunned", "webbed"];
const asPhase = (s: string): RightClickerPhase => (PHASES as readonly string[]).includes(s) ? (s as RightClickerPhase) : "idle";

export function rightClickerOf(frame: Pick<ChapterRenderFrame, "villains">): RightClickerFrame | null {
  return (frame.villains.find((v) => v.id === "right-clicker") as RightClickerFrame | undefined) ?? null;
}

/**
 * The HUD's view of a frame's chapter, or null on a normal night. The frame gives the phase,
 * the clues, the Right-Clicker and Mary; the sim's own HUD snapshot (`sim`, when there is one)
 * adds what only the sim knows: whether a blow lands now, the hero beside Mary, SAVED. Restore
 * is rounded to a percent so a still bar doesn't re-render.
 */
export function chapterHud(frame: Pick<ChapterRenderFrame, "chapter" | "villains">, sim?: SimChapterHud | null): ChapterHud | null {
  const c = frame.chapter;
  if (!c || c.id !== CHAPTER_ID) return null;
  const rc = rightClickerOf(frame);
  const found = c.clues.filter((x) => x.found).length;
  const phase = rc ? asPhase(rc.state) : "idle";
  return {
    phase: c.phase,
    clues: c.clues.map((x) => ({ id: x.id, found: x.found })),
    found,
    total: c.clues.length,
    villain:
      rc && c.phase === "standoff" && phase !== "webbed"
        ? { phase, hits: rc.hits, hitsMax: rc.hitsMax, open: sim?.villain ? sim.villain.open : phase === "recover" || phase === "stunned" }
        : null,
    restore: c.phase === "rescue" && c.captive ? Math.round(Math.max(0, Math.min(1, c.captive.restore)) * 100) / 100 : null,
    beside: !!sim?.beside,
    saved: !!sim?.saved,
    freed: !!c.captive?.freed,
  };
}

export interface Objective {
  /** The whole line, as read: "Find the clues 1/3". */
  text: string;
  /** The verb phrase on its own, and the count when there is one. */
  label: string;
  count: { found: number; total: number } | null;
}

export function objective(hud: Pick<ChapterHud, "phase" | "found" | "total">): Objective {
  switch (hud.phase) {
    case "investigate":
      return { text: `Find the clues ${hud.found}/${hud.total}`, label: "Find the clues", count: { found: hud.found, total: hud.total } };
    case "standoff":
    // (Case File 001 has no lineup; Case File 002's HUD is its own, lib/cases/vote-view.ts.)
    case "lineup":
      return { text: "Stop the Right-Clicker", label: "Stop the Right-Clicker", count: null };
    case "rescue":
      return { text: "Restore Mary", label: "Restore Mary", count: null };
    case "done":
      return { text: "Case closed", label: "Case closed", count: null };
  }
}

/**
 * The word on the Right-Clicker's bar for what he's doing, or null when there's nothing to
 * read: "Saving…" while he aims (even over a flinch), "Open: hit him" while a blow lands.
 */
export function villainCue(phase: RightClickerPhase, open = phase === "recover" || phase === "stunned"): { text: string; tone: "warn" | "open" | "plain" } | null {
  if (phase === "aim") return { text: "Saving…", tone: "warn" };
  if (phase === "flash") return { text: "Click!", tone: "warn" };
  if (open) return { text: "Open: hit him", tone: "open" };
  switch (phase) {
    case "copy":
      return { text: "Ctrl+C", tone: "plain" };
    case "drag":
      return { text: "Dragging you", tone: "warn" };
    case "stunned":
      return { text: "Stunned", tone: "plain" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ events */

const CHAPTER_EVENTS = new Set(["clue-found", "screenshot", "copy-spawn", "copy-pop", "drag", "captive-restore", "captive-freed", "case-closed"]);

export function isChapterEvent(ev: { type: string }): ev is ChapterEvent {
  return CHAPTER_EVENTS.has(ev.type);
}

/** A line for screen readers (and the sound captions) when a chapter event happens; null for ones too frequent to read. */
export function chapterLine(ev: ChapterEvent): { text: string; urgent: boolean } | null {
  switch (ev.type) {
    case "clue-found": {
      const c = clueCopy(ev.id);
      return { text: `Clue ${ev.found} of ${ev.of} found: ${c.name.toLowerCase()}. “${c.note}”`, urgent: true };
    }
    case "screenshot":
      return ev.hit ? { text: "Saved! Frozen for a second.", urgent: true } : { text: "Dodged the screenshot. He’s reloading: hit him.", urgent: true };
    case "drag":
      return { text: "Dragged in. Punch to break free.", urgent: true };
    case "copy-spawn":
      return { text: "Ctrl+C: a paper copy of you is in the way.", urgent: false };
    case "captive-freed":
      return { text: "Mary’s restored. “gm.”", urgent: true };
    case "case-closed":
      return { text: "Case closed.", urgent: true };
    case "copy-pop":
    case "captive-restore":
      return null;
  }
}

/** A line when the case moves on to its next phase. */
export function phaseLine(phase: ChapterPhase): string {
  switch (phase) {
    case "investigate":
      return "Case file 001. Find the three clues in the Bridge District.";
    case "standoff":
    case "lineup":
      return "That’s every clue. Stop the Right-Clicker on the bridge deck.";
    case "rescue":
      return "The Right-Clicker’s down. Stand next to Mary and hold web to restore her.";
    case "done":
      return "Case closed.";
  }
}
