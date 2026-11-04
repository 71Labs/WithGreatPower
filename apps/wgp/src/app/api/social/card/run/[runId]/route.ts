/**
 * GET /api/social/card/run/:runId → 200 image/png (1200×630), 404 for unverified or unknown runs.
 * A verified run's card: its Open Graph and X image (src/app/r/[runId]) and the queue's
 * shout-out attachment. Public. A verified run never changes, so browsers keep the PNG
 * a day and the CDN a year (each deploy starts its CDN cache afresh).
 */
import { createElement } from "react";

import { getDb } from "@/server/db/client";
import { clientIp, handle, notFound } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { RunCard, renderCard } from "@/server/social/cards";
import { publicRun } from "@/server/social/runs";

export const GET = handle("social/card/run", async (request: Request, { params }: { params: Promise<{ runId: string }> }) => {
  rateLimiter.enforce("card-ip", clientIp(request), RATE_LIMITS.cardPerIp);
  const { runId } = await params;
  const run = await publicRun(await getDb(), runId);
  if (!run) throw notFound("No verified run with that id");
  return renderCard(createElement(RunCard, { run }), {
    origin: new URL(request.url).origin,
    headers: { "cache-control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=86400" },
  });
});
