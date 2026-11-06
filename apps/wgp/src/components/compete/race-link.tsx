"use client";

/**
 * "Race my ghost": a verified run's challenge link (/play/compete/race/<runId>), to copy or to
 * open. Anyone who opens it races this run's ghost: today's Daily, its course, or its own night
 * again as a duel. Used on the results screens and a run's public page.
 */
import Link from "next/link";
import { useState } from "react";

import { stickerButtonClass, type StickerSize, type StickerVariant } from "@/components/game/kit";
import { Check, Copy, Replay } from "@/components/icons";
import { racePath, raceUrl } from "@/lib/compete/share";

export function CopyRaceLink({ runId, size = "md", variant = "paper", className = "" }: { runId: string; size?: StickerSize; variant?: StickerVariant; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raceUrl(runId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // No clipboard (an insecure page, a refusal): open the link instead, to copy from the bar.
      window.open(racePath(runId), "_blank", "noopener");
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className={stickerButtonClass(variant, size, className)}>
      {copied ? <Check aria-hidden className="size-[18px]" strokeWidth={2.25} /> : <Copy aria-hidden className="size-[18px]" strokeWidth={2.25} />}
      {copied ? "Link copied" : "Copy challenge link"}
      <span role="status" className="sr-only">
        {copied ? "Challenge link copied" : ""}
      </span>
    </button>
  );
}

/** A link that opens the race against this run's ghost right here. */
export function RaceGhostLink({ runId, label = "Race this ghost", size = "md", variant = "paper", className = "" }: { runId: string; label?: string; size?: StickerSize; variant?: StickerVariant; className?: string }) {
  return (
    <Link href={racePath(runId)} className={stickerButtonClass(variant, size, className)}>
      <Replay aria-hidden className="size-[18px]" strokeWidth={2.25} />
      {label}
    </Link>
  );
}
