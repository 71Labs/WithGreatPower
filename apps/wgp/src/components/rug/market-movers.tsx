"use client";

/**
 * The Daily Rug's markets column: the Mempool Market's biggest movers of the last 24
 * hours, written up as Bearson would ("Goblin glider up 40%*", footnote and all), each
 * with its price, its move and a sparkline. A flat market gets a flat headline.
 */
import { useEffect, useState } from "react";

import { StickerLink } from "@/components/game/kit";
import { ArrowRight } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { FLAT_MARKET, ITEM_SOURCE, moverHeadline } from "@/components/market/copy";
import { ChangePill, formatPrice, Sparkline } from "@/components/market/sparkline";
import { plural } from "@/lib/plural";
import { getMarket, type MarketItemView } from "@/lib/market/api";

import { SectionHead } from "./shared";

/** Items that moved at least half a percent, biggest move first. Pure. */
export function topMovers(items: MarketItemView[], count = 3): MarketItemView[] {
  return items
    .filter((i) => i.change24h !== null && Math.abs(i.change24h) >= 0.005)
    .sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!))
    .slice(0, count);
}

export function MarketMovers() {
  const [items, setItems] = useState<MarketItemView[] | null>(null);
  const [onChain, setOnChain] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getMarket(controller.signal)
      .then((res) => {
        if (!res.ok) return;
        setItems(res.data.items);
        setOnChain(res.data.onChain);
      })
      // Leaving the page aborts the request; nothing to show then.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!items) return null;
  const movers = topMovers(items);
  return (
    <section aria-labelledby="markets-title" className="flex flex-col gap-3">
      <SectionHead
        id="markets-title"
        aside={<span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-game-muted">{onChain ? "Live from NEAR" : "Simulated market"}</span>}
      >
        The markets
      </SectionHead>
      {movers.length === 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-[22px] font-bold uppercase leading-6 tracking-[-0.02em] text-game-ink [text-wrap:balance]">{FLAT_MARKET.headline}</h3>
          <p className="text-[13px] leading-[18px] text-game-muted">{FLAT_MARKET.footnote}</p>
        </div>
      ) : (
        <ol className="grid gap-4 md:grid-cols-3 md:gap-5">
          {movers.map((m) => {
            const h = moverHeadline(m.item, m.name, m.change24h!);
            return (
              <li key={m.item} className="flex min-w-0 flex-col gap-2">
                <h3 className="font-display text-[20px] font-bold uppercase leading-[22px] tracking-[-0.02em] text-game-ink [overflow-wrap:anywhere] [text-wrap:balance]">{h.headline}</h3>
                <div className="flex items-center gap-2.5">
                  <MiniAvatar id={ITEM_SOURCE[m.item]} className="size-8 rounded-[9px]" />
                  <p className="num flex min-w-0 flex-1 flex-col text-[13px] leading-[18px]">
                    <span className="font-semibold">{formatPrice(m.priceMilli)} Bits</span>
                    <span className="text-game-muted">{plural(m.trades24h, "trade")} in 24 h</span>
                  </p>
                  <ChangePill change={m.change24h} />
                </div>
                <Sparkline points={m.spark} steps={m.sparkSteps} className="h-8 w-full" label={`${m.name} over 24 hours`} />
                <p className="text-[12px] leading-4 text-game-muted">{h.footnote}</p>
              </li>
            );
          })}
        </ol>
      )}
      <StickerLink href="/play/market" size="sm" className="self-start">
        Open the Mempool Market
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
      </StickerLink>
    </section>
  );
}
