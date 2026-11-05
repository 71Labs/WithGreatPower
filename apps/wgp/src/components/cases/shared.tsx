"use client";

/**
 * Pieces the case screens share: a Daily Rug front page in miniature, the rubber stamp,
 * the case's status pill and the "Case closed" badge's state. Paper and ink, from the
 * game's sticker kit. (A client module for BadgeBlock's sign-in button.)
 */

import type { ReactNode } from "react";

import { StickerButton, stickerButtonClass } from "@/components/game/kit";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { BadgeCheck, Check, Clock, ExternalLink, Hourglass, Lock, LogIn, Medal, Sparkles } from "@/components/icons";
import type { BadgeView, CaseStatus } from "@/lib/cases/view";
import { STATUS_LABEL } from "@/lib/cases/view";

/* ------------------------------------------------------------------ the front page */

const HEADLINE = {
  panel: "text-[clamp(1.75rem,1.2rem+2.4vw,2.5rem)] leading-[0.92]",
  card: "text-[clamp(1.625rem,1.1rem+2.2vw,2.5rem)] leading-[0.95]",
  lead: "text-[clamp(1.875rem,1.3rem+2.6vw,3.25rem)] leading-[0.95]",
} as const;

/**
 * A front page of The Daily Rug: the nameplate, the rules, a dateline, the headline in
 * caps, a photo with its caption, the story and Bearson's byline. `size` scales it from a
 * comic panel to the Rug's own lead.
 */
