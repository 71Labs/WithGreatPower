"use client";

import { useEffect, useState } from "react";

import { StickerBadge, StickerButton, StickerChip, StickerLink, StickerPanel } from "@/components/game/kit";
import { HeroTile, StickerTabs, tabPanelProps, type StickerTab } from "@/components/game/ui";
import { CircleAlert, Clock, LogIn, Users } from "@/components/icons";
import { ShareOnXIcon } from "@/components/social/share-on-x";
import { runShareText, seasonShareText } from "@/lib/social/share";
import type { LeaderboardView } from "@/server/db/board-view";
import type { BoardRow } from "@/server/db/leaderboard";

import { plural } from "@/lib/plural";

import { BOARD_TOP, boardInvite, boardLines, msToUtcMidnight, openingBoard, placeNotice, type BoardInvite } from "./board-lines";
import { SeasonCard, TrophyMark, useServerNow } from "./season-card";
import { formatLeft } from "./season-clock";

type Board = LeaderboardView["board"];
type View = LeaderboardView & { signedIn: boolean };
/** `receivedAt` is the device's clock when the answer came, for the countdown's skew. */
type Load = { state: "loading" } | { state: "error" } | { state: "ready"; view: View; receivedAt: number };

const TABS: StickerTab<Board>[] = [
  { id: "tonight", label: "Tonight" },
  { id: "season", label: "Season" },
  { id: "alltime", label: "All time" },
];

const ID = "leaderboard";
const points = new Intl.NumberFormat("en-US");
const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

/** Which period the board covers: a short title and a line of detail. */
function periodLabel(view: View): { title: string; detail: string } {
  if (view.board === "alltime") return { title: "All time", detail: "Best single night, ever" };
  if (view.board === "tonight") {
    const date = view.period ? day(`${view.period}T00:00:00Z`, { weekday: "short", month: "short", day: "numeric" }) : "Today";
    return { title: date, detail: "Resets at midnight UTC" };
  }
  if (!view.season) return { title: "Season", detail: "No season scheduled yet" };
  const start = day(view.season.startsAt, { month: "short", day: "numeric" });
  // ends_at is exclusive: the last day is the one before.
  const last = day(new Date(new Date(view.season.endsAt).getTime() - 1).toISOString(), { month: "short", day: "numeric" });
  // The season card under it says where the season stands.
  return { title: view.season.name, detail: `${start} – ${last} (UTC)` };
}

/** On the Season board, the places that win a trophy, and whether it's won yet. */
type Trophy = { won: boolean } | null;
function trophyFor(view: View, rank: number): Trophy {
  if (view.board !== "season" || !view.season || rank > view.season.trophies) return null;
  return { won: view.season.phase === "final" };
}

/* ------------------------------------------------------------------ rows */

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={`num grid h-8 min-w-8 shrink-0 place-items-center rounded-full border-2 border-game-ink px-1.5 text-[13px] font-bold leading-none ${
        rank === 1 ? "bg-game-gold text-game-ink" : rank <= 3 ? "bg-game-paper text-game-ink" : "border-transparent text-game-muted"
      }`}
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

/** Above the dock, like the place notice: the viewer's row sticks here while it's scrolled out of view. */
const PINNED = "sticky bottom-[calc(86px+env(safe-area-inset-bottom))] z-10 sm:bottom-[calc(78px+env(safe-area-inset-bottom))]";

/** What the viewer's own row shares: the run behind it, or for a season total, the board. */
function shareText(view: View, row: BoardRow): string | null {
  if (view.board === "season") return seasonShareText(row.score, view.season?.name ?? "this season");
  return row.runId ? runShareText(row.score, row.runId) : null;
}

