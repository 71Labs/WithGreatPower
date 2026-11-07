/**
 * The invite landing's body (src/app/invite/[code]): who invited you, with their hero's
 * sticker, three steps to count for their crew and one red action, "Start playing"
 * (the accept route sets the invite cookie and sends you to /play). An unknown code says
 * so and offers "Play anyway"; a lookup that couldn't answer still offers the invite.
 * Server-safe; RememberInvite stores the code in the browser.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { HeroArt } from "@/components/cast";
import { GameBackdrop } from "@/components/game/backdrop";
import { KitStyles, ON_PAPER, StickerFrame, StickerPanel, stickerButtonClass } from "@/components/game/kit";
import { ArrowRight, CircleAlert, Users } from "@/components/icons";
import { acceptInvitePath } from "@/lib/referrals/api";
import type { LandingInvite } from "@/lib/referrals/landing";
import { SUITS } from "@wgp/game-core/data";
import type { SuitId } from "@wgp/game-core/types";

import { RememberInvite } from "./remember-invite";

const suitOf = (suit: string | null | undefined): SuitId => (suit && suit in SUITS ? (suit as SuitId) : "classic");

function Steps({ who }: { who: string }) {
  const steps = [
    { title: "Start playing", text: "Right in your browser. No download, no wallet." },
    { title: "Sign in", text: `Google works, and you join ${who} crew.` },
    { title: "Add your X and play a night", text: `Then you count toward ${who} 3.` },
  ];
  return (
    <ol className="flex flex-col gap-2.5 border-y-2 border-dashed border-game-ink/25 py-4">
      {steps.map((s, i) => (
        <li key={s.title} className="flex items-start gap-3">
          <span aria-hidden className="num grid size-7 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-[13px] font-bold text-game-ink">
            {i + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
            <span className="text-[15px] font-semibold leading-5 text-game-ink">{s.title}</span>
            <span className="text-[13px] leading-[18px] text-game-muted [overflow-wrap:anywhere]">{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Chip({ tone, icon, children }: { tone: "gold" | "paper"; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-8 w-fit items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink px-3 text-[13px] font-bold text-game-ink shadow-[var(--game-shadow-sm)] ${tone === "gold" ? "bg-game-gold" : "bg-game-paper-2"}`}
    >
      {icon}
      {children}
    </span>
  );
}

const PITCH = "A web-swinging superhero parody on NEAR: swing the city at night, stop parody villains, and climb boards where the server replays every night before it counts.";

function Invited({ invite }: { invite: Extract<LandingInvite, { state: "valid" | "unavailable" }> }) {
  const referrer = invite.state === "valid" ? invite.referrer : null;
  const who = referrer ? `${referrer.handle}’s` : "your friend’s";
  const suit = suitOf(referrer?.suit);
  return (
    <>
      <div className="flex items-center gap-4">
        <StickerFrame
          label={referrer ? (referrer.heroName ? `${referrer.heroName}, ${referrer.handle}’s hero, in the ${SUITS[suit].name} suit` : `${referrer.handle}’s hero`) : undefined}
          className="-rotate-3 [--s:92px] sm:[--s:116px]"
        >
          <HeroArt {...SUITS[suit].colors} />
        </StickerFrame>
        <div className="flex min-w-0 flex-col gap-2">
          <Chip tone="gold" icon={<Users aria-hidden className="size-4" strokeWidth={2.25} />}>
            You’re invited
          </Chip>
          {referrer?.heroName ? (
            <p className="text-[13px] leading-[18px] text-game-muted [overflow-wrap:anywhere]">
              Their hero: <span className="font-semibold text-game-ink">{referrer.heroName}</span>
            </p>
          ) : null}
        </div>
      </div>
      <h1 id="invite-title" className="font-display text-[30px] font-semibold leading-[34px] tracking-[-0.03em] text-game-ink [overflow-wrap:anywhere] [text-wrap:balance] sm:text-[38px] sm:leading-[42px]">
        {referrer ? (
          <>
            <span className="text-game-hero">{referrer.handle}</span> invited you to With Great Power
          </>
        ) : (
          "You’re invited to With Great Power"
        )}
      </h1>
      <p className="max-w-[60ch] text-[15px] leading-[22px] text-game-ink [text-wrap:pretty]">{PITCH}</p>
      <Steps who={who} />
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-5">
        {/* A plain link: the accept route answers with a redirect and a cookie, not a page. */}
        <a href={acceptInvitePath(invite.code)} className={stickerButtonClass("hero", "lg", "w-full sm:w-auto")}>
          Start playing
          <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
        </a>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-1 text-[14px] font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
        >
          See what the game is
        </Link>
      </div>
    </>
  );
}

function Unknown({ code }: { code: string | null }) {
  return (
    <>
      <Chip tone="paper" icon={<CircleAlert aria-hidden className="size-4 text-game-hero" strokeWidth={2.25} />}>
        Invite not found
      </Chip>
      <h1 id="invite-title" className="font-display text-[30px] font-semibold leading-[34px] tracking-[-0.03em] text-game-ink [text-wrap:balance] sm:text-[38px] sm:leading-[42px]">
        This invite link doesn’t work
      </h1>
      <p className="max-w-[60ch] text-[15px] leading-[22px] text-game-ink [text-wrap:pretty]">
        {code ? (
          <>
            We don’t know the code <span className="font-mono font-semibold tracking-[0.08em]">{code}</span>.{" "}
          </>
        ) : (
          "That isn’t a whole invite code. "
        )}
        Check the link with whoever sent it. You can still play, and add a friend’s code in your first 48 hours.
      </p>
      <p className="max-w-[60ch] text-[14px] leading-5 text-game-muted [text-wrap:pretty]">{PITCH}</p>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-5">
        <Link href="/play" className={stickerButtonClass("hero", "lg", "w-full sm:w-auto")}>
          Play anyway
          <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-1 text-[14px] font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
        >
          See what the game is
        </Link>
      </div>
    </>
  );
}

export function InviteLanding({ invite }: { invite: LandingInvite }) {
  return (
    <div data-wgp-night="" className="relative isolate min-h-dvh bg-game-night text-game-paper [--vs-focus:var(--game-gold)]">
      <KitStyles />
      <GameBackdrop variant="flow" />
      <main id="main" className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="flex w-full max-w-[600px] flex-col gap-5">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center self-start rounded-full text-[13px] font-bold uppercase tracking-[0.08em] text-game-paper/85 underline-offset-4 pointer-fine:hover:underline"
          >
            With Great Power
          </Link>
          <StickerPanel as="article" aria-labelledby="invite-title" className={`wgp-rise flex flex-col gap-5 p-5 sm:p-7 ${ON_PAPER}`}>
            {invite.state === "unknown" ? <Unknown code={invite.code} /> : <Invited invite={invite} />}
          </StickerPanel>
          {invite.state !== "unknown" ? (
            <p className="text-center text-[13px] leading-5 text-game-paper/75">
              Invite code <span className="font-mono font-semibold tracking-[0.08em] text-game-paper">{invite.code}</span>
            </p>
          ) : null}
        </div>
      </main>
      {invite.state !== "unknown" ? <RememberInvite code={invite.code} referrer={invite.state === "valid" ? invite.referrer.handle : null} /> : null}
    </div>
  );
}
