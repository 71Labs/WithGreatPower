/**
 * GET /api/runs/:id/replay → 200 PublicReplay (src/server/db/runs.ts)
 * Public, verified runs only: the seed, the start save and the log, so anyone can
 * re-run the verifier. Immutable once verified, so it's cacheable.
 */
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { getReplay } from "@/server/db/runs";
import { clientIp, handle, json, notFound } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("runs/replay", async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  rateLimiter.enforce("replay-ip", clientIp(request), RATE_LIMITS.replayReadPerIp);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw notFound("No such run");
  const replay = await getReplay(await getDb(), id);
  if (!replay) throw notFound("No verified run with that id");
  return json(replay, { cacheSeconds: 3600 });
});
