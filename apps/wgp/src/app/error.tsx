"use client";

import { useEffect } from "react";

import { StickerButton, StickerLink } from "@/components/game/kit";
import { StrayPage } from "@/components/game/stray";
import { RotateCcw } from "@/components/icons";

/** A screen that threw while rendering. The save is untouched: it lives in the browser or the account, not in the page. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StrayPage
      eyebrow="Something broke"
      title="This screen hit a snag"
      actions={
        <>
          <StickerButton variant="hero" onClick={() => retry()} className="w-full sm:w-auto">
            <RotateCcw aria-hidden className="size-5" strokeWidth={2.25} />
            Try again
          </StickerButton>
          <StickerLink href="/play" className="w-full sm:w-auto">
            Go to Tonight
          </StickerLink>
        </>
      }
    >
      Your hero and your progress are safe. Try again, or head back to Tonight.
    </StrayPage>
  );
}
