"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createElement } from "react";

import { AVATARS, HeroArt } from "@/components/cast";
import { CaseTile } from "@/components/cases/case-tile";
import { CompeteTile } from "@/components/compete/compete-tile";
import { CityTile } from "@/components/tonight/city-tile";
import { MakeItYoursTile } from "@/components/first-minute/make-it-yours";
import { CrewChecklistTile } from "@/components/referrals/crew-checklist";
import { InviteTile } from "@/components/referrals/invite-tile";
import { stickerTileClass, StickerBadge, StickerButton, StickerChip, StickerFrame, StickerLink } from "@/components/game/kit";
import { useUnreadEdition } from "@/components/game/shell";
import { GameLoading, useHeroSave, type HeroSave } from "@/components/game/ui";
import { ArrowRight, Check, Heart, Moon, Swords, Target } from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { castById, type CastId } from "@wgp/game-core/cast";
import { ALLY_CAST, DISTRICTS, ERRANDS, SUITS, VILLAINS, villainLevel } from "@wgp/game-core/data";
import { activeQuest, generatePatrol } from "@wgp/game-core/engine";
import { CITY, INK, LINE } from "@/game/style";
import { useGame } from "@/game/store";
import type { Stop } from "@wgp/game-core/types";

/** Who's at a stop, for stickers and copy. */
function stopWho(stop: Stop): CastId {
  return stop.kind === "fight" ? stop.villain : ALLY_CAST[stop.ally];
}

function stopTitle(stop: Stop): string {
  if (stop.kind === "fight") return VILLAINS[stop.villain].name;
  return ERRANDS.find((e) => e.id === stop.errand)?.title ?? castById(ALLY_CAST[stop.ally]).name;
}

function stopKind(stop: Stop): string {
  if (stop.kind === "errand") return "Errand";
  return stop.boss ? "Boss" : "Fight";
}

/* ------------------------------------------------------------------ the hero, perched */

/** A rooftop edge for the hero to stand on: flat fills and ink, like the city. Decorative art. */
function Rooftop() {
  return (
    <svg aria-hidden viewBox="0 0 280 40" className="-mt-3 h-auto w-[min(280px,78vw)]" fill="none" stroke={INK} strokeWidth={LINE.near} strokeLinejoin="round">
      {/* A web line slung off the roof, out of frame. */}
      <path d="M232 14 C 252 18 268 24 282 34" strokeWidth={2} stroke={CITY.webLine} />
      <path d="M8 14 H272 V40 H8 Z" fill={CITY.rooftop} />
      <path d="M2 8 H278 V16 H2 Z" fill={CITY.mid[0]} />
      <path d="M40 24 h16 v10 h-16 Z M120 24 h16 v10 h-16 Z M200 24 h16 v10 h-16 Z" fill={CITY.windowLit} strokeWidth={2} />
    </svg>
  );
}

function HeroPerch({ save }: { save: HeroSave }) {
  const hero = save.hero;
  return (
    <div className="flex flex-col items-center [grid-area:hero]">
      <div className="wgp-bob origin-bottom">
        <StickerFrame label={`${hero.name}, in the ${SUITS[hero.suit].name} suit, on a rooftop`} className="[--s:clamp(128px,19dvh,196px)] lg:[--s:220px]">
          <HeroArt {...SUITS[hero.suit].colors} />
        </StickerFrame>
      </div>
      <Rooftop />
    </div>
  );
}

/* ------------------------------------------------------------------ route */

