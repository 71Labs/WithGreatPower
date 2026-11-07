/**
 * Browser fetchers for referrals ("Invite 3 friends"), typed to the shared contract
 * (launch/out/agents/referrals-spec.md, owned by the server build; docs/referrals.md once
 * it lands). Like src/lib/api/client.ts, every call resolves to `{ ok: true, data }` or
 * `{ ok: false, status, error }` and never throws on an HTTP error; a network failure is
 * status 0, error "network".
 *
 * Privacy: the referrer only ever gets their friends' game handles, never an X handle or
 * a NEAR account.
 */
import type { SuitId } from "@wgp/game-core/types";

import { call, type ApiResult } from "@/lib/api/client";

/** The reward's life: locked until 3 friends qualify; granted (XP in) and queued (badge mint waiting) once earned; minted with its tx. */
export type RewardState = "locked" | "granted" | "queued" | "minted";

/** One friend who signed up through the player's link. `qualified` = `x` and `played`. */
export interface InvitedFriend {
  /** Their game handle (never their X handle or NEAR account). */
  handle: string;
  /** ISO time they joined. */
  joinedAt: string;
  /** They saved an X handle. */
  x: boolean;
  /** They have at least one verified run, any mode. */
  played: boolean;
  qualified: boolean;
}

export interface ReferralReward {
  state: RewardState;
  /** 300. */
  xp: number;
  badge: "recruiter";
  /** The badge mint's transaction, once minted. */
  tx: string | null;
}

/** GET /api/referrals (signed in; 401 otherwise). */
export interface ReferralsView {
  /** "K7Q2M9X". */
  code: string;
  /** The invite link on this deployment's origin. */
  link: string;
  /** 3. */
  goal: number;
  /** Friends who count (deduped by X handle). */
  qualified: number;
  invited: InvitedFriend[];
  reward: ReferralReward;
  /** The game handle of whoever invited this player. */
  referredBy: string | null;
  /** Whether "Got an invite code?" can still go through (no inviter yet, account under 48 h). */
  canClaim: boolean;
  /**
   * This player's own progress as their inviter's friend, counted by the server's rules (null
   * without an inviter; absent from older servers, when the Tonight checklist reads the
   * account instead: src/lib/referrals/view.ts crewChecklist).
   */
  self?: { x: boolean; played: boolean; qualified: boolean } | null;
}

/** Who sent an invite, as the public lookup tells it. */
export interface InviteReferrer {
  handle: string;
  /** Null-tolerant: a referrer may not have a hero yet. */
  heroName: string | null;
  suit: SuitId | null;
}

/** GET /api/invite/{code} (public, cached briefly). */
export interface InviteLookup {
  valid: boolean;
  referrer: InviteReferrer | null;
}

/** POST /api/referrals/claim → 200. */
export interface ClaimResponse {
  /** The inviter's game handle. */
  referredBy: string;
}

/** 409 already_referred · 422 bad_code | self | too_late | cycle (and 401, 429 from the platform). */
export type ClaimError = "already_referred" | "bad_code" | "self" | "too_late" | "cycle";

export const getReferrals = (signal?: AbortSignal): Promise<ApiResult<ReferralsView>> => call<ReferralsView>("/api/referrals", { signal });

export const getInvite = (code: string, signal?: AbortSignal): Promise<ApiResult<InviteLookup>> =>
  call<InviteLookup>(`/api/invite/${encodeURIComponent(code)}`, { signal });

/** A late claim: adds an inviter to a player who signed up without the link. */
export const claimInvite = (code: string): Promise<ApiResult<ClaimResponse>> => call<ClaimResponse>("/api/referrals/claim", { method: "POST", json: { code } });

/**
 * Where "Start playing" goes: the server sets the `wgp_ref` cookie and redirects to
 * /play?invited=1 (an unknown code goes to /play with no cookie).
 */
export const acceptInvitePath = (code: string) => `/api/invite/${encodeURIComponent(code)}/accept`;
