import { createElement, type ReactNode } from "react";

import { castById, type CastId } from "@wgp/game-core/cast";

import { AVATARS } from "./avatars";

/*
 * A sticker is a physical-looking object: the white border and the light paper behind
 * the art keep their colors in dark mode, like a real sticker on a dark desk.
 *
 * Border ≈ 7% of the frame, outer radius ≈ 28%, inner radius = outer − border.
 */
const SIZES = {
  sm: { frame: "size-14 rounded-[16px] p-1", inner: "rounded-[12px]", gap: "gap-1.5" },
  md: { frame: "size-30 rounded-[34px] p-2", inner: "rounded-[26px]", gap: "gap-2.5" },
  lg: { frame: "size-50 rounded-[56px] p-3.5", inner: "rounded-[42px]", gap: "gap-3" },
} as const;

export type StickerSize = keyof typeof SIZES;

/** Picking up a sticker: a small tilt and lift, only for fine pointers that hover. */
const PICK_UP =
  "motion-safe:transition-[rotate,scale] motion-safe:duration-200 motion-safe:ease-out motion-safe:pointer-fine:hover:-rotate-3 motion-safe:pointer-fine:hover:scale-104";

/**
 * A character sticker. Pass a cast `id`, or `art` and `name` for anything else (the
 * player's own hero in their suit).
 */
export function Sticker({
  id,
  art: customArt,
  name: customName,
  size = "md",
  label = true,
  className = "",
}: {
  id?: CastId;
  art?: ReactNode;
  name?: string;
  size?: StickerSize;
  /** Show the name under the sticker. Without it the sticker is an image named for the character. */
  label?: boolean;
  className?: string;
}) {
  const name = customName ?? (id ? castById(id).name : "");
  const s = SIZES[size];
  const frameClass = `shrink-0 bg-white shadow-[var(--shadow-chip)] ${s.frame} ${PICK_UP}`;
  const art = <div className={`size-full overflow-hidden bg-sticker ${s.inner}`}>{customArt ?? (id ? createElement(AVATARS[id]) : null)}</div>;

  if (!label) {
    return (
      <div role="img" aria-label={name} className={`${frameClass} ${className}`}>
        {art}
      </div>
    );
  }

  return (
    <figure className={`inline-flex flex-col items-center ${s.gap} ${className}`}>
      <div className={frameClass}>{art}</div>
      <figcaption className="whitespace-nowrap text-center font-mono text-[13px] leading-5 text-ink-subtle">{name}</figcaption>
    </figure>
  );
}
