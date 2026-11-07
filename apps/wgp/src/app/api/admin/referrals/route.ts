/**
 * GET /api/admin/referrals → 200 { admin, referrers: AdminReferrer[] }
 * GET /api/admin/referrals?format=csv → 200 text/csv download, one row per qualified friend
 * Admins only (ADMIN_ACCOUNT_IDS); 404 for everyone else, signed in or not, like the social
 * queue. Referrers with at least one qualified friend, most first, with everything the owner
 * reviews before paying anyone by hand (src/server/db/referrals.ts `adminReferrals`). Nothing
 * here pays: USDC payouts are the owner's, through Uprail.
 */
import { getDb } from "@/server/db/client";
import { adminReferrals, referralsCsv } from "@/server/db/referrals";
import { handle, json } from "@/server/http";
import { requireAdmin } from "@/server/social/admin";

export const GET = handle("admin/referrals", async (request: Request) => {
  const session = await requireAdmin(request);
  const referrers = await adminReferrals(await getDb());
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const day = new Date().toISOString().slice(0, 10);
    return new Response(referralsCsv(referrers), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="wgp-referrals-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return json({ admin: session.player.nearAccountId, referrers });
});
