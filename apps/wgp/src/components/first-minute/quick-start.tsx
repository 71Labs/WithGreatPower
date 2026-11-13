"use client";

/**
 * /play/start, where the landing's "Play now" goes: one tap from the website to the city.
 *
 * - A new guest gets the quick-start hero (lib/first-minute/quick-hero.ts) and lands in
 *   their first night at once: no name, suit or power form first. The hub offers to make
 *   the hero theirs afterwards.
 * - Anyone who already has a hero goes to Tonight, as before.
 * - A signed-in player with no hero yet gets the full origin (/play/bitten): their hero's
 *   name goes on the boards, so they choose it.
 *
 * The 3D night's code starts loading while this decides, so the city is closer by the time
 * the patrol page mounts.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { GameLoading } from "@/components/game/ui";
import { useAccount, useGame } from "@/game/store";
import { QUICK_HERO, markQuickHero } from "@/lib/first-minute/quick-hero";
import { quickStartStep } from "@/lib/first-minute/quick-start-route";

if (typeof window !== "undefined") {
  // Warm the patrol page's code (it asks for the 3D stage itself as soon as it runs).
  void import("@/app/play/patrol/patrol").catch(() => {});
}

export function QuickStart() {
  const account = useAccount();
  const { save, dispatch } = useGame();
  const router = useRouter();
  /** This visit made the hero: go straight into the night rather than to the hub. */
  const made = useRef(false);
  const hasHero = !!save?.hero;
  const status = account.status;

  useEffect(() => {
    // The decision is a pure function (lib/first-minute/quick-start-route.ts), tested there.
    const step = quickStartStep({ status, saveLoaded: !!save, hasHero, madeHere: made.current });
    if (step.kind === "go") router.replace(step.to);
    else if (step.kind === "make-hero") {
      made.current = true;
      markQuickHero(true);
      dispatch({ type: "create-hero", ...QUICK_HERO });
    }
  }, [status, save, hasHero, dispatch, router]);

  return <GameLoading />;
}
