"use client";

/**
 * Whether the account sheet is open, shared by the chip that opens it, the sheet itself
 * and anything else that asks for sign-in. Other screens (the patrol results, for
 * guests) ask without importing this module by firing `window` event SIGN_IN_EVENT.
 */
import { useSyncExternalStore } from "react";

/**
 * `window.dispatchEvent(new Event("wgp:sign-in"))` opens the account sheet;
 * `new CustomEvent("wgp:sign-in", { detail: { with: "google" } })` opens it and starts Google.
 */
export const SIGN_IN_EVENT = "wgp:sign-in";

/** A field the sheet should open on: "x", the X handle (the invite checklist's "Add your X"). */
export type AccountSheetFocus = "x";

/** What the sheet should do as it opens: "google" starts Google sign-in at once (one tap from the asker). */
export type AccountSheetIntent = "google";

let open = false;
let focus: AccountSheetFocus | null = null;
let intent: AccountSheetIntent | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const openAccountSheet = () => set(true);
export const closeAccountSheet = () => {
  focus = null;
  intent = null;
  set(false);
};

/**
 * Opens the sheet and has it start a sign-in straight away: the asker's button already said
 * "Sign in with Google", so the player shouldn't have to press it twice. The sheet takes the
 * intent once (takeAccountSheetIntent); if Google can't start, the sheet is simply open.
 */
export function openAccountSheetWith(next: AccountSheetIntent) {
  intent = next;
  if (open) listeners.forEach((l) => l());
  else set(true);
}

/** The pending intent, cleared by reading it. */
export function takeAccountSheetIntent(): AccountSheetIntent | null {
  const taken = intent;
  intent = null;
  return taken;
}

export function useAccountSheetIntent(): AccountSheetIntent | null {
  return useSyncExternalStore(subscribe, () => (open ? intent : null), () => null);
}

/** Opens the sheet with focus on one field (signed in), e.g. "x". */
export function openAccountSheetAt(target: AccountSheetFocus) {
  focus = target;
  set(true);
}

export function useAccountSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/** The field the open sheet was asked to start on, if any. */
export function useAccountSheetFocus(): AccountSheetFocus | null {
  return useSyncExternalStore(subscribe, () => (open ? focus : null), () => null);
}
