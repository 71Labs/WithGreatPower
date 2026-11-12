"use client";

/**
 * Investing in a merchant, on screen (src/lib/market/invest.ts holds the rules): the line
 * on each item's card that says when Gwei's shop is closed and why, with the way to
 * reopen her; the sheet where a player invests, withdraws and claims, which states what
 * they risk before they confirm; the player's stakes; and the practice market's banner.
 *
 * The same components serve all three places investing can run: the practice market (in
 * the browser), the simulated market (the server) and a v3 contract. On contract v2, which
 * is what mainnet runs today, nothing here offers investing: a closed shop shows its reason
 * and one honest sentence about v3, with a way into practice.
 */
import { useEffect, useId, useRef, useState } from "react";

import { StickerButton, StickerPanel } from "@/components/game/kit";
import { GameSheet } from "@/components/game/ui";
import { CircleAlert, HandCoins, KeyRound, Lock, RotateCcw, TestTube, TriangleAlert } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import type { MarketItemView, MarketMe, MarketView, StakeRequest } from "@/lib/market/api";
import { bitsText, feeText } from "@/lib/market/format";
import { closedText, INVEST_RISKS, shopOf, unlocksIn, type Shop, type StakeView } from "@/lib/market/invest";
import { PRACTICE_INVEST_RULES, PRACTICE_LABEL, PRACTICE_START_BITS } from "@/lib/market/practice";
import type { InvestingState } from "@/lib/market/reasoning-shop";
import { INVEST_NOT_LIVE } from "@/lib/market/refusal";

import { ITEM_SOURCE } from "./copy";
import type { TradeGate } from "./sheets";
import { formatBits } from "./sparkline";
import type { TradeOutcome } from "./use-market";

/**
 * Where investing stands on the market being shown:
 * - "available": it takes investors (practice, simulated, or contract v3 with investing on);
 * - "paused": contract v3 with investing switched off (stakes still come out);
 * - "not-live": contract v2, which has no investing (mainnet today).
 */
export type Investing = InvestingState;

export const investingOf = (view: Pick<MarketView, "params">): Investing => (view.params.invest ? (view.params.invest.open ? "available" : "paused") : "not-live");

/** A stall as the contract (v3) said it, or the same worked out from the item's pool. */
export const shopFor = (view: Pick<MarketView, "shops" | "params">, item: MarketItemView): Shop => view.shops?.find((s) => s.item === item.item) ?? shopOf(item.pool, view.params.open);

const lockText = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1_000)} seconds` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 3_600_000)} hours`);

const chip = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink pl-1 pr-2 text-[12px] font-bold leading-none text-game-ink";
const textButton =
  "inline-flex min-h-8 items-center gap-1 rounded-[8px] text-start text-[12px] font-semibold leading-4 text-game-ink underline decoration-game-ink/40 underline-offset-[3px] [text-decoration-skip-ink:auto] focus-visible:outline-offset-2 pointer-coarse:min-h-11 pointer-fine:hover:decoration-game-ink";
/** The card's own button face (as its Buy and Sell): narrow enough for two columns on a phone. */
const cardAction =
  "inline-flex h-11 w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[12px] border-2 border-game-ink px-2 text-[14px] font-semibold shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none";

/* ------------------------------------------------------------------ on an item's card */

/**
 * Under an item's Buy and Sell: whether Gwei's shop for it is closed and why, the player's
 * stake if they have one, and the way to invest (or, on v2, the sentence about v3).
 */
