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
