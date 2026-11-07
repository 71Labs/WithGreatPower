/**
 * What the referral screens say, worked out from the API's answers: pure, so it's tested
 * without a browser. Copy is sentence case with curly quotes, and never promises money:
 * the reward is the soulbound Recruiter badge and 300 XP.
 */
import type { ApiResult } from "@/lib/api/client";
import { EXPLORER_URL } from "@/lib/near/config";

import type { ClaimResponse, InvitedFriend, ReferralReward, ReferralsView } from "./api";
import { claimCodeFromInput } from "./code";

export const DEFAULT_GOAL = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ a friend's steps */

export type StepId = "joined" | "x" | "played";
export interface FriendStep {
  id: StepId;
  label: string;
  done: boolean;
}

/** Joined · X added · Played, each marked done or not (an icon and a word on screen, never colour alone). */
export function friendSteps(friend: InvitedFriend): FriendStep[] {
  return [
    { id: "joined", label: "Joined", done: true },
    { id: "x", label: "X added", done: friend.x },
    { id: "played", label: "Played", done: friend.played },
  ];
}

/** "Joined Nov 7" (UTC, so it reads the same everywhere). */
export function joinedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Joined";
  return `Joined ${at.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`;
}

/* ------------------------------------------------------------------ progress */

export interface Slot {
  /** 1-based. */
  n: number;
  /** The qualified friend in this slot, or null while it's open. */
  handle: string | null;
}

/** The goal's slots, filled in order by the friends who count. */
export function progressSlots(view: Pick<ReferralsView, "goal" | "qualified" | "invited">): Slot[] {
  const goal = Math.max(1, view.goal || DEFAULT_GOAL);
  const counted = view.invited.filter((f) => f.qualified).map((f) => f.handle);
  return Array.from({ length: goal }, (_, i) => ({
    n: i + 1,
    // The server's count is the truth (X handles are deduped there); names fill what it counts.
    handle: i < view.qualified ? (counted[i] ?? "A friend") : null,
  }));
}

/** "2 of 3 friends count", for screen readers and summaries. */
export function progressSpoken(qualified: number, goal: number): string {
  return `${Math.min(qualified, goal)} of ${goal} friends count`;
}

/* ------------------------------------------------------------------ the reward */

export interface RewardView {
  kind: "locked" | "earned" | "minted";
  /** The state as a word on the pill. */
  status: string;
  detail: string;
  /** NearBlocks, once minted with a tx. */
  href: string | null;
}

export const txUrl = (tx: string) => `${EXPLORER_URL}/txns/${encodeURIComponent(tx)}`;

export function rewardView(reward: ReferralReward, qualified: number, goal: number): RewardView {
  if (reward.state === "minted")
    return { kind: "minted", status: "Minted", detail: "Your Recruiter badge is on NEAR, on your hero, for good.", href: reward.tx ? txUrl(reward.tx) : null };
  if (reward.state === "granted" || reward.state === "queued")
    return {
      kind: "earned",
      status: "Earned",
      detail: `${reward.xp} XP is in your hero’s bar. Your Recruiter badge is queued to mint on NEAR.`,
      href: null,
    };
  const left = Math.max(0, goal - qualified);
  return {
    kind: "locked",
    status: "Locked",
    detail: left > 0 ? `${plural(left, "more friend")} to go.` : "All your friends count. Your reward is on its way.",
    href: null,
  };
}

/* ------------------------------------------------------------------ entry points */

export type ReferralsState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "error" }
  | { status: "ready"; view: ReferralsView };

export interface InviteSummary {
  /** "1/3" once known. */
  count: string | null;
  line: string;
  /** The count in words, for screen readers. */
  spoken: string | null;
}

/** The one-line summary the Tonight tile, the account row and the Hero page show. */
export function inviteSummary(state: ReferralsState): InviteSummary {
  if (state.status === "guest") return { count: null, line: "Sign in to get your link", spoken: null };
  if (state.status !== "ready") return { count: null, line: "Bring 3 friends into the city", spoken: null };
  const { goal, qualified, reward } = state.view;
  const shown = Math.min(qualified, goal);
  const count = `${shown}/${goal}`;
  const spoken = progressSpoken(qualified, goal);
  if (reward.state !== "locked") return { count, line: "Recruiter badge earned", spoken };
  if (qualified === 0) return { count, line: `Bring ${goal} friends into the city`, spoken };
  const left = Math.max(0, goal - qualified);
  return { count, line: left > 0 ? `${plural(left, "more friend")} to the Recruiter badge` : "Your reward is on its way", spoken };
}

/* ------------------------------------------------------------------ the late claim */

export type ClaimInput = { ok: true; code: string } | { ok: false; message: string };

/** The "Got an invite code?" field, checked on submit (loosely: the server decides if a code is real). */
export function checkClaimInput(raw: string): ClaimInput {
  const check = claimCodeFromInput(raw);
  if (check.ok) return check;
  return {
    ok: false,
    message: check.reason === "empty" ? "Enter the invite code from your friend’s link." : "Invite codes are 7 letters and numbers, like K7Q2M9X.",
  };
}

/** Why a claim didn't go through: the server's own message when it sends one, else ours by code. */
export function claimProblem(res: Extract<ApiResult<ClaimResponse>, { ok: false }>): string {
  if (res.message?.trim()) return res.message.trim();
  switch (res.error) {
    case "already_referred":
      return "You’re already in a crew.";
    case "bad_code":
      return "We don’t know that code. Check it with your friend and try again.";
    case "self":
      return "That’s your own code. Ask a friend for theirs.";
    case "too_late":
      return "Invite codes can only be added in your first 48 hours, and yours are up.";
    case "cycle":
      return "You invited this player, so they can’t be your inviter.";
  }
  if (res.status === 0) return "Couldn’t reach the server. Try again.";
  if (res.status === 401) return "Sign in again to add a code.";
  if (res.status === 429) return "That’s a lot of tries. Wait a minute and try again.";
  return "Couldn’t add that code. Try again.";
}

/* ------------------------------------------------------------------ the friend's side */

export interface CrewChecklist {
  referrer: string;
  x: boolean;
  played: boolean;
}

/**
 * "Count for {referrer}": what a referred player still has to do, until they count. Uses
 * the server's `self` when it sends one. Otherwise X is the account's saved handle, and a
 * night played is a night on the server save of an account that didn't import a browser
 * save (an imported save's nights weren't verified runs, so they can't say).
 */
export function crewChecklist(input: {
  view: Pick<ReferralsView, "referredBy" | "self"> | null;
  xHandle?: string | null;
  nights?: number;
  migrated?: boolean;
}): CrewChecklist | null {
  const { view } = input;
  if (!view?.referredBy) return null;
  if (view.self?.qualified) return null;
  const x = view.self?.x ?? !!input.xHandle;
  const played = view.self?.played ?? (!input.migrated && (input.nights ?? 0) > 0);
  if (x && played) return null;
  return { referrer: view.referredBy, x, played };
}

/** The friend-side toast. Guests haven't joined anything yet: they're asked to sign in. */
export function crewWelcomeText(referrer: string | null, guest: boolean): string {
  const who = referrer ? `${referrer}’s` : "a friend’s";
  return guest ? `You joined ${who} crew. Sign in so your nights count for them.` : `You joined ${who} crew.`;
}
