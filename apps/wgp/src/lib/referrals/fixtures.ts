/**
 * Development fixtures for the referral screens, so every state renders without the
 * server: add `?fixture=<name>` to /play, /play/invite or /play/hero (or the invite
 * landing's `landing-*` names to /invite/<code>). Production builds ignore the switch
 * (referralFixture and landingFixture answer null there). Server-safe: no hooks.
 */
import type { InviteLookup, InvitedFriend, ReferralsView } from "./api";
import type { ReferralsState } from "./view";

const LINK = "https://www.wgponnear.fun/invite/K7Q2M9X";

const friend = (handle: string, day: number, x: boolean, played: boolean): InvitedFriend => ({
  handle,
  joinedAt: `2026-11-0${day}T10:00:00Z`,
  x,
  played,
  qualified: x && played,
});

const base: ReferralsView = {
  code: "K7Q2M9X",
  link: LINK,
  goal: 3,
  qualified: 0,
  invited: [],
  reward: { state: "locked", xp: 300, badge: "recruiter", tx: null },
  referredBy: null,
  canClaim: false,
};

const ready = (view: Partial<ReferralsView>): ReferralsState => ({ status: "ready", view: { ...base, ...view } });

/** Every referral fixture by name. A function, so production builds (where nothing calls it) drop the data. */
export function referralFixtures(): Record<string, ReferralsState> {
  const twoOfThree: InvitedFriend[] = [
    friend("nora", 5, true, true),
    friend("webhead_99", 6, true, true),
    friend("gweifan", 6, true, false),
    friend("mempool-max", 7, false, true),
    friend("aunt-may-be", 7, false, false),
  ];
  const threeOfThree: InvitedFriend[] = [friend("nora", 5, true, true), friend("webhead_99", 6, true, true), friend("gweifan", 6, true, true), friend("mempool-max", 7, false, true)];
  return {
    "referrals-guest": { status: "guest" },
    "referrals-loading": { status: "loading" },
    "referrals-error": { status: "error" },
    "referrals-0of3": ready({}),
    "referrals-claim": ready({ canClaim: true }),
    "referrals-2of3": ready({ qualified: 2, invited: twoOfThree }),
    /** 3/3 on the server's usual path: XP added, the badge waiting in the outbox. */
    "referrals-3of3": ready({ qualified: 3, invited: threeOfThree, reward: { state: "queued", xp: 300, badge: "recruiter", tx: null } }),
    /** The server's fallback state; drawn the same as queued. */
    "referrals-granted": ready({ qualified: 3, invited: threeOfThree, reward: { state: "granted", xp: 300, badge: "recruiter", tx: null } }),
    "referrals-minted": ready({
      qualified: 3,
      invited: threeOfThree,
      reward: { state: "minted", xp: 300, badge: "recruiter", tx: "8Hq3vZ1mJpYk2Qe4rT6uW9xA5bC7dE1fG3hJ5kL7mN9p" },
    }),
    /** More friends than the goal: the slots stop at 3/3, "+N more" under them. */
    "referrals-5of3": ready({ qualified: 5, invited: twoOfThree.map((f) => ({ ...f, x: true, played: true, qualified: true })), reward: { state: "minted", xp: 300, badge: "recruiter", tx: "8Hq3vZ" } }),
    /** A referred friend, nothing done yet (the Tonight checklist). */
    "referrals-crew": ready({ referredBy: "sele", self: { x: false, played: false, qualified: false } }),
    /** A referred friend with X added, a night still to play. */
    "referrals-crew-x": ready({ referredBy: "sele", self: { x: true, played: false, qualified: false } }),
  };
}

export const LANDING_FIXTURES: Record<string, InviteLookup | "unavailable"> = {
  "landing-valid": { valid: true, referrer: { handle: "sele", heroName: "Web Weaver", suit: "midnight" } },
  "landing-unknown": { valid: false, referrer: null },
  "landing-unavailable": "unavailable",
};

/** The referral fixture `name` stands for, in development only (src/lib/referrals/store.ts reads the URL). */
export function referralFixture(name: string | null): ReferralsState | null {
  if (process.env.NODE_ENV === "production" || !name) return null;
  return referralFixtures()[name] ?? null;
}

/** The landing fixture a `fixture` search param names, in development only. */
export function landingFixture(name: string | string[] | undefined): InviteLookup | "unavailable" | null {
  if (process.env.NODE_ENV === "production" || typeof name !== "string") return null;
  return LANDING_FIXTURES[name] ?? null;
}
