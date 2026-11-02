"use client";

/**
 * <CityBackdrop className="…" />: an idle, slowly drifting sticker city with the player's
 * hero perched on a rooftop, for menus to use as a living background. Decorative
 * (aria-hidden, no pointer events). It sizes to its container, so give it a size or
 * place it `absolute inset-0` inside a positioned parent.
 */
import { useEffect, useRef } from "react";

import { SUITS } from "@wgp/game-core/data";
import { useGame } from "@/game/store";

import { BackdropEngine } from "./backdrop-engine";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CityBackdrop({ className = "", hero = true }: { className?: string; hero?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { save } = useGame();
  const suit = save?.hero?.suit ?? "classic";

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = new BackdropEngine(canvas, hero ? SUITS[suit].colors : null, prefersReducedMotion());
    return () => engine.dispose();
  }, [suit, hero]);

  // The canvas fills the box, so the box needs a position; keep the caller's if it set one.
  const positioned = /(^|\s)(absolute|fixed|sticky|relative)(\s|$)/.test(className) ? "" : "relative";
  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden bg-game-night ${positioned} ${className}`}>
      <canvas ref={ref} className="absolute inset-0 block size-full" />
    </div>
  );
}
