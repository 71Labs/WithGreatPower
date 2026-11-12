"use client";

/**
 * Tonight's reason to come back: when the next Daily Run posts (midnight UTC, counted down),
 * and a way to keep the game one tap away: "Add to home screen", where the browser offers
 * it (Android and desktop Chrome fire `beforeinstallprompt` once the manifest is in place),
 * or the two steps to do it by hand on an iPhone. No push, no service worker: the browser
 * asks the player, and the icon is the reminder.
 */
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { ON_PAPER, StickerButton } from "@/components/game/kit";
import { CalendarClock, ChevronRight, Smartphone } from "@/components/icons";
import { showToast } from "@/game/store";
import { useDailyReset } from "@/lib/first-minute/tomorrow";

/** The browser's install offer (not in TypeScript's DOM types). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the offer for our own button instead of the browser's banner.
    event.preventDefault();
    offer = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type InstallState = "offer" | "ios" | "none";

/** What this browser can do about a home-screen icon. */
function installState(): InstallState {
  if (offer) return "offer";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "none";
  // iPhone and iPad Safari never fire the offer: the Share sheet is the only way.
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) ? "ios" : "none";
}

async function install() {
  const event = offer;
  if (!event) return;
  await event.prompt();
  const choice = await event.userChoice.catch(() => null);
  // An offer can be used once.
  offer = null;
  notify();
  if (choice?.outcome === "accepted") showToast("Added. With Great Power is on your home screen.", "success");
}

export function ComeBackTile({ nightDone, className = "" }: { nightDone: boolean; className?: string }) {
  const reset = useDailyReset();
  const state = useSyncExternalStore<InstallState>(subscribe, installState, () => "none");
  return (
    <section
      aria-label="Tomorrow"
      className={`flex w-full min-w-0 flex-col gap-2.5 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} ${className}`}
    >
      <Link
        href="/play/compete"
        className="flex min-h-11 min-w-0 items-center gap-3 rounded-[12px] pr-0.5 focus-visible:outline-offset-2 pointer-fine:hover:bg-game-paper-2"
      >
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-paper-2">
          <CalendarClock className="size-5" strokeWidth={2.25} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Tomorrow</span>
          <span className="num text-[15px] font-bold leading-5 [text-wrap:balance]">{reset ? `New Daily Run in ${reset}` : "New Daily Run at midnight UTC"}</span>
          <span className="text-[13px] leading-[18px] text-game-muted">
            {nightDone ? "A new patrol posts when you sleep. The Daily is a new city for everyone." : "A new city for everyone, and a fresh board to climb."}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
      </Link>
      {state === "offer" ? (
        <StickerButton size="sm" onClick={() => void install()} className="w-full">
          <Smartphone aria-hidden className="size-[18px]" strokeWidth={2.25} />
          Add to home screen
        </StickerButton>
      ) : state === "ios" ? (
        <p className="flex items-start gap-2 rounded-[10px] bg-game-paper-2 px-3 py-2 text-[13px] leading-[18px] text-game-ink">
          <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
          <span>To keep the game one tap away, tap Share, then “Add to Home Screen”.</span>
        </p>
      ) : null}
    </section>
  );
}
