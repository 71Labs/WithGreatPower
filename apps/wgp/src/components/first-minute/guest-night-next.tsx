"use client";

/**
 * What a guest sees under their score when a night ends: the three ways on.
 *
 * 1. Sign in with Google, in one tap, with the promise spelled out and kept true: the night
 *    just played stays unranked (the server only checks nights it issued), the next ones
 *    rank, and the hero in this browser comes along on first sign-in, within the import's
 *    caps (src/game/import-caps.ts): level 3, 10 items.
 * 2. Play the next night now: a guest's nights aren't rationed.
 * 3. Come back tomorrow: the Daily Run turns over at midnight UTC.
 *
 * It asks for sign-in through the `wgp:sign-in` window event, like the rest of the patrol,
 * so it doesn't pull the account sheet's code into the night.
 */
import { useState } from "react";

import { StickerButton, StickerLink } from "@/components/game/kit";
import { ArrowRight, CalendarClock, Check, Google } from "@/components/icons";
import { IMPORT_CAPS } from "@/game/import-caps";
import { dispatch, getSave } from "@/game/store";
import { useDailyReset } from "@/lib/first-minute/tomorrow";

/** What comes along on sign-in, said exactly: the caps only show when they'd bite. */
export function keepLine(hero: { name: string; level: number } | null, items: number): string {
  if (!hero) return "Your hero comes with you the first time you sign in.";
  const level = hero.level > IMPORT_CAPS.level ? `arrives at level ${IMPORT_CAPS.level} (the most a guest hero brings)` : `keeps level ${hero.level}`;
  const bag =
    items === 0
      ? "their powers and suits"
      : items > IMPORT_CAPS.totalItems
        ? `their powers, suits and ${IMPORT_CAPS.totalItems} of the ${items} items in the bag`
        : `their powers, suits and ${items === 1 ? "the item" : `all ${items} items`} in the bag`;
  return `${hero.name} comes with you: ${level}, with ${bag}.`;
}

export function GuestNightNext({ hero, items, night }: { hero: { name: string; level: number } | null; items: number; night: number }) {
  const reset = useDailyReset();
  const [leaving, setLeaving] = useState(false);

  function nextNight() {
    if (leaving) return;
    setLeaving(true);
    // The night is banked in this browser already: sleep, then open the patrol on the new night.
    if (getSave()?.nightDone) dispatch({ type: "sleep" });
    // A fresh page load, on purpose: the patrol page is already mounted on the finished night,
    // and a new night needs its session, recorder and scene built from nothing.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/play/patrol");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[17px] font-bold leading-6 text-game-ink [text-wrap:balance]">Sign in with Google to rank your next night and keep this hero</h2>
        <ul className="flex flex-col gap-1.5 text-[14px] leading-5 text-game-ink">
          <li className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={3} />
            <span className="[text-wrap:pretty]">{keepLine(hero, items)}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={3} />
            <span className="[text-wrap:pretty]">Every night after that is replayed by the server and ranked, with a link you can share.</span>
          </li>
          <li className="flex items-start gap-2 text-game-muted">
            <span aria-hidden className="mt-0.5 grid size-4 shrink-0 place-items-center font-bold">·</span>
            <span className="[text-wrap:pretty]">This night stays unranked: it was played as a guest. Free, and no wallet or crypto needed.</span>
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <StickerButton
          variant="ink"
          size="md"
          onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in", { detail: { with: "google" } }))}
          className="w-full sm:w-auto"
        >
          <Google aria-hidden className="size-5" strokeWidth={2} />
          Sign in with Google
        </StickerButton>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in"))}
          className="inline-flex min-h-11 items-center justify-center rounded-full px-2 text-[14px] font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 focus-visible:outline-offset-2 pointer-fine:hover:decoration-game-ink"
        >
          Use a NEAR wallet instead
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t-2 border-dashed border-game-ink/30 pt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <StickerButton size="md" onClick={nextNight} aria-busy={leaving || undefined} className="w-full sm:w-auto">
            {leaving ? "Sleeping…" : `Play night ${night + 1} now`}
            <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
          </StickerButton>
          <StickerLink href="/play/compete/daily" size="md" className="w-full sm:w-auto">
            Race today’s Daily Run
          </StickerLink>
        </div>
        <p className="flex items-start gap-2 text-[13px] leading-5 text-game-muted">
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          <span className="[text-wrap:pretty]">
            The Daily Run is the same city for everyone, and a new one posts{" "}
            {reset ? (
              <>
                in <span className="num font-semibold text-game-ink">{reset}</span> (midnight UTC)
              </>
            ) : (
              "at midnight UTC"
            )}
            . Your hero is saved in this browser, so you can pick up tomorrow.
          </span>
        </p>
      </div>
    </div>
  );
}
