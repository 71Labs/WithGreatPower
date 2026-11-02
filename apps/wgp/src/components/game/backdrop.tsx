"use client";

import type { SuitId } from "@wgp/game-core/types";
import { CityBackdrop } from "@/sim/render/backdrop";

/**
 * The living city behind every game screen except the game itself.
 *
 * This is the one place the backdrop is chosen: the sticker city from the game itself
 * (`CityBackdrop`), drifting slowly under a scrim.
 *
 * Contract:
 * - Fixed, full-bleed, behind everything (`-z-10` inside the shell's isolated root),
 *   `aria-hidden`, `pointer-events: none`. It never takes focus or clicks.
 * - `variant` sets how far the city is pushed back: "home" keeps it vivid in the middle
 *   (the hero stands in it), "tab" dims it for screens full of paper, "flow" dims it
 *   most (onboarding).
 * - The city draws your hero perched on a roof, except on Home, where your hero already
 *   stands front and centre.
 * - Static under prefers-reduced-motion; animates only while on screen.
 * - It owns its own scrim, so text in the safe areas (the top chips, the dock) always
 *   sits on a dark ground.
 */
export type BackdropVariant = "home" | "tab" | "flow";

const SCRIM: Record<BackdropVariant, string> = {
  home: "bg-[linear-gradient(to_bottom,var(--game-night)_0%,transparent_20%,transparent_46%,color-mix(in_oklab,var(--game-night)_88%,transparent)_70%,var(--game-night)_100%)]",
  tab: "bg-game-night/70",
  flow: "bg-game-night/80",
};

export function GameBackdrop({ variant = "tab" }: { variant?: BackdropVariant; suit?: SuitId }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-game-night">
      <CityBackdrop hero={variant !== "home"} className="absolute inset-0" />
      <div className={`absolute inset-0 motion-safe:transition-[background-color,opacity] motion-safe:duration-500 ${SCRIM[variant]}`} />
    </div>
  );
}
