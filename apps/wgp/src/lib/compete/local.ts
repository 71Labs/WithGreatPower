/**
 * A guest's best time per course, kept in this browser (localStorage) so the trials list can
 * show a medal before they sign in. A convenience only: nothing here is verified or ranked,
 * and every read and write survives blocked storage (private mode) by doing nothing.
 */
import { useMemo, useSyncExternalStore } from "react";

import { isTrialCourse } from "@wgp/game-core/compete";
import type { TrialCourseId } from "@wgp/game-core/types";

const KEY = "wgp:trial-best:v1";

function parse(text: string): Partial<Record<TrialCourseId, number>> {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const out: Partial<Record<TrialCourseId, number>> = {};
    for (const [k, v] of Object.entries(raw)) if (isTrialCourse(k) && typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

const read = () => {
  try {
    return window.localStorage.getItem(KEY) ?? "{}";
  } catch {
    return "{}";
  }
};

export const localBests = () => parse(read());

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** This browser's bests, for rendering (none on the server, and none until hydrated). */
export function useLocalBests(): Partial<Record<TrialCourseId, number>> {
  const text = useSyncExternalStore(subscribe, read, () => "{}");
  return useMemo(() => parse(text), [text]);
}

/** Keep `ticks` if it beats this browser's best on the course. Returns whether it did. */
export function saveLocalBest(course: TrialCourseId, ticks: number): boolean {
  const all = localBests();
  const old = all[course];
  if (old !== undefined && old <= ticks) return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...all, [course]: ticks }));
    for (const fn of listeners) fn();
  } catch {
    // Blocked storage: the best just isn't kept.
  }
  return true;
}