function RouteRow({ save, stops }: { save: HeroSave; stops: Stop[] }) {
  const p = save.patrol;
  const questVillain = activeQuest(save)?.villain;
  return (
    <ol aria-label="Tonight’s route" className="relative grid w-full max-w-[400px] grid-cols-4 justify-items-center [grid-area:route]">
      {/* The web the route hangs on. */}
      <span aria-hidden className="absolute inset-x-[12%] top-7 border-t-2 border-dashed border-game-paper/50" />
      {stops.map((stop, i) => {
        const done = !!p && (p.results.length > i || (p.phase === "summary" && i < p.index)) ;
        const current = !!p && !save.nightDone && p.phase !== "summary" && p.phase !== "briefing" && p.index === i;
        const quest = stop.kind === "fight" && (stop.quest || (stop.boss && stop.villain === questVillain));
        const kind = stopKind(stop);
        const status = done ? "done" : current ? "up next" : null;
        return (
          <li key={i} className="relative flex min-w-0 flex-col items-center gap-1.5">
            <span className={`relative rounded-[16px] ${current ? "wgp-pulse" : ""}`}>
              <StickerFrame drop="sm" className={`[--s:56px] ${done ? "opacity-60 grayscale-[0.4]" : ""}`}>
                {createElement(AVATARS[stopWho(stop)])}
              </StickerFrame>
              {done ? (
                <span aria-hidden className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border-2 border-game-ink bg-game-mint text-game-paper">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              ) : quest ? (
                <span aria-hidden className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-game-ink">
                  <Target className="size-3.5" strokeWidth={2.5} />
                </span>
              ) : null}
            </span>
            <span
              aria-hidden
              className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold uppercase tracking-[0.04em] ${
                current ? "bg-game-gold text-game-ink" : stop.kind === "fight" && stop.boss ? "bg-game-hero text-game-paper" : "bg-game-paper text-game-ink"
              }`}
            >
              {stop.kind === "fight" ? <Swords className="size-3" strokeWidth={2.5} /> : <Heart className="size-3" strokeWidth={2.5} />}
              {current ? "Next" : done ? "Done" : kind}
            </span>
            <span className="sr-only">
              Stop {i + 1}, {kind.toLowerCase()}: {stopTitle(stop)} in {DISTRICTS[stop.district].name}
              {quest ? ", tonight’s quest" : ""}
              {status ? `, ${status}` : ""}.
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ the one action */

function PrimaryAction({ save }: { save: HeroSave }) {
  const { dispatch } = useGame();
  const router = useRouter();
  const p = save.patrol;
  const mid = !!p && p.phase !== "briefing";

  let action;
  if (save.nightDone) {
    action = (
      <StickerButton variant="hero" size="xl" className="w-full" onClick={() => dispatch({ type: "sleep" })}>
        <Moon aria-hidden className="size-6" strokeWidth={2.25} />
        Sleep until tomorrow night
      </StickerButton>
    );
  } else if (mid) {
    action = (
      <StickerLink href="/play/patrol" variant="hero" size="xl" className="w-full">
        {p.phase === "summary" ? "See the night’s haul" : "Resume patrol"}
        <ArrowRight aria-hidden className="size-6" strokeWidth={2.25} />
      </StickerLink>
    );
  } else {
    action = (
      <StickerButton
        variant="hero"
        size="xl"
        className="w-full"
        onClick={() => {
          dispatch({ type: "start-patrol" });
          router.push("/play/patrol");
        }}
      >
        Swing out
        <ArrowRight aria-hidden className="size-6" strokeWidth={2.25} />
      </StickerButton>
    );
  }

  return (
    <div className="flex w-full max-w-[400px] flex-col items-center gap-1 [grid-area:action]">
      {action}
      {save.nightDone ? null : (
        <Link
          href="/play/classic"
          className="inline-flex min-h-11 items-center gap-1 rounded-full px-4 text-[14px] font-semibold text-game-paper underline decoration-game-paper/50 underline-offset-4 pointer-fine:hover:decoration-game-paper"
        >
          Classic mode
          <span className="sr-only">: play tonight turn by turn</span>
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ event tiles */

function RugTile({ save, highlight }: { save: HeroSave; highlight: boolean }) {
  const edition = save.editions[0];
  const unread = useUnreadEdition(save);
  return (
    <Link
      href="/play/rug"
      className={`${stickerTileClass} w-full flex-row items-center gap-3 self-stretch p-2.5 [grid-area:rug] lg:max-w-[320px] lg:self-center lg:justify-self-end ${highlight ? "ring-4 ring-game-gold" : ""}`}
    >
      <span className="relative shrink-0">
        <MiniAvatar id={edition?.who ?? "bearson"} className="size-11 rounded-[10px]" />
        {unread ? <StickerBadge className="absolute -left-2 -top-2">New</StickerBadge> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Daily Rug{unread ? <span className="sr-only">, new edition</span> : null}
        </span>
        <span className="line-clamp-2 text-[13px] font-bold uppercase leading-4 [overflow-wrap:anywhere]">
          {edition ? edition.headline : "No edition yet"}
        </span>
      </span>
    </Link>
  );
}

function QuestTile({ save }: { save: HeroSave }) {
  const tonight = activeQuest(save);
  // Tonight's quest, or once the night is done, the one tomorrow's paper just set.
  const quest = tonight ?? (save.nightDone ? (save.editions[0]?.quest ?? null) : null);
  return (
    <Link href="/play/rug#quest" className={`${stickerTileClass} w-full flex-row items-center gap-3 self-stretch p-2.5 [grid-area:quest] lg:max-w-[320px] lg:self-center lg:justify-self-start`}>
      {quest ? (
        <span className="relative shrink-0">
          <MiniAvatar id={quest.villain} className="size-11 rounded-[10px]" />
          <StickerBadge className="absolute -bottom-2 left-1/2 -translate-x-1/2">+{quest.rewardXp}</StickerBadge>
        </span>
      ) : (
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[10px] border-2 border-dashed border-game-ink/40 text-game-muted">
          <Target className="size-5" strokeWidth={2} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          {quest ? (tonight ? "Quest" : "Tomorrow") : "Quest"}
          {quest ? <span className="sr-only">, worth {quest.rewardXp} XP and loot</span> : null}
        </span>
        <span className="line-clamp-2 text-[13px] font-semibold leading-4">{quest ? quest.text : "None yet. The Rug sets one"}</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ the screen */

/*
 * Grid areas: upright phones stack it; short landscape puts the hero on the left;
 * desktop is a lobby, the hero in the middle with tonight's events either side.
 */
const GRID =
  "grid w-full grid-cols-2 justify-items-center gap-x-3 gap-y-3.5 [grid-template-areas:'title_title'_'hero_hero'_'route_route'_'action_action'_'case_case'_'rug_quest'] " +
  "[@media(orientation:landscape)_and_(max-height:520px)]:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] [@media(orientation:landscape)_and_(max-height:520px)]:gap-x-6 [@media(orientation:landscape)_and_(max-height:520px)]:gap-y-3 " +
  "[@media(orientation:landscape)_and_(max-height:520px)]:[grid-template-areas:'hero_title_title'_'hero_route_route'_'hero_action_action'_'rug_rug_quest'_'case_case_case'] " +
  "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-10 lg:gap-y-5 lg:[grid-template-areas:'._title_.'_'rug_hero_quest'_'._route_.'_'._action_.'_'._case_.']";

export function Tonight() {
  const save = useHeroSave();
  if (!save) return <GameLoading />;

  const hero = save.hero;
  const p = save.patrol;
  const stops = p?.stops ?? generatePatrol(save, hero).stops;
  const boss = stops[stops.length - 1] as Extract<Stop, { kind: "fight" }>;
  const mid = !!p && p.phase !== "briefing" && !save.nightDone;
  const here = mid && p.phase !== "summary" ? stops[p.index] : null;

  let headline: string;
  let line: string;
  if (save.nightDone) {
    headline = "Good work tonight.";
    line = "Bearson is already writing about you. Sleep, and a new patrol posts tomorrow night.";
  } else if (here) {
    headline = `Stop ${p!.index + 1} of ${stops.length}: ${DISTRICTS[here.district].name}`;
    line = `${stopTitle(here)} is waiting. ${VILLAINS[boss.villain].name} is the boss tonight.`;
  } else if (mid) {
    headline = "The night’s done. Bank it.";
    line = "Your haul is waiting at the end of the patrol.";
  } else {
    headline = `${VILLAINS[boss.villain].name} is loose.`;
    line = `“${VILLAINS[boss.villain].taunt}”`;
  }

  return (
    <div className="wgp-rise mx-auto flex min-h-[calc(100dvh-180px)] w-full max-w-[460px] flex-col justify-center px-4 lg:max-w-[1100px] lg:px-8 [@media(orientation:landscape)_and_(max-height:520px)]:max-w-[880px]">
      <div className={GRID}>
        <header className="flex flex-col items-center gap-2 text-center [grid-area:title] [@media(orientation:landscape)_and_(max-height:520px)]:items-start [@media(orientation:landscape)_and_(max-height:520px)]:text-left">
          <StickerChip>
            <Moon aria-hidden className="size-4" strokeWidth={2.25} />
            <span className="num">Night {save.night}</span>
            <span aria-hidden className="text-game-muted">·</span>
            <span className="num font-medium text-game-muted">Villains lv {villainLevel(save.night)}</span>
          </StickerChip>
          <h1 className="max-w-[18ch] font-display text-[30px] font-semibold leading-[32px] tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[36px] sm:leading-[38px] [@media(orientation:landscape)_and_(max-height:520px)]:text-[26px] [@media(orientation:landscape)_and_(max-height:520px)]:leading-[28px]">
            {headline}
          </h1>
          <p className="max-w-[36ch] text-[14px] leading-5 text-game-paper/80">{line}</p>
        </header>

        <HeroPerch save={save} />
        <RouteRow save={save} stops={stops} />
        <PrimaryAction save={save} />

        <div className="contents">
          <RugTile save={save} highlight={save.nightDone} />
          <QuestTile save={save} />
        </div>
        <div className="flex w-full flex-col gap-3 [grid-area:case] lg:max-w-[400px]">
          <MakeItYoursTile save={save} />
          <CrewChecklistTile save={save} />
          <CaseTile save={save} />
          <CompeteTile />
          <CityTile save={save} />
          <InviteTile />
        </div>
      </div>
    </div>
  );
}
