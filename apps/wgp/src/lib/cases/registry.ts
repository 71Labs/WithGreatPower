/**
 * The case files Bearson has open, in order, with what every list, tile and ending needs to
 * name one: its number, title, district, suspect, where its pages are and what a player's post
 * about a clear says. Each case's own words live in its content file (content.ts for 001,
 * content-002.ts for 002, content-003.ts for 003); a new case adds one entry here.
 */
import type { ChapterId } from "@wgp/game-core/types";

import { CASE_001, CASE_PATHS, caseShareText, RIGHT_CLICKER } from "./content";
import { CASE_002, CASE_002_PATHS, case002ShareText, SYBIL } from "./content-002";
import { CASE_003, CASE_003_PATHS, case003ShareText, GAS_GOBLIN } from "./content-003";

export interface CaseEntry {
  id: ChapterId;
  number: string;
  title: string;
  district: string;
  summary: string;
  suspect: { name: string; tagline: string };
  paths: { list: string; intro: string; play: string };
  /** Who's rescued, for the results' lines ("Mary’s back"). */
  closedLine: string;
  openLine: string;
  share(): string;
}

export const CASE_ENTRIES: Record<ChapterId, CaseEntry> = {
  "case-001": {
    id: "case-001",
    number: CASE_001.number,
    title: CASE_001.title,
    district: CASE_001.district,
    summary: CASE_001.summary,
    suspect: RIGHT_CLICKER,
    paths: CASE_PATHS,
    closedLine: "Mary’s back, and Bearson already has the front page.",
    openLine: "Mary’s still in the Downloads folder. Bearson is holding the front page.",
    share: () => caseShareText(),
  },
  "case-002": {
    id: "case-002",
    number: CASE_002.number,
    title: CASE_002.title,
    district: CASE_002.district,
    summary: CASE_002.summary,
    suspect: { name: SYBIL.name, tagline: SYBIL.tagline },
    paths: CASE_002_PATHS,
    closedLine: "Uncle Gen’s vote is counted, and Bearson already has the front page.",
    openLine: "The polls are still open, and still full of him. Bearson is holding the front page.",
    share: () => case002ShareText(),
  },
  "case-003": {
    id: "case-003",
    number: CASE_003.number,
    title: CASE_003.title,
    district: CASE_003.district,
    summary: CASE_003.summary,
    suspect: { name: GAS_GOBLIN.name, tagline: GAS_GOBLIN.tagline },
    paths: CASE_003_PATHS,
    closedLine: "The fees are back to normal, the oven’s lit, and Bearson already has the front page.",
    openLine: "Gas Goblin is still holding the meter. Bearson is holding the front page.",
    share: () => case003ShareText(),
  },
};

/** The open cases, in the order the files list them. */
export const CASE_ORDER: readonly ChapterId[] = ["case-001", "case-002", "case-003"];

export const caseEntry = (id: ChapterId | null | undefined): CaseEntry => CASE_ENTRIES[id ?? "case-001"] ?? CASE_ENTRIES["case-001"];
