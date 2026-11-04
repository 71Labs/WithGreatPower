/**
 * "Share on X": a link to X's post composer with the text filled in. The player sends it
 * from their own X account; nothing is posted for them. Server-safe (no hooks).
 */
import { stickerButtonClass, type StickerSize, type StickerVariant } from "@/components/game/kit";
import { XLogo } from "@/components/icons";
import { xIntentUrl } from "@/lib/social/x";

export function ShareOnX({
  text,
  label = "Share on X",
  variant = "ink",
  size = "md",
  className = "",
}: {
  text: string;
  label?: string;
  variant?: StickerVariant;
  size?: StickerSize;
  className?: string;
}) {
  return (
    <a href={xIntentUrl(text)} target="_blank" rel="noopener noreferrer" className={stickerButtonClass(variant, size, className)}>
      <XLogo aria-hidden className="size-[18px]" strokeWidth={2} />
      {label}
      <span className="sr-only">(opens X in a new tab)</span>
    </a>
  );
}

/** The same link as a round 44px icon, for tight rows. `label` is its accessible name. */
export function ShareOnXIcon({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  return (
    <a
      href={xIntentUrl(text)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens X in a new tab)`}
      className={`grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2 ${className}`}
    >
      <XLogo aria-hidden className="size-[18px]" strokeWidth={2} />
    </a>
  );
}
