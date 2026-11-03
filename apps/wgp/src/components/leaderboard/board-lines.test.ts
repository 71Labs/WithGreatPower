import { describe, expect, it } from "vitest";

import type { BoardRow } from "@/server/db/leaderboard";

import { boardLines, placeNotice, type BoardLine } from "./board-lines";

const row = (rank: number, who = `p${rank}`): BoardRow => ({
  rank,
  playerId: who,
  handle: who,
  nearAccountId: `${who}.wgp.testnet`,
  heroName: null,
  suit: "classic",
  score: 100_000 - rank,
  ticks: 9000,
  runId: null,
  updatedAt: "2026-11-06T20:00:00.000Z",
});

const page = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));
const youLines = (lines: BoardLine[]) => lines.filter((l) => l.kind === "row" && l.you);
const ranks = (lines: BoardLine[]) => lines.map((l) => (l.kind === "gap" ? "…" : l.row.rank));

describe("the board draws your row once", () => {
  it("on the page: your row in the list, no second row and no notice", () => {
    const rows = page(50);
    const me = rows[6]!;
    const view = { rows, me, around: rows.slice(4, 9), signedIn: true };
    const lines = boardLines(view);
    expect(lines).toHaveLength(50);
    expect(youLines(lines)).toEqual([{ kind: "row", row: me, you: true }]);
    expect(placeNotice(view)).toBeNull();
  });

  it("off the page: your row after a gap with your neighbours, still once, and no notice", () => {
    const rows = page(50);
    const around = [row(118), row(119), row(120, "me"), row(121), row(122)];
    const view = { rows, me: around[2]!, around, signedIn: true };
    const lines = boardLines(view);
    expect(ranks(lines).slice(48)).toEqual([49, 50, "…", 118, 119, 120, 121, 122]);
    expect(youLines(lines)).toHaveLength(1);
    expect(placeNotice(view)).toBeNull();
  });

  it("right below the page: no gap marker between 50 and 51", () => {
    const rows = page(50);
    const around = [row(49), row(50), row(51, "me"), row(52)];
    expect(ranks(boardLines({ rows, me: around[2]!, around })).slice(-4)).toEqual([49, 50, 51, 52]);
  });

  it("doesn't repeat a neighbour the cached page already shows", () => {
    const rows = page(50);
    // Live ranks moved since the page was cached: p50 is now 51st.
    const around = [row(51, "p50"), row(52, "me"), row(53)];
    const lines = boardLines({ rows, me: around[1]!, around });
    const ids = lines.flatMap((l) => (l.kind === "row" ? [l.row.playerId] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(youLines(lines)).toHaveLength(1);
  });

  it("adds your row if the live neighbours miss it", () => {
    const rows = page(10);
    const me = row(30, "me");
    const lines = boardLines({ rows, me, around: [] });
    expect(ranks(lines).slice(-2)).toEqual(["…", 30]);
    expect(youLines(lines)).toHaveLength(1);
  });

  it("without a row of your own: just the board, and the notice that says why", () => {
    const rows = page(5);
    expect(youLines(boardLines({ rows, me: null, around: [] }))).toEqual([]);
    expect(placeNotice({ rows, me: null, around: [], signedIn: false })).toBe("sign-in");
    expect(placeNotice({ rows, me: null, around: [], signedIn: true })).toBe("unranked");
  });
});
