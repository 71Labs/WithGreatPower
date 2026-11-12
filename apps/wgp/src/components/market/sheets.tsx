"use client";

/**
 * The market's sheets: buy or sell with the vendor (amount, live quote, the burned gas
 * fee and the slippage limit), list an item at your own price, and confirm buying a
 * listing. Quotes run the contract's math in the browser (src/lib/market/math.ts) on
 * the curve the server just read, so what you see is what the chain will charge, up to
 * the slippage limit if someone trades first.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { StickerButton } from "@/components/game/kit";
import { GameSheet } from "@/components/game/ui";
import { CircleAlert, Minus, Plus } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { ITEMS, RARITY_LABEL } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import type { ListingView, MarketItemView, MarketMe, MarketView, SimTradeRequest } from "@/lib/market/api";
import { afterBuy, afterSell, buyQuote, lessSlippage, listingBounds, sellQuote, spotMilli, withSlippage } from "@/lib/market/math";
import { explainPrice } from "@/lib/market/reasoning";

import { ITEM_SOURCE } from "./copy";
import { bitsText, formatBits, formatChange, formatPrice } from "./sparkline";
import type { TradeOutcome } from "./use-market";
import { VendorChips } from "./why-price";

/** How far the price may move against you before a trade refuses: 3%. */
export const SLIPPAGE_BPS = 300;

export type Side = "buy" | "sell";

const plural = (n: number, name: string) => `${formatBits(n)} ${name}`;

function Stepper({ id, label, value, min, max, onChange, invalid, describedBy }: { id: string; label: string; value: number; min: number; max: number; onChange(n: number): void; invalid?: boolean; describedBy?: string }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.floor(n) || min));
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold leading-4">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`One fewer`}
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 disabled:opacity-40 pointer-fine:hover:bg-game-paper-2"
        >
          <Minus aria-hidden className="size-5" strokeWidth={2.25} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="num h-11 w-20 rounded-[12px] border-2 border-game-ink bg-game-paper px-2 text-center text-[18px] font-bold focus-visible:outline-offset-2"
        />
        <button
          type="button"
          aria-label={`One more`}
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 disabled:opacity-40 pointer-fine:hover:bg-game-paper-2"
        >
          <Plus aria-hidden className="size-5" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

