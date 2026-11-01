"use client";

import { Check } from "@/components/icons";
import { StickerButton, StickerMeter } from "@/components/game/kit";
import { useGame } from "@/game/store";
import type { Edition } from "@/game/types";

import { SectionHead } from "./shared";

const reaction = {
  hero: "Bearson is printing a correction. Reluctantly.",
  menace: "Bearson agrees with you, for once.",
} as const;

/**
 * The reader poll on the latest edition. One vote per edition: the reducer ignores a
 * second one, and the buttons give way to your vote once it's in.
 */
export function ReaderPoll({ edition, heroName }: { edition: Edition; heroName: string }) {
  const { dispatch } = useGame();
  const hero = edition.heroPoll;
  const vote = edition.vote;

  return (
    <section aria-labelledby="poll-title" className="flex flex-col gap-3">
      <SectionHead id="poll-title">Reader poll</SectionHead>
      <p className="text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-game-ink [overflow-wrap:anywhere]">{heroName}: hero or menace?</p>

      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <p className="flex items-baseline gap-1.5">
            <span className="num font-display text-[36px] font-bold leading-[34px] tracking-[-0.04em]">{hero}%</span>
            <span className="text-[13px] leading-5 text-game-muted">say hero</span>
          </p>
          <p className="num pb-0.5 text-[13px] leading-5 text-game-muted">{100 - hero}% menace</p>
        </div>
        <StickerMeter label="Readers who say hero" value={hero} max={100} hideLabel />
      </div>

      {vote ? (
        <p className="flex items-start gap-2.5 rounded-[14px] bg-game-paper-2 px-3 py-2.5 text-[14px] leading-5">
          <span aria-hidden className="mt-px grid size-5 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-mint text-game-paper">
            <Check className="size-3" strokeWidth={3} />
          </span>
          <span>
            <span className="font-semibold">You voted {vote}.</span> {reaction[vote]}
          </span>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <StickerButton variant="hero" size="sm" className="w-full" onClick={() => dispatch({ type: "vote", side: "hero" })}>
            Vote hero
          </StickerButton>
          <StickerButton size="sm" className="w-full" onClick={() => dispatch({ type: "vote", side: "menace" })}>
            Vote menace
          </StickerButton>
        </div>
      )}

      {/* Announced once the vote is counted; the visible result above says the same. */}
      <p role="status" className="sr-only">
        {vote ? `Vote counted: you voted ${vote}. Readers now say ${hero}% hero.` : ""}
      </p>

      <p className="text-[12px] leading-4 text-game-muted">
        {vote ? "One vote per edition. The next poll runs after your next patrol." : "One vote per edition. It moves what the city thinks of you."}
      </p>
    </section>
  );
}
