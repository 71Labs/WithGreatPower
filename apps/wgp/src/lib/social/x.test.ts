import { describe, expect, it } from "vitest";

import { runShareText } from "./share";
import { HASHTAG, X_MAX, linksIn, normalizeXHandle, postProblems, tagsIn, xIntentUrl, xLength } from "./x";

describe("X's character count", () => {
  it("counts plain text one per character", () => {
    expect(xLength("hello")).toBe(5);
    expect(xLength("")).toBe(0);
  });

  it("counts every link as 23, with or without the scheme, and leaves sentence punctuation out", () => {
    expect(xLength("https://www.wgponnear.fun/r/2f6c4b0e-6f4f-4d38-9a76-8a1f1f0c9b11")).toBe(23);
    expect(xLength("wgponnear.fun")).toBe(23);
    expect(xLength("play: wgponnear.fun/r/abc.")).toBe("play: ".length + 23 + 1);
    expect(linksIn("go to wgponnear.fun/r/x, then x.com")).toEqual(["wgponnear.fun/r/x", "x.com"]);
  });

  it("doesn't take NEAR accounts or emails for links", () => {
    expect(linksIn("sele71.near and game.wgpnear.near")).toEqual([]);
    expect(xLength("sele71.near")).toBe(11);
    expect(linksIn("me@example.com")).toEqual([]);
  });

  it("counts an emoji as 2, however many code points it has", () => {
    expect(xLength("🕸️")).toBe(2);
    expect(xLength("🏆")).toBe(2);
    expect(xLength("👩🏽‍🚀")).toBe(2);
    expect(xLength("🇳🇬")).toBe(2);
  });

  it("weighs characters outside X's narrow ranges as 2", () => {
    expect(xLength("→")).toBe(2);
    expect(xLength("…")).toBe(2);
    expect(xLength("’")).toBe(1);
    expect(xLength("–")).toBe(1);
    expect(xLength("夜")).toBe(2);
  });

  it("blocks approval over 280, over three tags, or without the hashtag", () => {
    expect(postProblems(`${"a".repeat(X_MAX - HASHTAG.length - 1)} ${HASHTAG}`)).toEqual([]);
    expect(postProblems(`${"a".repeat(X_MAX)} ${HASHTAG}`)[0]).toMatch(/over X’s 280/);
    expect(postProblems(`@a @b @c ${HASHTAG}`)).toEqual([expect.stringMatching(/4 tags/)]);
    expect(postProblems("no tags here")).toEqual(["Add #NEARHackathon."]);
    expect(postProblems("   ")).toContain("The post is empty.");
  });

  it("finds mentions and hashtags, not emails or link fragments", () => {
    expect(tagsIn("hey @sele_71, #NEARHackathon me@mail.com wgponnear.fun/#top @NEARProtocol")).toEqual(["@sele_71", "#NEARHackathon", "@NEARProtocol"]);
  });

  it("fills X's composer with the text", () => {
    const url = xIntentUrl("I banked 12,340 🕸️ & more");
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe("I banked 12,340 🕸️ & more");
  });

  it("writes the player's share post with their score and run page", () => {
    const text = runShareText(12340, "2f6c4b0e-6f4f-4d38-9a76-8a1f1f0c9b11");
    expect(text).toBe("I banked 12,340 in With Great Power. Beat me 🕸️ https://www.wgponnear.fun/r/2f6c4b0e-6f4f-4d38-9a76-8a1f1f0c9b11");
    expect(xLength(text)).toBeLessThan(X_MAX);
  });
});

describe("X handle validation", () => {
  it("drops a leading @ and keeps the case", () => {
    expect(normalizeXHandle("@Sele_71")).toEqual({ ok: true, handle: "Sele_71" });
    expect(normalizeXHandle("  wgponnear ")).toEqual({ ok: true, handle: "wgponnear" });
  });

  it("takes 1 to 15 letters, numbers and underscores", () => {
    expect(normalizeXHandle("a").ok).toBe(true);
    expect(normalizeXHandle("a".repeat(15)).ok).toBe(true);
    expect(normalizeXHandle("a".repeat(16))).toMatchObject({ ok: false, message: expect.stringMatching(/15/) });
    expect(normalizeXHandle("").ok).toBe(false);
    expect(normalizeXHandle("@").ok).toBe(false);
    for (const bad of ["sele.near", "sele-71", "sele 71", "séle", "x.com/sele"]) expect(normalizeXHandle(bad).ok).toBe(false);
  });
});
