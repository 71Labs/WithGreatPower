/**
 * PATCH /api/admin/social/drafts/:id { action: "edit" | "approve" | "reject" | "posted", text? }
 *   → 200 { draft }
 *   422 not_postable (over X's 280, more than three tags, or no #NEARHackathon)
 *   409 bad_status · 409 expired · 404 for non-admins and unknown drafts
 * Logs who did what and when. "posted" only records that the admin sent it from X.
 */
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { assertJson, handle, json, notFound, readJson } from "@/server/http";
import { requireAdmin } from "@/server/social/admin";
import { DRAFT_ACTIONS, decideDraft } from "@/server/social/queue";

const body = z.object({ action: z.enum(DRAFT_ACTIONS), text: z.string().max(4000).optional() });

export const PATCH = handle("admin/social/draft", async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireAdmin(request);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw notFound("No such draft");
  assertJson(request);
  const input = await readJson(request, body, 16 * 1024);
  const draft = await decideDraft(await getDb(), { id, actor: session.player.nearAccountId, action: input.action, text: input.text });
  return json({ draft });
});
