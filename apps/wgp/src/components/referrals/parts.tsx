/**
 * The pieces of "Invite friends" (/play/invite) that only draw what they're given: the
 * three slots filling toward 3, the invited friends with their steps, the reward card and
 * the "How it counts" explainer. Paper and ink from the sticker kit; every status is an
 * icon and a word, never colour alone. Server-safe (no hooks).
 */
import type { ReactNode } from "react";

import { ON_PAPER, StickerEyebrow, StickerPanel, stickerButtonClass } from "@/components/game/kit";
import { BadgeCheck, Check, CircleDashed, ExternalLink, Lock, Users } from "@/components/icons";
import type { InvitedFriend, ReferralReward } from "@/lib/referrals/api";
import { friendSteps, joinedLabel, progressSlots, progressSpoken, rewardView, type FriendStep, type Slot } from "@/lib/referrals/view";

import { RecruiterBadgeArt } from "./recruiter-badge";

/* ------------------------------------------------------------------ progress */

function SlotMark({ slot }: { slot: Slot }) {
  const filled = slot.handle !== null;
  return (
    <li className="relative flex min-w-0 flex-col items-center gap-1.5">
      <span
        aria-hidden
        className={`grid size-14 place-items-center rounded-full border-[2.5px] ${
          filled ? "border-game-ink bg-game-gold text-game-ink shadow-[var(--game-shadow-sm)]" : "border-dashed border-game-ink/45 bg-game-paper text-game-muted"
        }`}
      >
        {filled ? <Check className="size-6" strokeWidth={3} /> : <span className="num text-[18px] font-bold leading-none">{slot.n}</span>}
      </span>
      <span aria-hidden className={`max-w-full truncate text-[13px] leading-4 ${filled ? "font-semibold text-game-ink" : "font-medium text-game-muted"}`} title={slot.handle ?? undefined}>
        {slot.handle ?? "Open"}
      </span>
      <span className="sr-only">
        Friend {slot.n}: {filled ? `${slot.handle}, counts` : "open"}.
      </span>
    </li>
  );
}

