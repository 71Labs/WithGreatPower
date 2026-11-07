import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { InvitedFriend, ReferralReward, ReferralsView } from "@/lib/referrals/api";
import { referralFixtures } from "@/lib/referrals/fixtures";
import { inviteSummary, type ReferralsState } from "@/lib/referrals/view";

import { CrewChecklistView } from "./crew-checklist";
import { ClaimForm, InviteLinkCard, copyText, submitClaim } from "./invite-actions";
import { InviteFriendsView } from "./invite-friends";
import { InviteTileView } from "./invite-tile";
import { FriendList, FriendRow, InviteProgress, RewardCard } from "./parts";

/**
 * The referral screens drawn to static markup (no browser): what each state shows, its
 * accessible names and labels, and the links it points at. Interactions run through the
 * functions the components call (copyText, submitClaim).
 */

const friend = (handle: string, x: boolean, played: boolean): InvitedFriend => ({ handle, joinedAt: "2026-11-06T10:00:00Z", x, played, qualified: x && played });
const reward = (state: ReferralReward["state"], tx: string | null = null): ReferralReward => ({ state, xp: 300, badge: "recruiter", tx });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ready = (name: string) => referralFixtures()[name] as Extract<ReferralsState, { status: "ready" }>;

describe("progress", () => {
  it("fills two of three slots with the friends who count, the third open", () => {
    const html = renderToStaticMarkup(h(InviteProgress, { goal: 3, qualified: 2, invited: [friend("nora", true, true), friend("max", true, true), friend("ana", false, true)], titleId: "t" }));
    expect(text(html)).toContain("Friend 1: nora, counts.");
    expect(text(html)).toContain("Friend 2: max, counts.");
    expect(text(html)).toContain("Friend 3: open.");
    expect(text(html)).toContain("2 of 3 friends count");
    expect(html).toContain('class="num');
  });

  it("stops at 3/3 when more friends count, and says how many more", () => {
    const { view } = ready("referrals-5of3");
    const t = text(renderToStaticMarkup(h(InviteProgress, { goal: view.goal, qualified: view.qualified, invited: view.invited, titleId: "t" })));
    expect(t).toContain("3 of 3 friends count");
    expect(t).not.toContain(": open.");
    expect(t).toContain("Plus 2 more friends who count.");
  });

  it("starts empty at 0/3", () => {
    const html = renderToStaticMarkup(h(InviteProgress, { goal: 3, qualified: 0, invited: [], titleId: "t" }));
    expect(html.match(/: open\./g)).toHaveLength(3);
    expect(text(html)).toContain("0 of 3 friends count");
  });
});

describe("a friend's row", () => {
  it("names each step with an icon and a word, done or not yet", () => {
    const html = renderToStaticMarkup(h("ul", null, h(FriendRow, { friend: friend("gweifan", true, false) })));
    const t = text(html);
    expect(t).toContain("gweifan");
    expect(t).toContain("Joined Nov 6");
    expect(t).toContain("Joined : done");
    expect(t).toContain("X added : done");
    expect(t).toContain("Played : not yet");
    expect(t).not.toContain("Counts");
    expect(html).toContain('aria-label="gweifan’s steps"');
  });

  it("marks a friend who counts", () => {
    expect(text(renderToStaticMarkup(h("ul", null, h(FriendRow, { friend: friend("nora", true, true) }))))).toContain("Counts");
  });

  it("never shows a friend's X handle or NEAR account: the contract carries neither", () => {
    const shown = text(renderToStaticMarkup(h(FriendList, { invited: ready("referrals-2of3").view.invited, goal: 3 })));
    expect(shown).not.toMatch(/@|\.near\b|\.testnet\b/);
  });

  it("orients the player when nobody has joined yet", () => {
    expect(text(renderToStaticMarkup(h(FriendList, { invited: [], goal: 3 })))).toContain("Nobody yet. Send your link to 3 friends");
  });
});

