"use client";

/**
 * The Mempool Market (/play/market). Gwei Stacy runs the stall: every item has a price
 * on a bonding curve that moves with each trade, and players list their own loot to each
 * other. Guests trade in a practice market of their own (src/lib/market/practice.ts: the same
 * rules in their browser, never on NEAR); signed-in players buy, sell and list. On chain, trades are
 * session-key calls with no popup ("quick play"); until the contract's market is live,
 * the server runs the same rules and everything is flagged as simulated.
 *
 * The market is part of the nightly loop, not a side room: a link from the results, the
 * Suit lab or Tonight (src/lib/market/prompts.ts) opens the trade sheet prefilled; the
 * player's next trade and today's market quest sit above the prices; a first visit gets a
 * three-step coach; and whatever stops a player trading (signed out, no name, quick play
 * off) is said in one sentence on the sheet's own button instead of hiding the buttons.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { createElement, useEffect, useState } from "react";

import { StickerButton, StickerFrame, StickerPanel } from "@/components/game/kit";
import { StickerTabs, tabPanelProps, type StickerTab } from "@/components/game/ui";
import { AVATARS } from "@/components/cast";
import { CircleAlert, Coins, ExternalLink, Hourglass, KeyRound, LogIn, Store, Tag } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { showToast, useAccount, useGame } from "@/game/store";
import { RARITY_LABEL } from "@wgp/game-core/data";
import { NewStockTag } from "./new-stock-tag";
import type { ItemId } from "@wgp/game-core/types";

import type { ListingView, MarketItemView, MarketMe, MarketView, SimTradeRequest, StakeRequest } from "@/lib/market/api";
import type { MarketParams } from "@/lib/market/config";
import type { Shop, StakeView } from "@/lib/market/invest";
import { holdingsOf, MARKET_PATH, nextTrade, parseTradeIntent } from "@/lib/market/prompts";
import { countsForQuest } from "@/lib/market/quest";
import { feeText } from "@/lib/market/format";
import { explainPrice } from "@/lib/market/reasoning";
import { withShop } from "@/lib/market/reasoning-shop";
import { INVEST_NOT_LIVE } from "@/lib/market/refusal";
import { sparkQuiet } from "@/lib/market/spark";
import { plural } from "@/lib/plural";
import { EXPLORER_URL } from "@/lib/near/config";
import { isUnclaimed } from "@/lib/near/policy";

import { COACH_RING, CoachCard, coachSteps, markCoachSeen, useCoachSeen } from "./coach";
import { doneText, ITEM_SOURCE, vendorAfter, vendorLine } from "./copy";
import { investingOf, InvestSheet, PracticeBanner, ShopLine, shopFor, StakesPanel, type Investing } from "./invest";
import { OtherTraders, TraderStrip } from "./other-traders";
import { QuestStrip } from "./quest-strip";
import { FillSheet, ListSheet, TradeSheet, type Side, type TradeGate } from "./sheets";
import { ChangePill, formatBits, formatChange, formatPrice, Sparkline } from "./sparkline";
import { TradePromptCard } from "./trade-prompt";
import { askToSignIn, stake as stakeLive, trade, useMarketData, useQuickPlay, type QuickPlay } from "./use-market";
import { useGuestBits, useMarketQuest } from "./use-market-peek";
import { setPracticeMode, useClock, usePractice } from "./use-practice";
import { VendorChips, WhyPrice } from "./why-price";

type Tab = "vendor" | "listings";
const ID = "market";

/* ------------------------------------------------------------------ the stall */

