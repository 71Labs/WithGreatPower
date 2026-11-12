"use client";

import { useCallback, useSyncExternalStore } from "react";

import { newSave, reduce, type Action } from "@wgp/game-core/engine";
import type { Hero, Save } from "@wgp/game-core/types";

import { getMe, migrateLocalSave, postAction, type ApiResult, type Me } from "@/lib/api/client";
import { craftRefusalText } from "@/lib/market/craft";

import { chainFor, clearActivity, refreshChain, reportActivity, sendSuitOnChain, type ChainActivity } from "./chain";
import { isSuitAction, routeAction, type SuitAction } from "./chain-route";

/**
 * One store for the whole app; components subscribe with useGame() and useAccount().
 *
 * Guests: the save lives in this browser (localStorage) and dispatch reduces it there.
 *
 * Signed in: the server's save is the truth. A menu action (create-hero, sleep, vote,
 * pick-power, set-loadout, craft-suit, equip-suit, reset) shows at once, optimistically,
 * and is posted to /api/actions in order, one at a time; the server's answer replaces the
 * guess. A stale revision (409 rev_conflict) takes the server's save from the error; a
 * run in progress (409 run_active), a network error or any other failure reverts the
 * guess and raises a toast. Patrol steps are never posted: a night only counts as a
 * ranked run, so they play out on an unsaved local copy until the run's verified save
 * arrives (adoptServerSave) or the next menu action replaces it.
 *
 * Craft and equip with quick play on go on chain instead of /api/actions (chain-route.ts):
 * the session key signs them, the relayer lands them, and the server's mirrored save
 * replaces the guess. A contract refusal reverts the guess with a toast that says why; a
 * relayer that can't take it falls back to /api/actions, saved but not on chain. The
 * suit lab reads each outcome from useChainActivity().
 *
 * The guest's local save is never touched while signed in, so signing out brings it back.
 * Until /api/me answers, useGame().save is null (the loading state every screen handles),
 * so nobody is bounced to onboarding on a local save that isn't theirs.
 */
const KEY = "wgp:save:v1";

/** The actions /api/actions accepts (src/server/db/actions.ts). */
const MENU_ACTIONS = new Set<Action["type"]>(["create-hero", "sleep", "vote", "pick-power", "set-loadout", "craft-suit", "equip-suit", "reset"]);

export type AccountState = { status: "loading"; me: null } | { status: "guest"; me: null } | { status: "signed-in"; me: Me };

const LOADING: AccountState = { status: "loading", me: null };

/* ------------------------------------------------------------------ state */

/** The guest's save, read from localStorage on first use. */
let local: Save | null = null;
let account: AccountState = LOADING;
let accountInflight: Promise<AccountState> | null = null;
/** Signed in: menu actions shown but not yet confirmed by the server, oldest first. */
let pending: Action[] = [];
let pumping = false;
/** Signed in: an unsaved patrol played on top of the server's save. */
let overlay: Save | null = null;
/** Players who closed the import offer without choosing, for this page load. */
const deferredOffers = new Set<string>();

const listeners = new Set<() => void>();
let view: { save: Save | null; offer: MigrationOffer | null } | null = null;

function changed() {
  view = null;
  listeners.forEach((l) => l());
}

/* ------------------------------------------------------------------ the guest's save */

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

function localSave(): Save {
  if (!local) local = load();
  return local;
}

/* ------------------------------------------------------------------ what screens see */

export interface MigrationOffer {
  playerId: string;
  /** The hero saved in this browser. */
  hero: Hero;
  save: Save;
}

const declinedKey = (playerId: string) => `wgp:migrate-declined:${playerId}`;

function declined(playerId: string): boolean {
  try {
    return window.localStorage.getItem(declinedKey(playerId)) === "1";
  } catch {
    return false;
  }
}

function serverView(me: Me): Save {
  return pending.reduce((save, action) => reduce(save, action), me.save);
}

function current() {
  if (view) return view;
  if (account.status === "loading") view = { save: null, offer: null };
  else if (account.status === "guest") view = { save: localSave(), offer: null };
  else {
    const { me } = account;
    const mine = localSave();
    const offer =
      !me.player.migrated && !me.save.hero && mine.hero && !deferredOffers.has(me.player.id) && !declined(me.player.id)
        ? { playerId: me.player.id, hero: mine.hero, save: mine }
        : null;
    view = { save: overlay ?? serverView(me), offer };
  }
  return view;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (account.status === "loading" && !accountInflight) void refreshAccount();
  // Another tab saved the guest's game: pick it up.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    local = load();
    changed();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/* ------------------------------------------------------------------ toasts */

export interface GameToast {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
}

let toast: GameToast | null = null;
let toastSeq = 0;
const toastListeners = new Set<() => void>();

/** Shows a short message over the game (one at a time; the newest wins). */
export function showToast(text: string, tone: GameToast["tone"] = "info") {
  toast = { id: ++toastSeq, text, tone };
  toastListeners.forEach((l) => l());
}

/** Hides the toast, or only toast `id` if it's still the one showing. */
export function dismissToast(id?: number) {
  if (!toast || (id !== undefined && toast.id !== id)) return;
  toast = null;
  toastListeners.forEach((l) => l());
}

export const getToast = (): GameToast | null => toast;

export function useGameToast(): GameToast | null {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toast,
    () => null,
  );
}

