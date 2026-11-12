"use client";

/**
 * The Mempool Market (/play/market). Gwei Stacy runs the stall: every item has a price
 * on a bonding curve that moves with each trade, and players list their own loot to each
 * other. Guests read prices; signed-in players buy, sell and list. On chain, trades are
 * session-key calls with no popup ("quick play"); until the contract's market is live,
 * the server runs the same rules and everything is flagged as simulated.
 */
import { createElement, useState } from "react";

import { StickerButton, StickerFrame, StickerPanel } from "@/components/game/kit";
import { StickerTabs, tabPanelProps, type StickerTab } from "@/components/game/ui";
import { AVATARS } from "@/components/cast";
import { CircleAlert, Coins, ExternalLink, Hourglass, KeyRound, LogIn, Store, Tag } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { showToast, useAccount } from "@/game/store";
import { RARITY_LABEL } from "@wgp/game-core/data";

import type { ListingView, MarketItemView, MarketMe, MarketView, SimTradeRequest } from "@/lib/market/api";
import type { MarketParams } from "@/lib/market/config";
import { explainPrice } from "@/lib/market/reasoning";
import { EXPLORER_URL } from "@/lib/near/config";
import { isUnclaimed } from "@/lib/near/policy";

import { ITEM_SOURCE, VENDOR_AFTER, vendorLine } from "./copy";
import { FillSheet, ListSheet, TradeSheet, type Side } from "./sheets";
import { ChangePill, formatBits, formatChange, formatPrice, Sparkline } from "./sparkline";
import { askToSignIn, trade, useMarketData, useQuickPlay, type QuickPlay } from "./use-market";
import { VendorChips, WhyPrice } from "./why-price";

type Tab = "vendor" | "listings";
const ID = "market";

/* ------------------------------------------------------------------ the stall */

