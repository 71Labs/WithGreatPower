"use client";

/**
 * "Bring your hero along?": once, on a player's first sign-in, when this browser holds a
 * hero and the account doesn't. Accepting imports it (POST /api/migrate: level capped at
 * 3, items minted once with a Day one trophy); Start fresh is remembered for this player
 * in this browser; closing asks again on the next visit.
 */
import { useState } from "react";

import { CircleAlert } from "@/components/icons";
import { StickerButton } from "@/components/game/kit";
import { GameSheet, HeroSticker } from "@/components/game/ui";
import { IMPORT_CAPS } from "@/game/import-caps";
import { plural } from "@/lib/plural";
import { acceptMigration, declineMigration, deferMigration, showToast, useMigrationOffer, type MigrationOffer } from "@/game/store";


export function MigrationSheet({ blocked }: { blocked: boolean }) {
  const offer = useMigrationOffer();
  // Keep the last offer on screen while the sheet slides away after a choice.
  const [shown, setShown] = useState<MigrationOffer | null>(offer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (offer && offer !== shown) setShown(offer);

  const open = !!offer && !blocked;
  const hero = shown?.hero;
  const items = shown ? Object.values(shown.save.inventory).reduce((sum, n) => sum + (n ?? 0), 0) : 0;

  async function bring() {
    if (busy || !hero) return;
    setBusy(true);
    setError(null);
    const res = await acceptMigration();
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (res.imported) showToast(`${hero.name} is on your account now.`, "success");
  }

  return (
    <GameSheet
      open={open}
      onClose={() => {
        if (!busy) deferMigration();
      }}
      eyebrow="Welcome aboard"
      title="Bring your hero along?"
      art={hero ? <HeroSticker hero={hero} size="sm" /> : undefined}
      footer={
        <>
          <StickerButton onClick={declineMigration} aria-disabled={busy || undefined} className="sm:order-first">
            Start fresh
          </StickerButton>
          <StickerButton variant="hero" onClick={() => void bring()} aria-busy={busy || undefined} data-autofocus="">
            {busy ? `Bringing ${hero?.name ?? "your hero"}…` : `Bring ${hero?.name ?? "my hero"} along`}
          </StickerButton>
        </>
      }
    >
      {hero ? (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-6 text-game-ink [text-wrap:pretty]">
            <span className="font-semibold">{hero.name}</span> is saved in this browser at level <span className="num">{hero.level}</span>. Bring them to your account and
            your nights count on the leaderboard.
          </p>
          <ul className="flex flex-col gap-2 text-[14px] leading-5">
            <li className="rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-3">
              {hero.level > IMPORT_CAPS.level ? (
                <>
                  Heroes arrive at level <span className="num">{IMPORT_CAPS.level}</span> at most, so {hero.name} starts at level{" "}
                  <span className="num">{IMPORT_CAPS.level}</span>.
                </>
              ) : (
                <>
                  {hero.name} keeps level <span className="num">{hero.level}</span>, their powers and suits.
                </>
              )}
            </li>
            <li className="rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-3">
              {items > 0 ? `Up to ${plural(Math.min(items, IMPORT_CAPS.totalItems), "item")} from the bag are minted to your NEAR account, once, with a Day one trophy.` : "You get a Day one trophy on your NEAR account."}
            </li>
            <li className="rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-3">
              Start fresh to make a new hero instead. The copy in this browser stays either way.
            </li>
          </ul>
          <div role="status" aria-live="polite" className="empty:-mt-4">
            {error ? (
              <p className="flex items-start gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 text-[14px] leading-5">
                <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-game-hero" strokeWidth={2} />
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </GameSheet>
  );
}
