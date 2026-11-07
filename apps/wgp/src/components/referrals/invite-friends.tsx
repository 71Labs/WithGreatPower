"use client";

/**
 * /play/invite, "Invite friends": the "Invite 3 friends" campaign. Your link (copy it,
 * share it on X), your crew filling three slots, each invited friend's steps, the
 * Recruiter badge + 300 XP, how a friend counts, and "Got an invite code?" while you can
 * still add an inviter. Guests get a sign-in prompt, since a link needs an account.
 *
 * Phones stack it in reading order; from 1024px it's two columns (your link and crew on
 * the left, the reward and the rules on the right).
 */
import { ON_PAPER, StickerButton, StickerChip, StickerPanel } from "@/components/game/kit";
import { CircleAlert, RotateCcw, Users } from "@/components/icons";
import { showToast } from "@/game/store";
import { patchReferrals, refreshReferrals, useReferrals } from "@/lib/referrals/store";
import { DEFAULT_GOAL, crewWelcomeText, type ReferralsState } from "@/lib/referrals/view";

import { ClaimForm, CrewNote, InviteLinkCard, SignInCard } from "./invite-actions";
import { CrewPanel, HowItCounts, RewardCard } from "./parts";

const LOCKED = { state: "locked", xp: 300, badge: "recruiter", tx: null } as const;

function Loading() {
  return (
    <StickerPanel className={`flex min-h-[188px] flex-col justify-center gap-3 p-4 sm:p-5 ${ON_PAPER}`}>
      <p role="status" className="flex items-center gap-2.5 text-[14px] font-semibold text-game-muted">
        <span aria-hidden className="size-2.5 rounded-full bg-game-ink/40 motion-safe:animate-pulse" />
        Getting your invite link…
      </p>
    </StickerPanel>
  );
}

function LoadError() {
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper p-4 text-game-ink shadow-[var(--game-shadow)] sm:p-5 ${ON_PAPER}`}>
      <p className="flex items-start gap-2.5 text-[14px] leading-5">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
        <span>
          <span className="font-bold">Couldn’t load your invites.</span> Your link and your crew are safe on the server.
        </span>
      </p>
      <StickerButton size="sm" onClick={refreshReferrals} className="self-start">
        <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
        Try again
      </StickerButton>
    </div>
  );
}

function claimed(referredBy: string) {
  patchReferrals({ referredBy, canClaim: false });
  refreshReferrals();
  showToast(crewWelcomeText(referredBy, false), "success");
}

/** The two columns: on phones `contents`, so their children stack in DOM order. */
const COLUMN = "contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5";

function Body({ state }: { state: ReferralsState }) {
  if (state.status === "guest")
    return (
      <>
        <div className={COLUMN}>
          <SignInCard />
        </div>
        <div className={COLUMN}>
          <RewardCard reward={LOCKED} qualified={0} goal={DEFAULT_GOAL} />
          <HowItCounts goal={DEFAULT_GOAL} />
        </div>
      </>
    );
  if (state.status === "loading")
    return (
      <>
        <div className={COLUMN}>
          <Loading />
        </div>
        <div className={COLUMN}>
          <HowItCounts goal={DEFAULT_GOAL} />
        </div>
      </>
    );
  if (state.status === "error")
    return (
      <>
        <div className={COLUMN}>
          <LoadError />
        </div>
        <div className={COLUMN}>
          <HowItCounts goal={DEFAULT_GOAL} />
        </div>
      </>
    );
  const v = state.view;
  return (
    <>
      <div className={COLUMN}>
        <InviteLinkCard link={v.link} code={v.code} />
        <CrewPanel goal={v.goal} qualified={v.qualified} invited={v.invited} />
      </div>
      <div className={COLUMN}>
        <RewardCard reward={v.reward} qualified={v.qualified} goal={v.goal} />
        <HowItCounts goal={v.goal} />
        {v.referredBy ? <CrewNote referrer={v.referredBy} /> : v.canClaim ? <ClaimForm onClaimed={claimed} /> : null}
      </div>
    </>
  );
}

/** Drawn from a state, so tests and fixtures can render any of them. */
export function InviteFriendsView({ state }: { state: ReferralsState }) {
  const goal = state.status === "ready" ? state.view.goal : DEFAULT_GOAL;
  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[520px] flex-col gap-6 px-4 pb-4 sm:max-w-[640px] lg:max-w-[1040px] lg:px-8">
      <header className="flex flex-col items-center gap-2 text-center">
        <StickerChip>
          <Users aria-hidden className="size-4" strokeWidth={2.25} />
          Recruit your crew
        </StickerChip>
        <h1 className="font-display text-[34px] font-semibold leading-9 tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] [text-wrap:balance] sm:text-[44px] sm:leading-[46px]">
          Invite {goal} friends
        </h1>
        <p className="max-w-[44ch] text-[14px] leading-5 text-game-paper/80 [text-wrap:pretty] sm:text-[15px] sm:leading-[22px]">
          When {goal} friends join through your link, add their X and play a night, you earn the Recruiter badge and 300 XP.
        </p>
      </header>
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <Body state={state} />
      </div>
    </div>
  );
}

export function InviteFriends() {
  return <InviteFriendsView state={useReferrals()} />;
}
