import { ImageResponse } from "next/og";

import { INVITE_CARD_SIZE, InviteCard } from "@/components/referrals/invite-card";
import { loadLandingInvite, requestOrigin } from "@/lib/referrals/landing";
import { SUITS } from "@wgp/game-core/data";
import type { SuitId } from "@wgp/game-core/types";
import { CARD_FONT, cardFonts } from "@/server/social/fonts";

/**
 * /invite/<CODE>'s card for X and Open Graph (1200×630): the inviter's hero and handle in
 * the run cards' comic style (src/components/referrals/invite-card.tsx). An invite that
 * can't be looked up gets the card without a name.
 */
export const alt = "An invite to With Great Power, the web-swinging superhero parody on NEAR";
export const size = INVITE_CARD_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [invite, origin] = await Promise.all([loadLandingInvite(code), requestOrigin()]);
  const fonts = await cardFonts(origin);
  const referrer = invite.state === "valid" ? invite.referrer : null;
  const suit: SuitId = referrer?.suit && referrer.suit in SUITS ? referrer.suit : "classic";
  return new ImageResponse(<InviteCard handle={referrer?.handle ?? null} heroName={referrer?.heroName ?? null} suit={suit} code={invite.state === "unknown" ? null : invite.code} fontFamily={fonts.length ? CARD_FONT : undefined} />, {
    ...INVITE_CARD_SIZE,
    ...(fonts.length ? { fonts } : {}),
    headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
