/**
 * The Daily Rug's lead after case file 003 is closed: Bearson's "Fees fall. Loaf rises."
 * above the night's own front page, until the next edition is printed (lib/cases/local.ts
 * rugLeadFor), as case 001's lead does (components/cases/rug-lead.tsx).
 */
import { StickerLink } from "@/components/game/kit";
import { FolderSearch } from "@/components/icons";
import { CASE_003, CASE_003_PATHS } from "@/lib/cases/content-003";

import { RugFront } from "../shared";
import { AlsoFound } from "./also-found";
import { WarmLoafPhoto } from "./art";

export function CaseRugLead003({ hero }: { hero: string }) {
  return (
    <section aria-labelledby="case-lead-headline" className="flex min-w-0 flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 items-center rounded-full border-2 border-game-ink bg-game-hero px-2 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-on-hero">Extra</span>
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Case file <span className="num">{CASE_003.number}</span>: closed
        </span>
      </p>
      <RugFront
        nameplate={false}
        size="lead"
        headingLevel="h2"
        headingId="case-lead-headline"
        headline={CASE_003.found.headline}
        photo={<WarmLoafPhoto alt={CASE_003.found.photo} />}
        caption={CASE_003.found.caption}
        dek={CASE_003.found.dek}
        story={CASE_003.found.story(hero || "The Node")}
        byline={CASE_003.byline}
      />
      <AlsoFound />
      <StickerLink href={CASE_003_PATHS.list} size="sm" className="self-start">
        <FolderSearch aria-hidden className="size-4" strokeWidth={2.25} />
        Open the case files
      </StickerLink>
    </section>
  );
}
