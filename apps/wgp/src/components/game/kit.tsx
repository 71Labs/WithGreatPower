/**
 * The game's sticker UI kit. Everything in the game that you press or read looks like a
 * sticker on a page: paper faces, a 2.5px ink outline, a hard ink drop, chunky type.
 * One red action per screen; everything else is paper.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const press =
  "motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const variants = {
  /** The one red action on a screen. */
  hero: "bg-game-hero text-game-on-hero pointer-fine:hover:bg-game-hero-press",
  paper: "bg-game-paper text-game-ink pointer-fine:hover:bg-game-paper-2",
  ink: "bg-game-ink text-game-paper pointer-fine:hover:bg-game-ink-2",
} as const;

const sizes = {
  sm: "h-10 gap-1.5 rounded-[12px] px-3.5 text-[14px] pointer-coarse:h-11",
  md: "h-12 gap-2 rounded-[14px] px-5 text-[16px]",
  lg: "h-14 gap-2.5 rounded-[16px] px-7 text-[18px]",
  xl: "h-16 gap-3 rounded-[18px] px-9 text-[21px] tracking-[-0.01em]",
} as const;

export type StickerVariant = keyof typeof variants;
export type StickerSize = keyof typeof sizes;

const base =
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border-[2.5px] border-game-ink font-semibold leading-none shadow-[var(--game-shadow)] focus-visible:outline-offset-4";

export function stickerButtonClass(variant: StickerVariant = "paper", size: StickerSize = "md", className = "") {
  return `${base} ${press} ${variants[variant]} ${sizes[size]} ${className}`;
}

export function StickerButton({
  variant = "paper",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: StickerVariant; size?: StickerSize }) {
  return <button type="button" className={stickerButtonClass(variant, size, className)} {...props} />;
}

export function StickerLink({
  variant = "paper",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: StickerVariant; size?: StickerSize }) {
  return <Link className={stickerButtonClass(variant, size, className)} {...props} />;
}

/** A paper panel with an ink outline and a hard drop. 22px corners, so 12px padding → 10px inside. */
export function StickerPanel({
  as: Tag = "div",
  className = "",
  children,
  ...props
}: ComponentProps<"div"> & { as?: "div" | "section" | "aside" | "header" | "article" | "nav" }) {
  return (
    <Tag className={`rounded-[22px] border-[2.5px] border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)] ${className}`} {...props}>
      {children}
    </Tag>
  );
}