function Row({ row, you, trophy = null, share = null }: { row: BoardRow; you: boolean; trophy?: Trophy; share?: string | null }) {
  return (
    <li
      className={`flex min-h-14 items-center gap-3 rounded-[14px] px-2.5 py-2 sm:px-3 ${you ? `${PINNED} bg-game-gold shadow-[var(--game-shadow-sm)] ring-2 ring-game-ink` : ""}`}
      aria-current={you ? "true" : undefined}
    >
      <RankBadge rank={row.rank} />
      <HeroTile suit={row.suit ?? "classic"} className="size-10 rounded-[10px]" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold leading-5" title={row.handle}>
            {row.handle}
          </span>
          {you ? (
            <>
              <StickerBadge className="px-1.5">You</StickerBadge>
              <span className="sr-only">(you)</span>
            </>
          ) : null}
        </span>
        <span className={`truncate text-[12px] leading-4 ${you ? "text-game-ink" : "text-game-muted"}`} title={row.nearAccountId}>
          {row.nearAccountId}
        </span>
      </span>
      {trophy ? (
        <>
          <TrophyMark />
          <span className="sr-only">{trophy.won ? `, won season trophy ${row.rank}` : ", in the trophy places"}</span>
        </>
      ) : null}
      <span className="num shrink-0 text-right text-[16px] font-bold leading-5">
        {points.format(row.score)}
        <span className="sr-only"> points</span>
      </span>
      {share ? <ShareOnXIcon text={share} label="Share your score on X" className="-my-1" /> : null}
    </li>
  );
}

function SkeletonRows() {
  return (
    <div role="status" className="flex flex-col gap-1">
      <span className="sr-only">Loading the board…</span>
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} aria-hidden className="flex min-h-14 items-center gap-3 px-2.5 sm:px-3">
          <span className="size-8 rounded-full bg-game-paper-2" />
          <span className="size-10 rounded-[10px] bg-game-paper-2" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3.5 w-28 rounded-full bg-game-paper-2 motion-safe:animate-pulse" />
            <span className="h-3 w-40 max-w-full rounded-full bg-game-paper-2 motion-safe:animate-pulse" />
          </span>
          <span className="h-4 w-14 rounded-full bg-game-paper-2 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyBoard({ view }: { view: View }) {
  const ended = view.season?.phase === "final" || view.season?.phase === "closing";
  const line =
    view.board === "tonight"
      ? "Nobody has finished a ranked patrol tonight. Swing out and take first place."
      : view.board === "season"
        ? ended
          ? `${view.season?.name ?? "This season"} ended without a ranked night. Tonight’s board is still open.`
          : "No nightly bests in this season yet. Every night you finish adds to your total."
        : "No verified runs yet. The first finished patrol sets the record.";
  return (
    <div className="flex flex-col items-start gap-3 px-2.5 py-6 sm:px-3">
      <p className="max-w-[46ch] text-[15px] leading-6 text-game-ink [text-wrap:pretty]">{line}</p>
      <StickerLink href="/play" variant="hero" size="sm">
        Start tonight’s patrol
      </StickerLink>
    </div>
  );
}

/**
 * Pinned above the dock for a viewer without a row: why they aren't on the board. A
 * ranked viewer gets no card: their own row pins itself (boardLines).
 */
function PlaceNotice({ view }: { view: View }) {
  const notice = placeNotice(view);
  if (!notice) return null;
  const final = view.board === "season" && view.season?.phase === "final";
  const line =
    notice === "sign-in"
      ? final
        ? "Sign in to see your place in the final standings."
        : "Sign in to put your hero on the board. Guest runs stay unranked."
      : final
        ? `You didn’t finish a ranked night in ${view.season?.name ?? "this season"}. Tonight’s board is open.`
        : view.board === "tonight"
          ? "You’re not on tonight’s board yet. Finish a ranked patrol to get a place."
          : "You’re not on this board yet. Finish a ranked patrol to get a place.";
  return (
    <div className={PINNED}>
      <StickerPanel as="aside" aria-label="Your place" className="p-2">
        <p className="flex min-h-14 items-center gap-3 px-2.5 text-[14px] leading-5 sm:px-3">
          <Users aria-hidden className="size-5 shrink-0" strokeWidth={2} />
          {line}
        </p>
      </StickerPanel>
    </div>
  );
}

