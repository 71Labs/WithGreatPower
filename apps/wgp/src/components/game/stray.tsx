/**
 * A page with nothing to show: an address that leads nowhere, or a screen that broke. The
 * night city behind one paper panel, like /stats and the invite landing, saying what
 * happened and offering the way back. Server-safe; the error pages pass a retry button in.
 */
import type { ReactNode } from "react";

import { GameBackdrop } from "@/components/game/backdrop";
import { KitStyles, ON_PAPER, StickerEyebrow, StickerPanel } from "@/components/game/kit";

export function StrayPage({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div data-wgp-night="" className="relative isolate min-h-dvh bg-game-night text-game-paper [--vs-focus:var(--game-gold)]">
      <KitStyles />
      <GameBackdrop variant="flow" />
      <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
        <StickerPanel as="article" aria-labelledby="stray-title" className={`wgp-rise flex w-full max-w-[480px] flex-col gap-5 p-5 sm:p-7 ${ON_PAPER}`}>
          <header className="flex flex-col gap-2">
            <StickerEyebrow>{eyebrow}</StickerEyebrow>
            <h1 id="stray-title" className="font-display text-[28px] font-semibold leading-8 tracking-[-0.03em] text-game-ink [text-wrap:balance] sm:text-[34px] sm:leading-[38px]">
              {title}
            </h1>
            <p className="text-[15px] leading-[22px] text-game-muted [text-wrap:pretty]">{children}</p>
          </header>
          <div className="flex flex-col gap-2.5 sm:flex-row">{actions}</div>
        </StickerPanel>
      </main>
    </div>
  );
}