describe("the reward card", () => {
  it("is locked with what's left", () => {
    const t = text(renderToStaticMarkup(h(RewardCard, { reward: reward("locked"), qualified: 2, goal: 3 })));
    expect(t).toContain("Recruiter badge + 300 XP");
    expect(t).toContain("Locked");
    expect(t).toContain("1 more friend to go.");
  });

  it("is earned once granted or queued", () => {
    for (const state of ["granted", "queued"] as const) {
      const t = text(renderToStaticMarkup(h(RewardCard, { reward: reward(state), qualified: 3, goal: 3 })));
      expect(t).toContain("Earned");
      expect(t).toContain("queued to mint on NEAR");
    }
  });

  it("links the mint on NearBlocks, in a new tab, once minted", () => {
    const html = renderToStaticMarkup(h(RewardCard, { reward: reward("minted", "8Hq3vZ"), qualified: 3, goal: 3 }));
    expect(html).toMatch(/href="https:\/\/(testnet\.)?nearblocks\.io\/txns\/8Hq3vZ"/);
    expect(html).toContain('target="_blank"');
    expect(text(html)).toContain("View the mint on NearBlocks");
    expect(text(html)).toContain("(opens in a new tab)");
    expect(text(html)).toContain("Minted");
  });
});

describe("your link", () => {
  const link = "https://www.wgponnear.fun/invite/K7Q2M9X";

  it("sits in a labelled field with Copy link, and Share on X opens X's composer", () => {
    const html = renderToStaticMarkup(h(InviteLinkCard, { link, code: "K7Q2M9X" }));
    expect(html).toMatch(/<label for="([^"]+)-link"[^>]*>Your invite link<\/label>/);
    expect(html).toMatch(/<input[^>]*type="url"[^>]*inputMode="url"[^>]*readOnly=""[^>]*value="https:\/\/www.wgponnear.fun\/invite\/K7Q2M9X"/);
    expect(text(html)).toContain("Copy link");
    const share = /href="(https:\/\/x\.com\/intent\/post\?text=[^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&");
    expect(share).toBeDefined();
    expect(new URL(share!).searchParams.get("text")).toBe(`I’m swinging through With Great Power on NEAR 🕸️ Join my crew: ${link}`);
    expect(text(html)).toContain("Share on X");
    expect(text(html)).toContain("K7Q2M9X");
  });

  it("copies through the clipboard, and says when it can't", async () => {
    const writes: string[] = [];
    expect(await copyText(link, { writeText: async (t) => void writes.push(t) })).toBe(true);
    expect(writes).toEqual([link]);
    expect(await copyText(link, { writeText: async () => Promise.reject(new Error("NotAllowedError")) })).toBe(false);
    expect(await copyText(link, undefined)).toBe(false);
  });
});

describe("the late claim", () => {
  it("has a real label, the right input hints, and help tied to the field", () => {
    const html = renderToStaticMarkup(h(ClaimForm, { onClaimed: () => {} }));
    expect(text(html)).toContain("Got an invite code?");
    expect(html).toMatch(/<label for="([^"]+)-code"[^>]*>Invite code<\/label>/);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*inputMode="text"[^>]*autoCapitalize="characters"/);
    expect(html).toMatch(/aria-describedby="[^"]+-help"/);
    expect(html).toMatch(/<button type="submit"[^>]*>Add invite code<\/button>/);
    // Submit stays enabled until the request starts; the check runs on submit.
    expect(html).not.toMatch(/\sdisabled=""/);
  });

  it("checks the code before sending it", async () => {
    const send = vi.fn();
    expect(await submitClaim("", send)).toEqual({ ok: false, message: "Enter the invite code from your friend’s link." });
    expect(await submitClaim("K7Q", send)).toEqual({ ok: false, message: "Invite codes are 7 letters and numbers, like K7Q2M9X." });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a pasted link's code, and reports the inviter or the refusal", async () => {
    const send = vi.fn(async (code: string) => (code === "K7Q2M9X" ? ({ ok: true, data: { referredBy: "sele" } } as const) : ({ ok: false, status: 422, error: "bad_code" } as const)));
    expect(await submitClaim("https://www.wgponnear.fun/invite/k7q2m9x", send)).toEqual({ ok: true, referredBy: "sele" });
    expect(send).toHaveBeenCalledWith("K7Q2M9X");
    expect(await submitClaim("ZZZZZZZ", send)).toEqual({ ok: false, message: "We don’t know that code. Check it with your friend and try again." });
  });
});

