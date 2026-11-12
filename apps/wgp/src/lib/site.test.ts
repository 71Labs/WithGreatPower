import { describe, expect, it } from "vitest";

import { START_URL, startUrl } from "./site";

describe("where “Play now” goes", () => {
  it.each([
    ["/play", "/play/start"],
    ["/play/", "/play/start"],
    [" /play ", "/play/start"],
    ["/play?ref=x", "/play/start?ref=x"],
    ["/play#top", "/play/start#top"],
    ["https://www.wgponnear.fun/play", "https://www.wgponnear.fun/play/start"],
    ["https://www.wgponnear.fun/play/", "https://www.wgponnear.fun/play/start"],
    ["//wgponnear.fun/play", "//wgponnear.fun/play/start"],
  ])("%s is the game's front door, so it opens the quick start: %s", (url, start) => {
    expect(startUrl(url)).toBe(start);
  });

  it.each(["/play/start", "/play/market", "/playground", "https://example.com/other", "/"])("%s points somewhere else and is used as it is", (url) => {
    expect(startUrl(url)).toBe(url);
  });

  it("with NEXT_PUBLIC_PLAY_URL unset, the landing's button goes to the quick start", () => {
    expect(START_URL).toBe("/play/start");
  });
});
