/**
 * POST /api/runs/:id/submit { log: base64, clientHash } (body ≤ ~89 KB, log ≤ 64 KB)
 *   200 { status: "verified", runId, score, ticks, ranked, digest, save, rev, idempotent }
 *   422 { error: "run_rejected", status: "rejected", reason, runId, idempotent }
 *   409 { error: "rev_conflict", … } when the save moved on during the run
 *   410 run_expired · 409 already_submitted (a different log for a finished run)
 * Idempotent: the same log again returns the stored outcome.
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { refreshBoards } from "@/server/db/leaderboard-cache";
import { submitRun } from "@/server/db/runs";
import { HttpError, clientIp, handle, json, notFound, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { VERIFY_RULES } from "@/server/verify";

const MAX_LOG_BASE64 = Math.ceil(VERIFY_RULES.maxLogBytes / 3) * 4;

const body = z.object({
  log: z
    .string()
    .min(1)
    .max(MAX_LOG_BASE64)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "log must be standard base64"),
  clientHash: z.string().min(1).max(128),
});

export const POST = handle("runs/submit", async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  rateLimiter.enforce("run-submit-ip", clientIp(request), RATE_LIMITS.runSubmitPerIp);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw notFound("No such run");
  const session = await requireSession(request);
  rateLimiter.enforce("run-submit", session.playerId, RATE_LIMITS.runSubmitPerPlayer);

  const input = await readJson(request, body, MAX_LOG_BASE64 + 1024);
  const log = new Uint8Array(Buffer.from(input.log, "base64"));
  if (log.byteLength > VERIFY_RULES.maxLogBytes) throw new HttpError(413, "too_large", `Log over ${VERIFY_RULES.maxLogBytes} bytes`);

  const outcome = await submitRun(await getDb(), { playerId: session.playerId, runId: id, log, clientHash: input.clientHash });
  if (outcome.status === "verified") {
    if (outcome.tags.length > 0) refreshBoards(outcome.tags);
    return json({ ...outcome, tags: undefined });
  }
  const revConflict = outcome.reason === "rev_conflict";
  return json({ error: revConflict ? "rev_conflict" : "run_rejected", ...outcome }, { status: revConflict ? 409 : 422 });
});
