/**
 * GET /api/social/card/:kind?… → 200 image/png (1200×630), the social queue's attachments:
 *   leaderboard?board=tonight|season|alltime&period=…  · market?item=…&at=<iso>
 *   countdown?season=…&at=<iso>                        · rug?run=<runId>
 * Admins only (404 otherwise), like the queue that links them. Every number on a card is
 * read from the database; `at` only fixes the moment the card shows, so a draft's card
 * stays the same however late it's opened.
 */
import type { NextRequest } from "next/server";

import { getDb } from "@/server/db/client";
import { handle, notFound } from "@/server/http";
import { requireAdmin } from "@/server/social/admin";
import { queueCard, renderCard } from "@/server/social/cards";

export const GET = handle("social/card", async (request: NextRequest, { params }: { params: Promise<{ kind: string }> }) => {
  await requireAdmin(request);
  const { kind } = await params;
  const card = await queueCard(await getDb(), kind, request.nextUrl.searchParams);
  if (!card) throw notFound("Nothing to draw for that card");
  return renderCard(card, { origin: request.nextUrl.origin, headers: { "cache-control": "private, max-age=300" } });
});
