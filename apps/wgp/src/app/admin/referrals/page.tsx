import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ReferralsAdmin } from "@/components/admin/referrals";
import { sessionCookieName } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { REFERRAL_GOAL, adminReferrals } from "@/server/db/referrals";
import { adminForToken } from "@/server/social/admin";

/**
 * /admin/referrals: who invited friends who count, for the accounts in ADMIN_ACCOUNT_IDS only.
 * Everyone else gets a 404, as on /admin/social. The check runs before anything is sent
 * (instant = false), so the 404 is a real status, not a streamed one.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Referrals",
  robots: { index: false, follow: false },
};

export default async function ReferralsAdminPage() {
  // A request-time page: the session check reads the clock.
  await connection();
  const jar = await cookies();
  const db = await getDb();
  const admin = await adminForToken(jar.get(sessionCookieName())?.value, db);
  if (!admin) notFound();
  return <ReferralsAdmin admin={admin.player.nearAccountId} referrers={await adminReferrals(db)} goal={REFERRAL_GOAL} />;
}
