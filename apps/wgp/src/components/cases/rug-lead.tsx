/**
 * The Daily Rug's lead after a case is closed: Bearson's "JPEG found" story above the
 * night's own front page, until the next edition is printed (lib/cases/local.ts rugLeadFor).
 */
import { StickerLink } from "@/components/game/kit";
import { FolderSearch } from "@/components/icons";
import { CASE_001, CASE_PATHS } from "@/lib/cases/content";
import { CASE_002 } from "@/lib/cases/content-002";

import { MaryPhoto } from "./art";
import { GenPhoto } from "./case-002/art";
import { CaseRugLead003 } from "./fee-strike/rug-lead";
import { RugFront } from "./shared";

export function CaseRugLead({ hero, id = "case-001" }: { hero: string; id?: string }) {
  // Case File 003's own lead (fee-strike/rug-lead.tsx): "Fees fall. Loaf rises."
  if (id === "case-003") return <CaseRugLead003 hero={hero} />;
  if (id === "case-002")
    return (
      <section aria-labelledby="case-lead-headline" className="flex min-w-0 flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full border-2 border-game-ink bg-game-hero px-2 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-on-hero">Extra</span>
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
            Case file <span className="num">{CASE_002.number}</span>: closed
          </span>
        </p>
        <RugFront
          nameplate={false}
          size="lead"
          headingLevel="h2"
          headingId="case-lead-headline"
          headline={CASE_002.found.headline}
          photo={<GenPhoto alt="Uncle Gen beside the ballot box, holding up his ballot." />}
          caption={CASE_002.found.caption}
          dek={CASE_002.found.dek}
          story={CASE_002.found.story(hero || "The Node")}
          byline={CASE_002.found.byline}
        />
        <StickerLink href={CASE_PATHS.list} size="sm" className="self-start">
          <FolderSearch aria-hidden className="size-4" strokeWidth={2.25} />
          Open the case files
        </StickerLink>
      </section>
    );
  return (
    <section aria-labelledby="case-lead-headline" className="flex min-w-0 flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 items-center rounded-full border-2 border-game-ink bg-game-hero px-2 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-on-hero">Extra</span>
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Case file <span className="num">{CASE_001.number}</span>: closed
        </span>
      </p>
      <RugFront
        nameplate={false}
        size="lead"
        headingLevel="h2"
        headingId="case-lead-headline"
        headline={CASE_001.found.headline}
        photo={<MaryPhoto restored alt="Mary Jpeg on a rooftop, waving, in full quality." />}
        caption={CASE_001.found.caption}
        dek={CASE_001.found.dek}
        story={CASE_001.found.story(hero || "The Node")}
        byline="By J. Jonah Bearson, who had it first"
      />
      <StickerLink href={CASE_PATHS.list} size="sm" className="self-start">
        <FolderSearch aria-hidden className="size-4" strokeWidth={2.25} />
        Open the case files
      </StickerLink>
    </section>
  );
}
