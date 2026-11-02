"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { useGame } from "@/game/store";
import type { Hero, Save } from "@wgp/game-core/types";

export type HeroSave = Save & { hero: Hero };

/** The save once loaded and once a hero exists; players without one go get bitten. */
export function useHeroSave(): HeroSave | null {
  const { save } = useGame();
  const router = useRouter();
  const needsHero = !!save && !save.hero;
  useEffect(() => {
    if (needsHero) router.replace("/play/bitten");
  }, [needsHero, router]);
  return save && save.hero ? (save as HeroSave) : null;
}

function useMedia(query: string, server: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => server,
  );
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)", false);
export const useCoarsePointer = () => useMedia("(pointer: coarse)", false);
