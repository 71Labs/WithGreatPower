"use client";

/**
 * The signed-in player's referrals (GET /api/referrals), loaded once and shared by every
 * screen that shows them: the Tonight tile and checklist, the account sheet's row, the
 * Hero page and /play/invite. A screen that mounts asks for a fresh copy when the one held
 * is over a minute old; refreshReferrals() reloads after a claim.
 *
 * Guests get `guest` without a request. A 401 (the session ended) reads as `guest` too.
 * In development, `?fixture=<name>` swaps in a canned state (./fixtures.ts).
 */
import { useEffect, useSyncExternalStore } from "react";

import { useAccount } from "@/game/store";

import { getReferrals, type ReferralsView } from "./api";
import { referralFixture } from "./fixtures";
import type { ReferralsState } from "./view";

const STALE_MS = 60_000;
const LOADING: ReferralsState = { status: "loading" };
const GUEST: ReferralsState = { status: "guest" };

let owner: string | null = null;
let state: ReferralsState = LOADING;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: ReferralsState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function load(playerId: string): Promise<void> {
  const res = await getReferrals().catch(() => ({ ok: false as const, status: 0, error: "network" }));
  if (owner !== playerId) return;
  loadedAt = Date.now();
  if (res.ok) set({ status: "ready", view: res.data });
  else if (res.status === 401) set(GUEST);
  // Keep what's on screen through a failed refresh; only an empty screen shows the error.
  else if (state.status !== "ready") set({ status: "error" });
}

function ensure(playerId: string, force = false) {
  if (owner !== playerId) {
    owner = playerId;
    loadedAt = 0;
    inflight = null;
    set(LOADING);
  }
  if (inflight) return;
  if (!force && state.status === "ready" && Date.now() - loadedAt < STALE_MS) return;
  inflight = load(playerId).finally(() => {
    inflight = null;
  });
}

/** Reload now, e.g. after a late claim. */
export function refreshReferrals() {
  if (owner) ensure(owner, true);
}

/** Show a change straight away (the claim's answer), before the reload lands. */
export function patchReferrals(patch: Partial<ReferralsView>) {
  if (state.status === "ready") set({ status: "ready", view: { ...state.view, ...patch } });
}

const noop = () => () => {};

function readFixtureName(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("fixture");
  } catch {
    return null;
  }
}

/** The fixture this page asked for (development only). Null on the server's render, so hydration matches. */
function useFixture(): ReferralsState | null {
  const name = useSyncExternalStore(noop, process.env.NODE_ENV === "production" ? () => null : readFixtureName, () => null);
  return referralFixture(name);
}

/**
 * The player's referrals. `load: false` only reads what another screen loaded (the
 * welcome toast uses it, so it never costs a request of its own).
 */
export function useReferrals({ load: wanted = true }: { load?: boolean } = {}): ReferralsState {
  const account = useAccount();
  const fixture = useFixture();
  const playerId = account.status === "signed-in" ? account.me.player.id : null;
  const held = useSyncExternalStore(
    subscribe,
    () => (playerId && owner === playerId ? state : LOADING),
    () => LOADING,
  );
  useEffect(() => {
    if (wanted && playerId && !fixture) ensure(playerId);
  }, [wanted, playerId, fixture]);
  if (fixture) return fixture;
  if (account.status === "guest") return GUEST;
  return playerId ? held : LOADING;
}
