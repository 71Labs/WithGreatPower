/**
 * This browser's marks on the case files, next to the save in localStorage: when a case
 * was started here (for "In progress"), a guest's clear (it never reaches a server), and
 * whether The Daily Rug should lead with a case's story. Per-browser conveniences only:
 * the server's record, when there is one, always wins for a signed-in player.
 *
 * Every read and write survives blocked storage (private windows, previews): the pages
 * render from defaults instead.
 */
import { useSyncExternalStore } from "react";

import type { Save } from "@wgp/game-core/types";

import { CHAPTER_ID, type SaveWithCases } from "./types";
import type { LocalCase } from "./view";

const KEY = "wgp:cases:v1";

export interface CaseMarks {
  cases: Partial<Record<string, LocalCase>>;
  /** The case whose story leads the Rug, until an edition newer than `edition` is printed. */
  rugLead: { id: string; edition: number; hero: string } | null;
}

const EMPTY: CaseMarks = { cases: {}, rugLead: null };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: CaseMarks } | null = null;

function read(): CaseMarks {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = EMPTY;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<CaseMarks>) : null;
    if (parsed && typeof parsed === "object") value = { cases: parsed.cases ?? {}, rugLead: parsed.rugLead ?? null };
  } catch {
    // Corrupt: start over.
  }
  cache = { raw, value };
  return value;
}

function write(next: CaseMarks) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not remembered; the page still shows it for this visit.
  }
  cache = null;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The marks, re-read when they change (here or in another tab). Empty on the server. */
export function useCaseMarks(): CaseMarks {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const getCaseMarks = (): CaseMarks => (typeof window === "undefined" ? EMPTY : read());

/** The case's intro was opened: the dock and Tonight stop calling it new. */
export function markCaseSeen(id: string, now = Date.now()) {
  const m = read();
  const c = m.cases[id] ?? {};
  if (c.seenAt) return;
  write({ ...m, cases: { ...m.cases, [id]: { ...c, seenAt: now } } });
}

/** True while a case is still new to this hero: not opened, started or closed (here or on the save). */
export function useNewCase(save: Save | null, id: string = CHAPTER_ID): boolean {
  const mine = useCaseMarks().cases[id];
  const saved = (save as SaveWithCases | null)?.cases?.[id];
  return !!save?.hero && !mine?.seenAt && !mine?.startedAt && !mine?.cleared && !saved?.cleared;
}

/** "Start the case" was pressed: the case shows as in progress until it's closed. */
export function markCaseStarted(id: string, now = Date.now()) {
  const m = read();
  const c = m.cases[id] ?? {};
  if (c.cleared || c.startedAt) return;
  write({ ...m, cases: { ...m.cases, [id]: { ...c, startedAt: now } } });
}

/**
 * A clear on this device. `keep` records it here with its time (a guest's clear never
 * reaches a server; a verified one shows as closed before the server's list catches up);
 * either way the Rug leads with the story until the next edition after `edition`.
 */
export function markCaseCleared(id: string, opts: { ticks: number | null; edition: number; hero: string; keep: boolean }, now = new Date()) {
  const m = read();
  const c = m.cases[id] ?? {};
  const best = opts.ticks && opts.ticks > 0 ? Math.min(c.bestTicks ?? Infinity, opts.ticks) : c.bestTicks;
  const cases = opts.keep ? { ...m.cases, [id]: { ...c, cleared: true, clearedAt: now.toISOString(), bestTicks: best } } : m.cases;
  write({ cases, rugLead: { id, edition: opts.edition, hero: opts.hero } });
}

/** Whether the Rug leads with a case's story: a clear since the latest edition was printed. */
export function rugLeadFor(marks: CaseMarks, latestEdition: number): CaseMarks["rugLead"] {
  const lead = marks.rugLead;
  return lead && latestEdition <= lead.edition ? lead : null;
}
