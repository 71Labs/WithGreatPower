"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

import { HeroArt } from "@/components/cast";
import { StickerButton, StickerFrame, StickerLink, StickerPanel, stickerTileClass } from "@/components/game/kit";
import { GameLoading, GameSheet, useHeroSave, type HeroSave } from "@/components/game/ui";
import { ArrowRight, Check, Lock, Shirt, Sparkles, X, type Icon } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import type { CastId } from "@/content/cast";
import { ITEMS, RARITY_LABEL, STARTER_UNLOCK_LEVEL, SUITS } from "@/game/data";
import { craftShortfall } from "@/game/engine";
import { useGame } from "@/game/store";
import type { ItemId, SuitId } from "@/game/types";

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

function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold uppercase tracking-[0.04em] ${s.className}`}>
      <Icon aria-hidden className="size-3" strokeWidth={2.75} />
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ recipe, inline */

/** What a suit still needs, as small counts: item art and have/need, then the level. */
function RecipeCounts({ save, id }: { save: HeroSave; id: SuitId }) {
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

function Recipe({ save, id }: { save: HeroSave; id: SuitId }) {
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
    </ul>
  );
}

function SuitSheet({
  save,
  id,
  open,
  onClose,
  onCraft,
  onWear,
}: {
  save: HeroSave;
  id: SuitId | null;
  open: boolean;
  onClose: () => void;
  onCraft: (id: SuitId) => void;
  onWear: (id: SuitId) => void;
}) {
  const suit = id ? SUITS[id] : null;
  const status = id ? suitStatus(save, id) : null;
  const shortfall = id ? craftShortfall(save, id) : null;

  let footer = null;
  if (id && suit && status === "owned") {
    footer = (
      <StickerButton variant="hero" onClick={() => onWear(id)} data-autofocus="">
        <Shirt aria-hidden className="size-5" strokeWidth={2} />
        Wear {suit.name}
      </StickerButton>
    );
  } else if (id && suit && status === "craftable") {
    footer = (
      <StickerButton variant="hero" onClick={() => onCraft(id)} data-autofocus="">
        <Sparkles aria-hidden className="size-5" strokeWidth={2} />
        {suit.starter ? "Unlock" : "Craft"} {suit.name}
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
      eyebrow={status ? STATUS[status].label : undefined}
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
          <Recipe save={save} id={id} />
          {shortfall ? (
            <p className="flex items-start gap-2 rounded-[12px] bg-game-paper-2 px-3 py-2 text-[13px] leading-5">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
              {shortfall}.
            </p>
          ) : (
            <p className="text-[13px] leading-5 text-game-muted">
              {suit.starter ? "Unlocking it puts it on." : "Crafting uses the loot up and puts the suit on."}
            </p>
          )}
        </div>
      ) : (
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
  const [openId, setOpenId] = useState<SuitId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Next keeps this page alive when you leave it: don't come back to old news.
  useLayoutEffect(() => () => setNotice(null), []);

  if (!save) return <GameLoading />;

  function open(id: SuitId) {
    setOpenId(id);
    setSheetOpen(true);
  }

  function craft(id: SuitId) {
    dispatch({ type: "craft-suit", suit: id });
    setSheetOpen(false);
    setNotice(`${SUITS[id].name} ${SUITS[id].starter ? "unlocked" : "stitched together"}, and you’re wearing it.`);
  }

  function wear(id: SuitId) {
    dispatch({ type: "equip-suit", suit: id });
    setSheetOpen(false);
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
        </p>
      </header>

      <LootStrip save={save} />

      <p
        role="status"
        className={notice ? "flex items-center gap-2 rounded-full border-2 border-game-ink bg-game-mint px-4 py-2 text-[14px] font-semibold leading-5 text-game-paper" : "sr-only"}
      >
        {notice ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={3} /> : null}
        {notice}
      </p>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ALL_SUITS.map((id) => {
          const suit = SUITS[id];
          const status = suitStatus(save, id);
          const showRecipe = status === "locked" || status === "craftable";
          return (
            <li key={id} className="flex">
              <button type="button" onClick={() => open(id)} className={`${stickerTileClass} w-full items-center gap-2 p-1.5 pb-2.5`}>
                <span className="relative grid w-full place-items-center rounded-[14px] bg-game-paper-2 pb-3 pt-6">
                  <span className="absolute left-1.5 top-1.5">
                    <StatusChip status={status} />
                  </span>
                  <StickerFrame drop="sm" className={`[--s:84px] sm:[--s:104px] ${status === "locked" ? "opacity-70 grayscale-[0.6]" : ""}`}>
                    <HeroArt {...suit.colors} />
                  </StickerFrame>
                </span>
                <span className="px-1 text-center text-[15px] font-semibold leading-5">{suit.name}</span>
                {showRecipe ? (
                  <RecipeCounts save={save} id={id} />
                ) : (
                  <span className="text-[12px] font-medium leading-6 text-game-muted">{status === "equipped" ? "On you now" : "Tap to wear"}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <SuitSheet save={save} id={openId} open={sheetOpen} onClose={() => setSheetOpen(false)} onCraft={craft} onWear={wear} />
    </div>
  );
}
