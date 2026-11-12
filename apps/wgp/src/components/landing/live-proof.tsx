/**
 * The hero's proof line: how many runs the server has replay-verified and how many heroes
 * have played, read on the server from the same cached count GET /api/stats answers
 * (src/server/db/stats-cache.ts), so the numbers on the landing can be checked with one curl.
 *
 * It streams into the static page behind a Suspense boundary. Until it arrives, and whenever
 * the count can't be read (no database, an error), the line says the same thing without
 * numbers. Both forms are one line of the same height, so nothing shifts.
 */
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { BadgeCheck } from "@/components/icons";
import { getDb } from "@/server/db/client";
import { cachedPublicStats } from "@/server/db/stats-cache";

const count = new Intl.NumberFormat("en-US");

/** The two numbers the line shows, or null when they can't be trusted to show. */
export function proofCounts(stats: { runs: { verified: number }; players: { played: number } } | null): { verified: number; heroes: number } | null {
  if (!stats) return null;
  const verified = Math.floor(stats.runs.verified);
  const heroes = Math.floor(stats.players.played);
  // An empty or broken count reads worse than no count.
  if (!(verified > 0) || !(heroes > 0)) return null;
  return { verified, heroes };
}

function Line({ counts }: { counts: { verified: number; heroes: number } | null }) {
  return (
    <p className="flex min-h-11 flex-wrap items-center gap-x-1.5 text-[14px] leading-5">
      <BadgeCheck aria-hidden className="size-4 shrink-0 text-(--night-ink)" strokeWidth={2.25} />
      {counts ? (
        <span>
          <span className="num font-semibold text-(--night-ink)">{count.format(counts.verified)}</span> runs replay-verified,{" "}
          <span className="num font-semibold text-(--night-ink)">{count.format(counts.heroes)}</span> heroes so far.
        </span>
      ) : (
        <span>Every ranked run is replay-verified.</span>
      )}
      <Link
        href="/stats"
        className="inline-flex min-h-11 items-center rounded-[8px] font-semibold text-(--night-ink) underline decoration-(--night-ink-faint) underline-offset-4 [@media(hover:hover)]:hover:decoration-(--night-ink)"
      >
        See the numbers
      </Link>
    </p>
  );
}

async function Counted() {
  // Request time: the count comes from the database, never from the build.
  await connection();
  let counts: ReturnType<typeof proofCounts> = null;
  try {
    // Open the database outside the cache scope (PGlite can't start inside one).
    await getDb();
    counts = proofCounts(await cachedPublicStats());
  } catch {
    counts = null;
  }
  return <Line counts={counts} />;
}

export function LiveProof() {
  return (
    <Suspense fallback={<Line counts={null} />}>
      <Counted />
    </Suspense>
  );
}
