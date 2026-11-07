/**
 * POST /api/city/outing { outingId: uuid, base: CityBase, log: base64 } (log ≤ 64 KB)
 *   200 { outingId, gains: { tasks, pages, views, xp }, city, save, rev, ticks, ruleset: "roam-3" }
 *   409 stale_city: the record moved on since the outing began (start again from it)
 *   409 old_rules { city, ruleset }: the log is an older roam ruleset's (roam-1, roam-2): nothing is filed,
 *       the record keeps what it had, and the browser starts a fresh outing from `city`
 *   422 outing_rejected: the replay refused the log (a night's or a chapter's, or malformed)
 *   429 daily_cap
 *
 * Files a free-roam outing for the signed-in player (src/server/db/city.ts): replayed from the
 * record's base, what it found is merged into the save with its XP, once. Idempotent per
 * outing: the same (or a longer) log of the same outing files again without paying twice.
 */
import { z } from "zod";

import { MAX_LOG_BYTES } from "@wgp/game-core/input";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { fileOuting } from "@/server/db/city";
import { HttpError, clientIp, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

const MAX_LOG_BASE64 = Math.ceil(MAX_LOG_BYTES / 3) * 4;
const FILE_PER_PLAYER = { limit: 30, windowMs: 60_000 };
const FILE_PER_IP = { limit: 90, windowMs: 60_000 };

const stage = z.number().int().min(0).max(9);
const bits = z.number().int().min(0).max(0xffffffff);
const taskMap = <T extends z.ZodType>(v: T) => z.object({ bread: v.optional(), pickpocket: v.optional(), pixels: v.optional(), graffiti: v.optional() }).strict();

const body = z.object({
  outingId: z.uuid(),
  base: z.object({
    tasks: taskMap(stage),
    items: taskMap(bits),
    pages: bits,
    views: bits,
    at: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), fx: z.number().finite(), fz: z.number().finite() }).nullable(),
  }),
  log: z
    .string()
    .min(1)
    .max(MAX_LOG_BASE64)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "log must be standard base64"),
});

export const POST = handle("city/outing", async (request: Request) => {
  rateLimiter.enforce("city-file-ip", clientIp(request), FILE_PER_IP);
  const session = await requireSession(request);
  rateLimiter.enforce("city-file", session.playerId, FILE_PER_PLAYER);
  const input = await readJson(request, body, MAX_LOG_BASE64 + 4096);
  const log = new Uint8Array(Buffer.from(input.log, "base64"));
  if (log.byteLength > MAX_LOG_BYTES) throw new HttpError(413, "too_large", `Log over ${MAX_LOG_BYTES} bytes`);
  return json(await fileOuting(await getDb(), { playerId: session.playerId, outingId: input.outingId, base: input.base, log }));
});