export function ShopLine({
  item,
  shop,
  investing,
  stake,
  inPractice,
  onInvest,
  onPractice,
}: {
  item: MarketItemView;
  shop: Shop;
  investing: Investing;
  stake: StakeView | null;
  inPractice: boolean;
  /** Opens the invest sheet for this item. */
  onInvest(tab: "invest" | "withdraw"): void;
  /** Steps into the practice market (shown on v2 only). */
  onPractice(): void;
}) {
  const broke = shop.closed.includes("broke");
  const paused = shop.closed.includes("paused") || shop.closed.includes("market-closed");
  return (
    <div className="flex flex-col gap-1.5 border-t-2 border-dashed border-game-ink/15 pt-2">
      {broke && !paused ? (
        <>
          <p className="flex flex-wrap gap-1.5">
            <span className={`${chip} bg-game-gold`}>
              <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
              Closed for buying
            </span>
          </p>
          <p className="num text-[12px] leading-4 [text-wrap:pretty]">
            {closedText("broke")} Her till is {bitsText(shop.needs)} short of one.
          </p>
        </>
      ) : null}
      {stake ? (
        <p className="num text-[12px] font-semibold leading-4 [text-wrap:pretty]">
          Your stake: {bitsText(stake.bits)}
          {stake.earned > 0 ? ` · ${formatBits(stake.earned)} earned` : ""}
        </p>
      ) : null}
      {investing === "available" ? (
        <button type="button" onClick={() => onInvest("invest")} className={`${cardAction} ${broke ? "bg-game-ink text-game-paper pointer-fine:hover:bg-game-ink-2" : "bg-game-paper text-game-ink pointer-fine:hover:bg-game-paper-2"}`}>
          <HandCoins aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          Invest in Gwei
          <span className="sr-only">’s till for {item.name}</span>
        </button>
      ) : null}
      {stake && investing !== "not-live" ? (
        <button type="button" onClick={() => onInvest("withdraw")} className={textButton}>
          Withdraw or claim
          <span className="sr-only"> your stake in {item.name}</span>
        </button>
      ) : null}
      {investing === "paused" && broke ? <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">Gwei isn’t taking new investors right now. Buy one from her and she can buy again.</p> : null}
      {investing === "not-live" && broke ? (
        <>
          <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">{INVEST_NOT_LIVE}</p>
          {inPractice ? null : (
            <button type="button" onClick={onPractice} className={textButton}>
              Open the practice market
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the player's stakes */

export function StakesPanel({ view, me, now, onManage }: { view: MarketView; me: MarketMe | null; now: number; onManage(item: ItemId): void }) {
  const stakes = me?.investor?.stakes ?? [];
  if (stakes.length === 0) return null;
  return (
    <StickerPanel as="section" aria-labelledby="stakes-title" className="flex flex-col gap-2 p-3 sm:p-4">
      <h2 id="stakes-title" className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        Your stakes in Gwei
      </h2>
      <ul className="flex flex-col divide-y-2 divide-dashed divide-game-ink/10">
        {stakes.map((s) => {
          const item = view.items.find((i) => i.item === s.item);
          if (!item) return null;
          const wait = unlocksIn(s.unlocksAtMs, now);
          return (
            <li key={s.item} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
              <MiniAvatar id={ITEM_SOURCE[item.item]} className="size-10 shrink-0 rounded-[11px]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="num text-[15px] font-semibold leading-5">
                  {bitsText(s.bits)} in her {item.name} till
                </p>
                <p className="num text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
                  {formatBits(s.earned)} earned from fees ·{" "}
                  {wait ? `locked for ${wait}` : s.withdrawable >= s.bits ? "unlocked, all of it can come out" : s.withdrawable > 0 ? `unlocked, ${formatBits(s.withdrawable)} can come out now` : "unlocked, waiting for her till to refill"}
                </p>
              </div>
              <StickerButton size="sm" onClick={() => onManage(item.item)} className="max-sm:w-full">
                Withdraw or claim
                <span className="sr-only"> your {item.name} stake</span>
              </StickerButton>
            </li>
          );
        })}
      </ul>
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ the sheet */

function Row({ label, value, strong = false, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? "text-[15px] font-bold" : "text-[14px]"}`}>
      <dt className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="text-[12px] font-normal leading-4 text-game-muted [text-wrap:pretty]">{hint}</span> : null}
      </dt>
      <dd className="num shrink-0 text-right">{value}</dd>
    </div>
  );
}

function Problem({ id, text }: { id: string; text: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (text) ref.current?.scrollIntoView({ block: "nearest" });
  }, [text]);
  return (
    <div ref={ref} id={id} role="status" aria-live="polite" className="scroll-mb-4 empty:hidden">
      {text ? (
        <p className="flex items-start gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 text-[14px] leading-5">
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-game-hero" strokeWidth={2} />
          <span className="[text-wrap:pretty]">{text}</span>
        </p>
      ) : null}
    </div>
  );
}

type SheetTab = "invest" | "withdraw";

/**
 * Invest in one of Gwei's tills, withdraw a stake, or claim its earnings. The risks are
 * printed above the Invest button, always, so they are read before confirming. Remount it
 * with a new `key` per item and opening tab.
 */
export function InvestSheet({
  item,
  view,
  me,
  now,
  inPractice,
  initialTab = "invest",
  gate = null,
  onClose,
  onStake,
}: {
  item: MarketItemView | null;
  view: MarketView;
  me: MarketMe | null;
  /** Unix ms, for the lock. */
  now: number;
  inPractice: boolean;
  initialTab?: SheetTab;
  gate?: TradeGate | null;
  onClose(): void;
  onStake(req: StakeRequest): Promise<TradeOutcome>;
}) {
  const ids = useId();
  const [tab, setTab] = useState<SheetTab>(initialTab);
  const [typed, setTyped] = useState<number | null>(null);
  const [busy, setBusy] = useState<StakeRequest["action"] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const rules = view.params.invest;
  if (!item || !rules) return <GameSheet open={false} onClose={onClose} title="Invest in Gwei" />;

  const shop = shopFor(view, item);
  const broke = shop.closed.includes("broke");
  const stake = me?.investor?.stakes.find((s) => s.item === item.item) ?? null;
  const bits = me?.bits ?? 0;
  const investsLeft = me?.investor?.investsLeft ?? rules.dailyInvests;
  const bitsLeft = me?.investor?.investBitsLeft ?? rules.dailyBits;
  const wait = stake ? unlocksIn(stake.unlocksAtMs, now) : null;

  // What can go in right now, and a sensible first amount: enough to reopen her, if she is broke.
  const most = Math.max(0, Math.min(rules.max, shop.investRoom, bits, bitsLeft));
  const suggested = Math.min(most, Math.max(rules.min, broke ? shop.needs : Math.min(100, most)));
  const investAmount = typed ?? suggested;
  const withdrawAmount = typed ?? (stake ? Math.max(0, stake.withdrawable) : 0);
  const amount = tab === "invest" ? investAmount : withdrawAmount;

  function close() {
    setProblem(null);
    setTyped(null);
    onClose();
  }

  function blocker(): string | null {
    if (!me) return "Sign in to invest.";
    if (tab === "invest") {
      if (!rules!.open) return "Gwei isn’t taking new investors right now. Stakes can still be withdrawn.";
      if (shop.investRoom < rules!.min) return `Her till for ${item!.name} is fully funded. It can’t take more.`;
      if (amount < rules!.min || amount > rules!.max) return `You can invest ${formatBits(rules!.min)} to ${bitsText(rules!.max)} at a time.`;
      if (amount > shop.investRoom) return `Her till for ${item!.name} can take only ${bitsText(shop.investRoom)} more.`;
      if (amount > bits) return `You have ${bitsText(bits)}. Invest that many or fewer.`;
      if (investsLeft <= 0 || amount > bitsLeft) return "That’s today’s investing limit. It resets at midnight UTC.";
      return null;
    }
    if (!stake) return `You have no stake in her ${item!.name} till.`;
    if (wait) return `Your stake is locked for ${wait}. A stake unlocks ${lockText(rules!.lockMs)} after its last top-up.`;
    if (amount < 1 || amount > stake.bits) return `You have ${bitsText(stake.bits)} staked. Withdraw that many or fewer.`;
    if (amount > shop.till) {
      return shop.till === 0
        ? `Her till for ${item!.name} is empty right now, so your stake has to wait. It refills as players buy ${item!.name} from her.`
        : `Her till holds only ${bitsText(shop.till)} right now, so that’s the most you can withdraw. It refills as players buy ${item!.name} from her.`;
    }
    return null;
  }

  async function send(req: StakeRequest) {
    setBusy(req.action);
    const res = await onStake(req);
    setBusy(null);
    if (res.ok) {
      setTyped(null);
      setProblem(null);
      if (req.action !== "claim") close();
    } else setProblem(res.message);
  }

  function submit() {
    const why = blocker();
    setProblem(why);
    if (why) return;
    void send(tab === "invest" ? { action: "invest", item: item!.item, bits: amount } : { action: "withdraw", item: item!.item, bits: amount });
  }

  const share = `${rules.feeBps / 100}%`;
  const label = tab === "invest" ? (busy === "invest" ? "Investing…" : `Invest ${bitsText(amount)} in Gwei`) : busy === "withdraw" ? "Withdrawing…" : `Withdraw ${bitsText(amount)}`;
  return (
    <GameSheet
      open
      onClose={close}
      eyebrow={inPractice ? "Practice market · not on NEAR" : view.onChain ? "Mempool Market" : "Mempool Market · simulated"}
      title={`Invest in Gwei: ${item.name}`}
      description="Put Bits into her till for this item, so she can buy it from players. You earn a share of its gas fees."
      footer={
        gate ? (
          <StickerButton variant="hero" size="lg" onClick={gate.onAct} aria-describedby={`${ids}-gate`} className="w-full sm:w-auto">
            {gate.label}
          </StickerButton>
        ) : (
          // Enabled until it is sent; a refusal is explained under the form.
          <StickerButton variant="hero" size="lg" onClick={() => busy === null && submit()} aria-disabled={busy !== null || undefined} aria-busy={busy !== null || undefined} aria-describedby={`${ids}-problem`} className="num w-full sm:w-auto">
            {label}
          </StickerButton>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <span className="flex items-center gap-3">
          <MiniAvatar id={ITEM_SOURCE[item.item]} className="size-11 rounded-[12px]" />
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold leading-5">Gwei’s till for {item.name}</span>
            <span className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">{ITEMS[item.item].blurb}</span>
          </span>
        </span>

        <dl aria-label="The shop" className="flex flex-col divide-y-2 divide-dashed divide-game-ink/15 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-1">
          <Row label="Her shop for these" strong value={broke ? "Closed for buying" : shop.closed.includes("sold-out") ? "Sold out" : "Open"} hint={broke ? `Broke: her till is ${bitsText(shop.needs)} short of buying one.` : undefined} />
          <Row label="In her till" value={bitsText(shop.till)} />
          <Row label="Invested by players" value={bitsText(shop.invested)} />
          <Row label="Room for more" value={bitsText(shop.investRoom)} />
          {stake ? (
            <>
              <Row label="Your stake" strong value={bitsText(stake.bits)} />
              <Row label="Earned from fees" value={bitsText(stake.earned)} hint="Yours to claim at any time." />
              <Row
                label={wait ? "Unlocks in" : "You can withdraw now"}
                value={wait ?? bitsText(stake.withdrawable)}
                hint={wait ? `A stake unlocks ${lockText(rules.lockMs)} after its last top-up.` : stake.withdrawable < stake.bits ? "Her till holds less than your stake. The rest waits until players buy from her." : undefined}
              />
            </>
          ) : null}
        </dl>

        <div role="group" aria-label="Invest or withdraw" className="grid grid-cols-2 gap-1 rounded-full border-2 border-game-ink bg-game-paper p-1 shadow-[var(--game-shadow-sm)]">
          {(["invest", "withdraw"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => {
                setTab(t);
                setTyped(null);
                setProblem(null);
              }}
              className={`h-11 rounded-full text-[15px] font-semibold focus-visible:outline-offset-2 ${tab === t ? "bg-game-ink text-game-paper" : "pointer-fine:hover:bg-game-paper-2"}`}
            >
              {t === "invest" ? "Invest" : "Withdraw"}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-amount`} className="text-[13px] font-semibold leading-4">
            {tab === "invest" ? "Bits to invest" : "Bits to withdraw"}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`${ids}-amount`}
              data-autofocus
              type="number"
              inputMode="numeric"
              min={tab === "invest" ? rules.min : 1}
              max={tab === "invest" ? Math.max(rules.min, most) : (stake?.bits ?? 1)}
              value={amount}
              aria-invalid={!!problem || undefined}
              aria-describedby={`${ids}-hint ${ids}-problem`}
              onChange={(e) => {
                setTyped(Math.max(0, Math.floor(Number(e.target.value)) || 0));
                setProblem(null);
              }}
              className="num h-11 w-32 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 text-[18px] font-bold focus-visible:outline-offset-2"
            />
            {tab === "invest" && broke && shop.needs <= most ? (
              <StickerButton size="sm" onClick={() => (setTyped(Math.max(rules.min, shop.needs)), setProblem(null))}>
                Enough to reopen her
              </StickerButton>
            ) : null}
            {tab === "invest" && most >= rules.min ? (
              <StickerButton size="sm" onClick={() => (setTyped(most), setProblem(null))}>
                Use the most
              </StickerButton>
            ) : null}
            {tab === "withdraw" && stake ? (
              <StickerButton size="sm" onClick={() => (setTyped(Math.min(stake.bits, shop.till)), setProblem(null))}>
                Use the most
              </StickerButton>
            ) : null}
          </div>
          <p id={`${ids}-hint`} className="num text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
            {tab === "invest"
              ? `You have ${bitsText(bits)}. ${formatBits(rules.min)} to ${formatBits(rules.max)} at a time; today you can invest ${formatBits(investsLeft)} more ${investsLeft === 1 ? "time" : "times"}, up to ${bitsText(bitsLeft)}.`
              : stake
                ? `Your stake is ${bitsText(stake.bits)}. Withdrawing also pays out what it has earned.`
                : "You have no stake here yet."}
          </p>
        </div>

        {tab === "invest" ? (
          <>
            <ul className="num flex list-disc flex-col gap-1.5 ps-5 text-[13px] leading-[18px] marker:text-game-muted [text-wrap:pretty]">
              <li>Your Bits go into her till. The price doesn’t move: the same amount comes off the part of her curve nobody had funded.</li>
              <li>
                You earn {share} of the {feeText(view.params.feeBps)} gas fee on every trade of {item.name} with her, split by stake. The rest is burned.
              </li>
              <li>
                Your stake is yours, Bit for Bit. It is locked for {lockText(rules.lockMs)} after each top-up{inPractice ? " (an hour by default on NEAR)" : ""}.
              </li>
            </ul>
            {/* Said before the button, every time: what an investor risks. */}
            <section aria-labelledby={`${ids}-risk`} className="flex flex-col gap-2 rounded-[16px] border-2 border-game-ink bg-game-gold px-3.5 py-3">
              <h3 id={`${ids}-risk`} className="flex items-center gap-2 text-[14px] font-bold leading-5">
                <TriangleAlert aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
                What you risk
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 ps-5 text-[13px] font-medium leading-[18px] [text-wrap:pretty]">
                {INVEST_RISKS.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          </>
        ) : stake && stake.earned > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3">
            <p className="num text-[14px] leading-5 [text-wrap:pretty]">Take the {bitsText(stake.earned)} your stake has earned and leave the stake in.</p>
            <StickerButton size="sm" onClick={() => busy === null && void send({ action: "claim", item: item.item })} aria-disabled={busy !== null || undefined} className="num max-sm:w-full">
              {busy === "claim" ? "Claiming…" : `Claim ${bitsText(stake.earned)}`}
            </StickerButton>
          </div>
        ) : null}

        {gate ? (
          <p id={`${ids}-gate`} className="flex items-start gap-2 rounded-[14px] border-2 border-game-ink bg-game-gold px-3.5 py-3 text-[14px] font-medium leading-5">
            <KeyRound aria-hidden className="mt-px size-5 shrink-0" strokeWidth={2} />
            <span className="[text-wrap:pretty]">{gate.text}</span>
          </p>
        ) : null}
        <Problem id={`${ids}-problem`} text={problem} />
      </div>
    </GameSheet>
  );
}

/* ------------------------------------------------------------------ the practice market's banner */

/**
 * Always at the top of the practice market: what it is, in the same words everywhere
 * (`PRACTICE_LABEL`), where its prices came from, and its two controls.
 */
export function PracticeBanner({
  seededFrom,
  signedIn,
  drainName,
  onDrain,
  onReset,
  onLeave,
}: {
  seededFrom: "near" | "simulated" | "defaults" | null;
  signedIn: boolean;
  /** The item a staged crowd would empty the till of, or null when every shop is already broke. */
  drainName: string | null;
  onDrain(): void;
  onReset(): void;
  /** A signed-in player steps back to the real market. */
  onLeave(): void;
}) {
  const from = seededFrom === "near" ? "the live market on NEAR" : seededFrom === "simulated" ? "the simulated market" : "the market’s opening prices";
  return (
    <section aria-label="Practice market" className="flex flex-col gap-3 rounded-[18px] border-2 border-game-ink bg-game-gold p-3 text-game-ink shadow-[var(--game-shadow-sm)] sm:p-4">
      <div className="flex items-start gap-2.5">
        <TestTube aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.25} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[15px] font-bold leading-5 [text-wrap:balance]">{PRACTICE_LABEL}</p>
          <p className="num max-w-[72ch] text-[13px] font-medium leading-[18px] [text-wrap:pretty]">
            Same rules, your own copy: prices started from {from}. You trade with {formatBits(PRACTICE_START_BITS)} practice Bits plus what your guest nights would have paid, and with a copy of your loot. Nothing here changes your saved hero, and
            nothing here can be minted. A stake unlocks after {lockText(PRACTICE_INVEST_RULES.lockMs)} here.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {drainName ? (
          <StickerButton size="sm" onClick={onDrain} className="max-sm:w-full">
            <Lock aria-hidden className="size-4" strokeWidth={2} />
            Empty Gwei’s {drainName} till
          </StickerButton>
        ) : null}
        <StickerButton size="sm" onClick={onReset} className="max-sm:w-full">
          <RotateCcw aria-hidden className="size-4" strokeWidth={2} />
          Start practice over
        </StickerButton>
        {signedIn ? (
          <StickerButton size="sm" onClick={onLeave} className="max-sm:w-full">
            Go back to the real market
          </StickerButton>
        ) : null}
      </div>
    </section>
  );
}
