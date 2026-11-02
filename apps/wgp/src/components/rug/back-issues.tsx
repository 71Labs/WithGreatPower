"use client";

import { useState } from "react";

import { StickerButton } from "@/components/game/kit";
import { GameSheet } from "@/components/game/ui";
import { ChevronDown, History } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import type { Edition, Save } from "@wgp/game-core/types";

import { QuestPill, questStatus, sentence } from "./shared";

function Issue({ save, edition }: { save: Save; edition: Edition }) {
  const quest = edition.quest;
  return (
    <details className="group rounded-[20px] border-2 border-game-ink bg-game-paper open:bg-game-paper-2">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[18px] px-3 py-2.5 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <MiniAvatar id={edition.who} className="size-9 rounded-[8px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="num text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Night {edition.night}</span>
          <span className="text-[14px] font-bold uppercase leading-[17px] text-game-ink [overflow-wrap:anywhere]">{edition.headline}</span>
        </span>
        <ChevronDown
          aria-hidden
          className="size-5 shrink-0 text-game-ink group-open:rotate-180 motion-safe:transition-[rotate] motion-safe:duration-200 motion-safe:ease-out"
          strokeWidth={2.25}
        />
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3.5 pt-1">
        <p className="text-[14px] leading-5 text-game-ink">{sentence(edition.dek)}</p>
        <ul className="flex flex-col gap-2 border-t-2 border-game-ink pt-2.5">
          {edition.stories.map((s) => (
            <li key={s.headline} className="flex flex-col gap-0.5">
              <p className="text-[13px] font-bold uppercase leading-4 text-game-ink [overflow-wrap:anywhere]">{s.headline}</p>
              <p className="text-[13px] leading-[18px] text-game-muted">{sentence(s.dek)}</p>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1.5 text-[13px] leading-5">
          <div className="flex flex-wrap items-center gap-x-2">
            <dt className="text-game-muted">Poll</dt>
            <dd className="num font-semibold">
              {edition.heroPoll}% hero · {edition.vote ? `you voted ${edition.vote}` : "you didn’t vote"}
            </dd>
          </div>
          {quest ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <dt className="text-game-muted">Quest</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span>{sentence(quest.text)}</span>
                <QuestPill status={questStatus(save, quest)} />
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </details>
  );
}

/** Every earlier edition, newest first, in a sheet; each opens to its front page. */
export function BackIssues({ save, editions }: { save: Save; editions: Edition[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <StickerButton size="sm" onClick={() => setOpen(true)} className="self-center">
        <History aria-hidden className="size-4" strokeWidth={2.25} />
        Read back issues
        <span className="num inline-grid h-5 min-w-5 place-items-center rounded-full bg-game-ink px-1 text-[11px] text-game-paper">{editions.length}</span>
      </StickerButton>
      <GameSheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="The Daily Rug"
        title="Back issues"
        description="Bearson never forgets. Newest first."
      >
        <ul className="flex flex-col gap-2">
          {editions.map((e) => (
            <li key={e.night}>
              <Issue save={save} edition={e} />
            </li>
          ))}
        </ul>
      </GameSheet>
    </>
  );
}
