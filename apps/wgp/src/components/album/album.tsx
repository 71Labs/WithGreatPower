"use client";

import { useState } from "react";

import { HeroArt } from "@/components/cast";
import { StickerBadge, StickerFrame, StickerMeter, StickerPanel } from "@/components/game/kit";
import { GameLoading, GameSheet, useHeroSave, type HeroSave } from "@/components/game/ui";
import { Check, Lock, MapPin } from "@/components/icons";
import { CAST, castById, type CastId } from "@wgp/game-core/cast";
import { DISTRICTS, SUITS, VILLAINS } from "@wgp/game-core/data";

import { ALWAYS, GROUPS, countLabel, howToGet, isVillain } from "./entries";
import { CastFrame, LockedFrame, Slot, GRID_SIZE } from "./slots";

/** The cast in album order: heroes, the vendor, allies, press, villains. */
const ORDER = GROUPS.flatMap((g) => CAST.filter((c) => c.role === g.role));

type Open = { kind: "you" } | { kind: "cast"; id: CastId };

function Progress({ save }: { save: HeroSave }) {
  const has = (id: CastId) => id === ALWAYS || (save.album[id] ?? 0) > 0;
  const collected = CAST.filter((c) => has(c.id)).length;
  let caught = 0;
  let met = 0;
  for (const [id, n] of Object.entries(save.album) as [CastId, number][]) {
    if (isVillain(id)) caught += n;
    else met += n;
  }
  return (
    <div className="flex flex-col gap-2 border-b-2 border-dashed border-game-ink/20 px-1 pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="num text-[22px] font-semibold leading-7 tracking-[-0.02em]">
          {collected} of {CAST.length} <span className="text-[14px] font-medium tracking-normal text-game-muted">collected</span>
        </p>
        <p className="num text-[13px] font-medium leading-5 text-game-muted">
          {caught} caught · {met} met
        </p>
      </div>
      <StickerMeter label="Stickers collected" value={collected} max={CAST.length} hideLabel fill="bg-game-gold" />
    </div>
  );
}

function AlbumSheet({ save, open, item, onClose }: { save: HeroSave; open: boolean; item: Open | null; onClose: () => void }) {
  if (!item) return <GameSheet open={false} onClose={onClose} title="" />;

  if (item.kind === "you") {
    const hero = save.hero;
    return (
      <GameSheet
        open={open}
        onClose={onClose}
        eyebrow="You"
        title={hero.name}
        description={`Bitten on night ${hero.createdNight}. Still working on the responsibility part.`}
        art={
          <StickerFrame drop="sm" className="[--s:72px]">
            <HeroArt {...SUITS[hero.suit].colors} />
          </StickerFrame>
        }
      >
        <p className="num text-[14px] leading-5 text-game-muted">
          Level {hero.level} · {SUITS[hero.suit].name} suit · {save.stats.nights} {save.stats.nights === 1 ? "night" : "nights"} out
        </p>
      </GameSheet>
    );
  }

  const c = castById(item.id);
  const n = save.album[item.id] ?? 0;
  const legend = item.id === ALWAYS;
  const got = legend || n > 0;
  return (
    <GameSheet
      open={open}
      onClose={onClose}
      eyebrow={legend ? "The original" : c.role}
      title={c.name}
      description={got ? c.line : "Not in your album yet."}
      art={got ? <CastFrame id={item.id} className="[--s:72px]" /> : <LockedFrame id={item.id} className="[--s:72px]" />}
    >
      {got ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-[14px] font-semibold leading-5">
            <span aria-hidden className="grid size-6 place-items-center rounded-full border-2 border-game-ink bg-game-mint text-game-paper">
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            <span className="num">{legend ? "In every album, from your first night" : countLabel(item.id, n)}</span>
          </p>
          {isVillain(item.id) ? (
            <p className="flex items-center gap-2 text-[13px] leading-5 text-game-muted">
              <MapPin aria-hidden className="size-4 shrink-0" strokeWidth={2} />
              Usually found in {DISTRICTS[VILLAINS[item.id].district].name}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="flex items-start gap-2 rounded-[12px] bg-game-paper-2 px-3 py-2.5 text-[14px] leading-5">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
          {howToGet(item.id)}
        </p>
      )}
    </GameSheet>
  );
}

/** The sticker album: you, then the whole cast, collected or waiting. Tap one for its page. */
export function AlbumScreen() {
  const save = useHeroSave();
  const [item, setItem] = useState<Open | null>(null);
  const [open, setOpen] = useState(false);
  if (!save) return <GameLoading />;

  const show = (next: Open) => {
    setItem(next);
    setOpen(true);
  };

  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[28px] font-semibold leading-[30px] tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[36px] sm:leading-[38px]">
          Sticker album
        </h1>
        <p className="max-w-[52ch] text-[14px] leading-5 text-game-paper/80">Catch villains and help the neighbors on patrol. Every one sticks in here.</p>
      </header>

      <StickerPanel as="section" aria-label="Your stickers" className="flex flex-col gap-3 p-3 sm:p-5">
        <Progress save={save} />
        <ul className="grid grid-cols-3 gap-x-1 gap-y-1 sm:grid-cols-4 lg:grid-cols-6">
          <Slot
            onOpen={() => show({ kind: "you" })}
            art={
              <StickerFrame drop="sm" className={GRID_SIZE}>
                <HeroArt {...SUITS[save.hero.suit].colors} />
              </StickerFrame>
            }
            badge={<StickerBadge>You</StickerBadge>}
            name={save.hero.name}
            sub={`Level ${save.hero.level}`}
          />
          {ORDER.map((c) => {
            const n = save.album[c.id] ?? 0;
            if (c.id === ALWAYS) {
              return <Slot key={c.id} onOpen={() => show({ kind: "cast", id: c.id })} art={<CastFrame id={c.id} />} name={c.name} sub="The original" />;
            }
            return n > 0 ? (
              <Slot
                key={c.id}
                onOpen={() => show({ kind: "cast", id: c.id })}
                art={<CastFrame id={c.id} />}
                badge={<StickerBadge>×{n}</StickerBadge>}
                name={c.name}
                sub={
                  <>
                    {isVillain(c.id) ? "Caught" : "Met"}
                    <span className="sr-only"> ×{n}</span>
                  </>
                }
              />
            ) : (
              <Slot
                key={c.id}
                muted
                onOpen={() => show({ kind: "cast", id: c.id })}
                art={<LockedFrame id={c.id} />}
                name={c.name}
                sub={
                  <span className="inline-flex items-center gap-1">
                    <Lock aria-hidden className="size-3" strokeWidth={2.5} />
                    Locked
                  </span>
                }
              />
            );
          })}
        </ul>
      </StickerPanel>

      <AlbumSheet save={save} open={open} item={item} onClose={() => setOpen(false)} />
    </div>
  );
}