function Vendor({ view, me, signedIn, unclaimed, quickPlay, line }: { view: MarketView; me: MarketMe | null; signedIn: boolean; unclaimed: boolean; quickPlay: QuickPlay; line: string }) {
  return (
    <StickerPanel as="section" aria-labelledby="vendor-name" className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:gap-5 sm:p-4">
      <div className="flex min-w-0 flex-1 items-start gap-3.5 sm:items-center">
        <StickerFrame drop="sm" label="Gwei Stacy, the vendor" className="[--s:76px] sm:[--s:96px]">
          {createElement(AVATARS.gwei)}
        </StickerFrame>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p id="vendor-name" className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
            Gwei Stacy · the vendor
          </p>
          {/* A speech bubble: the tail points back at Gwei. */}
          <blockquote className="relative rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-2.5 text-[15px] font-medium leading-[21px] [text-wrap:pretty] before:absolute before:-left-[9px] before:top-4 before:size-4 before:rotate-45 before:border-b-2 before:border-l-2 before:border-game-ink before:bg-game-paper-2 before:content-['']">
            “{line}”
          </blockquote>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t-2 border-dashed border-game-ink/20 pt-3 sm:min-w-[210px] sm:border-l-2 sm:border-t-0 sm:pl-5 sm:pt-0">
        <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-start sm:gap-1">
          <div className="flex flex-col">
            <p className="flex flex-col">
              <span className="text-[12px] font-semibold leading-4 text-game-muted">Your Bits</span>
              <span className="num text-[30px] font-bold leading-9 tracking-[-0.02em]">{me ? formatBits(me.bits) : "—"}</span>
            </p>
            {/* A night's Bits between the results screen and the wallet: say so, never let them look lost. */}
            <p role="status" className="empty:hidden">
              {me && me.pendingBits > 0 ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold leading-4 text-game-muted">
                  <Hourglass aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
                  <span>
                    <span className="num">+{formatBits(me.pendingBits)}</span> {unclaimed ? "waiting for your name" : "on the way"}
                  </span>
                </span>
              ) : null}
            </p>
          </div>
          <p className="num text-right text-[12px] leading-4 text-game-muted sm:text-left">
            Gwei’s till: {formatBits(view.till)} Bits
            <br />
            Gas fee {view.params.feeBps / 100}%, burned
          </p>
        </div>
        {!signedIn ? (
          <StickerButton variant="hero" onClick={askToSignIn} className="w-full">
            <LogIn aria-hidden className="size-5" strokeWidth={2} />
            Sign in to trade
          </StickerButton>
        ) : view.onChain && unclaimed ? (
          // A Google player still on their key's address: nothing reaches NEAR until they pick a name.
          <div className="flex flex-col gap-1.5">
            <StickerButton variant="hero" onClick={askToSignIn} className="w-full">
              <KeyRound aria-hidden className="size-5" strokeWidth={2} />
              Claim your name
            </StickerButton>
            <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">Your Bits and loot are saved. They reach your wallet once you pick a name, and then you can trade.</p>
          </div>
        ) : view.onChain && quickPlay === "needed" ? (
          <div className="flex flex-col gap-1.5">
            <StickerButton variant="hero" onClick={askToSignIn} className="w-full">
              <KeyRound aria-hidden className="size-5" strokeWidth={2} />
              Enable quick play
            </StickerButton>
            <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">One approval adds a game-only key. Trades then need no popups, and it can never move your tokens.</p>
          </div>
        ) : null}
      </div>
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ prices */

/** A card's buy and sell buttons: the kit's sticker button, narrow enough for two columns on a phone. */
const cardButton =
  "inline-flex h-11 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-[12px] border-2 border-game-ink bg-game-paper px-1.5 text-[14px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 pointer-fine:hover:bg-game-paper-2";

function ItemCard({ item, me, params, canTrade, onTrade }: { item: MarketItemView; me: MarketMe | null; params: MarketParams; canTrade: boolean; onTrade(side: Side): void }) {
  const held = me?.items[item.item] ?? 0;
  const first = item.spark[0] ?? item.priceMilli;
  // Gwei's own account of this price, from the pool the server just read.
  const why = explainPrice({ pool: item.pool, open: params.open, feeBps: params.feeBps, change24h: item.change24h, trades24h: item.trades24h });
  const blocked = [why.buyBlocked, why.sellBlocked].filter((t, i, all) => t !== null && all.indexOf(t) === i);
  const blockedId = `${ID}-${item.item}-blocked`;
  return (
    <li className="group/card flex min-w-0 flex-col gap-2 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 text-game-ink shadow-[var(--game-shadow-sm)] sm:gap-3 sm:p-3">
      <div className="flex items-center gap-2 sm:gap-2.5">
        <MiniAvatar id={ITEM_SOURCE[item.item]} className="size-8 rounded-[9px] sm:size-10 sm:rounded-[11px]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-[14px] font-semibold leading-[18px] text-game-ink [overflow-wrap:anywhere] sm:text-[15px] sm:leading-5">{item.name}</h3>
          <span className="text-[12px] leading-4 text-game-muted">{RARITY_LABEL[item.rarity]}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="flex items-baseline gap-1">
          <span className="num text-[22px] font-bold leading-7 tracking-[-0.02em] sm:text-[26px]">{formatPrice(item.priceMilli)}</span>
          <span className="text-[12px] font-semibold text-game-muted sm:text-[13px]">Bits</span>
        </p>
        <ChangePill change={item.change24h} />
      </div>
      <VendorChips reasoning={why} />
      <Sparkline
        points={item.spark}
        className="h-8 w-full sm:h-10"
        label={`${item.name} over 24 hours: from ${formatPrice(first)} to ${formatPrice(item.priceMilli)} Bits${item.change24h !== null ? `, ${formatChange(item.change24h)}` : ""}`}
      />
      <p className="num flex flex-wrap justify-between gap-x-3 text-[12px] leading-4 text-game-muted">
        <span>Stock {formatBits(item.pool.stock)}</span>
        {me ? <span>You have {formatBits(held)}</span> : <span>{formatBits(item.trades24h)} trades today</span>}
      </p>
      {/* The popover spreads from the card's own edge: the right-hand column opens leftwards, so it stays on a phone's screen. */}
      <WhyPrice name={`for ${item.name}`} reasoning={why} popoverClassName="start-0 group-even/card:start-auto group-even/card:end-0" />
      {canTrade ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            <button type="button" className={cardButton} onClick={() => onTrade("buy")} disabled={why.buyBlocked !== null || item.buyOne === null} aria-describedby={why.buyBlocked ? blockedId : undefined}>
              Buy
              {why.buyBlocked === null && item.buyOne !== null ? (
                <>
                  <span className="num font-normal">· {formatBits(item.buyOne)}</span>
                  <span className="sr-only"> Bits for one</span>
                </>
              ) : null}
            </button>
            <button type="button" className={cardButton} onClick={() => onTrade("sell")} disabled={why.sellBlocked !== null} aria-describedby={why.sellBlocked ? blockedId : undefined}>
              Sell
              {why.sellBlocked === null && item.sellOne !== null ? (
                <>
                  <span className="num font-normal">· {formatBits(item.sellOne)}</span>
                  <span className="sr-only"> Bits for one</span>
                </>
              ) : null}
            </button>
          </div>
          {/* A disabled button can't explain itself in a tooltip, so the reason is printed under it. */}
          {blocked.length > 0 ? (
            <p id={blockedId} className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
              {blocked.join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ listings */

function ListingRow({ listing, mine, canTrade, cancelling, onBuy, onCancel }: { listing: ListingView; mine: boolean; canTrade: boolean; cancelling: boolean; onBuy(): void; onCancel(): void }) {
  const seller = listing.seller.split(".")[0];
  const vs = listing.vsSpot - 1;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[16px] px-2 py-2.5 sm:flex-nowrap sm:px-3">
      <MiniAvatar id={ITEM_SOURCE[listing.item as keyof typeof ITEM_SOURCE]} className="size-10 rounded-[11px]" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold leading-5">
          <span className="num">{formatBits(listing.amount)}</span> × {listing.name}
        </span>
        <span className="truncate text-[12px] leading-4 text-game-muted" title={listing.seller}>
          {mine ? "Your listing" : `From ${seller}`} · <span className="num">{formatPrice(listing.unitMilli)}</span> each,{" "}
          <span className="num">{Math.abs(Math.round(vs * 100))}%</span> {vs >= 0 ? "over" : "under"} Gwei
        </span>
      </span>
      <span className="num shrink-0 text-[16px] font-bold leading-5">
        {formatBits(listing.price)}
        <span className="text-[12px] font-semibold text-game-muted"> Bits</span>
      </span>
      {canTrade ? (
        mine ? (
          // aria-disabled, not disabled: focus stays on the button while it works.
          <StickerButton size="sm" onClick={() => !cancelling && onCancel()} aria-disabled={cancelling || undefined} aria-busy={cancelling || undefined} className="max-sm:w-full">
            {cancelling ? "Taking it down…" : "Take it down"}
          </StickerButton>
        ) : (
          <StickerButton size="sm" onClick={onBuy} className="max-sm:w-full">
            Buy this lot
          </StickerButton>
        )
      ) : null}
    </li>
  );
}

function Listings({
  listings,
  me,
  view,
  canTrade,
  cancelling,
  onList,
  onBuy,
  onCancel,
}: {
  listings: ListingView[] | null;
  me: MarketMe | null;
  view: MarketView;
  canTrade: boolean;
  cancelling: number | null;
  onList(): void;
  onBuy(l: ListingView): void;
  onCancel(l: ListingView): void;
}) {
  const mine = new Set(me?.open ?? []);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-dashed border-game-ink/20 px-2 pb-3 pt-1 sm:px-3">
        <p className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold leading-5">Player listings</span>
          <span className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
            Priced by players, between half and four times Gwei’s price. {me ? `You can list ${me.listingsLeft} more today.` : ""}
          </span>
        </p>
        {canTrade ? (
          <StickerButton size="sm" onClick={onList}>
            <Tag aria-hidden className="size-4" strokeWidth={2} />
            List an item
          </StickerButton>
        ) : null}
      </div>
      {listings === null ? (
        <p role="status" className="px-2 py-6 text-[14px] text-game-muted sm:px-3">
          Loading listings…
        </p>
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-2 py-6 sm:px-3">
          <p className="max-w-[48ch] text-[15px] leading-6 [text-wrap:pretty]">
            Nobody has listed anything yet. Put up loot you don’t need at your own price; it waits in escrow until someone buys it.
          </p>
          {canTrade ? null : <p className="text-[13px] text-game-muted">Sign in to list your loot.</p>}
        </div>
      ) : (
        <ul aria-label="Open listings" className="flex flex-col divide-y-2 divide-dashed divide-game-ink/10">
          {listings.map((l) => (
            <ListingRow
              key={l.id}
              listing={l}
              mine={mine.has(l.id) || l.seller === me?.accountId}
              canTrade={canTrade}
              cancelling={cancelling === l.id}
              onBuy={() => onBuy(l)}
              onCancel={() => onCancel(l)}
            />
          ))}
        </ul>
      )}
      <p className="px-2 pb-1 text-[12px] leading-4 text-game-muted sm:px-3">
        {view.listings} open · at most {view.params.maxOpenListings} each · gas fee {view.params.feeBps / 100}% from the seller’s proceeds
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

function Header({ view }: { view: MarketView | null }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2.5 font-display text-[28px] font-semibold leading-[30px] tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] [text-wrap:balance] sm:text-[36px] sm:leading-[38px]">
        <Store aria-hidden className="size-8 shrink-0 [filter:drop-shadow(0_2px_0_var(--game-ink))]" strokeWidth={2} />
        Mempool Market
      </h1>
      <p className="max-w-[56ch] text-[14px] leading-5 text-game-paper/80 [text-wrap:pretty]">
        Spend the Bits you earn on patrol. Every buy pushes a price up and every sell pulls it down; no patch sets them.
      </p>
      {view ? (
        <div className="flex flex-wrap gap-2">
          {view.onChain ? (
            <a
              href={`${EXPLORER_URL}/address/${view.contractId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border-2 border-game-ink bg-game-mint px-3 text-[13px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 pointer-coarse:h-11"
            >
              On NEAR {view.network} · {view.contractId}
              <ExternalLink aria-hidden className="size-4" strokeWidth={2} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <p className="inline-flex items-start gap-1.5 rounded-[14px] border-2 border-game-ink bg-game-gold px-3 py-1.5 text-[13px] font-semibold leading-[18px] text-game-ink shadow-[var(--game-shadow-sm)] [text-wrap:pretty]">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
              Simulated until the contract’s market opens: same rules, no tokens move
            </p>
          )}
        </div>
      ) : null}
    </header>
  );
}

export function MarketScreen() {
  const { market, listings, me, signedIn, refresh, adopt } = useMarketData();
  const account = useAccount();
  const view = market.state === "ready" ? market.data : null;
  const quickPlay = useQuickPlay(!!view?.onChain, me?.accountId ?? null);
  const [tab, setTab] = useState<Tab>("vendor");
  const [sheet, setSheet] = useState<{ item: MarketItemView; side: Side } | null>(null);
  const [listing, setListing] = useState(false);
  const [filling, setFilling] = useState<ListingView | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  // Gwei's line changes daily; the day comes from the server's answer, not the render.
  const day = view ? Math.floor(Date.parse(view.updatedAt) / 86_400_000) : 0;

  const unclaimed = account.status === "signed-in" && isUnclaimed(account.me.player);
  const canTrade = signedIn && !!me && (!view?.onChain || (quickPlay === "ready" && !unclaimed));

  async function run(req: SimTradeRequest) {
    const res = await trade(!!view?.onChain, req);
    // The answer carries the market right after the trade (or the price that refused it).
    if (res.snapshot) adopt(res.snapshot);
    else if (res.ok || (res.code !== "busy" && res.code !== "network")) void refresh();
    if (res.ok) {
      setAfter(VENDOR_AFTER[req.action]);
      showToast(
        req.action === "buy" ? "Bought. It’s in your pocket." : req.action === "sell" ? "Sold. The Bits are yours." : req.action === "list" ? "Listed. It’s in escrow until someone buys it." : req.action === "fill" ? "Bought from a player. It’s in your pocket." : "Taken down. Your items are back.",
        "success",
      );
    } else if (res.code === "quick_play") {
      askToSignIn();
    }
    // An unsure answer reloads the wallet at once, so the player can see whether it landed.
    if (!res.ok && res.unsure) void refresh();
    return res;
  }

  /** Taking a listing down has no sheet, so its outcome is a toast. */
  async function cancel(l: ListingView) {
    if (cancelling !== null) return;
    setCancelling(l.id);
    const res = await run({ action: "cancel", listingId: l.id });
    setCancelling(null);
    if (!res.ok && res.code !== "quick_play") showToast(res.message, "error");
  }

  const tabs: StickerTab<Tab>[] = [
    { id: "vendor", label: "Gwei’s stall" },
    { id: "listings", label: "Listings", badge: listings && listings.length > 0 ? { value: listings.length, label: `${listings.length} open` } : undefined },
  ];

  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-4 sm:px-6">
      <Header view={view} />
      {market.state === "loading" ? (
        <StickerPanel className="p-6">
          <p role="status" className="text-[15px] font-semibold">
            Opening the stall…
          </p>
        </StickerPanel>
      ) : null}
      {market.state === "error" ? (
        <StickerPanel className="flex flex-col items-start gap-3 p-5">
          <p className="flex items-center gap-2 text-[15px] leading-6">
            <CircleAlert aria-hidden className="size-5 shrink-0 text-game-hero" strokeWidth={2} />
            {market.message}
          </p>
          <StickerButton size="sm" onClick={() => void refresh()}>
            Try again
          </StickerButton>
        </StickerPanel>
      ) : null}
      {view ? (
        <>
          <Vendor view={view} me={me} signedIn={signedIn} unclaimed={unclaimed} quickPlay={quickPlay} line={after ?? vendorLine(day)} />
          <StickerTabs tabs={tabs} value={tab} onChange={setTab} label="Market" idPrefix={ID} className="self-stretch sm:min-w-[360px] sm:self-start" />
          {tab === "vendor" ? (
            <section {...tabPanelProps(ID, "vendor")} aria-label="Gwei’s prices" className="focus-visible:outline-offset-4">
              <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                {view.items.map((item) => (
                  <ItemCard key={item.item} item={item} me={me} params={view.params} canTrade={canTrade} onTrade={(side) => setSheet({ item, side })} />
                ))}
              </ul>
              <p className="mt-3 flex items-center gap-2 text-[12px] leading-4 text-game-paper/75">
                <Coins aria-hidden className="size-4 shrink-0" strokeWidth={2} />
                Prices include the {view.params.feeBps / 100}% gas fee. You can make {me ? me.tradesLeft : view.params.dailyTrades} more trades with Gwei today.
              </p>
            </section>
          ) : (
            <StickerPanel {...tabPanelProps(ID, "listings")} className="p-2 focus-visible:outline-offset-4">
              <Listings
                listings={listings}
                me={me}
                view={view}
                canTrade={canTrade}
                cancelling={cancelling}
                onList={() => setListing(true)}
                onBuy={setFilling}
                onCancel={(l) => void cancel(l)}
              />
            </StickerPanel>
          )}
          <TradeSheet
            key={sheet?.item.item ?? "none"}
            item={sheet ? (view.items.find((i) => i.item === sheet.item.item) ?? sheet.item) : null}
            side={sheet?.side ?? "buy"}
            view={view}
            me={me}
            onSide={(side) => setSheet((s) => (s ? { ...s, side } : s))}
            onClose={() => setSheet(null)}
            onTrade={run}
          />
          <ListSheet open={listing} view={view} me={me} onClose={() => setListing(false)} onTrade={run} />
          <FillSheet key={filling?.id ?? 0} listing={filling} me={me} onClose={() => setFilling(null)} onTrade={run} />
        </>
      ) : null}
    </div>
  );
}
