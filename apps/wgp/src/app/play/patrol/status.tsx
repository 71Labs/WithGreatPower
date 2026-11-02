"use client";

/**
 * The patrol page's quiet states, in the sticker kit over the living 2D city: loading,
 * a notice when there's nothing to play, and a choice when a ranked night can't start
 * as asked (one already running, today's cap reached, the server unreachable).
 */
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { StickerButton, StickerEyebrow, StickerLink, StickerPanel } from "@/components/game/kit";
import { CityBackdrop } from "@/sim/render/backdrop";

/** The 2D game, loaded only when the 3D one can't run (no WebGL 2, a lost context, a 2D patrol). */
export const PatrolGame = dynamic(() => import("@/sim/ui/patrol-game").then((m) => m.PatrolGame), {
  loading: () => (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-game-night">
      <Loading />
    </div>
  ),
});

export function Centered({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center p-4">{children}</div>;
}

export function Loading({ label = "Suiting up…" }: { label?: string }) {
  return (
    <Centered>
      <p role="status" className="rounded-full border-[2.5px] border-game-ink bg-game-paper px-5 py-2.5 text-[15px] font-semibold text-game-ink shadow-[var(--game-shadow)]">
        {label}
      </p>
    </Centered>
  );
}

/** Nothing to play: tonight's done, no hero yet, or the server won't start one. */
export function Notice({ title, body, href = "/play", action = "Back to the city" }: { title: string; body: string; href?: string; action?: string }) {
  return (
    <>
      <CityBackdrop className="absolute inset-0" />
      <Centered>
        <StickerPanel as="section" aria-labelledby="notice-title" className="flex w-full max-w-[420px] flex-col gap-3 p-5">
          <h1 id="notice-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-balance text-game-ink">
            {title}
          </h1>
          <p className="text-[15px] leading-[22px] text-pretty">{body}</p>
          <StickerLink href={href} variant="hero" size="lg" className="mt-1 w-full">
            {action}
          </StickerLink>
        </StickerPanel>
      </Centered>
    </>
  );
}

export interface ChoiceAction {
  label: string;
  onClick(): void;
}

/** A decision before the night: one red action, a paper alternative, and the way back. */
export function Choice({ eyebrow, title, body, primary, secondary, busy }: { eyebrow: string; title: string; body: string; primary: ChoiceAction; secondary?: ChoiceAction; busy?: boolean }) {
  return (
    <>
      <CityBackdrop className="absolute inset-0" />
      <Centered>
        <StickerPanel as="section" role="dialog" aria-modal="true" aria-labelledby="choice-title" className="flex w-full max-w-[440px] flex-col gap-4 p-5">
          <StickerEyebrow>{eyebrow}</StickerEyebrow>
          <h1 id="choice-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-balance text-game-ink">
            {title}
          </h1>
          <p className="text-[15px] leading-[22px] text-pretty">{body}</p>
          <div className="flex flex-col gap-2.5">
            <StickerButton variant="hero" size="lg" onClick={primary.onClick} aria-disabled={busy || undefined} disabled={busy} className="w-full" autoFocus>
              {primary.label}
            </StickerButton>
            {secondary ? (
              <StickerButton size="lg" onClick={secondary.onClick} disabled={busy} className="w-full">
                {secondary.label}
              </StickerButton>
            ) : null}
            <StickerLink href="/play" size="lg" className="w-full">
              Back to the city
            </StickerLink>
          </div>
        </StickerPanel>
      </Centered>
    </>
  );
}
