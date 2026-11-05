"use client";

import { createElement, useEffect } from "react";

import { StickerFrame, StickerLink, ON_PAPER } from "@/components/game/kit";
import { playSfx, playSting, playVoice } from "@/audio/player";
import { markEditionRead, useUnreadEdition } from "@/components/game/shell";
import { GameLoading, useHeroSave, type HeroSave } from "@/components/game/ui";
import { ArrowRight } from "@/components/icons";
import { AVATARS } from "@/components/cast";
import { CaseRugLead } from "@/components/cases/rug-lead";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { rugLeadFor, useCaseMarks } from "@/lib/cases/local";
import { castById } from "@wgp/game-core/cast";
import type { Edition } from "@wgp/game-core/types";

import { BackIssues } from "./back-issues";
import { MarketMovers } from "./market-movers";
import { ReaderPoll } from "./poll";
import { QuestBox } from "./quest-box";
import { SectionHead, sentence } from "./shared";

function Masthead({ dateline, issue }: { dateline: string; issue?: string }) {
  return (
    <header>
      <h1
        id="rug-nameplate"
        className="text-center font-display text-[clamp(2.5rem,1.6rem+4.4vw,4.75rem)] font-bold leading-[0.95] tracking-[-0.04em] text-game-ink"
      >
        The Daily Rug
      </h1>
      {/* The masthead rule: heavy over hairline, the way a front page opens. */}
      <div aria-hidden className="mt-3 border-t-4 border-game-ink sm:mt-4" />
      <div aria-hidden className="mt-[3px] border-t border-game-ink" />
      <div className="flex items-center justify-between gap-3 py-2 text-[11px] font-bold uppercase leading-4 tracking-[0.06em]">
        <p className="num">{dateline}</p>
        <p className="text-game-muted max-sm:hidden">The city’s least trusted newspaper</p>
        <p className="num text-game-muted">{issue}</p>
      </div>
      <div aria-hidden className="border-t border-game-ink" />
    </header>
  );
}

function LeadStory({ edition, second = false }: { edition: Edition; /** Under a case's lead: the night's story a size down, below a rule. */ second?: boolean }) {
  return (
    <section aria-labelledby="lead-headline" className={`flex min-w-0 flex-col gap-4 ${second ? "border-t-[3px] border-game-ink pt-4" : ""}`}>
      <h2
        id="lead-headline"
        className={`font-display font-bold uppercase tracking-[-0.03em] text-game-ink [overflow-wrap:anywhere] ${
          second ? "text-[clamp(1.375rem,1.1rem+1.2vw,2rem)] leading-[1]" : "text-[clamp(1.875rem,1.3rem+2.6vw,3.25rem)] leading-[0.95]"
        }`}
      >
        {edition.headline}
      </h2>
      <div className="flex items-start gap-4">
        <figure className="flex shrink-0 flex-col items-center gap-1.5">
          <StickerFrame drop="sm" label={`Pictured: ${castById(edition.who).name}`} className="[--s:88px] sm:[--s:120px]">
            {createElement(AVATARS[edition.who])}
          </StickerFrame>
          <figcaption className="max-w-[88px] text-center text-[11px] leading-[14px] text-game-muted sm:max-w-[120px]">
            {castById(edition.who).name}
          </figcaption>
        </figure>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-[16px] leading-6 text-game-ink sm:text-[19px] sm:leading-7">{sentence(edition.dek)}</p>
          <p className="flex items-center gap-2 text-[12px] leading-4">
            <MiniAvatar id="bearson" className="size-7 rounded-[8px]" />
            <span>
              <span className="font-semibold">By J. Jonah Bearson</span>
              <span className="text-game-muted max-sm:hidden">, who already knows the answer</span>
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function Stories({ edition }: { edition: Edition }) {
  return (
    <section aria-labelledby="stories-title" className="flex flex-col gap-3">
      <SectionHead id="stories-title">Also in this edition</SectionHead>
      <ul className="grid gap-2.5 md:grid-cols-3 md:gap-5">
        {edition.stories.map((s) => (
          <li key={s.headline} className="flex min-w-0 items-center gap-3 sm:items-start md:flex-col md:gap-2">
            <MiniAvatar id={s.who} className="size-9 rounded-[10px]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h3 className="text-[14px] font-bold uppercase leading-[17px] text-game-ink [overflow-wrap:anywhere]">{s.headline}</h3>
              <p className="text-[13px] leading-[18px] text-game-muted max-sm:hidden">{sentence(s.dek)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyFrontPage() {
  return (
    <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
      <StickerFrame drop="sm" className="[--s:96px]">
        {AVATARS.bearson()}
      </StickerFrame>
      <h2 className="max-w-[24ch] text-[20px] font-semibold leading-6 tracking-[-0.02em] text-game-ink">
        Finish your first patrol and Bearson will write about it.
      </h2>
      <StickerLink href="/play" variant="hero">
        Swing out
        <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
      </StickerLink>
    </div>
  );
}

/** When the jingle last played: a remount (or React's development double run) doesn't play it twice. */
let lastJingle = -Infinity;

/**
 * The Daily Rug: the latest front page, written from your last patrol, on a sheet of
 * newsprint, with the Mempool Market's movers in the markets column.
 */
export function DailyRugScreen() {
  const save = useHeroSave();
  const latestNight = save?.editions[0]?.night;

  const unread = useUnreadEdition(save);
  const marks = useCaseMarks();

  // The paper lands: its jingle over the hub theme, and the snap of newsprint.
  useEffect(() => {
    if (performance.now() - lastJingle < 2000) return;
    lastJingle = performance.now();
    playSting("rug-jingle");
    playSfx("newspaper", { volume: 0.8 });
  }, []);

  // Reading it clears the dock's "new" badge (and a new edition gets Bearson's shout).
  // Runs only while this page is on screen.
  useEffect(() => {
    if (!latestNight) return;
    if (unread) playVoice("bearson-late-edition", { delay: 1.1 });
    markEditionRead(latestNight);
  }, [latestNight, unread]);

  // A case closed since this edition went to print leads the front page.
  const caseLead = rugLeadFor(marks, latestNight ?? 0);

  if (!save) return <GameLoading />;
  const [latest, ...older] = save.editions;

  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 sm:px-6">
      <article
        aria-labelledby="rug-nameplate"
        className={`flex flex-col gap-6 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper px-4 pb-6 pt-5 text-game-ink shadow-[var(--game-shadow)] sm:px-8 sm:pb-8 sm:pt-7 ${ON_PAPER}`}
      >
        <Masthead
          dateline={caseLead ? `${latest ? `Night ${latest.night}` : `Night ${save.night}`} · Extra edition` : latest ? `Night ${latest.night} · Late edition` : `Night ${save.night}`}
          issue={latest ? `No. ${latest.night}` : caseLead ? "Extra" : "No edition yet"}
        />
        {caseLead ? <CaseRugLead hero={caseLead.hero || save.hero.name.trim()} /> : null}
        {latest ? <FrontPage save={save} edition={latest} second={!!caseLead} /> : caseLead ? null : <EmptyFrontPage />}
        <MarketMovers />
      </article>

      {older.length > 0 ? <BackIssues save={save} editions={older} /> : null}
    </div>
  );
}

function FrontPage({ save, edition, second = false }: { save: HeroSave; edition: Edition; second?: boolean }) {
  return (
    <>
      <LeadStory edition={edition} second={second} />
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <ReaderPoll edition={edition} heroName={save.hero.name.trim()} />
        {edition.quest ? <QuestBox save={save} quest={edition.quest} /> : null}
      </div>
      <Stories edition={edition} />
    </>
  );
}
