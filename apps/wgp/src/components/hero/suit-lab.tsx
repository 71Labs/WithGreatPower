"use client";

/**
 * The suit lab: loot, every suit, and crafting or changing into one. Signed in, each
 * change shows where it landed (src/game/chain.ts): on NEAR with quick play on, or
 * "saved, not yet on chain" without it, next to the offer to turn quick play on.
 *
 * Crafting a suit with a recipe burns the market's `craft_bits` (src/lib/market/craft.ts;
 * 0 on mainnet today, and then nothing below shows). When it is set, every recipe prints
 * the cost, and Craft is off with the reason in words while the player can't pay it.
 */
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { openAccountSheet } from "@/components/account/sheet-state";
import { HeroArt } from "@/components/cast";
import { StickerButton, StickerFrame, StickerLink, StickerPanel, stickerTileClass } from "@/components/game/kit";
import { GameLoading, GameSheet, useHeroSave, type HeroSave } from "@/components/game/ui";
import { ArrowRight, Check, CircleDashed, Coins, ExternalLink, Hourglass, Lock, Shirt, Sparkles, X, Zap, type Icon } from "@/components/icons";
import { SuitShare } from "@/components/first-minute/suit-share";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { PartOffers, SpareOffers } from "@/components/market/trade-prompt";
import { useMarketPeek } from "@/components/market/use-market-peek";
import { craftCost, craftGate, type CraftGate, type CraftWallet } from "@/lib/market/craft";
import { bitsText, formatBits } from "@/lib/market/format";
import { holdingsOf, suitGaps, type MarketFacts } from "@/lib/market/prompts";
import type { CastId } from "@wgp/game-core/cast";
import { ITEMS, RARITY_LABEL, STARTER_UNLOCK_LEVEL, SUITS } from "@wgp/game-core/data";
import { craftShortfall } from "@wgp/game-core/engine";
import { clearActivity, refreshChain, useChain, useChainActivity, type ChainActivity, type ChainView } from "@/game/chain";
import type { SuitAction } from "@/game/chain-route";
import { useAccount, useGame } from "@/game/store";
import { EXPLORER_URL } from "@/lib/near/config";
import type { ItemId, SuitId } from "@wgp/game-core/types";

const ALL_SUITS = Object.keys(SUITS) as SuitId[];
const ALL_ITEMS = Object.keys(ITEMS) as ItemId[];

/** Who drops each item, so it shows where it came from. */
const ITEM_SOURCE: Record<ItemId, CastId> = {
  "fee-bomb": "gas-goblin",
  "goblin-glider": "gas-goblin",
  crumbs: "sandwich-man",
  "sesame-seed": "sandwich-man",
  "chain-link": "doc-octochain",
  "spare-arm": "doc-octochain",
  "sybil-goo": "sybil",
  "press-pass": "bearson",
};

type Status = "equipped" | "owned" | "craftable" | "locked";

/** What a suit's craft costs in Bits and why it can't be paid now (null: it can, or it's free). */
export interface CraftBits {
  cost: number;
  gate: CraftGate | null;
  /** The player's Bits when known. */
  bits: number | null;
}

const NO_COST: CraftBits = { cost: 0, gate: null, bits: null };

/** The loot and the level are there, but the Bits (or the way to burn them) aren't. */
const BLOCKED: Record<CraftGate["code"], { label: string; icon: Icon; className: string } | null> = {
  bits: { label: "Needs Bits", icon: Coins, className: "bg-game-paper-2 text-game-ink border-dashed" },
  "sign-in": { label: "Needs Bits", icon: Coins, className: "bg-game-paper-2 text-game-ink border-dashed" },
  "quick-play": { label: "Needs quick play", icon: Zap, className: "bg-game-paper-2 text-game-ink border-dashed" },
  // Still reading the wallet: don't flash a warning that may not be true.
  checking: null,
};

