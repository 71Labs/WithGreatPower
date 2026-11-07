import type { Metadata } from "next";

import { InviteLanding } from "@/components/referrals/invite-landing";
import { invitePath } from "@/lib/referrals/code";
import { loadLandingInvite } from "@/lib/referrals/landing";
import { SITE_URL } from "@/lib/site";

/**
 * /invite/<CODE>: where a player's invite link lands. "{handle} invited you to With Great
 * Power", the inviter's hero, and "Start playing" through the accept route (which sets
 * the invite cookie); the code is also kept in this browser as a fallback. An unknown
 * code still offers "Play anyway". The card image is ./opengraph-image.tsx.
 *
 * It waits for the lookup before it sends anything (instant = false), like /r/<runId>.
 * In development, `?fixture=landing-valid|landing-unknown|landing-unavailable` skips it.
 */
export const instant = false;

const fixtureOf = (search: Record<string, string | string[] | undefined>) => (typeof search.fixture === "string" ? search.fixture : null);

export async function generateMetadata({ params, searchParams }: PageProps<"/invite/[code]">): Promise<Metadata> {
  const [{ code }, search] = await Promise.all([params, searchParams]);
  const invite = await loadLandingInvite(code, fixtureOf(search));
  const title = invite.state === "valid" ? `${invite.referrer.handle} invited you` : invite.state === "unknown" ? "Invite not found" : "You’re invited";
  const description =
    invite.state === "valid"
      ? `Join ${invite.referrer.handle}’s crew in With Great Power, the web-swinging superhero parody on NEAR. Swing the city tonight.`
      : "With Great Power is a web-swinging superhero parody on NEAR. Swing the city tonight.";
  const path = invite.code ? invitePath(invite.code) : undefined;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    robots: { index: false },
    alternates: path ? { canonical: path } : undefined,
    openGraph: { type: "website", siteName: "With Great Power", url: path, title, description },
    twitter: { card: "summary_large_image", site: "@wgponnear", title, description },
  };
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[code]">) {
  const [{ code }, search] = await Promise.all([params, searchParams]);
  return <InviteLanding invite={await loadLandingInvite(code, fixtureOf(search))} />;
}
