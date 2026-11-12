import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { StatsBody } from "@/components/stats/stats-body";
import { StatsFrame } from "@/components/stats/stats-view";
import { SITE_URL } from "@/lib/site";
import { cachedPublicStats } from "@/server/db/stats-cache";

/**
 * /stats, "By the numbers": the game's public counts as tiles and one chart of verified
 * matches by mode. It draws what GET /api/stats answers (the same cached read), so every
 * number on it can be checked with one curl.
 *
 * The frame, the headings and every label are prerendered and sent at once; the counts
 * come from the database at request time and stream into their places. A cold function
 * with a cold database connection once took 13.7 s to answer, and the page used to wait
 * for it before sending anything.
 */

const description = "Matches, players, City outings and on-chain mints in With Great Power, counted live. Every number comes from one public API.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "By the numbers",
  description,
  alternates: { canonical: "/stats" },
  openGraph: { type: "website", siteName: "With Great Power", url: "/stats", title: "With Great Power, by the numbers", description },
  twitter: { card: "summary_large_image", site: "@wgponnear", title: "With Great Power, by the numbers", description },
};

async function Counted() {
  await connection();
  return <StatsBody stats={await cachedPublicStats()} />;
}

export default function StatsPage() {
  return (
    <StatsFrame>
      <Suspense fallback={<StatsBody stats={null} />}>
        <Counted />
      </Suspense>
    </StatsFrame>
  );
}
