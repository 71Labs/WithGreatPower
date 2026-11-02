"use client";

/**
 * Whether the account sheet is open, shared by the chip that opens it, the sheet itself
 * and anything else that asks for sign-in. Other screens (the patrol results, for
 * guests) ask without importing this module by firing `window` event SIGN_IN_EVENT.
 */
import { useSyncExternalStore } from "react";

/** `window.dispatchEvent(new Event("wgp:sign-in"))` opens the account sheet. */
export const SIGN_IN_EVENT = "wgp:sign-in";

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export const openAccountSheet = () => set(true);
export const closeAccountSheet = () => set(false);

export function useAccountSheetOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