describe("the Invite friends screen", () => {
  const screen = (state: ReferralsState) => renderToStaticMarkup(h(InviteFriendsView, { state }));

  it("asks guests to sign in, since a link needs an account", () => {
    const t = text(screen({ status: "guest" }));
    expect(t).toContain("Invite 3 friends");
    expect(t).toContain("Sign in to get your link");
    expect(t).toContain("How it counts");
    expect(t).not.toContain("Copy link");
  });

  it("shows the link, the crew, the reward and the rules once loaded", () => {
    const t = text(screen(ready("referrals-2of3")));
    for (const part of ["Share your link", "Copy link", "Share on X", "Your crew", "2 of 3 friends count", "Invited · 5", "Recruiter badge + 300 XP", "How it counts"]) expect(t).toContain(part);
    expect(t).not.toContain("Got an invite code?");
  });

  it("offers the late claim while it can, and the crew note once in one", () => {
    expect(text(screen(ready("referrals-claim")))).toContain("Got an invite code?");
    const crew = text(screen(ready("referrals-crew")));
    expect(crew).toContain("You’re in sele’s crew");
    expect(crew).not.toContain("Got an invite code?");
  });

  it("has a loading state and an error with a retry", () => {
    expect(text(screen({ status: "loading" }))).toContain("Getting your invite link…");
    const err = screen({ status: "error" });
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain("Try again");
  });

  it("never promises money or prizes, in any state", () => {
    for (const state of Object.values(referralFixtures())) expect(text(screen(state))).not.toMatch(/\$|usdc|money|cash|prize|payout|airdrop/i);
  });
});

describe("the entry points", () => {
  it("read Invite friends · n/3 and go to /play/invite", () => {
    const html = renderToStaticMarkup(h(InviteTileView, { summary: inviteSummary(ready("referrals-2of3")) }));
    expect(html).toContain('href="/play/invite"');
    expect(text(html)).toContain("Invite friends");
    expect(text(html)).toContain("2/3");
    expect(text(html)).toContain("2 of 3 friends count");
  });

  it("ask a guest to sign in", () => {
    expect(text(renderToStaticMarkup(h(InviteTileView, { summary: inviteSummary({ status: "guest" }) })))).toContain("Sign in to get your link");
  });
});

describe("the friend's checklist", () => {
  it("offers Add your X as a button and Play a night as a to-do", () => {
    const html = renderToStaticMarkup(h(CrewChecklistView, { list: { referrer: "sele", x: false, played: false }, onAddX: () => {} }));
    const t = text(html);
    expect(t).toContain("Count for sele");
    expect(html).toMatch(/<button type="button"[^>]*aria-haspopup="dialog"[^>]*>.*Add your X/);
    expect(t).toContain("Add your X : not yet");
    expect(t).toContain("Play a night : not yet");
  });

  it("ticks what's done", () => {
    const t = text(renderToStaticMarkup(h(CrewChecklistView, { list: { referrer: "sele", x: true, played: false }, onAddX: () => {} })));
    expect(t).toContain("X added : done");
    expect(t).not.toContain("Add your X");
  });
});

describe("fixtures", () => {
  it("cover every state the screens draw", () => {
    const states = Object.values(referralFixtures());
    expect(new Set(states.map((s) => s.status))).toEqual(new Set(["guest", "loading", "error", "ready"]));
    const rewards = states.flatMap((s) => (s.status === "ready" ? [s.view.reward.state] : []));
    expect(new Set(rewards)).toEqual(new Set(["locked", "granted", "queued", "minted"]));
    const twoOfThree: ReferralsView = ready("referrals-2of3").view;
    expect(twoOfThree.invited.filter((f) => f.qualified)).toHaveLength(twoOfThree.qualified);
  });
});
