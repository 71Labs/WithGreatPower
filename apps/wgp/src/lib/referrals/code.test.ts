import { describe, expect, it } from "vitest";

import { INVITE_CODE_RE, claimCodeFromInput, inviteCodeFromParam, invitePath, inviteShareText, inviteShareUrl, normalizeInviteCode } from "./code";

describe("invite codes", () => {
  it("are 7 characters of Crockford base32", () => {
    expect(INVITE_CODE_RE.test("K7Q2M9X")).toBe(true);
    for (const bad of ["K7Q2M9", "K7Q2M9XX", "K7Q2M9I", "K7Q2M9L", "K7Q2M9O", "K7Q2M9U", "k7q2m9x"]) expect(INVITE_CODE_RE.test(bad)).toBe(false);
  });

  it("read in any case, with spaces or dashes", () => {
    expect(normalizeInviteCode(" k7q2m9x ")).toEqual({ ok: true, code: "K7Q2M9X" });
    expect(normalizeInviteCode("K7Q-2M9 X")).toEqual({ ok: true, code: "K7Q2M9X" });
  });

  it("read Crockford's look-alikes as the digits they stand for", () => {
    expect(normalizeInviteCode("K7QOM9X")).toEqual({ ok: true, code: "K7Q0M9X" });
    expect(normalizeInviteCode("K7QiM9l")).toEqual({ ok: true, code: "K7Q1M91" });
  });

  it("come out of a pasted invite link", () => {
    expect(normalizeInviteCode("https://www.wgponnear.fun/invite/k7q2m9x?utm=x")).toEqual({ ok: true, code: "K7Q2M9X" });
    expect(normalizeInviteCode("wgponnear.fun/invite/K7Q2M9X#top")).toEqual({ ok: true, code: "K7Q2M9X" });
  });

  it("say why one can't be a code", () => {
    expect(normalizeInviteCode("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeInviteCode("K7Q2")).toEqual({ ok: false, reason: "format" });
    expect(normalizeInviteCode("K7Q2M9U")).toEqual({ ok: false, reason: "format" });
    expect(normalizeInviteCode("hello world")).toEqual({ ok: false, reason: "format" });
  });

  it("as the late-claim field sends them: trimmed, uppercased, 4–12 letters and numbers", () => {
    expect(claimCodeFromInput(" k7q-2m9 x ")).toEqual({ ok: true, code: "K7Q2M9X" });
    expect(claimCodeFromInput("K7QO")).toEqual({ ok: true, code: "K7QO" });
    expect(claimCodeFromInput("wgponnear.fun/invite/abcd1234")).toEqual({ ok: true, code: "ABCD1234" });
    expect(claimCodeFromInput("")).toEqual({ ok: false, reason: "empty" });
    expect(claimCodeFromInput("K7Q")).toEqual({ ok: false, reason: "format" });
    expect(claimCodeFromInput("K7Q2M9X2M9X2M")).toEqual({ ok: false, reason: "format" });
    expect(claimCodeFromInput("K7Q_2M9")).toEqual({ ok: false, reason: "format" });
  });

  it("from a URL segment, or null so the landing never looks a bad one up", () => {
    expect(inviteCodeFromParam("k7q2m9x")).toBe("K7Q2M9X");
    expect(inviteCodeFromParam("%E0%A4%A")).toBeNull();
    expect(inviteCodeFromParam("nope")).toBeNull();
    expect(invitePath("K7Q2M9X")).toBe("/invite/K7Q2M9X");
  });
});

describe("Share on X", () => {
  const link = "https://www.wgponnear.fun/invite/K7Q2M9X";

  it("fills in the invite post with the link", () => {
    expect(inviteShareText(link)).toBe("I’m swinging through With Great Power on NEAR 🕸️ Join my crew: https://www.wgponnear.fun/invite/K7Q2M9X");
  });

  it("is X's composer, nothing posted for the player", () => {
    const url = new URL(inviteShareUrl(link));
    expect(url.origin + url.pathname).toBe("https://x.com/intent/post");
    expect(url.searchParams.get("text")).toBe(inviteShareText(link));
  });
});
