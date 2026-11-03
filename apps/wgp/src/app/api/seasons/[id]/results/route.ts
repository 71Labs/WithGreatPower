/**
 * GET /api/seasons/:id/results → 200 the season's published results file
 * { version: "wgp-season-v1", seasonId, root, leaves: [{ rank, accountId, score, proof }] }
 *
 * Built from the standings frozen at the close, byte for byte what
 * scripts/near/record-season.ts writes for the same board: its sha256 is the `digest`
 * that `record_season` puts on chain, and every leaf's proof checks against `root`
 * (src/server/near/season.ts). 404 until the season has closed with at least one player.
 */
import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { seasonLeaves, type SeasonStanding } from "@/server/db/season-close";
import { seasons } from "@/server/db/schema";
import { clientIp, handle, notFound } from "@/server/http";
import { commitSeason } from "@/server/near/season";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("seasons/results", async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  rateLimiter.enforce("season-results-ip", clientIp(request), RATE_LIMITS.replayReadPerIp);
  const { id } = await params;
  if (!/^[a-z0-9-]{1,16}$/.test(id)) throw notFound("No such season");
  const [season] = await (await getDb()).select({ status: seasons.status, standings: seasons.standings }).from(seasons).where(eq(seasons.id, id)).limit(1);
  const standings = (season?.standings ?? []) as SeasonStanding[];
  if (!season || standings.length === 0) throw notFound("This season has no final results yet");
  const { file } = commitSeason(id, seasonLeaves(standings));
  // Final once recorded; until then a player claiming a name can still re-key it.
  const maxAge = season.status === "recorded" ? 3600 : 60;
  return new Response(file, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`,
      "content-disposition": `inline; filename="season-${id}.json"`,
    },
  });
});