const STATUS: Record<Status, { label: string; icon: Icon; className: string }> = {
  equipped: { label: "Wearing", icon: Check, className: "bg-game-ink text-game-paper" },
  owned: { label: "Owned", icon: Shirt, className: "bg-game-paper text-game-ink" },
  craftable: { label: "Ready", icon: Sparkles, className: "bg-game-gold text-game-ink" },
  locked: { label: "Locked", icon: Lock, className: "bg-game-paper-2 text-game-muted border-dashed" },
};

function suitStatus(save: HeroSave, id: SuitId): Status {
  if (save.hero.suit === id) return "equipped";
  if (save.suits.includes(id)) return "owned";
  return craftShortfall(save, id) ? "locked" : "craftable";
}

/** The level a suit needs: starters unlock free at level 2, the rest at their own level. */
const minLevel = (id: SuitId) => (SUITS[id].starter ? STARTER_UNLOCK_LEVEL : SUITS[id].minLevel);

function StatusChip({ status, gate = null }: { status: Status; gate?: CraftGate | null }) {
  const s = (status === "craftable" && gate ? BLOCKED[gate.code] : null) ?? STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold uppercase tracking-[0.04em] ${s.className}`}>
      <Icon aria-hidden className="size-3" strokeWidth={2.75} />
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ on chain or saved */

/** The suits the signed-in player holds on chain, or null when that isn't known (guests, test sign-ins, no NEAR here). */
function chainSuits(chain: ChainView, playerId: string | null): readonly string[] | null {
  const s = chain.status;
  if (!playerId || chain.owner?.id !== playerId || !s?.available || !s.configured || !s.onChain) return null;
  return s.onChain.suits;
}

/** Quick play is something this player could turn on now. */
const canEnable = (chain: ChainView) => chain.quickPlay.state === "off" || chain.quickPlay.state === "pending";

function EnableQuickPlay({ onOpen }: { onOpen?: () => void }) {
  return (
    <StickerButton
      size="sm"
      className="self-start"
      onClick={() => {
        onOpen?.();
        openAccountSheet();
      }}
    >
      <Zap aria-hidden className="size-4" strokeWidth={2.25} />
      Enable quick play
    </StickerButton>
  );
}

/** For a suit the hero owns: on NEAR, or saved only. */
function ChainLine({ onChain, offer, onOpen }: { onChain: boolean; offer: boolean; onOpen: () => void }) {
  if (onChain) {
    return (
      <p className="flex items-center gap-2 text-[14px] font-semibold leading-5">
        <span aria-hidden className="grid size-5 place-items-center rounded-full border-2 border-game-ink bg-game-mint text-game-paper">
          <Check className="size-3" strokeWidth={3} />
        </span>
        On NEAR, in your account.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-[22px] bg-game-paper-2 px-3 py-2.5">
      <p className="flex items-start gap-2 text-[14px] leading-5">
        <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
        <span className="[text-wrap:pretty]">
          <span className="font-semibold">Saved, not yet on chain.</span>
          {offer ? " Turn on quick play and your next suit change goes on NEAR." : null}
        </span>
      </p>
      {offer ? <EnableQuickPlay onOpen={onOpen} /> : null}
    </div>
  );
}

const sameAction = (a: SuitAction, b: SuitAction | null) => !!b && a.type === b.type && a.suit === b.suit;

/** The notice after a suit change, from where it landed. Null when there's nothing to add to the toast. */
function activityNotice(a: ChainActivity, chain: ChainView): { tone: "done" | "busy" | "saved"; text: string; txHash?: string | null; offer?: boolean } | null {
  const suit = SUITS[a.action.suit];
  const craft = a.action.type === "craft-suit";
  switch (a.state) {
    case "sending":
      return { tone: "busy", text: craft ? `Putting ${suit.name} on NEAR…` : `Changing into ${suit.name} on NEAR…` };
    case "on-chain":
      return { tone: "done", text: craft ? `${suit.name} is yours on NEAR, and you’re wearing it.` : `You changed into ${suit.name}, on NEAR.`, txHash: a.txHash };
    case "saved": {
      const done = craft ? `${suit.name} ${suit.starter ? "unlocked" : "stitched together"} and saved, not yet on chain.` : `You changed into ${suit.name}. Saved, not yet on chain.`;
      const why = a.reason === "suit-off-chain" ? " That suit isn’t on NEAR yet." : a.reason === "relayer" ? " NEAR couldn’t take it just now." : "";
      return { tone: "saved", text: done + why, offer: a.reason === "quick-play-off" && canEnable(chain) };
    }
    case "failed":
      return null;
  }
}

const NOTICE_TONE = {
  done: { icon: Check, className: "bg-game-mint text-game-paper" },
  busy: { icon: Hourglass, className: "bg-game-gold text-game-ink" },
  saved: { icon: CircleDashed, className: "bg-game-paper-2 text-game-ink" },
} as const;

function ToneMark({ tone }: { tone: keyof typeof NOTICE_TONE }) {
  const { icon: ToneIcon, className } = NOTICE_TONE[tone];
  return (
    <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full border-2 border-game-ink ${className}`}>
      <ToneIcon className="size-3.5" strokeWidth={2.75} />
    </span>
  );
}

