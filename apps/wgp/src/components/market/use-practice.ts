"use client";

/**
 * The practice market in the browser (src/lib/market/practice.ts holds its rules): kept
 * under its own localStorage key, seeded from the live market the first time it is opened,
 * and read by the market screen in place of the live market's data.
 *
 * - A guest always sees it: it is the only market they can trade in.
 * - A signed-in player sees the real market and can step into practice and back (the
 *   choice lasts for the browser session); a link with `?practice=1` steps in too.
 *
 * It only ever reads the game's save (the visitor's loot is where practice items start
 * from) and the live prices. It writes one thing: the practice market's own storage key.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useGame } from "@/game/store";
import type { MarketView, SimTradeRequest, StakeRequest } from "@/lib/market/api";
import { MarketError } from "@/lib/market/engine";
import {
  parsePractice,
  PRACTICE_KEY,
  practiceBase,
  practiceDrain,
  practiceNpcLooks,
  practiceScreen,
  practiceStake,
  practiceTrade,
  seedPractice,
  stageItem,
  storePractice,
  type PracticeBase,
  type PracticeScreen,
  type PracticeState,
} from "@/lib/market/practice";
import { marketProblem } from "@/lib/market/refusal";
import type { ItemId } from "@wgp/game-core/types";

import type { TradeOutcome } from "./use-market";
import { useGuestBits } from "./use-market-peek";

/* ------------------------------------------------------------------ the stored market */

const listeners = new Set<() => void>();
let cache: { raw: string | null; state: PracticeState | null } | null = null;
/** The market for this tab when storage is blocked (private mode): practice still works, it just isn't kept. */
let unsaved: PracticeState | null = null;

function read(): PracticeState | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PRACTICE_KEY);
  } catch {
    return unsaved;
  }
  if (raw === null && unsaved) return unsaved;
  if (cache && cache.raw === raw) return cache.state;
  cache = { raw, state: parsePractice(raw) };
  return cache.state;
}