/** The short board's invitation, or null: a season that has ended takes no more scores. */
function inviteFor(view: View): BoardInvite | null {
  const ended = view.board === "season" && (!view.season || view.season.phase === "final" || view.season.phase === "closing");
  return boardInvite(view, !ended);
}

/** "Resets in 05:12:09", to the server's midnight UTC. */
function ResetClock({ serverNow, receivedAt }: { serverNow: string; receivedAt: number }) {
  const now = useServerNow(serverNow, receivedAt, true);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Clock aria-hidden className="size-4 shrink-0" strokeWidth={2} />
      <span>
        Resets in{" "}
        <time role="timer" aria-live="off" className="num font-semibold text-game-ink">
          {formatLeft(msToUtcMidnight(now))}
        </time>
      </span>
    </span>
  );
}

/**
 * Under a short board's rows: the place that is the viewer's to claim (drawn as an open row,
 * never as an entry), how many of the top places nobody holds, and when Tonight resets.
 */
function OpenPlaces({ view, invite, receivedAt }: { view: View; invite: BoardInvite; receivedAt: number }) {
  const where = view.board === "tonight" ? "tonight’s" : view.board === "season" ? "the season’s" : "the";
  return (
    <div className="flex flex-col gap-2 pt-1">
      {invite.claimRank !== null ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper-2 px-2.5 py-2.5 sm:px-3">
          <span className="num grid h-8 min-w-8 shrink-0 place-items-center rounded-full border-2 border-dashed border-game-ink px-1.5 text-[13px] font-bold leading-none text-game-ink">
            <span className="sr-only">Place </span>
            {invite.claimRank}
          </span>
          <p className="flex min-w-[12rem] flex-1 flex-col">
            <span className="text-[15px] font-semibold leading-5">This place is open</span>
            <span className="text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">
              {invite.needs === "sign-in" ? "Sign in and finish a ranked patrol to take it, or a higher one." : "Finish a ranked patrol and it’s yours, or a higher one."}
            </span>
          </p>
          {invite.needs === "sign-in" ? (
            <StickerButton variant="hero" size="sm" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("wgp:sign-in"))} className="max-sm:w-full">
              <LogIn aria-hidden className="size-4" strokeWidth={2.25} />
              Sign in to claim it
            </StickerButton>
          ) : (
            <StickerLink href="/play" variant="hero" size="sm" className="max-sm:w-full">
              Start tonight’s patrol
            </StickerLink>
          )}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2.5 pb-1 text-[13px] leading-[18px] text-game-muted sm:px-3">
        <span>
          <span className="num font-semibold text-game-ink">{invite.open}</span> of {where} top {BOARD_TOP} places {invite.open === 1 ? "is" : "are"} open
        </span>
        {view.board === "tonight" ? <ResetClock serverNow={view.now} receivedAt={receivedAt} /> : null}
      </p>
    </div>
  );
}

