/**
 * GET /api/admin/social → 200 { admin, drafts: DraftView[], sync: { created, errors } }
 * Admins only (ADMIN_ACCOUNT_IDS); 404 for everyone else. Opening the queue is what
 * drafts new posts: every generator runs (dev log included), idempotently, then the
 * newest 100 drafts are listed with their history. Nothing is posted from here.
 */
import { getDb } from "@/server/db/client";
import { handle, json } from "@/server/http";
import { requireAdmin } from "@/server/social/admin";
import { listDrafts, syncDrafts } from "@/server/social/queue";

export const GET = handle("admin/social", async (request: Request) => {
  const session = await requireAdmin(request);
  const db = await getDb();
  const sync = await syncDrafts(db, { devLog: true });
  const drafts = await listDrafts(db);
  return json({ admin: session.player.nearAccountId, drafts, sync });
});