export function RugFront({
  headline,
  headingLevel = "h2",
  headingId,
  dateline,
  photo,
  caption,
  dek,
  story = [],
  byline = "By J. Jonah Bearson",
  size = "card",
  nameplate = true,
  className = "",
}: {
  headline: string;
  headingLevel?: "h1" | "h2" | "h3";
  headingId?: string;
  dateline?: [string, string];
  photo: ReactNode;
  caption: string;
  dek: string;
  story?: readonly string[];
  byline?: string;
  size?: keyof typeof HEADLINE;
  /** Draw the paper's name (off when it sits inside the Rug's own page). */
  nameplate?: boolean;
  className?: string;
}) {
  const H = headingLevel;
  const compact = size === "panel";
  return (
    <div className={`flex min-w-0 flex-col gap-3 text-game-ink ${className}`}>
      {nameplate ? (
        <header>
          <p className={`text-center font-display font-bold tracking-[-0.04em] ${compact ? "text-[26px] leading-7" : "text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] leading-[0.95]"}`}>The Daily Rug</p>
          <div aria-hidden className="mt-2 border-t-[3px] border-game-ink" />
          <div aria-hidden className="mt-[2px] border-t border-game-ink" />
          {dateline ? (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[10px] font-bold uppercase leading-3 tracking-[0.08em]">
              <p className="num">{dateline[0]}</p>
              <p className="text-game-muted">{dateline[1]}</p>
            </div>
          ) : null}
          <div aria-hidden className="border-t border-game-ink" />
        </header>
      ) : null}
      <H id={headingId} className={`font-display font-bold uppercase tracking-[-0.03em] [overflow-wrap:anywhere] ${HEADLINE[size]}`}>
        {headline}
      </H>
      <div className={`flex gap-3 ${compact ? "flex-col" : "flex-col sm:flex-row sm:items-start sm:gap-4"}`}>
        <figure className={`flex shrink-0 flex-col gap-1.5 ${compact ? "" : "sm:w-[44%]"}`}>
          <div className={`overflow-hidden rounded-[10px] border-2 border-game-ink bg-game-night ${compact ? "aspect-[13/10]" : "aspect-[16/10] sm:aspect-[4/3]"}`}>{photo}</div>
          <figcaption className="text-[11px] italic leading-[14px] text-game-muted">{caption}</figcaption>
        </figure>
        <div className="flex min-w-0 flex-col gap-2.5">
          <p className={`font-medium ${compact ? "text-[14px] leading-5" : "text-[16px] leading-6 sm:text-[17px] sm:leading-[26px]"}`}>{dek}</p>
          {story.map((p) => (
            <p key={p} className="text-[14px] leading-[21px] text-game-ink">
              {p}
            </p>
          ))}
          <p className="flex items-center gap-2 text-[12px] leading-4">
            <MiniAvatar id="bearson" className="size-7 rounded-[8px]" />
            <span className="font-semibold">{byline}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the stamp */

/** "Case file 001" in red rubber-stamp ink, pressed on at a tilt (still under reduced motion). */
export function CaseStamp({ number, children, className = "" }: { number: string; children?: ReactNode; className?: string }) {
  return (
    <span
      className={`animate-seal inline-flex -rotate-[8deg] flex-col items-center gap-0.5 rounded-[10px] border-[3px] border-game-hero px-4 py-2 text-game-hero outline-2 outline-offset-[3px] outline-game-hero [outline-style:solid] ${className}`}
    >
      <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.2em]">Case file</span>
      <span className="num font-display text-[40px] font-bold leading-[0.9] tracking-[-0.02em]">{number}</span>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ status */

const STATUS_STYLE: Record<CaseStatus, { icon: ReactNode; className: string }> = {
  new: { icon: <Sparkles aria-hidden className="size-3.5" strokeWidth={2.25} />, className: "bg-game-gold" },
  "in-progress": { icon: <Hourglass aria-hidden className="size-3.5" strokeWidth={2.25} />, className: "bg-game-paper" },
  closed: { icon: <Check aria-hidden className="size-3.5" strokeWidth={3} />, className: "bg-game-mint" },
};

/** The case's status as a pill: an icon and a word, never colour alone. */
export function StatusPill({ status, className = "" }: { status: CaseStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-game-ink ${s.className} ${className}`}
    >
      {s.icon}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A best time, written out with its spoken form for screen readers. */
export function CaseTime({ text, spoken, label = "Best time", className = "" }: { text: string; spoken: string; label?: string; className?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-[13px] leading-5 ${className}`}>
      <Clock aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />
      <span className="text-game-muted">{label}</span>
      <span aria-hidden className="num font-bold text-game-ink">
        {text}
      </span>
      <span className="sr-only">{spoken}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ the badge */

const BADGE_ICON: Record<BadgeView["kind"], ReactNode> = {
  "sign-in": <LogIn aria-hidden className="size-5" strokeWidth={2.25} />,
  locked: <Lock aria-hidden className="size-5" strokeWidth={2.25} />,
  pending: <Hourglass aria-hidden className="size-5" strokeWidth={2.25} />,
  queued: <Hourglass aria-hidden className="size-5" strokeWidth={2.25} />,
  minted: <BadgeCheck aria-hidden className="size-5" strokeWidth={2.25} />,
  unknown: <Medal aria-hidden className="size-5" strokeWidth={2.25} />,
};

/** The "Case closed" badge: its state in words, and the one thing to do about it. */
export function BadgeBlock({ badge, className = "" }: { badge: BadgeView; className?: string }) {
  const lit = badge.kind === "minted";
  return (
    <div className={`flex flex-col gap-2.5 rounded-[14px] border-2 border-game-ink px-3 py-2.5 ${lit ? "bg-game-gold" : "bg-game-paper-2"} ${className}`}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-paper">
          {BADGE_ICON[badge.kind]}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[14px] font-bold leading-5">{badge.label}</p>
          <p className="text-[13px] leading-[18px] text-game-muted text-pretty">{badge.detail}</p>
        </div>
      </div>
      {badge.kind === "sign-in" ? (
        <StickerButton variant="ink" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in"))} className="self-start">
          <LogIn aria-hidden className="size-4" strokeWidth={2.25} />
          Sign in
        </StickerButton>
      ) : badge.kind === "minted" && badge.href ? (
        <a href={badge.href} target="_blank" rel="noopener noreferrer" className={stickerButtonClass("paper", "sm", "self-start")}>
          View the mint on NearBlocks
          <ExternalLink aria-hidden className="size-4" strokeWidth={2.25} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}
