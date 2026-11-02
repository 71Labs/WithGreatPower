import type { ReactNode } from "react";

import { AVATARS } from "@/components/cast";
import { StickerFrame } from "@/components/game/kit";
import type { CastId } from "@wgp/game-core/cast";

/** Sticker size in the grid: tight on phones, roomier from 640 up. */
export const GRID_SIZE = "[--s:76px] sm:[--s:92px]";

/**
 * An empty place in the album: a dashed outline, a faint silhouette and a "?". Locked
 * is said by the shape, the "?" and the word under it, never by color alone. Decorative.
 */
export function LockedFrame({ id, className = GRID_SIZE }: { id: CastId; className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative grid size-[var(--s,76px)] shrink-0 place-items-center rounded-[calc(var(--s,76px)*0.28)] border-2 border-dashed border-game-ink/45 bg-game-paper-2 ${className}`}
    >
      <span className="absolute inset-[12%] overflow-hidden rounded-[calc(var(--s,76px)*0.2)] opacity-[0.12] brightness-0 [&>svg]:size-full">
        {AVATARS[id]()}
      </span>
      <span className="relative font-display text-[calc(var(--s,76px)*0.4)] font-semibold leading-none text-game-muted">?</span>
    </span>
  );
}

/** A collected sticker in the grid. Decorative: the name is written under it. */
export function CastFrame({ id, className = GRID_SIZE }: { id: CastId; className?: string }) {
  return (
    <StickerFrame drop="sm" className={className}>
      {AVATARS[id]()}
    </StickerFrame>
  );
}

/** One place in the grid: the sticker, a count badge on its corner, the name and a line. */
export function Slot({
  art,
  name,
  sub,
  badge,
  muted = false,
  onOpen,
}: {
  art: ReactNode;
  name: string;
  sub: ReactNode;
  badge?: ReactNode;
  muted?: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 flex-col items-center gap-1.5 rounded-[18px] px-1 pb-2 pt-2.5 text-center focus-visible:outline-offset-0 motion-safe:transition-[scale] motion-safe:duration-150 motion-safe:ease-out active:scale-[0.97] pointer-fine:hover:bg-game-paper-2"
      >
        <span className="relative">
          {art}
          {badge ? <span className="absolute -right-2 -top-2">{badge}</span> : null}
        </span>
        <span className={`mt-1 line-clamp-2 text-[13px] font-semibold leading-4 [overflow-wrap:anywhere] ${muted ? "text-game-muted" : "text-game-ink"}`}>
          {name}
        </span>
        <span className="num text-[11px] font-medium leading-4 text-game-muted">{sub}</span>
      </button>
    </li>
  );
}
