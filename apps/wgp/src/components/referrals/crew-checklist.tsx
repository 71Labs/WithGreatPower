"use client";

/**
 * The friend's side on Tonight: a small checklist for a player someone invited, until
 * they count for that crew. "Add your X" opens the account sheet on its X field; "Play a
 * night" is ticked by any replay-verified night. Gone once both are done.
 */
import { ON_PAPER } from "@/components/game/kit";
import { Check, CircleDashed, XLogo } from "@/components/icons";
import { openAccountSheetAt } from "@/components/account/sheet-state";
import { useAccount } from "@/game/store";
import { useReferrals } from "@/lib/referrals/store";
import { crewChecklist, type CrewChecklist } from "@/lib/referrals/view";
import type { Save } from "@wgp/game-core/types";

function Done({ label }: { label: string }) {
  return (
    <span className="flex min-h-11 items-center gap-2.5 text-[14px] font-semibold leading-5 text-game-ink">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold">
        <Check className="size-4" strokeWidth={3} />
      </span>
      {label}
      <span className="sr-only">: done</span>
    </span>
  );
}

/** Presentational, for tests and fixtures. */
export function CrewChecklistView({ list, onAddX }: { list: CrewChecklist; onAddX: () => void }) {
  return (
    <section aria-labelledby="crew-checklist-title" className={`flex w-full flex-col gap-2 rounded-[20px] border-2 border-game-ink bg-game-paper p-3 pr-3.5 text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER}`}>
      <div className="flex flex-col gap-0.5">
        <p className="truncate text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{list.referrer}’s crew</p>
        <h2 id="crew-checklist-title" className="text-[15px] font-bold leading-5 text-game-ink [overflow-wrap:anywhere]">
          Count for {list.referrer}
        </h2>
      </div>
      <ul className="flex flex-col gap-1">
        <li>
          {list.x ? (
            <Done label="X added" />
          ) : (
            <button
              type="button"
              onClick={onAddX}
              aria-haspopup="dialog"
              className="-mx-1 flex min-h-11 w-[calc(100%+8px)] items-center gap-2.5 rounded-[12px] px-1 text-left text-[14px] font-semibold leading-5 focus-visible:outline-offset-0 pointer-fine:hover:bg-game-paper-2"
            >
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-dashed border-game-ink/50 text-game-muted">
                <XLogo className="size-3.5" strokeWidth={2.25} />
              </span>
              <span className="flex-1 underline decoration-game-ink/40 underline-offset-4">Add your X</span>
              <span className="sr-only">: not yet</span>
            </button>
          )}
        </li>
        <li>
          {list.played ? (
            <Done label="Night played" />
          ) : (
            <span className="flex min-h-11 items-center gap-2.5 text-[14px] leading-5">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-dashed border-game-ink/50 text-game-muted">
                <CircleDashed className="size-4" strokeWidth={2.25} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  Play a night<span className="sr-only">: not yet</span>
                </span>
                <span className="text-[12px] leading-4 text-game-muted">Any mode, once the server verifies it.</span>
              </span>
            </span>
          )}
        </li>
      </ul>
    </section>
  );
}

export function CrewChecklistTile({ save }: { save: Save }) {
  const state = useReferrals();
  const account = useAccount();
  const me = account.status === "signed-in" ? account.me : null;
  const list = crewChecklist({
    view: state.status === "ready" ? state.view : null,
    xHandle: me?.social?.xHandle ?? null,
    nights: save.stats.nights,
    migrated: me?.player.migrated ?? false,
  });
  if (!list) return null;
  return <CrewChecklistView list={list} onAddX={() => openAccountSheetAt("x")} />;
}
