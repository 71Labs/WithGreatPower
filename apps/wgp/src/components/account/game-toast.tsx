"use client";

/**
 * The game's one toast: a paper sticker over the bottom of the screen for saves that
 * didn't stick, sign-in and sign-out. A polite live region (routine news, never an alarm);
 * the icon and the words carry the meaning, not the colour. Hides itself after a while.
 */
import { useEffect } from "react";

import { BadgeCheck, Check, CircleAlert, X } from "@/components/icons";
import { StickerIconButton } from "@/components/game/kit";
import { dismissToast, useGameToast } from "@/game/store";

const ICON = {
  success: <BadgeCheck aria-hidden className="size-5 text-game-mint" strokeWidth={2.25} />,
  info: <Check aria-hidden className="size-5 text-game-ink" strokeWidth={2.25} />,
  error: <CircleAlert aria-hidden className="size-5 text-game-hero" strokeWidth={2.25} />,
} as const;

/** `raised` sits it above the tab dock. */
export function GameToaster({ raised }: { raised: boolean }) {
  const toast = useGameToast();

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => dismissToast(toast.id), toast.tone === "error" ? 9000 : 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3 ${
        raised ? "bottom-[calc(96px+env(safe-area-inset-bottom))] sm:bottom-[calc(88px+env(safe-area-inset-bottom))]" : "bottom-[max(16px,env(safe-area-inset-bottom))]"
      }`}
    >
      {toast ? (
        <div
          key={toast.id}
          className="wgp-rise pointer-events-auto flex w-full max-w-[440px] items-center gap-2.5 rounded-[20px] border-[2.5px] border-game-ink bg-game-paper py-1.5 pl-4 pr-1.5 text-game-ink shadow-[var(--game-shadow)] [--vs-focus:var(--game-hero)]"
        >
          <span className="shrink-0">{ICON[toast.tone]}</span>
          <p className="min-w-0 flex-1 py-2 text-[14px] font-semibold leading-5 [text-wrap:pretty]">{toast.text}</p>
          <StickerIconButton label="Dismiss message" onClick={() => dismissToast(toast.id)} className="shadow-none">
            <X strokeWidth={2.25} />
          </StickerIconButton>
        </div>
      ) : null}
    </div>
  );
}
