"use client";

/**
 * A single look at the market from outside it (the night's results, the Suit lab, Tonight):
 * the prices, and for a signed-in player their wallet and today's market quest. Read once
 * per visit and per player, never polled; a screen that can't reach the market simply shows
 * no prompt. Also this browser's tally of a guest's would-be Bits (per-browser, best effort).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAccount } from "@/game/store";
import { getMarket, getMarketMe, type MarketMe, type MarketView } from "@/lib/market/api";
import { getMarketQuest, type MarketQuestView } from "@/lib/market/quest";

export interface MarketPeek {
  view: MarketView | null;
  /** The signed-in player's wallet; null for guests, or until it loads. */
  me: MarketMe | null;
  quest: MarketQuestView | null;
  signedIn: boolean;
  /** The account is known and the market answered (or failed): prompts won't change any more. */
  settled: boolean;
}

interface Loaded {
  key: string;
  view: MarketView | null;
  me: MarketMe | null;
  quest: MarketQuestView | null;
}

/* ------------------------------------------------------------------ coming back to a screen */

/** The parts of `window` and `document` a revisit is read from; tests pass fakes. */
export interface RevisitSource {
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  doc: Pick<EventTarget, "addEventListener" | "removeEventListener"> & { visibilityState: string };
  now(): number;
}

/** No second re-read within this long: focus and visibility often fire together. */
export const REVISIT_GAP_MS = 3_000;

/**
 * Calls `onRevisit` when the player comes back to a page that stayed open: the tab becomes
 * visible again, the window regains focus, or the page is restored from the back-forward
 * cache. Throttled to one call per `gapMs`. Returns the function that stops watching.
 */
export function watchRevisits(onRevisit: () => void, source: RevisitSource, gapMs = REVISIT_GAP_MS): () => void {
  let last = Number.NEGATIVE_INFINITY;
  const fire = () => {
    if (source.doc.visibilityState !== "visible") return;
    const t = source.now();
    if (t - last < gapMs) return;
    last = t;
    onRevisit();
  };
  const restored = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) fire();
  };
  source.doc.addEventListener("visibilitychange", fire);
  source.win.addEventListener("focus", fire);
  source.win.addEventListener("pageshow", restored);
  return () => {
    source.doc.removeEventListener("visibilitychange", fire);
    source.win.removeEventListener("focus", fire);
    source.win.removeEventListener("pageshow", restored);
  };
}

/**
 * A number that goes up each time the player comes back to this screen: the tab or window
 * is shown again (`watchRevisits`), or Next shows a page it kept alive (its effects run
 * again). A screen that printed a wallet passes it to `useMarketPeek` so the Bits are
 * re-read: they may have been earned or spent elsewhere in the meantime.
 */
export function useRevisits(): number {
  const [visits, setVisits] = useState(0);
  const shownBefore = useRef(false);
  useEffect(() => {
    // The first run is the first visit; a later run is the kept-alive page being shown again.
    if (shownBefore.current) setVisits((n) => n + 1);
    shownBefore.current = true;
    return watchRevisits(() => setVisits((n) => n + 1), { win: window, doc: document, now: Date.now });
  }, []);
  return visits;
}

/**
 * `stamp`: change it to look again. The Suit lab passes the save's revision and its revisit
 * count: a craft may have burned Bits, and a trade elsewhere may have earned some.
 */
export function useMarketPeek(stamp: number | string = 0): MarketPeek {
  const account = useAccount();
  const key = account.status === "signed-in" ? account.me.player.id : account.status;
  const signedIn = account.status === "signed-in";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (key === "loading") return;
    const ctrl = new AbortController();
    Promise.all([getMarket(ctrl.signal), signedIn ? getMarketMe(ctrl.signal) : null, signedIn ? getMarketQuest(ctrl.signal) : null]).then(
      ([m, w, q]) => {
        if (!ctrl.signal.aborted) setLoaded({ key, view: m.ok ? m.data : null, me: w?.ok ? w.data : null, quest: q });
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [key, signedIn, stamp]);
  const now = loaded?.key === key ? loaded : null;
  return { view: now?.view ?? null, me: now?.me ?? null, quest: now?.quest ?? null, signedIn, settled: !!now };
}

/* ------------------------------------------------------------------ today's quest, on the market screen */

/** Today's market quest for the signed-in player, with a way to look again after a trade. */
export function useMarketQuest(playerId: string | null): { quest: MarketQuestView | null; refresh(): Promise<MarketQuestView | null> } {
  const [state, setState] = useState<{ playerId: string; quest: MarketQuestView | null } | null>(null);
  useEffect(() => {
    if (!playerId) return;
    const ctrl = new AbortController();
    getMarketQuest(ctrl.signal).then(
      (quest) => {
        if (!ctrl.signal.aborted) setState({ playerId, quest });
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [playerId]);
  async function refresh() {
    if (!playerId) return null;
    const quest = await getMarketQuest().catch(() => null);
    if (quest) setState({ playerId, quest });
    return quest;
  }
  return { quest: state && state.playerId === playerId ? state.quest : null, refresh };
}

/* ------------------------------------------------------------------ a guest's would-be Bits */

const GUEST_KEY = "wgp:guest-bits:v1";
const listeners = new Set<() => void>();
let cache: { raw: string | null; total: number } | null = null;

function readNights(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function readTotal(): number {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(GUEST_KEY);
  } catch {
    return 0;
  }
  if (cache && cache.raw === raw) return cache.total;
  const total = Object.values(readNights()).reduce((sum, n) => sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0), 0);
  cache = { raw, total };
  return total;
}

/** Notes what a guest's night would have paid as a verified one. Once per night number; storage may be blocked. */
export function recordGuestNight(night: number, bits: number) {
  if (typeof window === "undefined" || !(bits > 0)) return;
  const nights = readNights();
  if (nights[String(night)] !== undefined) return;
  try {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ ...nights, [String(night)]: Math.floor(bits) }));
  } catch {
    return;
  }
  cache = null;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Bits this browser's guest nights would have paid, had they been verified. 0 on the server and when unknown. */
export function useGuestBits(): number {
  return useSyncExternalStore(subscribe, readTotal, () => 0);
}
