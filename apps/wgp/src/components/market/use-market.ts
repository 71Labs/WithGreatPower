"use client";

/**
 * The market's data in the browser: prices, listings and the player's wallet, kept
 * fresh while the screen is visible, and one way to trade whichever market is live.
 *
 * - Simulated market (`onChain: false`): trades post to /api/market/trade with the
 *   session cookie; the answer carries the new save, which the game store adopts.
 * - On chain: trades are session-key calls (no popup, no deposit) relayed by our
 *   relayer; the server mirrors the change into the save, so the store refreshes.
 *
 * Either way the answer to a trade carries the market as it stands right after it
 * (MarketSnapshot, read past the server's 10-second cache), and the screen adopts it, so
 * a trader never sees the price, stock or listing from before their own trade.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useChain } from "@/game/chain";
import { adoptServerSave, refreshAccount, useAccount } from "@/game/store";
import { getListings, getMarket, getMarketMe, postSimTrade, type ListingView, type MarketMe, type MarketSnapshot, type MarketView, type SimTradeRequest } from "@/lib/market/api";
import { chainCall } from "@/lib/market/chain-calls";
import { marketProblem } from "@/lib/market/refusal";
import { isUnclaimed } from "@/lib/near/policy";
import type { RelayResponse } from "@/lib/near/session-key";

const POLL_MS = 20_000;
/** While a night's Bits are on their way, look more often so they show up as they land. */
const PENDING_POLL_MS = 5_000;
/** After adopting a trade's snapshot, check once more: another RPC node may have lagged a block. */
const SETTLE_MS = 3_000;

export type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

export interface MarketData {
  market: Load<MarketView>;
  listings: ListingView[] | null;
  /** The signed-in player's wallet; null for guests or until it loads. */
  me: MarketMe | null;
  signedIn: boolean;
  refresh(): Promise<void>;
  /** Shows the market a trade's answer carried, then checks it again shortly after. */
  adopt(snapshot: MarketSnapshot): void;
}

/** Prices, listings and (signed in) the wallet, fetched together. */
function fetchAll(signedIn: boolean, signal: AbortSignal) {
  return Promise.all([getMarket(signal), getListings(signal), signedIn ? getMarketMe(signal) : Promise.resolve(null)]).catch(() => [null, null, null] as const);
}

export function useMarketData(): MarketData {
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  const [market, setMarket] = useState<Load<MarketView>>({ state: "loading" });
  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [me, setMe] = useState<MarketMe | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const settle = useRef<number | null>(null);
  // Not for an unclaimed Google player: their Bits wait for a name, not for the operator.
  const pending = (me?.pendingBits ?? 0) > 0 && !(account.status === "signed-in" && isUnclaimed(account.me.player));

  const load = useCallback(
    (onto: AbortController) =>
      fetchAll(signedIn, onto.signal).then(([m, l, w]) => {
        if (onto.signal.aborted) return;
        if (m?.ok) setMarket({ state: "ready", data: m.data });
        // Keep the last good prices on a failed refresh; only a first failure shows.
        else setMarket((prev) => (prev.state === "ready" ? prev : { state: "error", message: m?.message ?? "The market didn’t load. Check your connection and try again." }));
        if (l?.ok) setListings(l.data.listings);
        // A failed wallet read keeps the last one (a 401 means signed out: drop it).
        setMe((prev) => (w?.ok ? w.data : w && w.status === 401 ? null : prev));
      }),
    [signedIn],
  );

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    await load(controller);
  }, [load]);

  const adopt = useCallback(
    (snapshot: MarketSnapshot) => {
      // A poll that left before the trade would answer with the market from before it.
      inflight.current?.abort();
      setMarket({ state: "ready", data: snapshot.view });
      setListings(snapshot.listings);
      setMe(snapshot.me);
      if (settle.current !== null) window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => void refresh(), SETTLE_MS);
    },
    [refresh],
  );

  useEffect(() => {
    if (account.status === "loading") return;
    const controller = new AbortController();
    inflight.current = controller;
    void load(controller);
    return () => {
      controller.abort();
      inflight.current?.abort();
      if (settle.current !== null) window.clearTimeout(settle.current);
    };
  }, [account.status, load]);

  useEffect(() => {
    if (account.status === "loading") return;
    const id = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      pending ? PENDING_POLL_MS : POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [account.status, pending, refresh]);

  return { market, listings, me, signedIn, refresh, adopt };
}

