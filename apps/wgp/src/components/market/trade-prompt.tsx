"use client";

/**
 * Trade prompts on screen: the one next market step, shown where the player decides what
 * to do with their loot. `TradePromptCard` is the card (the night's results, the market's
 * own top); `PartOffers` is the Suit lab's "Buy from Gwei" line per missing part and
 * `SpareOffers` its "List your spares". Every one links into the market with the trade
 * sheet prefilled (src/lib/market/prompts.ts), and every number is the contract's quote
 * on the pools the server just read.
 */
import type { ReactNode } from "react";

import { StickerButton, StickerLink } from "@/components/game/kit";
import { ArrowRight, Store, Tag } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { bitsText } from "@/lib/market/format";
import { holdingsOf, nextTrade, partOffers, promptCopy, spareItems, tradeHref, type Holdings, type MarketFacts, type SuitGap, type TradePrompt } from "@/lib/market/prompts";

import { ITEM_SOURCE } from "./copy";
import { useMarketPeek } from "./use-market-peek";

/** The prompt for a save, from one look at the market. Null until the market answers, and when there's nothing to offer. */
export function useTradePrompt(save: Parameters<typeof holdingsOf>[0] | null): { prompt: TradePrompt | null; signedIn: boolean; settled: boolean } {
  const peek = useMarketPeek();
  if (!save || !peek.view) return { prompt: null, signedIn: peek.signedIn, settled: peek.settled };
  // Signed in, a buy is measured against the wallet with tonight's Bits counted in; a guest just sees the price.
  const bits = peek.signedIn ? (peek.me ? peek.me.bits + peek.me.pendingBits : null) : null;
  return { prompt: nextTrade(holdingsOf(save), peek.view, bits), signedIn: peek.signedIn, settled: peek.settled };
}

/**
 * One prompt: what's true, then the one button. A link into the market by default; pass
 * `onAct` on the market itself to open the sheet in place.
 */
export function TradePromptCard({ prompt, eyebrow = "Your next trade", onAct, className = "" }: { prompt: TradePrompt; eyebrow?: string; onAct?: () => void; className?: string }) {
  const copy = promptCopy(prompt);
  const action = (
    <>
      {copy.action}
      <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
    </>
  );
  return (
    <section
      aria-label={eyebrow}
      className={`flex flex-col gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper-2 p-3 text-game-ink sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <MiniAvatar id={ITEM_SOURCE[prompt.intent.item]} className="size-10 shrink-0 rounded-[11px]" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{eyebrow}</p>
          <p className="num text-[14px] font-semibold leading-5 [text-wrap:pretty]">{copy.title}</p>
          {copy.note ? <p className="num text-[12px] leading-4 text-game-muted [text-wrap:pretty]">{copy.note}</p> : null}
        </div>
      </div>
      {onAct ? (
        <StickerButton variant="hero" size="sm" onClick={onAct} className="num w-full sm:w-auto">
          {action}
        </StickerButton>
      ) : (
        <StickerLink variant="hero" size="sm" href={tradeHref(prompt.intent)} className="num w-full sm:w-auto">
          {action}
        </StickerLink>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ the Suit lab */

function OfferRow({ item, children, action }: { item: ItemId; children: ReactNode; action: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
      <span className="flex min-w-0 items-center gap-2.5">
        <MiniAvatar id={ITEM_SOURCE[item]} className="size-8 shrink-0 rounded-[9px]" />
        <span className="num min-w-0 text-[13px] leading-[18px] [text-wrap:pretty]">{children}</span>
      </span>
      {action}
    </li>
  );
}

/**
 * A locked recipe's way out: one "Buy from Gwei" per missing part, at her price for the
 * whole shortfall. When she can't sell it, her own reason is printed and the row points
 * at the players' listings instead.
 */
export function PartOffers({ gap, market, onNavigate }: { gap: SuitGap; market: MarketFacts; onNavigate?: () => void }) {
  const offers = partOffers(gap, market);
  if (offers.length === 0) return null;
  return (
    <section aria-label="Buy the missing parts" className="flex flex-col rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-3 py-1">
      <ul className="flex flex-col divide-y-2 divide-dashed divide-game-ink/15">
        {offers.map(({ item, short, offer }) => {
          const name = ITEMS[item].name;
          if (offer?.ok) {
            return (
              <OfferRow
                key={item}
                item={item}
                action={
                  <StickerLink variant="hero" size="sm" href={tradeHref({ kind: "trade", item, side: "buy", amount: short })} onClick={onNavigate} className="num max-sm:w-full">
                    Buy from Gwei · {bitsText(offer.cost)}
                  </StickerLink>
                }
              >
                <span className="font-semibold">
                  {name} ×{short}
                </span>{" "}
                short. Gwei has {short === 1 ? "one" : "them"} in stock.
              </OfferRow>
            );
          }
          return (
            <OfferRow
              key={item}
              item={item}
              action={
                <StickerLink size="sm" href="/play/market" onClick={onNavigate} className="max-sm:w-full">
                  <Store aria-hidden className="size-4" strokeWidth={2} />
                  See the market
                </StickerLink>
              }
            >
              <span className="font-semibold">
                {name} ×{short}
              </span>{" "}
              short. {offer ? offer.reason : "Gwei doesn’t stock it."} A player may have listed one.
            </OfferRow>
          );
        })}
      </ul>
    </section>
  );
}

/** Loot no recipe the player still lacks would use, each with a link that opens the listing sheet on it. */
export function SpareOffers({ holdings, onNavigate, className = "" }: { holdings: Holdings; onNavigate?: () => void; className?: string }) {
  const spares = Object.entries(spareItems(holdings)) as [ItemId, number][];
  if (spares.length === 0) return null;
  const [item] = spares.reduce((best, s) => (s[1] > best[1] ? s : best), spares[0]!);
  const text = spares.map(([id, n]) => `${ITEMS[id].name} ×${n}`).join(", ");
  return (
    <p className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px] leading-[18px] ${className}`}>
      <span className="num min-w-0 [text-wrap:pretty]">
        <span className="font-semibold">Spare loot:</span> {text}. No suit you’re missing uses it.
      </span>
      <StickerLink size="sm" href={tradeHref({ kind: "list", item })} onClick={onNavigate} className="max-sm:w-full">
        <Tag aria-hidden className="size-4" strokeWidth={2} />
        List your spares
      </StickerLink>
    </p>
  );
}
