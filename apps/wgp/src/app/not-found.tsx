import type { Metadata } from "next";

import { StickerLink } from "@/components/game/kit";
import { StrayPage } from "@/components/game/stray";
import { ArrowRight } from "@/components/icons";

export const metadata: Metadata = { title: "Page not found" };

/** Any address the app doesn't have, and every `notFound()`: a run, an invite or a case that isn't there. */
export default function NotFound() {
  return (
    <StrayPage
      eyebrow="Error 404"
      title="Nothing at this address"
      actions={
        <>
          <StickerLink href="/play" variant="hero" className="w-full sm:w-auto">
            Go to Tonight
            <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
          </StickerLink>
          <StickerLink href="/" className="w-full sm:w-auto">
            Visit the website
          </StickerLink>
        </>
      }
    >
      The link may be old or mistyped. Your hero is where you left them.
    </StrayPage>
  );
}