/* ------------------------------------------------------------------ quick play */

export type QuickPlay = "checking" | "ready" | "needed";

/**
 * Whether this device can trade on chain without a popup: a session key bound to the
 * signed-in account. Only asked when the market is on chain.
 */
export function useQuickPlay(onChain: boolean, accountId: string | null): QuickPlay {
  const [state, setState] = useState<{ key: string; value: QuickPlay } | null>(null);
  // Quick play turned on in the account sheet changes this: look for the key again, so the
  // stall unlocks without a reload.
  const chainState = useChain().quickPlay.state;
  const key = `${onChain}:${accountId}:${chainState}`;
  useEffect(() => {
    if (!onChain || !accountId) return;
    let live = true;
    import("@/lib/near/session-key")
      .then((m) => m.loadSessionKey())
      .then((k) => live && setState({ key, value: k && k.accountId === accountId ? "ready" : "needed" }))
      .catch(() => live && setState({ key, value: "needed" }));
    return () => {
      live = false;
    };
  }, [onChain, accountId, key]);
  if (!onChain) return "ready";
  return state?.key === key ? state.value : "checking";
}

/** Opens the account sheet, where sign-in and quick play live. */
export const askToSignIn = () => window.dispatchEvent(new CustomEvent("wgp:sign-in"));

/* ------------------------------------------------------------------ trading */

export type TradeOutcome =
  | { ok: true; snapshot: MarketSnapshot | null }
  | {
      ok: false;
      /** "quick_play": the session key is missing or refused; "busy": another trade is on its way. */
      code: string;
      message: string;
      /** The market as the server saw it when it refused, when it said. */
      snapshot: MarketSnapshot | null;
      /** The trade may have landed after all (the answer was lost): reload before trying again. */
      unsure?: boolean;
    };

function failed(status: number, code: string, message: string | undefined, snapshot: MarketSnapshot | null = null): TradeOutcome {
  const p = marketProblem(status, code, message);
  return { ok: false, code: p.code, message: p.text, snapshot, unsure: p.unsure };
}

const isSnapshot = (v: unknown): v is MarketSnapshot => typeof v === "object" && v !== null && "view" in v && "me" in v && "listings" in v;

/** One trade at a time from this tab: a second tap while one is on its way is refused, never sent. */
let trading = false;

/** One trade on whichever market is live. Never throws. */
export async function trade(onChain: boolean, req: SimTradeRequest): Promise<TradeOutcome> {
  if (trading) return { ok: false, code: "busy", message: "Your last trade is still going through. Give it a moment.", snapshot: null };
  trading = true;
  try {
    return await (onChain ? tradeOnChain(req) : tradeSimulated(req));
  } finally {
    trading = false;
  }
}

async function tradeSimulated(req: SimTradeRequest): Promise<TradeOutcome> {
  const res = await postSimTrade(req);
  if (!res.ok) return failed(res.status, res.error, res.message);
  adoptServerSave(res.data.save, res.data.rev);
  return { ok: true, snapshot: res.data.market ?? null };
}

async function tradeOnChain(req: SimTradeRequest): Promise<TradeOutcome> {
  let res: RelayResponse & { market?: unknown };
  try {
    const { callGame } = await import("@/lib/near/session-key");
    const { method, args } = chainCall(req);
    res = await callGame(method, args);
  } catch (error) {
    // Nothing was sent: no key on this device yet, or NEAR couldn't be asked for the next nonce.
    const text = error instanceof Error ? error.message : String(error);
    if (/session key/i.test(text)) return failed(403, "unknown_key", text);
    return { ok: false, code: "network", message: "Couldn’t reach NEAR, so nothing was sent. Check your connection and try again.", snapshot: null };
  }
  const snapshot = isSnapshot(res.market) ? res.market : null;
  // The server mirrors a trade into the save (bought loot is there to craft with).
  if (res.ok || res.status === 0) void refreshAccount();
  if (!res.ok) return failed(res.status, res.error ?? `http_${res.status}`, res.message, snapshot);
  return { ok: true, snapshot };
}