function Vendor({
  view,
  me,
  signedIn,
  unclaimed,
  quickPlay,
  line,
  guestBits,
  coached,
  practice = false,
}: {
  /** The practice market: the Bits shown are practice Bits. */
  practice?: boolean;
  view: MarketView;
  me: MarketMe | null;
  signedIn: boolean;
  unclaimed: boolean;
  quickPlay: QuickPlay;
  line: string;
  /** What a guest's nights in this browser would have paid, had they been verified. */
  guestBits: number;
  /** The coach is pointing at the Bits. */
  coached: boolean;
}) {
  return (
    <StickerPanel as="section" aria-labelledby="vendor-name" className={`flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:gap-5 sm:p-4 ${coached ? COACH_RING : ""}`}>
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
              <span className="text-[12px] font-semibold leading-4 text-game-muted">{practice ? "Your practice Bits" : "Your Bits"}</span>
              <span className="num text-[30px] font-bold leading-9 tracking-[-0.02em]">{me ? formatBits(me.bits) : "—"}</span>
            </p>
            {/* A guest has no Bits yet: say what their nights would have paid, so the price of entry is clear. */}
            {!signedIn && !practice && guestBits > 0 ? (
              <p className="num max-w-[24ch] text-[12px] font-semibold leading-4 text-game-muted [text-wrap:pretty]">Your guest nights would have paid about {formatBits(guestBits)}</p>
            ) : null}
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
            Gas fee {feeText(view.params.feeBps)}, burned
          </p>
        </div>
        {practice ? (
          // Practice trading is open to everyone: say so first. Signing in is the second offer, and only for a guest.
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-semibold leading-[18px] [text-wrap:pretty]">Buy, sell and invest below with practice Bits. Nothing here is on NEAR.</p>
            {signedIn ? null : (
              <>
                <StickerButton size="sm" onClick={askToSignIn} className="w-full">
                  <LogIn aria-hidden className="size-4" strokeWidth={2} />
                  Sign in to trade for real
                </StickerButton>
                <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">Signed in, every verified night pays Bits you can spend on the real market.</p>
              </>
            )}
          </div>
        ) : !signedIn ? (
          <div className="flex flex-col gap-1.5">
            <StickerButton variant="hero" onClick={askToSignIn} className="w-full">
              <LogIn aria-hidden className="size-5" strokeWidth={2} />
              Sign in to trade
            </StickerButton>
            <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">Signed in, every verified night pays Bits you can spend here.</p>
          </div>
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

/** What an item's card needs to show its shop: open or closed, the player's stake, and where investing stands. */
interface CardShop {
  shop: Shop;
  investing: Investing;
  stake: StakeView | null;
  inPractice: boolean;
  onInvest(tab: "invest" | "withdraw"): void;
  onPractice(): void;
}

function ItemCard({ item, me, params, coached, onTrade, stall }: { item: MarketItemView; me: MarketMe | null; params: MarketParams; coached: boolean; onTrade(side: Side): void; stall: CardShop }) {
  const held = me?.items[item.item] ?? 0;
  const first = item.sparkSteps?.[0]?.[1] ?? item.spark[0] ?? item.priceMilli;
  const quiet = item.sparkSteps !== undefined && (item.sparkSteps.length === 0 || sparkQuiet(item.sparkSteps));
  // Gwei's own account of this price, from the pool the server just read; a closed shop adds why, and what reopens it.
  const why = withShop(explainPrice({ pool: item.pool, open: params.open, feeBps: params.feeBps, change24h: item.change24h, trades24h: item.trades24h }), stall.shop, stall.investing);
  const blocked = [why.buyBlocked, why.sellBlocked].filter((t, i, all) => t !== null && all.indexOf(t) === i);
  const blockedId = `${ID}-${item.item}-blocked`;
  return (
    <li className={`group/card flex min-w-0 flex-col gap-2 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 text-game-ink shadow-[var(--game-shadow-sm)] sm:gap-3 sm:p-3 ${coached ? COACH_RING : ""}`}>
      <div className="flex items-center gap-2 sm:gap-2.5">
        <MiniAvatar id={ITEM_SOURCE[item.item]} className="size-8 rounded-[9px] sm:size-10 sm:rounded-[11px]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-[14px] font-semibold leading-[18px] text-game-ink [overflow-wrap:anywhere] sm:text-[15px] sm:leading-5">{item.name}</h3>
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] leading-4 text-game-muted">
            {RARITY_LABEL[item.rarity]}
            <NewStockTag item={item} />
          </span>
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
        steps={item.sparkSteps}
        className="h-8 w-full sm:h-10"
        label={
          quiet
            ? `${item.name}: no trades in the last 24 hours, holding at ${formatPrice(item.priceMilli)} Bits`
            : `${item.name} over 24 hours: from ${formatPrice(first)} to ${formatPrice(item.priceMilli)} Bits${item.change24h !== null ? `, ${formatChange(item.change24h)}` : ""}`
        }
      />
      <p className="num flex flex-wrap justify-between gap-x-3 text-[12px] leading-4 text-game-muted">
        <span>Stock {formatBits(item.pool.stock)}</span>
        {me ? <span>You have {formatBits(held)}</span> : <span>{plural(item.trades24h, "trade")} in 24 h</span>}
      </p>
      {/* The popover spreads from the card's own edge: the right-hand column opens leftwards, so it stays on a phone's screen. */}
      <WhyPrice name={`for ${item.name}`} reasoning={why} popoverClassName="start-0 group-even/card:start-auto group-even/card:end-0" />
      {/* Always there, for guests and players without quick play too: the sheet they open says what's needed. */}
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
      {/* The shop itself: closed and why, the player's stake, and investing where this market has it. */}
      {stall.investing === "available" || stall.stake || stall.shop.closed.includes("broke") ? <ShopLine item={item} {...stall} /> : null}
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
        {view.listings} open · at most {view.params.maxOpenListings} each · gas fee {feeText(view.params.feeBps)} from the seller’s proceeds
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
  const { market, listings: liveListings, me: liveMe, signedIn, refresh, adopt } = useMarketData();
  const account = useAccount();
  const liveView = market.state === "ready" ? market.data : null;
  const router = useRouter();
  const query = useSearchParams();
  /*
   * The practice market (src/lib/market/practice.ts): a guest's own copy in their browser, the
   * only market they can trade in; a signed-in player can step into it and back. While it is
   * on, the screen reads it in place of the live market: same components, same rules.
   */
  const practice = usePractice(liveView, market.state === "error", account.status === "loading" ? null : signedIn, query.get("practice") === "1");
  const view = practice.on ? (practice.screen?.view ?? null) : liveView;
  const me = practice.on ? (practice.screen?.me ?? null) : liveMe;
  const listings = practice.on ? (practice.screen?.listings ?? null) : liveListings;
  const quickPlay = useQuickPlay(!!view?.onChain, me?.accountId ?? null);
  const [tab, setTab] = useState<Tab>("vendor");
  // `amount` and `from` come from a prompt: the sheet opens on that amount, remounted per prompt.
  const [sheet, setSheet] = useState<{ item: MarketItemView; side: Side; amount?: number; from?: string } | null>(null);
  const [listing, setListing] = useState(false);
  const [listItem, setListItem] = useState<ItemId | null>(null);
  const [filling, setFilling] = useState<ListingView | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  /** What the practice banner's own button just did, said in the banner. */
  const [practiceNote, setPracticeNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  // Counts the player's trades: Sandwich Man (the NPC) may answer one, so his strip looks again.
  const [traded, setTraded] = useState(0);
  // Gwei's line changes daily; the day comes from the server's answer, not the render.
  const day = view ? Math.floor(Date.parse(view.updatedAt) / 86_400_000) : 0;

  const unclaimed = account.status === "signed-in" && isUnclaimed(account.me.player);
  const canTrade = practice.on ? !!me : signedIn && !!me && (!view?.onChain || (quickPlay === "ready" && !unclaimed));
  // Investing: the item whose sheet is open and the tab it opens on; and a clock for a stake's lock.
  const [investIn, setInvestIn] = useState<{ item: ItemId; tab: "invest" | "withdraw" } | null>(null);
  const clock = useClock((me?.investor?.stakes.length ?? 0) > 0);
  const playerId = account.status === "signed-in" ? account.me.player.id : null;
  const { quest, refresh: refreshQuest } = useMarketQuest(playerId);
  const guestBits = useGuestBits();
  const { save } = useGame();

  /* A link from the results, the Suit lab or Tonight: open its sheet prefilled, once, then tidy the address. */
  const intentKey = query.toString();
  const intent = view ? parseTradeIntent(query, view.params.maxAmount) : null;
  const [handled, setHandled] = useState<string | null>(null);
  if (view && intent && handled !== intentKey) {
    setHandled(intentKey);
    if (intent.kind === "trade") {
      const item = view.items.find((i) => i.item === intent.item);
      if (item) {
        setTab("vendor");
        setSheet({ item, side: intent.side, amount: intent.amount, from: intentKey });
      }
    } else {
      setTab("listings");
      setListItem(intent.item);
      // Listing needs an account that can trade; otherwise the tab itself says what's needed.
      if (canTrade) setListing(true);
    }
  } else if (!intentKey && handled !== null) {
    // The address is clean again: the same link can open its sheet next time.
    setHandled(null);
  }
  useEffect(() => {
    if (handled !== null && handled === intentKey) router.replace(MARKET_PATH, { scroll: false });
  }, [handled, intentKey, router]);

  /* What stands between this player and a trade, said on the trade sheet's own button. */
  const stepAside = (then: () => void) => () => {
    setSheet(null);
    then();
  };
  const gate: TradeGate | null = !view || practice.on
    ? null
    : !signedIn
      ? {
          label: "Sign in to trade",
          text:
            guestBits > 0
              ? `Trading needs an account. Your guest nights would have paid about ${formatBits(guestBits)} Bits; signed in, every verified night pays Bits you can spend here.`
              : "Trading needs an account. Signed in, every verified night pays Bits you can spend here.",
          onAct: stepAside(askToSignIn),
        }
      : view.onChain && unclaimed
        ? { label: "Claim your name", text: "Your Bits and loot are saved. They reach your wallet once you pick a name, and then you can trade.", onAct: stepAside(askToSignIn) }
        : view.onChain && quickPlay === "needed"
          ? {
              label: "Enable quick play",
              text: "Trades on NEAR are signed by a game-only key, so there’s no popup each time. One approval adds it, and it can never move your tokens.",
              onAct: stepAside(askToSignIn),
            }
          : null;

  /* The player's next trade, from what they hold (their wallet on chain, else the save) and the pools on screen. */
  const prompt =
    view && save?.hero ? nextTrade(holdingsOf({ ...save, inventory: me?.items ?? save.inventory }), view, me ? me.bits + me.pendingBits : null) : null;

  /* The first-visit coach: signed in, the wallet loaded, and nothing open over the stall. */
  const coachSeen = useCoachSeen();
  const [coachStep, setCoachStep] = useState(0);
  const steps = coachSteps(me?.bits ?? null);
  const coaching = signedIn && !!view && !!me && !coachSeen && !sheet && !listing && !filling;
  const coachTarget = coaching ? steps[coachStep]!.target : null;
  const coach = coaching ? (
    <CoachCard
      step={steps[coachStep]!}
      index={coachStep}
      count={steps.length}
      onNext={() => (coachStep >= steps.length - 1 ? markCoachSeen() : setCoachStep(coachStep + 1))}
      onSkip={markCoachSeen}
    />
  ) : null;

  /** An investing move on whichever market is on screen: practice in the browser, else the live one (never a v2 contract). */
  async function runStake(req: StakeRequest) {
    if (!view) return { ok: false as const, code: "loading", message: "The market is still loading. Try again in a moment.", snapshot: null };
    const res = practice.on ? practice.stake(req) : await stakeLive(view, req);
    if (!practice.on) {
      if (res.snapshot) adopt(res.snapshot);
      else if (res.ok || (res.code !== "busy" && res.code !== "network")) void refresh();
    }
    if (res.ok) {
      showToast(doneText(req.action, practice.on), "success");
    } else if (res.code === "quick_play") {
      askToSignIn();
    }
    return res;
  }

  async function run(req: SimTradeRequest) {
    const res = practice.on ? practice.trade(req) : await trade(!!view?.onChain, req);
    // The answer carries the market right after the trade (or the price that refused it).
    if (practice.on) {
      // The practice market lives in this browser: it is already up to date.
    } else if (res.snapshot) adopt(res.snapshot);
    else if (res.ok || (res.code !== "busy" && res.code !== "network")) void refresh();
    if (res.ok) {
      setTraded((n) => n + 1);
      setAfter(vendorAfter(req.action, view?.params.feeBps ?? res.snapshot?.view.params.feeBps ?? 0));
      // A player who has traded doesn't need the tour.
      markCoachSeen();
      // The server completes today's quest when a trade lands; look, and say so in the same breath.
      const q = countsForQuest(req.action) && !quest?.done ? await refreshQuest() : null;
      const done = doneText(req.action, practice.on);
      showToast(!practice.on && q?.done ? `${done} Market quest done: +${q.xp} XP.` : done, "success");
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
      <Header view={practice.on ? null : view} />
      {practice.on ? (
        <PracticeBanner
          seededFrom={practice.seededFrom}
          signedIn={signedIn}
          drainName={practice.drainItem ? (view?.items.find((i) => i.item === practice.drainItem)?.name ?? null) : null}
          live={liveView?.onChain && liveView.contractId ? { network: liveView.network ?? "", contractId: liveView.contractId, href: `${EXPLORER_URL}/address/${liveView.contractId}` } : null}
          onDrain={() => {
            const item = practice.drainItem;
            const name = view?.items.find((i) => i.item === item)?.name ?? "that item";
            const sold = item ? practice.drain(item) : 0;
            if (sold > 0) setPracticeNote(`A crowd sold Gwei ${formatBits(sold)} ${name}. Her till for it is empty, so she is closed for buying it.`);
          }}
          onReset={() => {
            practice.reset();
            setAfter(null);
            setPracticeNote("Started over: your practice Bits, loot and prices are back where they began.");
          }}
          note={practiceNote}
          onLeave={() => setPracticeMode(false)}
        />
      ) : null}
      {market.state === "loading" && !view ? (
        <StickerPanel className="p-6">
          <p role="status" className="text-[15px] font-semibold">
            Opening the stall…
          </p>
        </StickerPanel>
      ) : null}
      {market.state === "error" && !view ? (
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
          {coachTarget === "bits" ? coach : null}
          <Vendor view={view} me={me} signedIn={signedIn} unclaimed={unclaimed} quickPlay={quickPlay} line={after ?? vendorLine(day, view.params.feeBps, practice.on)} guestBits={guestBits} coached={coachTarget === "bits"} practice={practice.on} />
          <StakesPanel view={view} me={me} now={clock || Date.parse(view.updatedAt)} onManage={(item) => setInvestIn({ item, tab: "withdraw" })} />
          <div className={`grid gap-3 ${prompt ? "lg:grid-cols-2" : ""}`}>
            <QuestStrip
              quest={practice.on ? null : quest}
              signedIn={signedIn}
              now={Date.parse(view.updatedAt)}
              note={practice.on ? (signedIn ? "Practice trades earn no XP. One trade on the real market does it." : "Practice trades earn no XP. Sign in, and one real trade a day does it.") : undefined}
            />
            {prompt ? (
              <TradePromptCard
                prompt={prompt}
                className="shadow-[var(--game-shadow-sm)]"
                onAct={() => {
                  const item = view.items.find((i) => i.item === prompt.intent.item);
                  if (item) {
                    setTab("vendor");
                    setSheet({ item, side: prompt.intent.side, amount: prompt.intent.amount, from: `prompt:${prompt.intent.side}:${prompt.intent.amount}` });
                  }
                }}
              />
            ) : null}
          </div>
          <StickerTabs tabs={tabs} value={tab} onChange={setTab} label="Market" idPrefix={ID} className="self-stretch sm:min-w-[360px] sm:self-start" />
          {coachTarget === "price" || coachTarget === "trade" ? coach : null}
          {tab === "vendor" ? (
            <section {...tabPanelProps(ID, "vendor")} aria-label="Gwei’s prices" className="focus-visible:outline-offset-4">
              <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                {view.items.map((item, i) => (
                  <ItemCard
                    key={item.item}
                    item={item}
                    me={me}
                    params={view.params}
                    coached={i === 0 && (coachTarget === "price" || coachTarget === "trade")}
                    onTrade={(side) => setSheet({ item, side })}
                    stall={{
                      shop: shopFor(view, item),
                      investing: investingOf(view),
                      stake: me?.investor?.stakes.find((s) => s.item === item.item) ?? null,
                      inPractice: practice.on,
                      onInvest: (tab) => setInvestIn({ item: item.item, tab }),
                      onPractice: () => setPracticeMode(true),
                    }}
                  />
                ))}
              </ul>
              <p className="mt-3 flex items-center gap-2 text-[12px] leading-4 text-game-paper/75">
                <Coins aria-hidden className="size-4 shrink-0" strokeWidth={2} />
                Prices include the {feeText(view.params.feeBps)} gas fee. You can make {me ? me.tradesLeft : view.params.dailyTrades} more trades with Gwei today.
              </p>
              {/* A signed-in player's way into practice; on contract v2 (mainnet today) it is also where investing can be tried. */}
              {!practice.on ? (
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-game-paper/75 [text-wrap:pretty]">
                  <span className="max-w-[64ch]">
                    {investingOf(view) === "not-live" ? `When one of Gwei’s tills runs dry, she closes for buying that item. ${INVEST_NOT_LIVE}` : "The practice market is your own copy of this one: same rules, practice Bits, nothing on NEAR."}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPracticeMode(true)}
                    className="inline-flex min-h-8 items-center rounded-[8px] font-semibold text-game-paper underline decoration-game-paper/50 underline-offset-[3px] [text-decoration-skip-ink:auto] focus-visible:outline-offset-2 pointer-coarse:min-h-11 pointer-fine:hover:decoration-game-paper"
                  >
                    Open the practice market
                  </button>
                </p>
              ) : null}
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
          {/* Sandwich Man: in practice he trades in this browser by the same rules, labelled NPC and Practice. */}
          {practice.on ? practice.screen ? <TraderStrip npc={practice.screen.npc} /> : null : <OtherTraders stamp={view.updatedAt} bump={traded} onMove={() => void refresh()} />}
          <InvestSheet
            key={`invest:${investIn?.item ?? "none"}:${investIn?.tab ?? ""}`}
            item={investIn ? (view.items.find((i) => i.item === investIn.item) ?? null) : null}
            initialTab={investIn?.tab}
            view={view}
            me={me}
            now={clock || Date.parse(view.updatedAt)}
            inPractice={practice.on}
            gate={canTrade ? null : gate}
            onClose={() => setInvestIn(null)}
            onStake={runStake}
          />
          <TradeSheet
            eyebrow={practice.on ? "Practice market · not on NEAR" : undefined}
            onInvest={
              sheet && investingOf(view) === "available"
                ? () => {
                    setInvestIn({ item: sheet.item.item, tab: "invest" });
                    setSheet(null);
                  }
                : undefined
            }
            key={`${sheet?.item.item ?? "none"}:${sheet?.from ?? ""}`}
            initialAmount={sheet?.amount}
            gate={canTrade ? null : gate}
            item={sheet ? (view.items.find((i) => i.item === sheet.item.item) ?? sheet.item) : null}
            side={sheet?.side ?? "buy"}
            view={view}
            me={me}
            onSide={(side) => setSheet((s) => (s ? { ...s, side } : s))}
            onClose={() => setSheet(null)}
            onTrade={run}
          />
          <ListSheet key={listItem ?? "any"} open={listing} view={view} me={me} initialItem={listItem} onClose={() => setListing(false)} onTrade={run} eyebrow={practice.on ? "Practice market · not on NEAR" : undefined} />
          <FillSheet key={filling?.id ?? 0} listing={filling} me={me} onClose={() => setFilling(null)} onTrade={run} />
        </>
      ) : null}
    </div>
  );
}
