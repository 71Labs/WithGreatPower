import { describe, expect, it } from "vitest";

import type { InvitedFriend, ReferralReward, ReferralsView } from "./api";
import {
  checkClaimInput,
  claimProblem,
  crewChecklist,
  crewWelcomeText,
  friendSteps,
  inviteSummary,
  joinedLabel,
  progressSlots,
  progressSpoken,
  rewardView,
} from "./view";

const friend = (handle: string, x: boolean, played: boolean): InvitedFriend => ({ handle, joinedAt: "2026-11-07T10:00:00Z", x, played, qualified: x && played });
const reward = (state: ReferralReward["state"], tx: string | null = null): ReferralReward => ({ state, xp: 300, badge: "recruiter", tx });
const view = (over: Partial<ReferralsView> = {}): ReferralsView => ({
  code: "K7Q2M9X",
  link: "https://www.wgponnear.fun/invite/K7Q2M9X",
  goal: 3,
  qualified: 0,
  invited: [],
  reward: reward("locked"),
  referredBy: null,
  canClaim: false,
  ...over,
});

describe("a friend's steps", () => {
  it("are Joined · X added · Played, each done or not", () => {
    expect(friendSteps(friend("nora", true, false))).toEqual([
      { id: "joined", label: "Joined", done: true },
      { id: "x", label: "X added", done: true },
      { id: "played", label: "Played", done: false },
    ]);
  });

  it("show the day they joined, in UTC", () => {
    expect(joinedLabel("2026-11-07T23:30:00Z")).toBe("Joined Nov 7");
    expect(joinedLabel("not a date")).toBe("Joined");
  });
});

describe("progress", () => {
  it("fills the slots in order with the friends who count", () => {
    const invited = [friend("ana", true, false), friend("nora", true, true), friend("max", true, true)];
    expect(progressSlots({ goal: 3, qualified: 2, invited })).toEqual([
      { n: 1, handle: "nora" },
      { n: 2, handle: "max" },
      { n: 3, handle: null },
    ]);
  });

  it("trusts the server's count (it dedupes X handles), and stops at the goal", () => {
    const invited = [friend("nora", true, true), friend("twin", true, true)];
    expect(progressSlots({ goal: 3, qualified: 1, invited }).map((s) => s.handle)).toEqual(["nora", null, null]);
    expect(progressSlots({ goal: 3, qualified: 5, invited }).map((s) => s.handle)).toEqual(["nora", "twin", "A friend"]);
    expect(progressSpoken(5, 3)).toBe("3 of 3 friends count");
  });
});

describe("the reward", () => {
  it("is locked until 3 count, saying how many to go", () => {
    expect(rewardView(reward("locked"), 1, 3)).toMatchObject({ kind: "locked", status: "Locked", detail: "2 more friends to go.", href: null });
    expect(rewardView(reward("locked"), 2, 3).detail).toBe("1 more friend to go.");
    expect(rewardView(reward("locked"), 3, 3).detail).toBe("All your friends count. Your reward is on its way.");
  });

  it("is earned once granted or queued: XP in, badge queued", () => {
    for (const state of ["granted", "queued"] as const) {
      expect(rewardView(reward(state), 3, 3)).toEqual({ kind: "earned", status: "Earned", detail: "300 XP is in your hero’s bar. Your Recruiter badge is queued to mint on NEAR.", href: null });
    }
  });

  it("links the mint on NearBlocks once minted", () => {
    const minted = rewardView(reward("minted", "8Hq3vZ"), 3, 3);
    expect(minted.kind).toBe("minted");
    expect(minted.href).toMatch(/^https:\/\/(testnet\.)?nearblocks\.io\/txns\/8Hq3vZ$/);
    expect(rewardView(reward("minted", null), 3, 3).href).toBeNull();
  });

  it("never promises money", () => {
    const words = (["locked", "granted", "queued", "minted"] as const).map((s) => rewardView(reward(s, "tx"), 1, 3).detail).join(" ");
    expect(words).not.toMatch(/\$|usdc|money|cash|prize|paid|payout/i);
  });
});

