"use client";

/**
 * The signed-in player's chain status in the browser: GET /api/chain/status plus this
 * device's session key, and from both the quick play state (lib/near/quick-play.ts).
 *
 * - The store sends craft and equip through `sendSuitOnChain` when quick play is on.
 * - <ChainSync> loads the status after sign-in and registers the hero once quick play is
 *   on (`ensureHeroOnChain`).
 * - The account sheet shows and enables quick play; the suit lab shows what's on chain
 *   and the last suit change's outcome (`useChainActivity`).
 *
 * near-api-js loads only when a session key is read or used.
 */
import { useSyncExternalStore } from "react";

import { getChainStatus, type ChainStatus, type Me } from "@/lib/api/client";
import type { RelayMethod } from "@/lib/near/policy";
import { quickPlayState, type LocalKey, type QuickPlay } from "@/lib/near/quick-play";

import { SUIT_METHOD, classifyRelay, type RelayReply, type RelayVerdict, type SuitAction } from "./chain-route";

export type ChainOwner = Pick<Me["player"], "id" | "nearAccountId" | "authKind">;

export interface ChainView {
  owner: ChainOwner | null;
  /** True once the first status for `owner` arrived (or failed). */
  loaded: boolean;
  status: ChainStatus | null;
  localKey: LocalKey | null;
  enabling: boolean;
  quickPlay: QuickPlay;
}

const EMPTY: ChainView = { owner: null, loaded: false, status: null, localKey: null, enabling: false, quickPlay: { state: "off" } };

let view: ChainView = EMPTY;
let inflight: { owner: string; promise: Promise<ChainView> } | null = null;
const listeners = new Set<() => void>();

function derive(v: ChainView): ChainView {
  const s = v.status;
  const quickPlay = s
    ? quickPlayState({ available: s.available, configured: s.configured, accountId: s.accountId, liveKeys: s.sessionKeys, localKey: v.localKey, enabling: v.enabling })
    : v.enabling
      ? ({ state: "pending", publicKey: null } as const)
      : ({ state: "off" } as const);
  return { ...v, quickPlay };
}

function set(next: Partial<ChainView>) {
  view = derive({ ...view, ...next });
  listeners.forEach((l) => l());
}

async function readLocalKey(): Promise<LocalKey | null> {
  try {
    const { loadSessionKey } = await import("@/lib/near/session-key");
    const key = await loadSessionKey();
    return key ? { publicKey: key.publicKey, accountId: key.accountId } : null;
  } catch {
    // No IndexedDB (private mode) or a corrupt record: no quick play on this device.
    return null;
  }
}

/** Loads (or reloads) the chain status for `owner`. Concurrent calls for one owner share a request. */
export function refreshChain(owner: ChainOwner): Promise<ChainView> {
  if (inflight?.owner === owner.id) return inflight.promise;
  if (view.owner?.id !== owner.id) set({ ...EMPTY, owner });
  const promise = (async () => {
    const [res, localKey] = await Promise.all([getChainStatus(), readLocalKey()]);
    if (view.owner?.id !== owner.id) return view;
    set({ loaded: true, status: res.ok ? res.data : view.status, localKey });
    return view;
  })().finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { owner: owner.id, promise };
  return promise;
}

/** The chain status for `owner`, loading it the first time. */
export function chainFor(owner: ChainOwner): Promise<ChainView> {
  return view.owner?.id === owner.id && view.loaded ? Promise.resolve(view) : refreshChain(owner);
}

/** Signed out: forget the last player's status. */
export function resetChain() {
  if (view !== EMPTY) set(EMPTY);
}

export const getChain = (): ChainView => view;

export function useChain(): ChainView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
    () => EMPTY,
  );
}

/** Marks an "Enable quick play" as under way (pending) or over. */
export function setEnabling(enabling: boolean) {
  if (view.enabling !== enabling) set({ enabling });
}

/* ------------------------------------------------------------------ game calls */

/** One game call signed with this browser's session key and relayed. Never throws. */
export async function sendGameCall(method: RelayMethod, args: Record<string, unknown>, accountId: string): Promise<RelayVerdict> {
  let reply: RelayReply;
  try {
    const { callGame } = await import("@/lib/near/session-key");
    reply = await callGame(method, args, { accountId });
  } catch (error) {
    reply = { thrown: error instanceof Error ? error.message : String(error) };
  }
  const verdict = classifyRelay(reply);
  // The relayer doesn't know this key after all: quick play is off, so look again.
  if (verdict.kind === "unavailable" && verdict.keyGone && view.owner) void refreshChain(view.owner);
  return verdict;
}

let heroInflight: Promise<RelayVerdict | null> | null = null;

/**
 * Registers the hero on chain when it's queued and quick play is on. Resolves null when
 * there was nothing to do, else the relayer's verdict (ok: the hero is on chain now).
 */
export function ensureHeroOnChain(): Promise<RelayVerdict | null> {
  const { status, owner, quickPlay } = view;
  if (!status || !owner || quickPlay.state !== "on" || status.hero.status !== "queued" || !status.hero.args) return Promise.resolve(null);
  const args = status.hero.args;
  heroInflight ??= (async () => {
    const verdict = await sendGameCall("register_hero", { name: args.name, suit: args.suit }, owner.nearAccountId);
    const onChain = verdict.kind === "ok" || (verdict.kind === "refused" && /already has a hero/i.test(verdict.raw));
    if (onChain && view.status && view.owner?.id === owner.id) {
      set({ status: { ...view.status, hero: { status: "registered", txHash: verdict.kind === "ok" ? verdict.txHash : null, args: null } } });
      void refreshChain(owner);
      return { kind: "ok", txHash: verdict.kind === "ok" ? verdict.txHash : null, save: null, rev: null } satisfies RelayVerdict;
    }
    return verdict;
  })().finally(() => {
    heroInflight = null;
  });
  return heroInflight;
}

/** Crafts or equips on chain: registers the hero first if it isn't yet. Never throws. */
export async function sendSuitOnChain(action: SuitAction, accountId: string): Promise<RelayVerdict> {
  const hero = await ensureHeroOnChain();
  if (hero && hero.kind !== "ok") return hero;
  return sendGameCall(SUIT_METHOD[action.type], { suit: action.suit }, accountId);
}

/* ------------------------------------------------------------------ the last suit change */

/**
 * What happened to the latest craft or equip, for the suit lab's notice:
 * sending (on its way to NEAR), on-chain, saved (in the save only, not on chain) or failed.
 */
export interface ChainActivity {
  id: number;
  action: SuitAction;
  state: "sending" | "on-chain" | "saved" | "failed";
  txHash?: string | null;
  /** Why a change was saved but not put on chain. */
  reason?: "quick-play-off" | "suit-off-chain" | "relayer" | "not-configured";
}

let activity: ChainActivity | null = null;
let activitySeq = 0;
const activityListeners = new Set<() => void>();

/** Records a suit change's progress; pass the id it returned to update the same one. */
export function reportActivity(next: Omit<ChainActivity, "id">, id?: number): number {
  if (id !== undefined && activity?.id !== id) return id;
  activity = { ...next, id: id ?? ++activitySeq };
  activityListeners.forEach((l) => l());
  return activity.id;
}

export const getActivity = (): ChainActivity | null => activity;

export function clearActivity() {
  if (!activity) return;
  activity = null;
  activityListeners.forEach((l) => l());
}

export function useChainActivity(): ChainActivity | null {
  return useSyncExternalStore(
    (l) => {
      activityListeners.add(l);
      return () => activityListeners.delete(l);
    },
    () => activity,
    () => null,
  );
}
