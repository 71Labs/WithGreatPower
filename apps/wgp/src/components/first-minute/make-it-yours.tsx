"use client";

/**
 * "Make it yours": a guest who came in through the quick start is playing The Node in the
 * Classic suit. This tile, on Tonight, opens a sheet to name the hero and pick one of the
 * four starter suits: the two choices the origin flow asks for up front, moved to after
 * the first swing. It edits the guest's save in this browser only; once the hero is named
 * (or the player keeps The Node), the tile goes away.
 *
 * Signed-in players never see it: their hero lives on the server and was named on the way in.
 */
import { useId, useState, useSyncExternalStore, type FormEvent } from "react";

import { HeroArt } from "@/components/cast";
import { StickerButton, StickerFrame, stickerTileClass } from "@/components/game/kit";
import { GameSheet } from "@/components/game/ui";
import { Mark, SELECT_CARD, SELECT_CARD_OFF, SELECT_CARD_ON } from "@/components/hero/controls";
import { ChevronRight, CircleAlert, PenLine } from "@/components/icons";
import { commitLocalSave, showToast, useAccount } from "@/game/store";
import { HERO_NAME_MAX, cleanHeroName, isQuickHero, markQuickHero, personalize, subscribeQuickHero } from "@/lib/first-minute/quick-hero";
import { SUITS } from "@wgp/game-core/data";
import type { Hero, Save, SuitId } from "@wgp/game-core/types";

const STARTER_SUITS = (Object.keys(SUITS) as SuitId[]).filter((id) => SUITS[id].starter);

export function MakeItYoursTile({ save, className = "" }: { save: Save & { hero: Hero }; className?: string }) {
  const guest = useAccount().status === "guest";
  const quick = useSyncExternalStore(subscribeQuickHero, isQuickHero, () => false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [suit, setSuit] = useState<SuitId>(save.hero.suit);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  // Kept mounted while the sheet slides away after saving.
  if (!guest || (!quick && !open)) return null;
  const hero = save.hero;
  // The suit can change while the starter they were given is the only one they own.
  const canSwap = save.suits.length === 1 && save.suits[0] === hero.suit;

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = cleanHeroName(name);
    if (!clean) {
      setError("Give your hero a name, or keep The Node.");
      document.getElementById(`${ids}-name`)?.focus();
      return;
    }
    commitLocalSave(personalize(save, clean, suit));
    markQuickHero(false);
    setOpen(false);
    showToast(`${clean} it is. Bearson will misspell it anyway.`, "success");
  }

  function keep() {
    markQuickHero(false);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setName("");
          setSuit(hero.suit);
          setError(null);
          setOpen(true);
        }}
        className={`${stickerTileClass} w-full flex-row items-center gap-3 p-2.5 pr-3 ${className}`}
      >
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-gold">
          <PenLine className="size-5" strokeWidth={2.25} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Make it yours</span>
          <span className="truncate text-[15px] font-bold leading-5">Name your hero, pick a suit</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
      </button>

      <GameSheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Secret identity"
        title="Make this hero yours"
        description="You’re playing The Node in the Classic suit. Change either now; your level, powers and loot stay."
        size="lg"
        footer={
          <>
            <StickerButton onClick={keep} className="sm:order-first">
              Keep The Node
            </StickerButton>
            <StickerButton variant="hero" type="submit" form={`${ids}-form`}>
              Save my hero
            </StickerButton>
          </>
        }
      >
        <form id={`${ids}-form`} onSubmit={submit} noValidate className="flex flex-col gap-6 pt-1">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${ids}-name`} className="text-[14px] font-semibold leading-5 text-game-ink">
              Hero name
            </label>
            <input
              id={`${ids}-name`}
              data-autofocus=""
              name="hero-name"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              maxLength={HERO_NAME_MAX}
              value={name}
              placeholder={hero.name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${ids}-error ${ids}-hint` : `${ids}-hint`}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              className="h-14 w-full rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 font-display text-[20px] font-semibold tracking-[-0.01em] text-game-ink placeholder:font-medium placeholder:text-game-muted/70 focus-visible:outline-offset-2 aria-invalid:border-game-hero"
            />
            {error ? (
              <p id={`${ids}-error`} className="flex items-start gap-1.5 text-[14px] font-semibold leading-5 text-game-hero">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
                {error}
              </p>
            ) : null}
            <p id={`${ids}-hint`} className="text-[13px] leading-5 text-game-muted">
              Up to {HERO_NAME_MAX} characters. It goes on your hero card and The Daily Rug’s front page.
            </p>
          </div>

          {canSwap ? (
            <fieldset className="min-w-0">
              <legend className="mb-2 block w-full p-0 text-[14px] font-semibold leading-5 text-game-ink">Starter suit</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STARTER_SUITS.map((id) => {
                  const s = SUITS[id];
                  const checked = suit === id;
                  return (
                    <label key={id} className={`${SELECT_CARD} ${checked ? SELECT_CARD_ON : SELECT_CARD_OFF} p-1.5`}>
                      <input type="radio" name="suit" value={id} checked={checked} onChange={() => setSuit(id)} className="sr-only" />
                      <span aria-hidden className="grid place-items-center rounded-[14px] bg-game-paper-2 py-3">
                        <StickerFrame drop="sm" className="[--s:72px]">
                          <HeroArt {...s.colors} />
                        </StickerFrame>
                      </span>
                      <span className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-2">
                        <span className="text-[14px] font-semibold leading-5">{s.name}</span>
                        <Mark checked={checked} shape="radio" />
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-3 text-[13px] leading-5 text-game-muted">The other three unlock free at level 2.</p>
            </fieldset>
          ) : null}
        </form>
      </GameSheet>
    </>
  );
}