/** Three slots, filling as friends count. `qualified` may pass the goal; the slots stop at it. */
export function InviteProgress({ goal, qualified, invited, titleId }: { goal: number; qualified: number; invited: InvitedFriend[]; titleId: string }) {
  const slots = progressSlots({ goal, qualified, invited });
  const shown = Math.min(qualified, goal);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <StickerEyebrow as="h2" id={titleId}>
          Your crew
        </StickerEyebrow>
        <p className="flex items-baseline gap-1 text-game-ink">
          <span aria-hidden className="num font-display text-[30px] font-bold leading-none tracking-[-0.02em]">
            {shown}
            <span className="text-game-muted">/{goal}</span>
          </span>
          <span aria-hidden className="text-[13px] font-semibold text-game-muted">
            count
          </span>
          <span className="sr-only">{progressSpoken(qualified, goal)}</span>
        </p>
      </div>
      <ol aria-label="Friends who count" className="relative grid grid-cols-3 gap-2">
        {/* The web the slots hang on. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-[16%] top-7 border-t-2 border-dashed border-game-ink/30" />
        {slots.map((slot) => (
          <SlotMark key={slot.n} slot={slot} />
        ))}
      </ol>
      {qualified > goal ? (
        <p className="num text-[13px] leading-5 text-game-muted">
          Plus {qualified - goal} more {qualified - goal === 1 ? "friend" : "friends"} who count. Thanks for the crew.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ friends */

function StepChip({ step }: { step: FriendStep }) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border-2 px-2 text-[12px] font-semibold leading-none ${
        step.done ? "border-game-ink bg-game-ink text-game-paper" : "border-dashed border-game-ink/45 bg-game-paper text-game-muted"
      }`}
    >
      {step.done ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : <CircleDashed aria-hidden className="size-3.5" strokeWidth={2.25} />}
      {step.label}
      <span className="sr-only">{step.done ? ": done" : ": not yet"}</span>
    </span>
  );
}

export function FriendRow({ friend }: { friend: InvitedFriend }) {
  const steps = friendSteps(friend);
  return (
    // Side by side only when the list itself is wide (a phone, or desktop's narrow column, stacks it).
    <li className="flex flex-col gap-2.5 rounded-[16px] border-2 border-game-ink bg-game-paper-2 p-2.5 pr-3 @xl:flex-row @xl:items-center @xl:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-paper text-[15px] font-bold uppercase text-game-ink">
          {friend.handle.slice(0, 1)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-[15px] font-semibold leading-5 text-game-ink" title={friend.handle}>
            {friend.handle}
          </p>
          <p className="num text-[12px] leading-4 text-game-muted">{joinedLabel(friend.joinedAt)}</p>
        </div>
        {friend.qualified ? (
          <span className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-gold px-2 text-[12px] font-bold leading-none text-game-ink">
            <BadgeCheck aria-hidden className="size-4" strokeWidth={2.25} />
            Counts
          </span>
        ) : null}
      </div>
      <ul aria-label={`${friend.handle}’s steps`} className="flex flex-wrap gap-1.5">
        {steps.map((s) => (
          <li key={s.id}>
            <StepChip step={s} />
          </li>
        ))}
      </ul>
    </li>
  );
}

export function FriendList({ invited, goal }: { invited: InvitedFriend[]; goal: number }) {
  if (invited.length === 0)
    return (
      <div className="flex items-start gap-3 rounded-[16px] border-2 border-dashed border-game-ink/40 px-3.5 py-3">
        <Users aria-hidden className="mt-0.5 size-5 shrink-0 text-game-muted" strokeWidth={2} />
        <p className="text-[14px] leading-5 text-game-muted [text-wrap:pretty]">
          Nobody yet. Send your link to {goal} friends; each one shows up here once they sign in.
        </p>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="num text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        Invited · {invited.length}
      </p>
      <ul className="@container flex flex-col gap-2">
        {invited.map((f) => (
          <FriendRow key={`${f.handle}-${f.joinedAt}`} friend={f} />
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ the reward */

const REWARD_PILL = {
  locked: { icon: <Lock aria-hidden className="size-3.5" strokeWidth={2.5} />, className: "bg-game-paper-2" },
  earned: { icon: <Check aria-hidden className="size-3.5" strokeWidth={3} />, className: "bg-game-gold" },
  minted: { icon: <BadgeCheck aria-hidden className="size-3.5" strokeWidth={2.5} />, className: "bg-game-gold" },
} as const;

/** Recruiter badge + 300 XP: locked, earned (XP in, badge queued) or minted with a NearBlocks link. */
export function RewardCard({ reward, qualified, goal }: { reward: ReferralReward; qualified: number; goal: number }) {
  const r = rewardView(reward, qualified, goal);
  const pill = REWARD_PILL[r.kind];
  return (
    <StickerPanel as="section" aria-labelledby="reward-title" className={`flex flex-col gap-3 p-4 sm:p-5 ${ON_PAPER}`}>
      <div className="flex items-center gap-4">
        <span className={`relative shrink-0 ${r.kind === "locked" ? "opacity-80 grayscale-[0.5]" : ""}`}>
          <RecruiterBadgeArt className="size-[84px]" clipId="reward-badge-well" />
          {r.kind === "locked" ? (
            <span aria-hidden className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-game-ink bg-game-paper text-game-ink">
              <Lock className="size-3.5" strokeWidth={2.5} />
            </span>
          ) : null}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <StickerEyebrow as="span">Your reward</StickerEyebrow>
          <h2 id="reward-title" className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-game-ink [text-wrap:balance]">
            Recruiter badge <span className="num whitespace-nowrap">+ {reward.xp} XP</span>
          </h2>
          <span
            className={`inline-flex h-7 w-fit items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-game-ink ${pill.className}`}
          >
            {pill.icon}
            {r.status}
          </span>
        </div>
      </div>
      <p className="text-[14px] leading-5 text-game-ink [text-wrap:pretty]">
        {r.kind === "locked" ? <>A soulbound badge on your hero, and {reward.xp} XP, once. </> : null}
        <span className="num">{r.detail}</span>
      </p>
      {r.href ? (
        <a href={r.href} target="_blank" rel="noopener noreferrer" className={stickerButtonClass("paper", "sm", "self-start")}>
          View the mint on NearBlocks
          <ExternalLink aria-hidden className="size-4" strokeWidth={2.25} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ how it counts */

const STEPS: { title: string; text: ReactNode }[] = [
  { title: "They join through you", text: "A friend opens your link and signs in, or adds your code in their first 48 hours." },
  { title: "They add their X", text: "In their account, under “On X”." },
  { title: "They play a night", text: "Any mode. It counts once the server has replay-verified it." },
];

export function HowItCounts({ goal }: { goal: number }) {
  return (
    <StickerPanel as="section" aria-labelledby="how-title" className={`flex flex-col gap-3.5 p-4 sm:p-5 ${ON_PAPER}`}>
      <StickerEyebrow as="h2" id="how-title">
        How it counts
      </StickerEyebrow>
      <ol className="flex flex-col gap-2.5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span aria-hidden className="num grid size-7 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-[13px] font-bold text-game-ink">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <span className="text-[15px] font-semibold leading-5 text-game-ink">{s.title}</span>
              <span className="text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t-2 border-dashed border-game-ink/25 pt-3 text-[13px] leading-5 text-game-muted [text-wrap:pretty]">
        When {goal} friends have done all three, the badge and XP are yours, once. Each X account counts once. You see your friends’ game handles only, never their X or NEAR account.
      </p>
    </StickerPanel>
  );
}

/** A panel for the crew: progress on top, the friends under it. */
export function CrewPanel({ goal, qualified, invited }: { goal: number; qualified: number; invited: InvitedFriend[] }) {
  return (
    <StickerPanel as="section" aria-labelledby="crew-title" className={`flex flex-col gap-5 p-4 sm:p-5 ${ON_PAPER}`}>
      <InviteProgress goal={goal} qualified={qualified} invited={invited} titleId="crew-title" />
      <FriendList invited={invited} goal={goal} />
    </StickerPanel>
  );
}
