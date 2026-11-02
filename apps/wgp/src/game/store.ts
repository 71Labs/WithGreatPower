"use client";

import { useCallback, useSyncExternalStore } from "react";

import { newSave, reduce, type Action } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import { getMe, type Me } from "@/lib/api/client";

/**
 * The save lives in this browser (localStorage) for guests. Signed in, the server copy is
 * the truth: adoptServerSave() takes it after a verified run or a server action. One
 * store for the whole app; components subscribe with useGame() and useAccount().
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

/** Replaces the guest's save wholesale, e.g. with the save after an unranked night. */
export function commitLocalSave(save: Save) {
  if (save === current) return;
  current = save;
  persist(save);
  listeners.forEach((l) => l());
}

/** The save (null during server render and the first client render) and dispatch. */
export function useGame(): { save: Save | null; dispatch: (action: Action) => void } {
  const save = useSyncExternalStore(subscribe, snapshot, () => null);
  const send = useCallback((a: Action) => dispatch(a), []);
  return { save, dispatch: send };
}

/* ------------------------------------------------------------------ account */

export type AccountState = { status: "loading"; me: null } | { status: "guest"; me: null } | { status: "signed-in"; me: Me };

let account: AccountState = { status: "loading", me: null };
const accountListeners = new Set<() => void>();
let inflight: Promise<AccountState> | null = null;

function setAccount(next: AccountState) {
  account = next;
  accountListeners.forEach((l) => l());
}

/** Asks the server who's signed in. Concurrent calls share one request. */
export function refreshAccount(): Promise<AccountState> {
  inflight ??= getMe()
    .then((res): AccountState => {
      // Offline or the server erred: play on as a guest rather than block the game.
      if (!res.ok || !res.data.signedIn) return { status: "guest", me: null };
      return { status: "signed-in", me: res.data };
    })
    .then((next) => {
      setAccount(next);
      return next;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Takes the server's save as the truth for the signed-in player (after a verified run or action). */
export function adoptServerSave(save: Save, rev: number) {
  if (account.status === "signed-in") setAccount({ status: "signed-in", me: { ...account.me, save, rev } });
}

function subscribeAccount(listener: () => void) {
  accountListeners.add(listener);
  if (account.status === "loading" && !inflight) void refreshAccount();
  return () => accountListeners.delete(listener);
}

const LOADING: AccountState = { status: "loading", me: null };

/** Who's playing: loading on the server render and until /api/me answers. */
export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, () => account, () => LOADING);
}
