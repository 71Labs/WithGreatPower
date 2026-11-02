"use client";

import { useCallback, useSyncExternalStore } from "react";

import { newSave, reduce, type Action } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

/**
 * The save lives in this browser (localStorage) until NEAR sign-in is wired up. One
 * store for the whole app; components subscribe with useGame().
 */
const KEY = "wgp:save:v1";

let current: Save | null = null;
const listeners = new Set<() => void>();

function load(): Save {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Save;
      if (parsed?.version === 1) return parsed;
    }
  } catch {
    // Private mode or a corrupt save: start fresh rather than crash.
  }
  return newSave();
}

function persist(save: Save) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage full or blocked: the game still works for this tab.
  }
}

function snapshot(): Save {
  if (!current) current = load();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab saved: pick it up.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function dispatch(action: Action) {
  const next = reduce(snapshot(), action);
  if (next === current) return;
  current = next;
  persist(next);
  listeners.forEach((l) => l());
}

/** The save (null during server render and the first client render) and dispatch. */
export function useGame(): { save: Save | null; dispatch: (action: Action) => void } {
  const save = useSyncExternalStore(subscribe, snapshot, () => null);
  const send = useCallback((a: Action) => dispatch(a), []);
  return { save, dispatch: send };
}