function Line({ label, value, strong = false, hint }: { label: string; value: ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? "text-[16px] font-bold" : "text-[14px]"}`}>
      <dt className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="text-[12px] font-normal leading-4 text-game-muted">{hint}</span> : null}
      </dt>
      <dd className="num shrink-0 text-right">{value}</dd>
    </div>
  );
}

function Problem({ id, text }: { id: string; text: string | null }) {
  // The message sits under the receipt; on a short screen it would land below the sheet's
  // fold, behind the footer button the player just tapped. Bring it into view.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (text) ref.current?.scrollIntoView({ block: "nearest" });
  }, [text]);
  return (
    <div ref={ref} id={id} role="status" aria-live="polite" className="empty:hidden scroll-mb-4">
      {text ? (
        <p className="flex items-start gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 text-[14px] leading-5">
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-game-hero" strokeWidth={2} />
          <span className="[text-wrap:pretty]">{text}</span>
        </p>
      ) : null}
    </div>
  );
}

function ItemHead({ item }: { item: MarketItemView }) {
  return (
    <span className="flex items-center gap-3">
      <MiniAvatar id={ITEM_SOURCE[item.item]} className="size-11 rounded-[12px]" />
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold leading-5">{item.name}</span>
        <span className="text-[12px] leading-4 text-game-muted">
          {RARITY_LABEL[item.rarity]} · {ITEMS[item.item].blurb}
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ buy and sell */

export function TradeSheet({
  item,
  side,
  view,
  me,
  onSide,
  onClose,
  onTrade,
}: {
  item: MarketItemView | null;
  side: Side;
  view: MarketView;
  me: MarketMe | null;
  onSide(side: Side): void;
  onClose(): void;
  onTrade(req: SimTradeRequest): Promise<TradeOutcome>;
}) {
  const ids = useId();
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = !!item;
  if (!item) return <GameSheet open={false} onClose={onClose} title="Trade" />;

  const fee = view.params.feeBps;
  const pool = item.pool;
  const held = me?.items[item.item] ?? 0;
  const bits = me?.bits ?? 0;
  const max = view.params.maxAmount;
  const buy = side === "buy" ? buyQuote(pool, amount, fee) : null;
  const sell = side === "sell" ? sellQuote(pool, amount, fee) : null;
  const after = buy ? afterBuy(pool, amount, buy.cost) : sell ? afterSell(pool, amount, sell.payout) : null;
  const move = after ? (spotMilli(after) - item.priceMilli) / item.priceMilli : 0;
  const limit = buy ? withSlippage(buy.total, SLIPPAGE_BPS) : sell ? lessSlippage(sell.net, SLIPPAGE_BPS) : 0;
  // Why the price is what it is, and whether Gwei can take this side of the trade at all.
  const why = explainPrice({ pool, open: view.params.open, feeBps: fee, change24h: item.change24h, trades24h: item.trades24h });
  const cant = side === "buy" ? why.buyBlocked : why.sellBlocked;

  function blocker(): string | null {
    if (!me) return "Sign in to trade.";
    if (side === "buy") {
      if (!buy) return `The vendor has only ${plural(pool.stock, item!.name)} in stock.`;
      if (buy.total > bits) return `You need ${formatBits(buy.total - bits)} more Bits for that.`;
      if (me.tradesLeft <= 0) return "That’s today’s vendor trades used up. The market resets at midnight UTC.";
      return null;
    }
    if (held < amount) return held === 0 ? `You don’t have any ${item!.name} to sell.` : `You have only ${formatBits(held)} to sell.`;
    if (!sell) return "The vendor’s till can’t pay for that many. Try fewer.";
    // The contract would take the item and pay nothing once the fee is out.
    if (sell.net < 1) return "That’s worth less than a Bit after the gas fee. Sell more at once, or keep it.";
    if (me.tradesLeft <= 0) return "That’s today’s vendor trades used up. The market resets at midnight UTC.";
    return null;
  }

  async function submit() {
    const why = blocker();
    setProblem(why);
    if (why) return;
    setBusy(true);
    const res = await onTrade(
      side === "buy" ? { action: "buy", item: item!.item, amount, maxBits: limit } : { action: "sell", item: item!.item, amount, minBits: limit },
    );
    setBusy(false);
    if (res.ok) {
      setAmount(1);
      onClose();
    } else setProblem(res.message);
  }

  const verb = side === "buy" ? "Buy" : "Sell";
  const total = buy?.total ?? sell?.net ?? null;
  return (
    <GameSheet
      open={open}
      onClose={() => {
        setProblem(null);
        onClose();
      }}
      eyebrow="Mempool Market"
      title={`${verb} ${item.name}`}
      footer={
        <StickerButton variant="hero" size="lg" onClick={submit} disabled={busy || cant !== null} aria-describedby={cant !== null ? `${ids}-cant` : `${ids}-problem`} className="w-full sm:w-auto">
          {busy ? (side === "buy" ? "Buying…" : "Selling…") : total !== null ? `${verb} ${formatBits(amount)} for ${bitsText(total)}` : `${verb} ${formatBits(amount)}`}
        </StickerButton>
      }
    >
      <div className="flex flex-col gap-5">
        <ItemHead item={item} />
        <div className="flex flex-col gap-2 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Gwei says</p>
          <p className="num text-[14px] font-semibold leading-5 [text-wrap:pretty]">“{why.headline}”</p>
          <VendorChips reasoning={why} />
          <p className="num text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">{why.reasons[0]}</p>
        </div>
        <div role="group" aria-label="Buy or sell" className="grid grid-cols-2 gap-1 rounded-full border-2 border-game-ink bg-game-paper p-1 shadow-[var(--game-shadow-sm)]">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => {
                setProblem(null);
                onSide(s);
              }}
              className={`h-11 rounded-full text-[15px] font-semibold focus-visible:outline-offset-2 ${side === s ? "bg-game-ink text-game-paper" : "pointer-fine:hover:bg-game-paper-2"}`}
            >
              {s === "buy" ? "Buy from Gwei" : "Sell to Gwei"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Stepper id={`${ids}-amount`} label="How many" value={amount} min={1} max={max} onChange={(n) => (setAmount(n), setProblem(null))} invalid={!!problem} describedBy={`${ids}-problem`} />
          <p className="num text-right text-[13px] leading-5 text-game-muted">
            You have {formatBits(held)} · {formatBits(bits)} Bits
            <br />
            In stock {formatBits(pool.stock)}
          </p>
        </div>
        <dl className="flex flex-col divide-y-2 divide-dashed divide-game-ink/15 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-1">
          <Line label="Price now" value={`${formatPrice(item.priceMilli)} Bits each`} />
          {buy ? (
            <>
              <Line label="Cost on the curve" value={`${bitsText(buy.cost)}`} />
              <Line label={`Gas fee (${fee / 100}%)`} hint="Burned. Nobody gets it." value={`${bitsText(buy.fee)}`} />
              <Line label="You pay" strong value={`${bitsText(buy.total)}`} />
            </>
          ) : null}
          {sell ? (
            <>
              <Line label="The vendor pays" value={`${bitsText(sell.payout)}`} />
              <Line label={`Gas fee (${fee / 100}%)`} hint="Burned. Nobody gets it." value={`−${bitsText(sell.fee)}`} />
              <Line label="You get" strong value={`${bitsText(sell.net)}`} />
            </>
          ) : null}
          {after ? <Line label="Price after your trade" value={`${formatPrice(spotMilli(after))} (${formatChange(move)})`} /> : null}
          {buy || sell ? (
            <Line
              label={side === "buy" ? "At most" : "At least"}
              hint="If someone trades first and the price moves past this, nothing happens."
              value={`${bitsText(limit)}`}
            />
          ) : null}
        </dl>
        {/* The button below is off while Gwei can't take this side; say why where it can be read. */}
        {cant !== null ? (
          <p id={`${ids}-cant`} className="flex items-start gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 text-[14px] leading-5">
            <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-game-hero" strokeWidth={2} />
            <span className="[text-wrap:pretty]">{cant}</span>
          </p>
        ) : null}
        <Problem id={`${ids}-problem`} text={problem} />
      </div>
    </GameSheet>
  );
}

/* ------------------------------------------------------------------ list an item */

export function ListSheet({
  open,
  view,
  me,
  onClose,
  onTrade,
}: {
  open: boolean;
  view: MarketView;
  me: MarketMe | null;
  onClose(): void;
  onTrade(req: SimTradeRequest): Promise<TradeOutcome>;
}) {
  const ids = useId();
  const held = view.items.filter((i) => (me?.items[i.item] ?? 0) > 0);
  const [choice, setChoice] = useState<ItemId | null>(null);
  const [amount, setAmount] = useState(1);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const item = held.find((i) => i.item === choice) ?? held[0] ?? null;
  const have = item ? (me?.items[item.item] ?? 0) : 0;
  const n = Math.min(amount, Math.max(1, Math.min(have, view.params.maxAmount)));
  const [floor, ceiling] = item ? listingBounds(item.pool, n, view.params.floorBps, view.params.ceilingBps) : [1, 1];
  const suggested = item ? Math.max(floor, Math.round((item.priceMilli * n) / 1000)) : 1;
  const asking = price ?? suggested;
  const fee = Math.ceil((asking * view.params.feeBps) / 10_000);

  function close() {
    setProblem(null);
    setPrice(null);
    onClose();
  }

  async function submit() {
    if (!item) return;
    const why =
      asking < floor || asking > ceiling
        ? `Price it between ${formatBits(floor)} and ${bitsText(ceiling)}.`
        : asking - fee < 1
          ? `At that price the gas fee takes it all. Ask ${bitsText(fee + 1)} or more.`
          : me && me.listingsLeft <= 0
            ? "That’s today’s listings used up. The market resets at midnight UTC."
            : me && me.open.length >= view.params.maxOpenListings
              ? `You can have ${view.params.maxOpenListings} listings up at once. Take one down first.`
              : null;
    setProblem(why);
    if (why) return;
    setBusy(true);
    const res = await onTrade({ action: "list", item: item.item, amount: n, price: asking });
    setBusy(false);
    if (res.ok) close();
    else setProblem(res.message);
  }

  return (
    <GameSheet
      open={open}
      onClose={close}
      eyebrow="Mempool Market"
      title="List an item"
      description="Your items wait in escrow until someone buys them or you take them down."
      footer={
        item ? (
          <StickerButton variant="hero" size="lg" onClick={submit} disabled={busy} className="w-full sm:w-auto">
            {busy ? "Listing…" : `List ${formatBits(n)} ${item.name} for ${bitsText(asking)}`}
          </StickerButton>
        ) : undefined
      }
    >
      {!item ? (
        <p className="text-[15px] leading-6 [text-wrap:pretty]">You have nothing to list yet. Catch a villain tonight and bring back the loot.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-semibold leading-4">What to sell</legend>
            <div className="flex flex-wrap gap-2">
              {held.map((i) => {
                const on = i.item === item.item;
                return (
                  <label
                    key={i.item}
                    className={`relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-game-ink pl-1 pr-3.5 text-[14px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${on ? "bg-game-ink text-game-paper" : "bg-game-paper pointer-fine:hover:bg-game-paper-2"}`}
                  >
                    <input
                      type="radio"
                      name={`${ids}-item`}
                      value={i.item}
                      checked={on}
                      onChange={() => {
                        setChoice(i.item);
                        setAmount(1);
                        setPrice(null);
                        setProblem(null);
                      }}
                      className="sr-only"
                    />
                    <MiniAvatar id={ITEM_SOURCE[i.item]} className="size-8 rounded-full" />
                    {i.name}
                    <span className="num font-normal">×{formatBits(me?.items[i.item] ?? 0)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Stepper id={`${ids}-amount`} label="How many" value={n} min={1} max={Math.max(1, Math.min(have, view.params.maxAmount))} onChange={(v) => (setAmount(v), setPrice(null))} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-price`} className="text-[13px] font-semibold leading-4">
              Price for the lot, in Bits
            </label>
            <input
              id={`${ids}-price`}
              type="number"
              inputMode="numeric"
              min={floor}
              max={ceiling}
              value={asking}
              aria-invalid={!!problem || undefined}
              aria-describedby={`${ids}-price-hint ${ids}-problem`}
              onChange={(e) => {
                setPrice(Math.max(0, Math.floor(Number(e.target.value)) || 0));
                setProblem(null);
              }}
              className="num h-11 w-36 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 text-[18px] font-bold focus-visible:outline-offset-2"
            />
            <p id={`${ids}-price-hint`} className="num text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
              Between {formatBits(floor)} and {formatBits(ceiling)} Bits: half to four times Gwei’s price, so a stolen key can’t sell your loot for nothing. Gwei’s price for {formatBits(n)} is about {formatBits(Math.round((item.priceMilli * n) / 1000))}.
            </p>
          </div>
          <dl className="flex flex-col divide-y-2 divide-dashed divide-game-ink/15 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-1">
            <Line label={`Gas fee when it sells (${view.params.feeBps / 100}%)`} hint="Burned from your proceeds." value={`−${bitsText(fee)}`} />
            <Line label="You get when it sells" strong value={`${bitsText(Math.max(0, asking - fee))}`} />
          </dl>
          <Problem id={`${ids}-problem`} text={problem} />
        </div>
      )}
    </GameSheet>
  );
}

