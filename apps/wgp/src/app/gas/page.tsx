import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { StickerEyebrow } from "@/components/game/kit";
import { GasFrame, GasHeader, TankBody } from "@/components/gas/gas-view";
import { RefillForm } from "@/components/gas/refill-form";
import { SITE_URL } from "@/lib/site";
import { gasTankConfig, MAX_USD, MIN_USD } from "@/server/intents/one-click";
import { readGasTank, type GasTank } from "@/server/intents/tank";

/**
 * /gas, the Gas tank: the relayer that pays signed-in players' gas, how full it is, and a
 * form that refills it from another chain through NEAR Intents' 1Click API
 * (src/server/intents/one-click.ts). The frame and the words are prerendered; the level is
 * read from NEAR at request time and streams in, like /stats.
 */

const description = "Signed-in players never pay gas. Refill the relayer that pays it from Ethereum, Base, Arbitrum, Solana or Bitcoin through NEAR Intents.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "The gas tank",
  description,
  alternates: { canonical: "/gas" },
  openGraph: { type: "website", siteName: "With Great Power", url: "/gas", title: "With Great Power: the gas tank", description },
  twitter: { card: "summary_large_image", site: "@wgponnear", title: "With Great Power: the gas tank", description },
};

async function Live() {
  await connection();
  const configured = gasTankConfig() !== null;
  let tank: GasTank | null = null;
  try {
    tank = await readGasTank();
  } catch (error) {
    console.error(`[gas] reading the tank failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return (
    <>
      {configured && !tank ? (
        <p role="status" className="rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper-2 px-4 py-4 text-[15px] font-semibold leading-[22px] text-game-ink">
          NEAR didn’t answer, so the level can’t be shown right now. Refills still work.
        </p>
      ) : (
        <TankBody tank={tank} configured={configured} />
      )}
      {configured ? <Refill /> : null}
    </>
  );
}

function Refill() {
  return (
    <section aria-labelledby="gas-refill" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <StickerEyebrow as="h2" id="gas-refill">
          Refill it from another chain
        </StickerEyebrow>
        <ul id="gas-terms" className="flex max-w-[65ch] list-disc flex-col gap-1 ps-5 text-[14px] leading-5 text-game-ink marker:text-game-muted [text-wrap:pretty]">
          <li>
            <span className="font-semibold">This is a donation.</span> It buys gas for players and returns nothing to you: no tokens, no rewards, no ranking.
          </li>
          <li>
            The swap runs through NEAR Intents’ 1Click API, which takes a 0.2% fee. The NEAR goes straight to the relayer; this site never holds your funds.
          </li>
          <li>
            Between ${MIN_USD} and ${MAX_USD} worth at a time. If a swap fails, it’s refunded to the refund address you give.
          </li>
        </ul>
      </div>
      <RefillForm />
    </section>
  );
}

export default function GasPage() {
  return (
    <GasFrame>
      <GasHeader />
      <Suspense fallback={<TankBody tank={null} configured />}>
        <Live />
      </Suspense>
    </GasFrame>
  );
}
