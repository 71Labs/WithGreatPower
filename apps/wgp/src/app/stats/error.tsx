"use client";

import { useEffect } from "react";

import { StickerButton, StickerLink } from "@/components/game/kit";
import { StrayPage } from "@/components/game/stray";
import { RotateCcw } from "@/components/icons";

/** The count failed (the database didn't answer): say so and offer another go. */
export default function StatsError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StrayPage
      eyebrow="By the numbers"
      title="Couldn’t count just now"
      actions={
        <>
          <StickerButton variant="hero" onClick={() => retry()} className="w-full sm:w-auto">
            <RotateCcw aria-hidden className="size-5" strokeWidth={2.25} />
            Count again
          </StickerButton>
          <StickerLink href="/" className="w-full sm:w-auto">
            Visit the website
          </StickerLink>
        </>
      }
    >
      The game’s records didn’t answer in time. The numbers are still there; count again in a moment.
    </StrayPage>
  );
}
