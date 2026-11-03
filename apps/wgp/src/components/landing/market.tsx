import Link from "next/link";
import type { ReactNode } from "react";

import { Chip, InlineTwoTone, Section } from "@/components/frame";
import { StickerLink } from "@/components/game/kit";
import { ArrowRight, ChartLine, Coins, Flame, KeyRound, Tag } from "@/components/icons";
import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { afterBuy, buyCost, spot } from "@/lib/market/math";
import { BITS_FOR_SHOWING_UP, BITS_PER_SCORE } from "@/lib/market/rewards";
import { ITEMS } from "@wgp/game-core/data";

import { PriceCurve, type CurvePoint } from "./price-curve";

const ITEM = "fee-bomb";

/** Gwei's spot price for a fee bomb as players buy her whole stock, one at a time, on the contract's own math. */
function buyOut(): CurvePoint[] {
  let pool = seededPools().find((p) => p.item === ITEM)!;
  const points: CurvePoint[] = [{ bought: 0, price: spot(pool) }];
  for (let bought = 1; pool.stock > 0; bought++) {
    pool = afterBuy(pool, 1, buyCost(pool, 1)!);
    points.push({ bought, price: spot(pool) });
  }
  return points;
}

const fee = `${DEFAULT_PARAMS.feeBps / 100}%`;

const features: { icon: ReactNode; text: ReactNode }[] = [
  {
    icon: <Coins strokeWidth={2} />,
    text: (
      <>
        Every verified night pays Bits: your score ÷ {BITS_PER_SCORE}, plus {BITS_FOR_SHOWING_UP} for showing up.
      </>
    ),
  },
  { icon: <ChartLine strokeWidth={2} />, text: "Gwei Stacy’s prices ride a bonding curve. Buy and they climb; sell and they fall." },
  { icon: <Tag strokeWidth={2} />, text: "List your loot for other players at a price you set, between half and four times Gwei’s." },
  { icon: <Flame strokeWidth={2} />, text: `A ${fee} fee on every trade is burned, so Bits don’t pile up forever.` },
  { icon: <KeyRound strokeWidth={2} />, text: "Trades sign with a session key and our relayer pays the gas. No pop-ups." },
];

export function Market() {
  const item = ITEMS[ITEM].name;
  return (
    <Section id="market" labelledBy="market-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 xl:gap-24">
        <div className="flex flex-col items-start">
          <Chip>The Mempool Market</Chip>
          <InlineTwoTone id="market-title" className="mt-6 max-w-[18ch]" lead="No patch notes." point="Players move the prices." />
          <p className="mt-5 max-w-[56ch] text-[17px] leading-7 text-ink-subtle">
            Loot from your nights has a price, and nobody at the studio sets it. Supply and demand at Gwei’s stall do.
          </p>
          <ul className="mt-10 flex flex-col gap-4">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-4 text-[16px] leading-6 text-ink">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-[10px] border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] [&>svg]:size-[18px]"
                >
                  {f.icon}
                </span>
                <span className="pt-1.5">{f.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <StickerLink href="/play/market" variant="paper" size="md">
              Open the market
            </StickerLink>
            <Link
              href="/lab/economy"
              className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-ink-strong underline decoration-hairline-strong underline-offset-4 [@media(hover:hover)]:hover:decoration-current"
            >
              Fast-forward the economy
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>

        <figure className="rounded-[22px] border-[2.5px] border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)] [--vs-focus:var(--game-hero)] sm:p-6 lg:order-first">
          <figcaption className="flex flex-col gap-1 pb-4">
            <span className="font-display text-[20px] font-medium leading-6 tracking-[-0.02em]">Gwei’s price for a {item.toLowerCase()}</span>
            <span className="text-[14px] leading-5 text-game-muted">
              The spot price in Bits as players buy out her stock, on the same math as the contract.
            </span>
          </figcaption>
          <PriceCurve points={buyOut()} item={item} />
        </figure>
      </div>
    </Section>
  );
}