/* ------------------------------------------------------------------ buy a listing */

export function FillSheet({ listing, me, onClose, onTrade }: { listing: ListingView | null; me: MarketMe | null; onClose(): void; onTrade(req: SimTradeRequest): Promise<TradeOutcome> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!listing) return <GameSheet open={false} onClose={onClose} title="Buy a listing" />;
  const seller = listing.seller.split(".")[0];

  async function submit() {
    const why = !me
      ? "Sign in to trade."
      : me.bits < listing!.price
        ? `You need ${formatBits(listing!.price - me.bits)} more Bits for that.`
        : me.fillsLeft <= 0 || me.fillBitsLeft < listing!.price
          ? "That’s today’s limit for buying from players. It resets at midnight UTC."
          : null;
    setProblem(why);
    if (why) return;
    setBusy(true);
    const res = await onTrade({ action: "fill", listingId: listing!.id });
    setBusy(false);
    if (res.ok) onClose();
    else setProblem(res.message);
  }

  return (
    <GameSheet
      open
      onClose={() => {
        setProblem(null);
        onClose();
      }}
      eyebrow="Player listing"
      title={`Buy ${formatBits(listing.amount)} ${listing.name}?`}
      description={`From ${seller}. They get the price less the gas fee, and the items come straight to you.`}
      footer={
        <StickerButton variant="hero" size="lg" onClick={submit} disabled={busy} className="w-full sm:w-auto">
          {busy ? "Buying…" : `Buy for ${bitsText(listing.price)}`}
        </StickerButton>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col divide-y-2 divide-dashed divide-game-ink/15 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-1">
          <Line label="Each" value={`${formatPrice(listing.unitMilli)} Bits`} />
          <Line label="Against Gwei’s price" value={listing.vsSpot >= 1 ? `${formatChange(listing.vsSpot - 1)} over` : `${formatChange(1 - listing.vsSpot).replace("+", "")} under`} />
          <Line label="You pay" strong value={`${bitsText(listing.price)}`} />
          <Line label="Your Bits after" value={formatBits(Math.max(0, (me?.bits ?? 0) - listing.price))} />
        </dl>
        <Problem id="fill-problem" text={problem} />
      </div>
    </GameSheet>
  );
}