/** One list, so the viewer's row can stay pinned while the whole board scrolls under it. */
function Board({ view, receivedAt }: { view: View; receivedAt: number }) {
  if (view.rows.length === 0) return <EmptyBoard view={view} />;
  const invite = inviteFor(view);
  return (
    <>
      <ol aria-label="Heroes by rank" className="flex flex-col gap-0.5">
        {boardLines(view).map((line) =>
          line.kind === "gap" ? (
            <li key="gap" aria-hidden className="px-3 py-1 text-center text-[18px] font-bold leading-4 tracking-[0.3em] text-game-muted">
              ···
            </li>
          ) : (
            <Row key={line.row.playerId} row={line.row} you={line.you} trophy={trophyFor(view, line.row.rank)} share={line.you ? shareText(view, line.row) : null} />
          ),
        )}
      </ol>
      {invite ? <OpenPlaces view={view} invite={invite} receivedAt={receivedAt} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ screen */

/** Each board's row count for `openingBoard`: undefined while loading, null if it failed. */
function rowCounts(loads: Partial<Record<Board, Load>>): Partial<Record<Board, number | null>> {
  const counts: Partial<Record<Board, number | null>> = {};
  for (const [board, load] of Object.entries(loads) as [Board, Load][]) {
    if (load.state === "ready") counts[board] = load.view.rows.length;
    else if (load.state === "error") counts[board] = null;
  }
  return counts;
}

/**
 * Tonight, Season and All time, each a ranked list of verified runs: rank, the hero's
 * sticker in their suit, handle, NEAR account and score. The viewer's own row is drawn
 * once, where it ranks, and pinned above the dock while it's out of view. It opens on
 * Tonight, or on the first board that has anyone on it (openingBoard), until the viewer
 * picks a tab; from then on their pick stands.
 */
export function LeaderboardScreen() {
  const [picked, setPicked] = useState<Board | null>(null);
  const [loads, setLoads] = useState<Partial<Record<Board, Load>>>({});
  const [attempt, setAttempt] = useState(0);
  const board = picked ?? openingBoard(rowCounts(loads));

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/leaderboard?board=${board}&around=me`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const view = (await res.json()) as View;
        setLoads((prev) => ({ ...prev, [board]: { state: "ready", view, receivedAt: Date.now() } }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Keep showing an older copy of this board if there is one.
        setLoads((prev) => (prev[board]?.state === "ready" ? prev : { ...prev, [board]: { state: "error" } }));
      });
    return () => controller.abort();
  }, [board, attempt]);

  const load = loads[board] ?? { state: "loading" };

  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[28px] font-semibold leading-[30px] tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] [text-wrap:balance] sm:text-[36px] sm:leading-[38px]">
          Leaderboard
        </h1>
        <p className="max-w-[52ch] text-[14px] leading-5 text-game-paper/80 [text-wrap:pretty]">
          Every score is replayed on our server before it counts. Ties go to the faster night.
        </p>
      </header>

      <StickerTabs tabs={TABS} value={board} onChange={setPicked} label="Board" idPrefix={ID} className="self-stretch sm:self-start sm:min-w-[360px]" />

      <StickerPanel {...tabPanelProps(ID, board)} className="flex flex-col gap-2 p-2 focus-visible:outline-offset-4">
        <div className="flex min-h-[52px] items-center justify-between gap-3 border-b-2 border-dashed border-game-ink/20 px-2.5 pb-3 pt-2 sm:px-3">
          {load.state === "ready" ? (
            <p className="flex min-w-0 items-center gap-2.5">
              <Clock aria-hidden className="size-5 shrink-0" strokeWidth={2} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-semibold leading-5">{periodLabel(load.view).title}</span>
                <span className="text-[12px] leading-4 text-game-muted [overflow-wrap:anywhere]">{periodLabel(load.view).detail}</span>
              </span>
            </p>
          ) : (
            <span aria-hidden className="h-4 w-36 rounded-full bg-game-paper-2" />
          )}
          {load.state === "ready" && load.view.total > 0 ? (
            <StickerChip className="num h-7 shrink-0 text-[12px]">
              {plural(load.view.total, "hero", "heroes")}
            </StickerChip>
          ) : null}
        </div>

        {load.state === "ready" && load.view.board === "season" && load.view.season ? (
          <SeasonCard season={load.view.season} serverNow={load.view.now} receivedAt={load.receivedAt} />
        ) : null}
        {load.state === "loading" ? <SkeletonRows /> : null}
        {load.state === "error" ? (
          <div className="flex flex-col items-start gap-3 px-2.5 py-6 sm:px-3">
            <p className="flex items-center gap-2 text-[15px] leading-6">
              <CircleAlert aria-hidden className="size-5 shrink-0 text-game-hero" strokeWidth={2} />
              The board didn’t load. Check your connection and try again.
            </p>
            <StickerButton size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </StickerButton>
          </div>
        ) : null}
        {load.state === "ready" ? <Board view={load.view} receivedAt={load.receivedAt} /> : null}
      </StickerPanel>

      {/* A short board says it inside the board (the open place); a full one pins the notice above the dock. */}
      {load.state === "ready" && load.view.rows.length > 0 && inviteFor(load.view)?.claimRank == null ? <PlaceNotice view={load.view} /> : null}
    </div>
  );
}
