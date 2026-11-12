import type { Metadata } from "next";

import { Cast } from "@/components/landing/cast";
import { Closing } from "@/components/landing/closing";
import { Hero } from "@/components/landing/hero";
import { Market } from "@/components/landing/market";
import { Near } from "@/components/landing/near";
import { Night } from "@/components/landing/night";
import { Ranked } from "@/components/landing/ranked";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  description:
    "With Great Power is a free-roam 3D web-swinging parody game in a comic-book city. Every ranked night is replayed on the server before it counts, a player-driven market sets the prices, and your items are NEP-245 tokens on NEAR with no gas to sign.",
};

/**
 * The landing page: the game in motion, how a night plays, the cast, the verified boards,
 * the market, what NEAR does, and the way in.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <Night />
      <Cast />
      <Ranked />
      <Market />
      <Near />
      <Closing />
    </>
  );
}
