/**
 * The /stats page's body, rendered to HTML: the empty state for a database with no matches,
 * and the filled state (tiles, the chart's rows in order with their values, the time and the
 * two source links).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { STAT_MODES, type PublicStats } from "@/server/db/stats";

import { StatsBody, modeName, modeRows, nearblocksUrl } from "./stats-body";

const zeroModes = () => Object.fromEntries(STAT_MODES.map((mode) => [mode, { started: 0, verified: 0 }]));

const EMPTY: PublicStats = {
  at: "2026-11-12T14:05:00.000Z",
  since: null,
  runs: { started: 0, verified: 0, rejected: 0, unfinished: 0, hoursVerified: 0, byMode: zeroModes(), season: { id: "s1", started: 0, verified: 0 }, today: { started: 0, verified: 0 } },
  players: { total: 0, played: 0, withVerifiedRun: 0 },
  city: { outings: 0, players: 0, tasksDone: 0 },
  referrals: { invited: 0, qualified: 0, rewards: 0 },
  chain: { network: null, contractId: null, rewardMints: { queued: 0, sent: 0 } },
};

const FILLED: PublicStats = {
  at: "2026-11-12T14:05:00.000Z",
  since: "2026-11-01T18:30:00.000Z",
  runs: {
    started: 1532,
    verified: 1204,
    rejected: 17,
    unfinished: 311,
    hoursVerified: 61.5,
    byMode: { ...zeroModes(), patrol: { started: 900, verified: 700 }, daily: { started: 300, verified: 250 }, trial: { started: 150, verified: 120 }, duel: { started: 90, verified: 80 }, "case-001": { started: 92, verified: 54 } },
    season: { id: "s1", started: 1100, verified: 905 },
    today: { started: 48, verified: 41 },
  },
  players: { total: 412, played: 356, withVerifiedRun: 298 },
  city: { outings: 733, players: 141, tasksDone: 266 },
  referrals: { invited: 63, qualified: 22, rewards: 4 },
  chain: { network: "mainnet", contractId: "game.wgpnear.near", rewardMints: { queued: 1250, sent: 1239 } },
};

const html = (stats: PublicStats) => renderToStaticMarkup(createElement(StatsBody, { stats }));
/** Visible text, tags dropped. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("StatsBody", () => {
  it("shows the empty state for a fresh database", () => {
    const markup = html(EMPTY);
    expect(text(markup)).toContain("No matches yet. Play a night and come back.");
    expect(markup).toMatch(/<a[^>]+href="\/play"[^>]*>Play a night/);
    expect(markup).not.toContain("<dl");
    expect(text(markup)).not.toContain("Verified matches by mode");
    // Still says where the numbers come from, and when.
    expect(markup).toContain('href="/api/stats"');
    expect(markup).toContain('href="https://nearblocks.io/address/game.wgpnear.near"');
    expect(markup).toContain('<time dateTime="2026-11-12T14:05:00.000Z"');
    expect(text(markup)).toContain("Nov 12, 2026, 2:05 PM UTC");
  });

  it("shows every number once there are matches", () => {
    const markup = html(FILLED);
    const seen = text(markup);
    expect(seen).not.toContain("No matches yet");
    for (const value of ["1,532", "1,204", "17", "311", "61.5", "905", "1,100", "48", "41", "412", "356", "298", "733", "141", "266", "63", "22", "4", "1,250", "1,239"]) {
      expect(markup).toContain(`>${value}</dd>`);
    }
    expect(seen).toContain("By the numbers");
    expect(seen).toContain("as of Nov 12, 2026, 2:05 PM UTC");
    expect(seen).toContain("The first match started on Nov 1, 2026");
    expect(seen).toContain("Every number here comes from GET /api/stats ; on-chain numbers can be checked on NearBlocks");
    expect(seen).toContain("game.wgpnear.near on mainnet");
    expect(markup).toContain('href="https://nearblocks.io/address/game.wgpnear.near"');
    // Tabular figures on every number.
    expect(markup.match(/<dd class="num /g)?.length).toBe(20);
  });

  it("draws one bar per mode with a verified match, longest first, each with its value", () => {
    const markup = html(FILLED);
    const rows = [...markup.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1]).trim());
    expect(rows).toEqual([
      "Patrol nights 700",
      "Daily Run 250",
      "Time trials 120",
      "Duels 80",
      "Case 001: Missing: Mary Jpeg 54",
      "Case 002: The Sybil Vote 0",
      "Case 003: Fee Strike 0",
    ]);
    const widths = [...markup.matchAll(/bg-game-data" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(5);
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBeCloseTo((250 / 700) * 100);
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);
    // One series: one colour, no legend.
    expect(markup).not.toMatch(/legend/i);
  });

  it("uses no money or prize words", () => {
    expect(text(html(FILLED)) + text(html(EMPTY))).not.toMatch(/\$|prize|cash|payout|earn money|usd|win /i);
  });
});

describe("helpers", () => {
  it("names modes", () => {
    expect(modeName("patrol")).toBe("Patrol nights");
    expect(modeName("case-003")).toBe("Case 003: Fee Strike");
    expect(modeName("mystery")).toBe("mystery");
  });

  it("orders equal counts the way the game lists its modes", () => {
    expect(modeRows({ ...zeroModes(), mystery: { started: 1, verified: 0 } }).map((r) => r.mode)).toEqual([...STAT_MODES, "mystery"]);
  });

  it("links the chain the server is on", () => {
    expect(nearblocksUrl({ network: "testnet", contractId: "wgp.testnet", rewardMints: { queued: 0, sent: 0 } })).toBe("https://testnet.nearblocks.io/address/wgp.testnet");
    expect(nearblocksUrl(EMPTY.chain)).toBe("https://nearblocks.io/address/game.wgpnear.near");
  });
});
