import type { Metadata } from "next";
import { connection } from "next/server";

import { StatsView } from "@/components/stats/stats-view";
import { SITE_URL } from "@/lib/site";
import { cachedPublicStats } from "@/server/db/stats-cache";

/**
 * /stats, "By the numbers": the game's public counts as tiles and one chart of verified
 * matches by mode. It draws what GET /api/stats answers (the same cached read), so every
 * number on it can be checked with one curl.
 *
 * The counts come from the database at request time, so the page waits for them before it
 * sends anything (instant = false), like /admin/social.
 */
export const instant = false;

const description = "Matches, players, City outings and on-chain mints in With Great Power, counted live. Every number comes from one public API.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "By the numbers",
  description,
  alternates: { canonical: "/stats" },
  openGraph: { type: "website", siteName: "With Great Power", url: "/stats", title: "With Great Power, by the numbers", description },
};

export default async function StatsPage() {
  await connection();
  return <StatsView stats={await cachedPublicStats()} />;
}