/** A small paper pill: a stat, a tag, a label. */
export function StickerChip({ className = "", children, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper px-3 text-[13px] font-semibold leading-none text-game-ink shadow-[var(--game-shadow-sm)] ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

/** A section label: a short red bar, then a word in caps. */
export function StickerEyebrow({ as: Tag = "p", id, children, className = "" }: { as?: "p" | "h2" | "h3" | "span"; id?: string; children: ReactNode; className?: string }) {
  return (
    <Tag id={id} className={`flex items-center gap-2 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink ${className}`}>
      <span aria-hidden className="h-[3px] w-4 rounded-full bg-game-hero" />
      {children}
    </Tag>
  );
}

/** A meter drawn like a sticker: ink outline, paper track, flat fill. Numbers always written out. */
export function StickerMeter({
  label,
  value,
  max,
  fill = "bg-game-hero",
  hideLabel = false,
  className = "",
}: {
  label: string;
  value: number;
  max: number;
  fill?: string;
  hideLabel?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className={`flex items-baseline justify-between gap-3 text-[12px] font-semibold leading-4 ${hideLabel ? "sr-only" : ""}`}>
        <span>{label}</span>
        <span className="num">
          {Math.round(value)} / {max}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        className="h-3 overflow-hidden rounded-full border-2 border-game-ink bg-game-paper-2"
      >
        <span className={`block h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ added for the game shell */

/**
 * Pieces the game shell and screens share. Server-safe (no hooks), like the rest of the
 * kit; the stateful pieces (GameSheet, StickerTabs) live in ./ui.tsx.
 */

/** Put on a paper surface: focus rings drawn on paper are hero red (4.9:1), not the shell's gold. */
export const ON_PAPER = "[--vs-focus:var(--game-hero)]";

/** A round paper button holding one icon, 44px (md) or 48px (lg). `label` is its accessible name ("Open settings"). */
export function StickerIconButton({
  label,
  size = "md",
  className = "",
  children,
  ...props
}: Omit<ComponentProps<"button">, "aria-label"> & { label: string; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`grid ${size === "lg" ? "size-12" : "size-11"} shrink-0 select-none place-items-center rounded-full border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2 [&>svg]:size-5 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A count or flag on a tab or a tile: gold with an ink rim, like a reward sticker. It's
 * decorative; say the same thing in text next to it (sr-only is fine).
 */
export function StickerBadge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={`num inline-grid h-5 min-w-5 place-items-center whitespace-nowrap rounded-full border-2 border-game-ink bg-game-gold px-1 text-[11px] font-bold leading-none text-game-ink ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A character sticker at any size: the white die-cut edge, the light card behind the
 * art and a hard ink drop, like the cast's stickers but sized by `--s` (default 120px)
 * so it can scale with the screen: `className="[--s:96px] sm:[--s:120px]"`.
 * Border 7% of the frame, outer radius 28%, inner radius = outer − border.
 */
export function StickerFrame({
  children,
  label,
  className = "",
  drop = "lg",
}: {
  /** The art: an AVATARS entry or <HeroArt />. */
  children: ReactNode;
  /** Names the art for assistive tech; without it the frame is decorative. */
  label?: string;
  className?: string;
  drop?: "lg" | "sm" | "none";
}) {
  const shadow = drop === "lg" ? "shadow-[0_5px_0_var(--game-ink)]" : drop === "sm" ? "shadow-[var(--game-shadow-sm)]" : "";
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`grid size-[var(--s,120px)] shrink-0 rounded-[calc(var(--s,120px)*0.28)] bg-white p-[calc(var(--s,120px)*0.07)] ring-2 ring-game-ink ${shadow} ${className}`}
    >
      <span className="block size-full overflow-hidden rounded-[calc(var(--s,120px)*0.21)] bg-sticker [&>svg]:size-full">{children}</span>
    </span>
  );
}

/** A pressable paper tile (a <button> or <Link>) for grids: ink outline, small drop, sinks on press. */
export const stickerTileClass =
  `relative flex min-w-0 flex-col rounded-[20px] border-2 border-game-ink bg-game-paper text-left text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2`;

/**
 * The kit's keyframes, the page lock for open sheets and the night ground for overscroll
 * (any element with data-wgp-night), hoisted into <head> once by
 * React (render it anywhere; the shell does). Every animation sits behind
 * prefers-reduced-motion: no-preference, so reduced motion gets a still page.
 */
const KIT_CSS = `
html:has([data-wgp-night]) { background-color: var(--game-night); }
html[data-wgp-sheet] { overflow: hidden; }
.wgp-scroll-x { scrollbar-width: none; }
.wgp-scroll-x::-webkit-scrollbar { display: none; }
@media (prefers-reduced-motion: no-preference) {
  @keyframes wgp-bob { 0%, 100% { translate: 0 0; rotate: -2deg; } 50% { translate: 0 -6px; rotate: -1deg; } }
  @keyframes wgp-rise { from { opacity: 0; translate: 0 10px; } to { opacity: 1; translate: 0 0; } }
  @keyframes wgp-pop { 0% { opacity: 0; scale: 0.6; } 70% { opacity: 1; scale: 1.08; } 100% { opacity: 1; scale: 1; } }
  @keyframes wgp-pulse { 0%, 100% { box-shadow: 0 0 0 0 var(--game-gold); } 50% { box-shadow: 0 0 0 5px transparent; } }
  .wgp-bob { animation: wgp-bob 3.6s ease-in-out infinite; }
  .wgp-rise { animation: wgp-rise 320ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  .wgp-pop { animation: wgp-pop 420ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  .wgp-pulse { animation: wgp-pulse 1.8s ease-out infinite; }
}
`;

export function KitStyles() {
  return (
    <style href="wgp-game-kit" precedence="medium">
      {KIT_CSS}
    </style>
  );
}
