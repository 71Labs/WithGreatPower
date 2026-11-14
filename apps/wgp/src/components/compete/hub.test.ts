/**
 * Today's Daily board, rendered to markup. Every day starts empty at midnight UTC, so the
 * empty board is what most visitors see first: it says why, and offers one thing to do.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CompeteView } from "@/lib/compete/api";

import { DailyBoard } from "./hub";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function view(signedIn: boolean, top: CompeteView["daily"]["top"] = []): CompeteView {
  return {
    now: "2026-11-16T09:00:00.000Z",
    signedIn,
    daily: {
      day: "2026-11-16",
      resetsAt: "2026-11-17T00:00:00.000Z",
      kit: ["web-sling", "web-shield", "node-sense"],
      seed: 1,
      attempts: { used: 0, limit: 5 },
      best: null,
      total: top.length,
      streak: 0,
      podiums: 0,
      wins: 0,
      badges: null,
      top,
    },
    trials: [],
    rivals: [],
    races: { used: 0, limit: 80 },
    active: null,
  };
}

describe("today's Daily board", () => {
  it("empty, says why and when it starts over, with one action, and never '0 runners'", () => {
    const out = renderToStaticMarkup(createElement(DailyBoard, { view: view(false) }));
    const words = text(out);
    expect(words).toContain("Nobody has posted a time today.");
    expect(words).toContain("starts over at midnight UTC");
    expect(words).not.toMatch(/\b0 runners?\b/);
    // One next action: today's city.
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('href="/play/compete/daily"');
    expect(words).toContain("Try today’s city");
  });

  it("signed in, the action is to post the first time", () => {
    expect(text(renderToStaticMarkup(createElement(DailyBoard, { view: view(true) })))).toContain("Post the first time");
  });

  it("with times on it, counts the runners and lists them", () => {
    const row = { rank: 1, playerId: "p1", handle: "ace", nearAccountId: "ace.near", heroName: null, suit: "classic" as const, score: 1200, ticks: 4000, runId: "r1", updatedAt: "2026-11-16T08:00:00.000Z" };
    const words = text(renderToStaticMarkup(createElement(DailyBoard, { view: view(true, [row]) })));
    expect(words).toContain("1 runner");
    expect(words).toContain("ace");
    expect(words).not.toContain("Nobody has posted a time today.");
  });
});
