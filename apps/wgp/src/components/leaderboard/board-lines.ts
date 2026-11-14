/**
 * Which rows the board draws, so each hero, the viewer included, appears once.
 *
 * - The top page (up to 50 rows, cached and shared) comes first.
 * - Your row is drawn where it ranks, and only there. The screen pins that row above the
 *   dock while it's scrolled out of view, so there is no second "you" row: on the page,
 *   it's your row in the list; off the page, it's your row in the "around you" rows
 *   after a gap, with your neighbours.
 * - The top page is cached for ~15 s and the rows around you are live, so a neighbour
 *   already drawn above isn't drawn again, and if the live rows somehow miss you, your
 *   own row is still added.
 * - The place notice (sign in, or finish a ranked night) shows only when you have no row.
 */
import type { BoardRow } from "@/server/db/leaderboard";

export type BoardLine = { kind: "row"; row: BoardRow; you: boolean } | { kind: "gap" };

export interface BoardSource {
  rows: BoardRow[];
  me: BoardRow | null;
  around: BoardRow[];
}

export function boardLines(view: BoardSource): BoardLine[] {
  const meId = view.me?.playerId ?? null;
  const top: BoardLine[] = view.rows.map((row) => ({ kind: "row", row, you: row.playerId === meId }));
  if (!view.me || view.rows.some((r) => r.playerId === meId)) return top;

  const drawn = new Set(view.rows.map((r) => r.playerId));
  const tail: BoardRow[] = [];
  for (const r of view.around) {
    if (drawn.has(r.playerId)) continue;
    drawn.add(r.playerId);
    tail.push(r);
  }
  if (!drawn.has(view.me.playerId)) tail.push(view.me);
  tail.sort((a, b) => a.rank - b.rank);

  const last = view.rows.at(-1)?.rank ?? 0;
  const gap: BoardLine[] = tail[0]!.rank > last + 1 ? [{ kind: "gap" }] : [];
  return [...top, ...gap, ...tail.map((row): BoardLine => ({ kind: "row", row, you: row.playerId === meId }))];
}

/** The notice pinned under the board in place of a row: only for a viewer without one. */
export function placeNotice(view: BoardSource & { signedIn: boolean }): "sign-in" | "unranked" | null {
  if (view.me) return null;
  return view.signedIn ? "unranked" : "sign-in";
}

/** A board with fewer heroes than this is short: it invites the next one in rather than sit half empty. */
export const BOARD_TOP = 10;

export interface BoardInvite {
  /** Places in the top `BOARD_TOP` nobody holds yet. */
  open: number;
  /** The place a viewer without a row would take at worst (they may rank higher); null when they have a row. */
  claimRank: number | null;
  /** What stands between the viewer and that place; null when they have a row. */
  needs: "sign-in" | "patrol" | null;
}

/**
 * The invitation a short board carries: how many top places are open, and for a viewer who
 * isn't on it, the place that is theirs to claim. Null for a full board (`BOARD_TOP` heroes
 * or more), an empty one (it has its own message) and a board that no longer takes scores.
 * It counts real rows only: nothing here adds an entry.
 */
export function boardInvite(view: { total: number; me: BoardRow | null; signedIn: boolean }, accepting = true): BoardInvite | null {
  if (!accepting || view.total <= 0 || view.total >= BOARD_TOP) return null;
  const open = BOARD_TOP - view.total;
  if (view.me) return { open, claimRank: null, needs: null };
  return { open, claimRank: view.total + 1, needs: view.signedIn ? "patrol" : "sign-in" };
}

/** Milliseconds until the next midnight UTC, when Tonight's board resets. */
export function msToUtcMidnight(now: number): number {
  const day = 86_400_000;
  return day - (((now % day) + day) % day);
}

export type BoardId = "tonight" | "season" | "alltime";

/**
 * Where the page opens when the viewer hasn't picked a tab: Tonight, unless nobody is on it
 * yet; then Season, unless that's empty too; then All time. `rows` holds each board's row
 * count once it has answered (undefined while it loads, null if it failed): the page waits on
 * a board's answer before passing it by, and stays on one that failed so it can say so.
 */
export function openingBoard(rows: Partial<Record<BoardId, number | null>>): BoardId {
  for (const board of ["tonight", "season"] as const) {
    const n = rows[board];
    if (n === undefined || n === null || n > 0) return board;
  }
  return "alltime";
}
