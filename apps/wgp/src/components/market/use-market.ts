"use client";

/**
 * The market's data in the browser: prices, listings and the player's wallet, kept
 * fresh while the screen is visible, and one way to trade whichever market is live.
 *
 * - Simulated market (`onChain: false`): trades post to /api/market/trade with the
 *   session cookie; the answer carries the new save, which the game store adopts.
 * - On chain: trades are session-key calls (no popup, no deposit) relayed by our
 *   relayer; the server mirrors the change into the save, so the store refreshes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { adoptServerSave, refreshAccount, useAccount } from "@/game/store";
import { getListings, getMarket, getMarketMe, postSimTrade, type ListingView, type MarketMe, type MarketView, type SimTradeRequest } from "@/lib/market/api";

const POLL_MS = 20_000;

export type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

export interface MarketData {
  market: Load<MarketView>;
  listings: ListingView[] | null;
  /** The signed-in player's wallet; null for guests or until it loads. */
  me: MarketMe | null;
  signedIn: boolean;
  refresh(): Promise<void>;
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

  const load = useCallback(
    (onto: AbortController) =>
      fetchAll(signedIn, onto.signal).then(([m, l, w]) => {
        if (onto.signal.aborted) return;
        if (m?.ok) setMarket({ state: "ready", data: m.data });
        // Keep the last good prices on a failed refresh; only a first failure shows.
        else setMarket((prev) => (prev.state === "ready" ? prev : { state: "error", message: m?.message ?? "The market didn’t load. Check your connection and try again." }));
        if (l?.ok) setListings(l.data.listings);
        setMe(w?.ok ? w.data : null);
      }),
    [signedIn],
  );

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    await load(controller);
  }, [load]);

  useEffect(() => {
    if (account.status === "loading") return;
    const controller = new AbortController();
    inflight.current = controller;
    void load(controller);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
      controller.abort();
      inflight.current?.abort();
    };
  }, [account.status, load, refresh]);

  return { market, listings, me, signedIn, refresh };
}

/* ------------------------------------------------------------------ quick play */

export type QuickPlay = "checking" | "ready" | "needed";

/**
 * Whether this device can trade on chain without a popup: a session key bound to the
 * signed-in account. Only asked when the market is on chain.
 */
export function useQuickPlay(onChain: boolean, accountId: string | null): QuickPlay {
  const [state, setState] = useState<{ key: string; value: QuickPlay } | null>(null);
  const key = `${onChain}:${accountId}`;
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

export type TradeOutcome = { ok: true } | { ok: false; code: string; message: string };

const CHAIN_CALL = {
  buy: (r: Extract<SimTradeRequest, { action: "buy" }>) => ["market_buy", { item: r.item, amount: r.amount, max_bits: String(r.maxBits) }] as const,
  sell: (r: Extract<SimTradeRequest, { action: "sell" }>) => ["market_sell", { item: r.item, amount: r.amount, min_bits: String(r.minBits) }] as const,
  list: (r: Extract<SimTradeRequest, { action: "list" }>) => ["list_item", { item: r.item, amount: r.amount, price_bits: String(r.price) }] as const,
  fill: (r: Extract<SimTradeRequest, { action: "fill" }>) => ["buy_listing", { listing_id: r.listingId }] as const,
  cancel: (r: Extract<SimTradeRequest, { action: "cancel" }>) => ["cancel_listing", { listing_id: r.listingId }] as const,
};

/** The contract's own words from a relayed failure ("Smart contract panicked: …"). */
export function panicText(message: string | undefined): string | null {
  const m = /panicked: ([^"\\]+)/.exec(message ?? "");
  return m ? m[1]!.trim() : null;
}

function problem(status: number, code: string, message?: string): TradeOutcome {
  if (status === 0) return { ok: false, code: "network", message: "Couldn’t reach the market. Check your connection and try again." };
  if (code === "run_active") return { ok: false, code, message: "Finish or abandon your patrol first, then trade." };
  if (status === 401) return { ok: false, code: "signed_out", message: "Sign in again to trade." };
  if (status === 429) return { ok: false, code, message: "That’s a lot of trades at once. Wait a moment and try again." };
  return { ok: false, code, message: message ?? "The market couldn’t do that. Try again." };
}

/** One trade on whichever market is live. Never throws. */
export async function trade(onChain: boolean, req: SimTradeRequest): Promise<TradeOutcome> {
  if (!onChain) {
    const res = await postSimTrade(req);
    if (!res.ok) return problem(res.status, res.error, res.message);
    adoptServerSave(res.data.save, res.data.rev);
    return { ok: true };
  }
  try {
    const { callGame } = await import("@/lib/near/session-key");
    const [method, args] = (CHAIN_CALL[req.action] as (r: SimTradeRequest) => readonly [Parameters<typeof callGame>[0], Record<string, unknown>])(req);
    const res = await callGame(method, args);
    if (!res.ok) {
      if (res.error === "unknown_key" || res.error === "revoked_key") return { ok: false, code: "quick_play", message: "Turn on quick play to trade without popups." };
      return problem(422, res.error ?? "call_failed", panicText(res.message) ?? res.message);
    }
    await refreshAccount();
    return { ok: true };
  } catch (error) {
    const text = (error as Error).message;
    if (/session key/i.test(text)) return { ok: false, code: "quick_play", message: "Turn on quick play to trade without popups." };
    return { ok: false, code: "network", message: "Couldn’t reach NEAR. Check your connection and try again." };
  }
}