function Notice({ notice }: { notice: { tone: keyof typeof NOTICE_TONE; text: string; txHash?: string | null; offer?: boolean } | null }) {
  // Always in the page, so screen readers hear each change; takes no room while empty.
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {notice ? (
        <div className="flex flex-col gap-2 rounded-[20px] border-2 border-game-ink bg-game-paper px-3 py-2 text-game-ink shadow-[var(--game-shadow-sm)] sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-[14px] font-semibold leading-5">
            <ToneMark tone={notice.tone} />
            <span className="[text-wrap:pretty]">{notice.text}</span>
          </p>
          {notice.txHash ? (
            <a
              href={`${EXPLORER_URL}/txns/${encodeURIComponent(notice.txHash)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 self-start rounded-full px-2 text-[14px] font-semibold underline decoration-game-ink/40 underline-offset-4 sm:self-auto pointer-fine:hover:decoration-game-ink"
            >
              View the transaction
              <ExternalLink aria-hidden className="size-4" strokeWidth={2} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
          {notice.offer ? <EnableQuickPlay /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ recipe, inline */

/** What a suit still needs, as small counts: item art and have/need, then the level. */
export function RecipeCounts({ save, id, craft }: { save: HeroSave; id: SuitId; craft: CraftBits }) {
  const suit = SUITS[id];
  const rows = Object.entries(suit.recipe) as [ItemId, number][];
  const level = minLevel(id);
  const levelOk = save.hero.level >= level;
  return (
    <span className="flex flex-wrap items-center justify-center gap-1">
      {rows.map(([item, need]) => {
        const have = Math.min(save.inventory[item] ?? 0, need);
        const ok = have >= need;
        return (
          <span
            key={item}
            className={`num inline-flex h-6 items-center gap-1 rounded-full pl-0.5 pr-1.5 text-[11px] font-semibold ${ok ? "bg-game-ink text-game-paper" : "bg-game-paper-2 text-game-ink"}`}
          >
            <MiniAvatar id={ITEM_SOURCE[item]} className="size-5 rounded-full" />
            {have}/{need}
            <span className="sr-only">
              {" "}
              {ITEMS[item].name}
              {ok ? ", enough" : ""}
            </span>
          </span>
        );
      })}
      <span
        className={`num inline-flex h-6 items-center rounded-full px-1.5 text-[11px] font-semibold ${levelOk ? "bg-game-ink text-game-paper" : "bg-game-paper-2 text-game-ink"}`}
      >
        {suit.starter ? `Free at Lv ${level}` : `Lv ${level}`}
        <span className="sr-only">{levelOk ? ", reached" : ", not yet"}</span>
      </span>
      {craft.cost > 0 ? (
        <span
          data-craft-cost={craft.cost}
          className={`num inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full pl-1 pr-1.5 text-[11px] font-semibold ${craft.bits !== null && craft.bits >= craft.cost ? "bg-game-ink text-game-paper" : "bg-game-paper-2 text-game-ink"}`}
        >
          <Coins aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          <span className="sr-only">Costs </span>
          {bitsText(craft.cost)}
          <span className="sr-only">{craft.bits === null ? "" : craft.bits >= craft.cost ? ", you have enough" : `, you have ${formatBits(craft.bits)}`}</span>
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ sheet */

/** One line of a recipe: what it is, then have / need with a tick or a cross. */
function Row({ ok, children, have, need }: { ok: boolean; children: ReactNode; have: number; need: number }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {children}
      <span className="num ml-auto flex shrink-0 items-center gap-1.5 text-[14px] font-semibold">
        {have}
        <span className="font-normal text-game-muted">/ {need}</span>
        <span
          aria-hidden
          className={`grid size-5 place-items-center rounded-full border-2 border-game-ink ${ok ? "bg-game-mint text-game-paper" : "bg-game-paper text-game-ink"}`}
        >
          {ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
        </span>
        <span className="sr-only">{ok ? "enough" : "not enough"}</span>
      </span>
    </li>
  );
}

export function Recipe({ save, id, craft }: { save: HeroSave; id: SuitId; craft: CraftBits }) {
  const suit = SUITS[id];
  const rows = Object.entries(suit.recipe) as [ItemId, number][];
  const level = minLevel(id);
  return (
    <ul className="flex flex-col divide-y-2 divide-dashed divide-game-ink/15">
      {rows.map(([item, need]) => {
        const have = save.inventory[item] ?? 0;
        return (
          <Row key={item} ok={have >= need} have={have} need={need}>
            <MiniAvatar id={ITEM_SOURCE[item]} className="size-10 rounded-[11px]" />
            <span className="flex min-w-0 flex-col">
              <span className="text-[14px] font-semibold leading-5">{ITEMS[item].name}</span>
              <span className="text-[12px] leading-4 text-game-muted">{RARITY_LABEL[ITEMS[item].rarity]} · {ITEMS[item].blurb}</span>
            </span>
          </Row>
        );
      })}
      <Row ok={save.hero.level >= level} have={save.hero.level} need={level}>
        <span aria-hidden className="num grid size-10 shrink-0 place-items-center rounded-[11px] bg-game-ink text-[13px] font-bold text-game-paper">
          Lv
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="num text-[14px] font-semibold leading-5">Level {level} or higher</span>
          <span className="text-[12px] leading-4 text-game-muted">{suit.starter ? "Starter suits unlock free" : "Your hero’s level"}</span>
        </span>
      </Row>
      {craft.cost > 0 ? (
        <li data-craft-cost={craft.cost} className="flex items-center gap-3 py-2">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-game-ink text-game-paper">
            <Coins className="size-5" strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="num text-[14px] font-semibold leading-5">Costs {bitsText(craft.cost)}</span>
            <span className="text-[12px] leading-4 text-game-muted">Burned when you craft, on top of the loot</span>
          </span>
          {craft.bits !== null ? (
            <span className="num ml-auto flex shrink-0 items-center gap-1.5 text-[14px] font-semibold">
              {formatBits(craft.bits)}
              <span className="font-normal text-game-muted">/ {formatBits(craft.cost)}</span>
              <span
                aria-hidden
                className={`grid size-5 place-items-center rounded-full border-2 border-game-ink ${craft.bits >= craft.cost ? "bg-game-mint text-game-paper" : "bg-game-paper text-game-ink"}`}
              >
                {craft.bits >= craft.cost ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
              </span>
              <span className="sr-only">{craft.bits >= craft.cost ? "enough" : "not enough"}</span>
            </span>
          ) : null}
        </li>
      ) : null}
    </ul>
  );
}

export function SuitSheet({
  save,
  id,
  open,
  onClose,
  onCraft,
  onWear,
  onChainSuits,
  offerQuickPlay,
  market,
  craft,
}: {
  save: HeroSave;
  id: SuitId | null;
  /** The open suit's cost in Bits and what blocks paying it. */
  craft: CraftBits;
  /** Gwei's prices, for buying a locked suit's missing parts; null until the market answers. */
  market: MarketFacts | null;
  open: boolean;
  onClose: () => void;
  onCraft: (id: SuitId) => void;
  onWear: (id: SuitId) => void;
  /** Suits on chain; null hides the on-chain line (guests, test sign-ins, no NEAR here). */
  onChainSuits: readonly string[] | null;
  offerQuickPlay: boolean;
}) {
  const suit = id ? SUITS[id] : null;
  const status = id ? suitStatus(save, id) : null;
  const shortfall = id ? craftShortfall(save, id) : null;
  const holdings = holdingsOf(save);
  // What this suit is still missing, to buy from Gwei at her price right now.
  const gap = id && status === "locked" ? (suitGaps(holdings).find((g) => g.suit === id) ?? null) : null;

  let footer = null;
  if (id && suit && status === "owned") {
    footer = (
      <StickerButton variant="hero" onClick={() => onWear(id)} data-autofocus="">
        <Shirt aria-hidden className="size-5" strokeWidth={2} />
        Wear {suit.name}
      </StickerButton>
    );
  } else if (id && suit && status === "craftable") {
    // Off while the Bits can't be paid; the reason is printed above it, never only in a tooltip.
    footer = (
      <StickerButton variant="hero" onClick={() => onCraft(id)} disabled={!!craft.gate} aria-describedby={craft.gate ? "craft-blocked" : undefined} data-autofocus={craft.gate ? undefined : ""}>
        <Sparkles aria-hidden className="size-5" strokeWidth={2} />
        {suit.starter ? "Unlock" : "Craft"} {suit.name}
        {craft.cost > 0 ? <span className="num font-medium"> · {bitsText(craft.cost)}</span> : null}
      </StickerButton>
    );
  } else if (status === "locked") {
    footer = (
      <StickerLink href="/play" onClick={onClose}>
        Swing out for loot
        <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
      </StickerLink>
    );
  }

  return (
    <GameSheet
      open={open}
      onClose={onClose}
      eyebrow={status ? ((status === "craftable" && craft.gate ? BLOCKED[craft.gate.code] : null) ?? STATUS[status]).label : undefined}
      title={suit?.name ?? ""}
      description={suit?.blurb}
      art={
        id ? (
          <StickerFrame drop="sm" className="[--s:72px]">
            <HeroArt {...SUITS[id].colors} />
          </StickerFrame>
        ) : null
      }
      footer={footer}
    >
      {id && suit && status !== "equipped" && status !== "owned" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
            {suit.starter ? "To unlock" : "Recipe"}
          </p>
          <Recipe save={save} id={id} craft={craft} />
          {shortfall ? (
            <p className="flex items-start gap-2 rounded-[12px] bg-game-paper-2 px-3 py-2 text-[13px] leading-5">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
              {shortfall}.
            </p>
          ) : craft.gate ? (
            <div className="flex flex-col gap-2 rounded-[12px] bg-game-paper-2 px-3 py-2">
              <p id="craft-blocked" data-craft-gate={craft.gate.code} className="num flex items-start gap-2 text-[13px] leading-5">
                <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
                <span className="[text-wrap:pretty]">{craft.gate.text}</span>
              </p>
              {craft.gate.code === "quick-play" ? <EnableQuickPlay onOpen={onClose} /> : null}
              {craft.gate.code === "sign-in" ? (
                <StickerButton
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    onClose();
                    openAccountSheet();
                  }}
                >
                  Sign in to earn Bits
                </StickerButton>
              ) : null}
            </div>
          ) : (
            <p className="num text-[13px] leading-5 text-game-muted">
              {suit.starter ? "Unlocking it puts it on." : craft.cost > 0 ? `Crafting uses the loot up, burns ${bitsText(craft.cost)} and puts the suit on.` : "Crafting uses the loot up and puts the suit on."}
            </p>
          )}
          {/* A locked suit's parts don't have to drop: Gwei sells them, at a price that moves. */}
          {gap && market ? <PartOffers gap={gap} market={market} onNavigate={onClose} /> : null}
          {/* Short of loot, or short of the Bits the craft burns: spare loot sells for Bits. */}
          {status === "locked" || craft.gate?.code === "bits" ? <SpareOffers holdings={holdings} onNavigate={onClose} className="pt-1" /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[14px] leading-5 text-game-muted">
            {status === "equipped" ? (
              <>
                <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
                You’re wearing it.
              </>
            ) : (
              "It’s yours. Change into it any time between stops."
            )}
          </p>
          {id && onChainSuits ? <ChainLine onChain={onChainSuits.includes(id)} offer={offerQuickPlay} onOpen={onClose} /> : null}
        </div>
      )}
    </GameSheet>
  );
}

/* ------------------------------------------------------------------ loot */

function LootStrip({ save }: { save: HeroSave }) {
  const held = ALL_ITEMS.filter((id) => (save.inventory[id] ?? 0) > 0);
  return (
    <StickerPanel as="section" aria-labelledby="loot-title" className="flex items-center gap-3 py-2 pl-4 pr-2">
      <h2 id="loot-title" className="shrink-0 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">
        Loot
      </h2>
      {held.length ? (
        <ul className="wgp-scroll-x relative -my-1 flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto py-1 pr-2">
          {held.map((id) => (
            <li
              key={id}
              className="flex h-9 shrink-0 snap-start items-center gap-1.5 rounded-full border-2 border-game-ink bg-game-paper-2 pl-0.5 pr-2.5 text-[13px] font-semibold"
            >
              <MiniAvatar id={ITEM_SOURCE[id]} className="size-7 rounded-full" />
              <span className="whitespace-nowrap">{ITEMS[id].name}</span>
              <span className="num text-game-muted">
                <span aria-hidden>×</span>
                <span className="sr-only">, </span>
                {save.inventory[id]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-1.5 text-[13px] leading-5 text-game-muted">Empty pockets. Villains drop loot when you catch them.</p>
      )}
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ the lab */

export function SuitLab() {
  const save = useHeroSave();
  const { dispatch } = useGame();
  const account = useAccount();
  const chain = useChain();
  const activity = useChainActivity();
  // One look at the market per visit, and again each time the server confirms a change to the save
  // (its revision moves): a craft may have burned Bits, and the wallet is read after the burn, not before.
  const peek = useMarketPeek(account.status === "signed-in" ? account.me.rev : 0);
  const market = peek.view;
  const [openId, setOpenId] = useState<SuitId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<SuitAction | null>(null);
  // Next keeps this page alive when you leave it: don't come back to old news.
  useLayoutEffect(
    () => () => {
      setNotice(null);
      setLastAction(null);
      clearActivity();
    },
    [],
  );

  const player = account.status === "signed-in" ? account.me.player : null;
  const playerId = player?.id ?? null;
  // Mints land a minute or so after a night: look again each visit.
  useEffect(() => {
    if (player && player.authKind !== "dev") void refreshChain(player);
    // `player` changes identity on every /api/me refresh; its id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  if (!save) return <GameLoading />;

  const onChainSuits = chainSuits(chain, playerId);
  const offerQuickPlay = onChainSuits !== null && canEnable(chain);
  // Where the Bits a craft burns would come from: the wallet the market reads for this player.
  const wallet: CraftWallet =
    account.status === "guest"
      ? { kind: "guest" }
      : account.status === "loading" || !peek.settled
        ? { kind: "loading" }
        : peek.me
          ? { kind: "known", bits: peek.me.bits, onChain: peek.me.onChain, signs: chain.quickPlay.state === "on" }
          : { kind: "unknown" };
  const craftOf = (id: SuitId): CraftBits => {
    const cost = craftCost(id, market?.params);
    return cost > 0 ? { cost, gate: craftGate(cost, wallet), bits: wallet.kind === "known" ? wallet.bits : null } : NO_COST;
  };
  const anyCost = ALL_SUITS.some((id) => craftCost(id, market?.params) > 0);
  const latest = activity && sameAction(activity.action, lastAction) ? activity : null;
  const shown = latest
    ? activityNotice(latest, chain)
    : notice
      ? { tone: "done" as const, text: notice }
      : null;

  function open(id: SuitId) {
    setOpenId(id);
    setSheetOpen(true);
  }

  function craft(id: SuitId) {
    const { cost, gate } = craftOf(id);
    // The button is off while the Bits can't be paid; the server refuses too (src/server/market/craft.ts).
    if (gate) return;
    dispatch({ type: "craft-suit", suit: id });
    setSheetOpen(false);
    setLastAction({ type: "craft-suit", suit: id });
    setNotice(`${SUITS[id].name} ${SUITS[id].starter ? "unlocked" : "stitched together"}, and you’re wearing it.${cost > 0 ? ` It burned ${bitsText(cost)}.` : ""}`);
  }

  function wear(id: SuitId) {
    dispatch({ type: "equip-suit", suit: id });
    setSheetOpen(false);
    setLastAction({ type: "equip-suit", suit: id });
    setNotice(`You changed into ${SUITS[id].name}.`);
  }

  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[980px] flex-col gap-4 px-4 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-[28px] font-semibold leading-[30px] tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[36px] sm:leading-[38px]">
          Suit lab
        </h1>
        <p className="num text-[14px] font-medium leading-5 text-game-paper/80">
          {save.suits.length} of {ALL_SUITS.length} owned · wearing {SUITS[save.hero.suit].name}
          {onChainSuits ? ` · ${save.suits.filter((s) => onChainSuits.includes(s)).length} on NEAR` : null}
          {anyCost && wallet.kind === "known" ? ` · ${bitsText(wallet.bits)}` : null}
        </p>
      </header>

      <LootStrip save={save} />

      <Notice notice={shown} />
      {/* A suit just stitched from loot is worth showing off (components/first-minute/suit-share.tsx). */}
      <SuitShare suit={shown && lastAction?.type === "craft-suit" ? lastAction.suit : null} />

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ALL_SUITS.map((id) => {
          const suit = SUITS[id];
          const status = suitStatus(save, id);
          const showRecipe = status === "locked" || status === "craftable";
          const bits = showRecipe ? craftOf(id) : NO_COST;
          return (
            <li key={id} className="flex">
              <button type="button" onClick={() => open(id)} className={`${stickerTileClass} w-full items-center gap-2 p-1.5 pb-2.5`}>
                <span className="relative grid w-full place-items-center rounded-[14px] bg-game-paper-2 pb-3 pt-6">
                  <span className="absolute left-1.5 top-1.5">
                    <StatusChip status={status} gate={bits.gate} />
                  </span>
                  <StickerFrame drop="sm" className={`[--s:84px] sm:[--s:104px] ${status === "locked" ? "opacity-70 grayscale-[0.6]" : ""}`}>
                    <HeroArt {...suit.colors} />
                  </StickerFrame>
                </span>
                <span className="px-1 text-center text-[15px] font-semibold leading-5">{suit.name}</span>
                {showRecipe ? (
                  <RecipeCounts save={save} id={id} craft={bits} />
                ) : (
                  <span className="text-[12px] font-medium leading-6 text-game-muted">{status === "equipped" ? "On you now" : "Tap to wear"}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <SuitSheet
        save={save}
        id={openId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCraft={craft}
        onWear={wear}
        onChainSuits={onChainSuits}
        offerQuickPlay={offerQuickPlay}
        market={market}
        craft={openId ? craftOf(openId) : NO_COST}
      />
    </div>
  );
}