/* ------------------------------------------------------------------ dispatch */

function failureText(res: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (res.status === 0) return "Couldn’t reach the server, so that change wasn’t saved. Check your connection and try again.";
  if (res.error === "run_active") return "Finish or abandon your patrol first, then try that again.";
  if (res.status === 429) return "That’s a lot of changes at once. Wait a moment and try again.";
  if (res.status === 403) return "This account is suspended, so changes can’t be saved.";
  // A craft refused over the Bits it burns (src/server/market/craft.ts).
  const craft = res.status === 422 ? craftRefusalText(res.error, res.message) : null;
  if (craft) return craft;
  return "The server couldn’t save that change. Try again.";
}

function isStoredSave(body: Record<string, unknown> | undefined): body is { save: Save; rev: number } {
  return !!body && typeof body.rev === "number" && typeof body.save === "object" && body.save !== null;
}

/** Takes a server save if it's at least as new as the one we hold. */
function confirm(save: Save, rev: number) {
  if (account.status !== "signed-in" || rev < account.me.rev) return;
  account = { status: "signed-in", me: { ...account.me, save, rev } };
}

const switchedAway = (me: Me) => account.status !== "signed-in" || account.me.player.id !== me.player.id;

/**
 * Craft or equip with quick play on: signed by the session key, relayed, and mirrored into
 * the save by the server. "done" when it was settled here (on chain, or refused and
 * reverted); otherwise the reason it goes to /api/actions instead, saved but not on chain.
 */
async function trySuitOnChain(me: Me, action: SuitAction): Promise<"done" | NonNullable<ChainActivity["reason"]>> {
  const chain = await chainFor(me.player);
  const status = chain.status;
  if (chain.quickPlay.state === "unavailable") return chain.quickPlay.reason === "not-configured" ? "not-configured" : "quick-play-off";
  if (routeAction(action, { quickPlay: chain.quickPlay, onChainSuits: status?.onChain?.suits ?? null }) === "db") {
    return chain.quickPlay.state === "on" ? "suit-off-chain" : "quick-play-off";
  }
  const id = reportActivity({ action, state: "sending" });
  const verdict = await sendSuitOnChain(action, me.player.nearAccountId);
  if (switchedAway(me)) {
    pending = [];
    return "done";
  }
  if (verdict.kind === "unavailable") return "relayer";
  // Wearing a suit that only the save holds (the chain's suits weren't known): save it instead.
  if (verdict.kind === "refused" && action.type === "equip-suit" && /don't own this suit/i.test(verdict.raw)) return "suit-off-chain";
  if (verdict.kind === "ok") {
    pending = pending.slice(1);
    if (verdict.save && verdict.rev !== null) confirm(verdict.save, verdict.rev);
    else void refreshAccount();
    reportActivity({ action, state: "on-chain", txHash: verdict.txHash }, id);
    void refreshChain(me.player);
  } else {
    // Refused, busy or signed out: drop the guess, as a failed /api/actions post would.
    pending = [];
    reportActivity({ action, state: "failed" }, id);
    if (verdict.kind === "signed-out") {
      void refreshAccount();
      showToast("You were signed out, so that change wasn’t saved. Sign in again to keep playing.", "error");
    } else {
      showToast(verdict.text, "error");
    }
  }
  changed();
  return "done";
}

/** Posts queued menu actions one by one, each on the revision the last one produced. */
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.length > 0 && account.status === "signed-in") {
      const me = account.me;
      const action = pending[0]!;
      let offChain: ChainActivity["reason"] | null = null;
      if (isSuitAction(action) && me.player.authKind !== "dev") {
        const outcome = await trySuitOnChain(me, action);
        if (outcome === "done") continue;
        if (switchedAway(me)) {
          pending = [];
          break;
        }
        offChain = outcome;
      }
      // The chain attempt awaited: post on the latest revision, not the one read before it.
      const res = await postAction(action, account.status === "signed-in" ? account.me.rev : me.rev);
      if (switchedAway(me)) {
        pending = [];
        break;
      }
      if (res.ok) {
        pending = pending.slice(1);
        confirm(res.data.save, res.data.rev);
        if (offChain && isSuitAction(action) && res.data.applied) reportActivity({ action, state: "saved", reason: offChain });
        changed();
        continue;
      }
      pending = [];
      if (isSuitAction(action)) clearActivity();
      if (res.status === 409 && res.error === "rev_conflict" && isStoredSave(res.body)) {
        confirm(res.body.save, res.body.rev);
        showToast("Your save changed somewhere else, so you’re looking at the latest.");
      } else if (res.status === 401) {
        void refreshAccount();
        showToast("You were signed out, so that change wasn’t saved. Sign in again to keep playing.", "error");
      } else {
        showToast(failureText(res), "error");
      }
      changed();
    }
  } finally {
    pumping = false;
  }
}