function write(state: PracticeState | null) {
  unsaved = state;
  try {
    if (state) window.localStorage.setItem(PRACTICE_KEY, storePractice(state));
    else window.localStorage.removeItem(PRACTICE_KEY);
    // Stored: the copy in memory is only for when it couldn't be.
    unsaved = null;
  } catch {
    // Storage full or blocked: keep playing from memory.
  }
  cache = null;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  // Another tab traded in the practice market: pick it up.
  const onStorage = (e: StorageEvent) => {
    if (e.key === PRACTICE_KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/* ------------------------------------------------------------------ a signed-in player's choice */

const MODE_KEY = "wgp:practice:on";
const modeListeners = new Set<() => void>();
let modeMemory = false;

function readMode(): boolean {
  try {
    return window.sessionStorage.getItem(MODE_KEY) === "1";
  } catch {
    return modeMemory;
  }
}

/** Steps a signed-in player into the practice market or back out. (A guest is always in it.) */
export function setPracticeMode(on: boolean) {
  modeMemory = on;
  try {
    if (on) window.sessionStorage.setItem(MODE_KEY, "1");
    else window.sessionStorage.removeItem(MODE_KEY);
  } catch {
    // Blocked storage: the choice lasts for this page.
  }
  modeListeners.forEach((l) => l());
}

function subscribeMode(l: () => void) {
  modeListeners.add(l);
  return () => modeListeners.delete(l);
}

/* ------------------------------------------------------------------ a clock for locks */

let clockNow = 0;
let clockTimer: number | null = null;
let clockEvery = 0;
const clockListeners = new Map<() => void, number>();

/** Restarts the shared timer at the fastest pace any listener asked for. */
function retime() {
  const every = clockListeners.size ? Math.min(...clockListeners.values()) : 0;
  if (every === clockEvery) return;
  if (clockTimer !== null) window.clearInterval(clockTimer);
  clockEvery = every;
  clockTimer =
    every > 0
      ? window.setInterval(() => {
          clockNow = Date.now();
          clockListeners.forEach((_, l) => l());
        }, every)
      : null;
}

/**
 * The time now (Unix ms), re-read every second while `fast` (a stake's lock is counting
 * down) and every half minute otherwise. 0 on the server and on the first render.
 */
export function useClock(fast: boolean): number {
  const sub = useCallback(
    (l: () => void) => {
      clockListeners.set(l, fast ? 1_000 : 30_000);
      clockNow = Date.now();
      retime();
      return () => {
        clockListeners.delete(l);
        retime();
      };
    },
    [fast],
  );
  return useSyncExternalStore(
    sub,
    () => clockNow,
    () => 0,
  );
}

/* ------------------------------------------------------------------ the hook */

function refused(error: unknown): TradeOutcome {
  if (error instanceof MarketError) {
    const p = marketProblem(422, error.code, error.message);
    return { ok: false, code: p.code, message: p.text, snapshot: null };
  }
  return { ok: false, code: "practice", message: "The practice market couldn’t do that. Reset it and try again.", snapshot: null };
}

export interface Practice {
  /** The screen is showing the practice market. */
  on: boolean;
  /** The practice market as the screen reads any market; null until it is seeded. */
  screen: PracticeScreen | null;
  /** Where its opening prices came from. */
  seededFrom: PracticeState["seededFrom"] | null;
  /** The till a staged crowd would empty next (`drain`), or null when every shop is already broke. */
  drainItem: ItemId | null;
  trade(req: SimTradeRequest): TradeOutcome;
  stake(req: StakeRequest): TradeOutcome;
  /** A crowd of practice sellers empties one till. Returns how many items they sold. */
  drain(item: ItemId): number;
  /** Starts the practice market over from the live prices. */
  reset(): void;
}

/**
 * `live` is the real market's view (null while it loads); `liveFailed` says it won't come,
 * so practice opens on the default pools instead. `signedIn` null means "not known yet".
 */
export function usePractice(live: MarketView | null, liveFailed: boolean, signedIn: boolean | null, wantPractice: boolean): Practice {
  const state = useSyncExternalStore(subscribe, read, () => null);
  const chosen = useSyncExternalStore(subscribeMode, readMode, () => false);
  const guestBits = useGuestBits();
  const { save } = useGame();
  const on = signedIn === null ? false : !signedIn || chosen;

  // A link into practice (`?practice=1`) steps a signed-in player in.
  useEffect(() => {
    if (wantPractice && signedIn) setPracticeMode(true);
  }, [wantPractice, signedIn]);

  // Seed it the first time it is shown, from the live prices when they are there.
  const canSeed = on && !state && (!!live || liveFailed);
  useEffect(() => {
    if (canSeed && !read()) write(seedPractice(live, Date.now()));
  }, [canSeed, live]);

  const base: PracticeBase = practiceBase(guestBits, save?.inventory);
  const locked = on && !!state?.book.investors;
  const now = useClock(locked);
  // Before the clock ticks (or with nothing locked) the stored market's own time is good enough to draw from.
  const screen = on && state ? practiceScreen(state, base, now || state.seededAt) : null;

  /**
   * `npcLooks`: Sandwich Man takes one look afterwards. He does after a trade or a listing
   * lands, as on the real market; not after an investment, which moves no price.
   */
  function act<T>(fn: (s: PracticeState, at: number) => { state: PracticeState } & T, npcLooks: boolean): TradeOutcome {
    const s = read();
    if (!s) return { ok: false, code: "practice", message: "The practice market is still opening. Try again in a moment.", snapshot: null };
    try {
      const at = Date.now();
      let next = fn(s, at).state;
      if (npcLooks) {
        try {
          next = practiceNpcLooks(next, base, at + 1).state;
        } catch {
          // His turn is a courtesy: a trade never fails because of it.
        }
      }
      write(next);
      return { ok: true, snapshot: null };
    } catch (error) {
      return refused(error);
    }
  }

  return {
    on,
    screen,
    seededFrom: state?.seededFrom ?? null,
    drainItem: on && state ? stageItem(state) : null,
    trade: (req) => act((s, at) => practiceTrade(s, base, req, at), true),
    stake: (req) => act((s, at) => practiceStake(s, base, req, at), false),
    drain(item) {
      const s = read();
      if (!s) return 0;
      const r = practiceDrain(s, base, item, Date.now());
      if (r.sold > 0) write(r.state);
      return r.sold;
    },
    reset() {
      write(live || liveFailed ? seedPractice(live, Date.now()) : null);
    },
  };
}
