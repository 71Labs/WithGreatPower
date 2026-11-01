import { AVATARS } from "@/components/cast";
import type { CastId } from "@/content/cast";

/** A character's art in a small sticker tile, for alerts, rows and cards. Decorative. */
export function MiniAvatar({ id, className = "size-9 rounded-[10px]" }: { id: CastId; className?: string }) {
  const Art = AVATARS[id];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 overflow-hidden bg-sticker ring-2 ring-white shadow-[var(--shadow-chip)] [&>svg]:size-full ${className}`}
    >
      <Art />
    </span>
  );
}