export function dispatch(action: Action) {
  if (account.status === "loading") return;
  if (account.status === "guest") {
    const save = localSave();
    const next = reduce(save, action);
    if (next === save) return;
    local = next;
    persist(next);
    changed();
    return;
  }
  const me = account.me;
  if (!MENU_ACTIONS.has(action.type)) {
    const base = overlay ?? serverView(me);
    const next = reduce(base, action);
    if (next === base) return;
    overlay = next;
    changed();
    return;
  }
  const hadOverlay = overlay !== null;
  overlay = null;
  const before = serverView(me);
  if (reduce(before, action) === before) {
    // The rules refuse it here, so the server would too: nothing to send.
    if (hadOverlay) changed();
    return;
  }
  pending = [...pending, action];
  changed();
  void pump();
}

/** Replaces the guest's save wholesale, e.g. with the save after an unranked night. */
export function commitLocalSave(save: Save) {
  if (save === local) return;
  local = save;
  persist(save);
  changed();
}

/** What useGame().save holds right now, for code outside React. */
export function getSave(): Save | null {
  return current().save;
}

/** The save (null during server render, the first client render and until /api/me answers) and dispatch. */
export function useGame(): { save: Save | null; dispatch: (action: Action) => void } {
  const save = useSyncExternalStore(subscribe, () => current().save, () => null);
  const send = useCallback((a: Action) => dispatch(a), []);
  return { save, dispatch: send };
}

/* ------------------------------------------------------------------ account */

function setAccount(next: AccountState) {
  const before = account.status === "signed-in" ? account.me.player.id : null;
  const after = next.status === "signed-in" ? next.me.player.id : null;
  if (before !== after) {
    // Someone else (or nobody) now: drop the last player's unsaved state.
    pending = [];
    overlay = null;
    clearActivity();
  }
  account = next;
  changed();
}

/** Asks the server who's signed in. Concurrent calls share one request. */
export function refreshAccount(): Promise<AccountState> {
  accountInflight ??= getMe()
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
      accountInflight = null;
    });
  return accountInflight;
}

/** Takes the server's save as the truth for the signed-in player (after a verified run or action). */
export function adoptServerSave(save: Save, rev: number) {
  if (account.status !== "signed-in") return;
  overlay = null;
  confirm(save, rev);
  changed();
}

export const getAccount = (): AccountState => account;

/** Who's playing: loading on the server render and until /api/me answers. */
export function useAccount(): AccountState {
  return useSyncExternalStore(subscribe, () => account, () => LOADING);
}

/* ------------------------------------------------------------------ first sign-in: bring the local hero */

/**
 * Signed in for the first time with a hero in this browser and none on the account: the
 * offer to import it. Null otherwise, or once accepted, declined or closed.
 */
export const getMigrationOffer = (): MigrationOffer | null => current().offer;

export function useMigrationOffer(): MigrationOffer | null {
  return useSyncExternalStore(subscribe, () => current().offer, () => null);
}

function markMigrated() {
  if (account.status !== "signed-in") return;
  account = { status: "signed-in", me: { ...account.me, player: { ...account.me.player, migrated: true } } };
}

/**
 * Imports the local hero onto the account (capped at level 3; items minted once). Already
 * imported, a hero already there, or nothing importable all end the offer quietly.
 */
export async function acceptMigration(): Promise<{ ok: true; imported: boolean } | { ok: false; message: string }> {
  const offer = current().offer;
  if (!offer) return { ok: true, imported: false };
  const res = await migrateLocalSave(offer.save);
  if (res.ok) {
    markMigrated();
    adoptServerSave(res.data.save, res.data.rev);
    return { ok: true, imported: true };
  }
  const quiet = (res.status === 409 && (res.error === "already_migrated" || res.error === "server_save_exists")) || (res.status === 422 && res.error === "nothing_to_import");
  if (quiet) {
    deferredOffers.add(offer.playerId);
    if (res.error === "server_save_exists" && isStoredSave(res.body)) confirm(res.body.save, res.body.rev);
    changed();
    void refreshAccount();
    return { ok: true, imported: false };
  }
  if (res.status === 0) return { ok: false, message: "Couldn’t reach the server. Check your connection and try again." };
  return { ok: false, message: res.message ? `${res.message}. Try again.` : "Couldn’t bring your hero along. Try again." };
}

/** Starts the account fresh and remembers the choice for this player in this browser. */
export function declineMigration() {
  const offer = current().offer;
  if (!offer) return;
  try {
    window.localStorage.setItem(declinedKey(offer.playerId), "1");
  } catch {
    deferredOffers.add(offer.playerId);
  }
  changed();
}

/** Closed without choosing: ask again on the next visit. */
export function deferMigration() {
  const offer = current().offer;
  if (!offer) return;
  deferredOffers.add(offer.playerId);
  changed();
}
