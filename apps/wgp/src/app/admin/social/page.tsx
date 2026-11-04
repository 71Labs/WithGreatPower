import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { SocialQueue } from "@/components/social/queue";
import { sessionCookieName } from "@/server/auth/session";
import { adminForToken } from "@/server/social/admin";

/**
 * /admin/social: the X draft queue, for the accounts in ADMIN_ACCOUNT_IDS only. Everyone
 * else gets a 404. The check runs before anything is sent (instant = false), so the 404
 * is a real status, not a streamed one.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Social queue",
  robots: { index: false, follow: false },
};

export default async function SocialQueuePage() {
  const jar = await cookies();
  const admin = await adminForToken(jar.get(sessionCookieName())?.value);
  if (!admin) notFound();
  return <SocialQueue admin={admin.player.nearAccountId} />;
}
