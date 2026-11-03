import { describe, expect, it } from "vitest";

import { CLOSE_GRACE_MS, type SeasonStanding } from "./season-close";
import { frozenBoard, recordState, seasonPhase, seasonView, type SeasonRow } from "./season-view";

const S1: SeasonRow = {
  id: "s1",
  name: "Season 1",
  startsAt: new Date("2026-11-05T00:00:00Z"),
  endsAt: new Date("2026-11-15T00:00:00Z"),
  status: "live",
  root: null,
  digest: null,
  recordTx: null,
  recordedAt: null,
  closedAt: null,
};
const CLOSED: SeasonRow = { ...S1, status: "closed", root: "a".repeat(64), digest: "b".repeat(64), closedAt: new Date("2026-11-15T00:50:00Z") };

const standing = (rank: number, who = `p${rank}`): SeasonStanding => ({
  rank,
  playerId: who,
  handle: who,
  nearAccountId: `${who}.wgp.testnet`,
  heroName: null,
  suit: "classic",
  score: 100_000 - rank,
  ticks: 9000,
  runId: null,
  updatedAt: "2026-11-14T20:00:00.000Z",
});

describe("the season view", () => {
  it("names the phase: upcoming, live, closing until the freeze, then final", () => {
    expect(seasonPhase(S1, new Date("2026-11-04T23:59:59Z"))).toBe("upcoming");
    expect(seasonPhase(S1, new Date("2026-11-05T00:00:00Z"))).toBe("live");
    expect(seasonPhase(S1, new Date("2026-11-15T00:00:00Z"))).toBe("closing");
    expect(seasonPhase({ ...S1, status: "scheduled" }, new Date("2026-11-20T00:00:00Z"))).toBe("closing");
    expect(seasonPhase(CLOSED, new Date("2026-11-15T00:50:00Z"))).toBe("final");
    expect(seasonPhase({ ...CLOSED, status: "recorded" }, new Date("2026-12-01T00:00:00Z"))).toBe("final");
  });

  it("says where the record stands, honestly, before and after the contract is live", () => {
    const base = { players: 3, season: CLOSED, op: { status: "pending" as const, error: null, txHash: null } };
    expect(recordState({ ...base, players: 0, contractLive: true, canSend: true })).toBe("empty");
    expect(recordState({ ...base, contractLive: false, canSend: true })).toBe("queued");
    expect(recordState({ ...base, contractLive: null, canSend: true })).toBe("queued");
    expect(recordState({ ...base, contractLive: true, canSend: false })).toBe("queued");
    expect(recordState({ ...base, contractLive: true, canSend: true })).toBe("sending");
    expect(recordState({ ...base, op: { status: "dead", error: "x", txHash: null }, contractLive: true, canSend: true })).toBe("stuck");
    expect(recordState({ ...base, op: { status: "sent", error: null, txHash: "tx" }, contractLive: true, canSend: true })).toBe("recorded");
    expect(recordState({ ...base, season: { ...CLOSED, status: "recorded" }, op: null, contractLive: false, canSend: false })).toBe("recorded");
  });

  it("gives the freeze time and the trophies, and the record only after the close", () => {
    const live = seasonView({ season: S1, players: 0, op: null, contractLive: false, canSend: false, now: new Date("2026-11-10T00:00:00Z") });
    expect(live).toMatchObject({ phase: "live", trophies: 10, contractLive: false, record: null });
    expect(Date.parse(live.freezesAt)).toBe(S1.endsAt.getTime() + CLOSE_GRACE_MS);

    const final = seasonView({
      season: { ...CLOSED, status: "recorded", recordTx: "tx-s1", recordedAt: new Date("2026-11-16T00:00:00Z") },
      players: 3,
      op: { status: "sent", error: null, txHash: "tx-s1" },
      contractLive: true,
      canSend: true,
      now: new Date("2026-11-17T00:00:00Z"),
    });
    expect(final.record).toEqual({ state: "recorded", root: "a".repeat(64), digest: "b".repeat(64), txHash: "tx-s1", recordedAt: "2026-11-16T00:00:00.000Z" });
  });

  it("pages the frozen standings like a live board, with your row and neighbours", () => {
    const standings = Array.from({ length: 80 }, (_, i) => standing(i + 1));
    const board = frozenBoard(standings, "p70", 50);
    expect(board.rows).toHaveLength(50);
    expect(board.total).toBe(80);
    expect(board.me?.rank).toBe(70);
    expect(board.around.map((r) => r.rank)).toEqual([68, 69, 70, 71, 72]);
    expect(frozenBoard(standings, "p1", 50).around.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(frozenBoard(standings, "nobody", 50)).toMatchObject({ me: null, around: [] });
    expect(frozenBoard([], null, 50)).toEqual({ rows: [], total: 0, me: null, around: [] });
  });
});
