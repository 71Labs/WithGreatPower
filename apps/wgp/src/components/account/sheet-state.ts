"use client";

/**
 * Whether the account sheet is open, shared by the chip that opens it, the sheet itself
 * and anything else that asks for sign-in. Other screens (the patrol results, for
 * guests) ask without importing this module by firing `window` event SIGN_IN_EVENT.
 */
import { useSyncExternalStore } from "react";

/** `window.dispatchEvent(new Event("wgp:sign-in"))` opens the account sheet. */
export const SIGN_IN_EVENT = "wgp:sign-in";

/** A field the sheet should open on: "x", the X handle (the invite checklist's "Add your X"). */
export type AccountSheetFocus = "x";

let open = false;
let focus: AccountSheetFocus | null = null;
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
  set(false);
};

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