describe("the entry points' summary", () => {
  it("asks guests to sign in, with no count", () => {
    expect(inviteSummary({ status: "guest" })).toEqual({ count: null, line: "Sign in to get your link", spoken: null });
  });

  it("reads Invite friends · n/3", () => {
    expect(inviteSummary({ status: "ready", view: view() })).toMatchObject({ count: "0/3", line: "Bring 3 friends into the city" });
    expect(inviteSummary({ status: "ready", view: view({ qualified: 2 }) })).toEqual({ count: "2/3", line: "1 more friend to the Recruiter badge", spoken: "2 of 3 friends count" });
    expect(inviteSummary({ status: "ready", view: view({ qualified: 3, reward: reward("granted") }) })).toMatchObject({ count: "3/3", line: "Recruiter badge earned" });
  });

  it("holds its line while loading or after an error", () => {
    expect(inviteSummary({ status: "loading" }).count).toBeNull();
    expect(inviteSummary({ status: "error" }).line).toBe("Bring 3 friends into the city");
  });
});

describe("the late claim", () => {
  it("checks the field on submit, loosely: the server reads look-alikes and decides", () => {
    expect(checkClaimInput("")).toEqual({ ok: false, message: "Enter the invite code from your friend’s link." });
    expect(checkClaimInput("abc")).toEqual({ ok: false, message: "Invite codes are 7 letters and numbers, like K7Q2M9X." });
    expect(checkClaimInput("k7q2m9x")).toEqual({ ok: true, code: "K7Q2M9X" });
    expect(checkClaimInput(" k7q-oil 9 ")).toEqual({ ok: true, code: "K7QOIL9" });
    expect(checkClaimInput("https://www.wgponnear.fun/invite/k7q2m9x")).toEqual({ ok: true, code: "K7Q2M9X" });
    expect(checkClaimInput("ABCDEFGHIJKLM").ok).toBe(false);
    expect(checkClaimInput("K7Q2M9X!").ok).toBe(false);
  });

  it("shows the server's message when it sends one", () => {
    expect(claimProblem({ ok: false, status: 409, error: "already_referred", message: "You already have an inviter." })).toBe("You already have an inviter.");
  });

  it("explains each refusal by its code otherwise", () => {
    const no = (status: number, error: string) => claimProblem({ ok: false, status, error });
    expect(no(409, "already_referred")).toBe("You’re already in a crew.");
    expect(no(422, "bad_code")).toMatch(/don’t know that code/);
    expect(no(422, "self")).toMatch(/your own code/);
    expect(no(422, "too_late")).toMatch(/first 48 hours/);
    expect(no(422, "cycle")).toMatch(/You invited this player/);
    expect(no(0, "network")).toBe("Couldn’t reach the server. Try again.");
    expect(no(429, "rate_limited")).toMatch(/Wait a minute/);
    expect(no(401, "unauthorized")).toBe("Sign in again to add a code.");
    expect(no(500, "http_500")).toBe("Couldn’t add that code. Try again.");
  });
});

describe("the friend's checklist", () => {
  it("shows only to an invited player, until they count", () => {
    expect(crewChecklist({ view: null })).toBeNull();
    expect(crewChecklist({ view: { referredBy: null } })).toBeNull();
    expect(crewChecklist({ view: { referredBy: "sele" } })).toEqual({ referrer: "sele", x: false, played: false });
    expect(crewChecklist({ view: { referredBy: "sele" }, xHandle: "nora", nights: 2 })).toBeNull();
  });

  it("prefers the server's own word when it sends one", () => {
    expect(crewChecklist({ view: { referredBy: "sele", self: { x: true, played: false, qualified: false } }, nights: 9 })).toEqual({ referrer: "sele", x: true, played: false });
    expect(crewChecklist({ view: { referredBy: "sele", self: { x: false, played: false, qualified: true } } })).toBeNull();
  });

  it("doesn't take an imported browser save's nights for verified runs", () => {
    expect(crewChecklist({ view: { referredBy: "sele" }, xHandle: "nora", nights: 4, migrated: true })).toEqual({ referrer: "sele", x: true, played: false });
  });

  it("welcomes them by the inviter's handle; guests are asked to sign in", () => {
    expect(crewWelcomeText("sele", false)).toBe("You joined sele’s crew.");
    expect(crewWelcomeText("sele", true)).toBe("You joined sele’s crew. Sign in so your nights count for them.");
    expect(crewWelcomeText(null, false)).toBe("You joined a friend’s crew.");
  });
});
