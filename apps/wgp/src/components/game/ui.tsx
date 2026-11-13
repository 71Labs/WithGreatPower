"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { HeroArt, Sticker, type StickerSize } from "@/components/cast";
import { X } from "@/components/icons";
import { SUITS } from "@wgp/game-core/data";
import { useAccount, useGame } from "@/game/store";
import { QUICK_HERO, markQuickHero } from "@/lib/first-minute/quick-hero";
import { noHeroStep } from "@/lib/first-minute/quick-start-route";
import type { Hero, Save, SuitId } from "@wgp/game-core/types";

import { ON_PAPER, StickerIconButton } from "./kit";

/** The player's hero as a sticker, in whatever suit they're wearing. */
export function HeroSticker({
  hero,
  suit,
  size = "md",
  label = false,
  className = "",
}: {
  hero: Pick<Hero, "name" | "suit">;
  /** Preview another suit without equipping it. */
  suit?: SuitId;
  size?: StickerSize;
  label?: boolean;
  className?: string;
}) {
  const colors = SUITS[suit ?? hero.suit].colors;
  return <Sticker art={<HeroArt {...colors} />} name={hero.name} size={size} label={label} className={className} />;
}

/** A small art tile for the player's hero, for rows and the header. Decorative. */
export function HeroTile({ suit, className = "size-8 rounded-[9px]" }: { suit: SuitId; className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 overflow-hidden bg-sticker ring-2 ring-white shadow-[var(--shadow-chip)] [&>svg]:size-full ${className}`}>
      <HeroArt {...SUITS[suit].colors} />
    </span>
  );
}

const tones = {
  accent: "bg-accent",
  ink: "bg-ink-strong",
  fluid: "bg-fluid",
  success: "bg-on-success",
} as const;

/**
 * A labelled meter: health, web fluid, XP. The numbers are always written out, so the
 * bar is never the only way to read it.
 */
export function Meter({
  label,
  value,
  max,
  tone = "accent",
  size = "md",
  hideLabel = false,
  className = "",
}: {
  label: string;
  value: number;
  max: number;
  tone?: keyof typeof tones;
  size?: "sm" | "md";
  hideLabel?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className={`flex items-baseline justify-between gap-3 text-[12px] leading-4 ${hideLabel ? "sr-only" : ""}`}>
        <span className="text-ink-subtle">{label}</span>
        <span className="num font-medium text-ink-strong">
          {Math.round(value)} / {max}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        className={`overflow-hidden rounded-full bg-surface-2 ${size === "sm" ? "h-1.5" : "h-2.5"}`}
      >
        <span
          className={`block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out ${tones[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** A white panel with an optional header, the base of every game screen. */
export function GamePanel({
  title,
  meta,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)] ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-display text-[19px] font-medium leading-6 tracking-[-0.015em] text-ink-strong">{title}</h2>
            {meta ? <p className="text-[13px] leading-5 text-ink-subtle">{meta}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Shown while the save loads from this browser (one frame, usually). */
export function GameLoading() {
  return (
    <div role="status" className="flex min-h-[50vh] items-center justify-center">
      <span className="inline-flex h-10 items-center rounded-full border-2 border-game-ink bg-game-paper px-4 text-[14px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)]">
        Suiting up…
      </span>
    </div>
  );
}

/**
 * The save, once loaded and once a hero exists; until then this renders the loading state,
 * for a frame. A visitor without a hero is never left waiting on it:
 *
 * - A guest on Tonight (/play) goes to the quick start, which makes the ready hero and
 *   opens the first night (components/first-minute/quick-start.tsx).
 * - A guest on any other screen (a deep link to the market, the suits, a patrol) gets the
 *   same ready hero in place and stays on the screen they asked for.
 * - A signed-in player picks their hero's name first: it goes on the boards (/play/bitten).
 */
export type HeroSave = Save & { hero: Hero };

export function useHeroSave(): HeroSave | null {
  const { save, dispatch } = useGame();
  const status = useAccount().status;
  const router = useRouter();
  const pathname = usePathname();
  const needsHero = !!save && !save.hero;
  useEffect(() => {
    // The decision is a pure function (lib/first-minute/quick-start-route.ts), tested there.
    const step = noHeroStep({ status, saveLoaded: !!save, hasHero: !needsHero, pathname });
    if (step.kind === "go") router.replace(step.to);
    else if (step.kind === "make-hero") {
      markQuickHero(true);
      dispatch({ type: "create-hero", ...QUICK_HERO });
    }
  }, [save, needsHero, status, pathname, router, dispatch]);
  return save && save.hero ? (save as HeroSave) : null;
}

/* ------------------------------------------------------------------ sheets */

/** Bottom sheet on phones (and short landscape), a centred dialog from 640 wide and 560 tall. */
const SHEET_FRAME =
  "fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[min(88dvh,760px)] w-full max-w-[640px] overflow-hidden p-0 " +
  "rounded-t-[28px] border-[2.5px] border-b-0 border-game-ink bg-game-paper text-game-ink " +
  "translate-y-full open:translate-y-0 starting:open:translate-y-full " +
  "motion-safe:transition-[translate,opacity,display,overlay] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] transition-discrete " +
  "backdrop:bg-game-night/70 " +
  "[@media(min-width:640px)_and_(min-height:560px)]:inset-0 [@media(min-width:640px)_and_(min-height:560px)]:m-auto " +
  "[@media(min-width:640px)_and_(min-height:560px)]:h-fit [@media(min-width:640px)_and_(min-height:560px)]:w-[calc(100%-48px)] " +
  "[@media(min-width:640px)_and_(min-height:560px)]:rounded-[28px] [@media(min-width:640px)_and_(min-height:560px)]:border-b-[2.5px] " +
  "[@media(min-width:640px)_and_(min-height:560px)]:shadow-[0_6px_0_var(--game-ink)] " +
  "[@media(min-width:640px)_and_(min-height:560px)]:translate-y-3 [@media(min-width:640px)_and_(min-height:560px)]:opacity-0 " +
  "[@media(min-width:640px)_and_(min-height:560px)]:open:translate-y-0 [@media(min-width:640px)_and_(min-height:560px)]:open:opacity-100 " +
  "[@media(min-width:640px)_and_(min-height:560px)]:starting:open:translate-y-3 [@media(min-width:640px)_and_(min-height:560px)]:starting:open:opacity-0";

/** The page behind an open sheet doesn't scroll (KitStyles keys off this attribute). */
function lockPage() {
  document.documentElement.setAttribute("data-wgp-sheet", "");
}

/** Unlock once no sheet is left open; deferred so a sheet opening in the same tick keeps the lock. */
function unlockPage() {
  requestAnimationFrame(() => {
    if (!document.querySelector("dialog[open]")) document.documentElement.removeAttribute("data-wgp-sheet");
  });
}

const SHEET_WIDTH = { md: "[@media(min-width:640px)_and_(min-height:560px)]:max-w-[480px]", lg: "[@media(min-width:640px)_and_(min-height:560px)]:max-w-[640px]" } as const;

/**
 * A sheet in the sticker kit: paper with an ink rim, a bottom sheet on phones and a
 * centred dialog on desktop. A native modal <dialog>, so the focus trap, Escape and the
 * top layer come from the browser; focus goes back to whatever opened it. A tap on the
 * dimmed backdrop closes it too. It slides in (still under reduced motion).
 *
 *   const [open, setOpen] = useState(false);
 *   <GameSheet open={open} onClose={() => setOpen(false)} title="How to play">…</GameSheet>
 *
 * `onClose` runs however it closes (Escape, the close button, the backdrop, or the parent
 * setting `open` to false), so keep it idempotent. When Next hides the page (Activity),
 * the sheet closes with it.
 */
export function GameSheet({
  open,
  onClose,
  title,
  eyebrow,
  description,
  footer,
  size = "md",
  art,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A small line over the title ("Settings", "Suit lab"). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Pinned under the scrolling content: the sheet's one action. */
  footer?: ReactNode;
  size?: keyof typeof SHEET_WIDTH;
  /** Art beside the title, e.g. a sticker. Decorative. */
  art?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const ids = useId();
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      lockPage();
      // Start on the first control in the body, not the close button, when there is one.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // Hidden by navigation (Activity) or unmounted: don't leave a modal, or a locked page, behind.
    return () => {
      if (dialog.open) dialog.close();
      unlockPage();
    };
  }, [open]);

  function handleClose() {
    // A close that was undone straight away (React's dev double effects) isn't a close.
    if (ref.current?.open) return;
    unlockPage();
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus();
    onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={handleClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      className={`${SHEET_FRAME} ${SHEET_WIDTH[size]} ${ON_PAPER}`}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          {art ? <span aria-hidden className="shrink-0">{art}</span> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1 self-center">
            {eyebrow ? (
              <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{eyebrow}</p>
            ) : null}
            <h2 id={titleId} className="font-display text-[24px] font-semibold leading-7 tracking-[-0.02em] text-game-ink [overflow-wrap:anywhere]">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-[14px] leading-5 text-game-muted">
                {description}
              </p>
            ) : null}
          </div>
          <StickerIconButton label="Close" onClick={() => ref.current?.close()} className="-mr-1 -mt-1">
            <X strokeWidth={2.25} />
          </StickerIconButton>
        </header>
        {children ? (
          <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 ${footer ? "pb-4" : "pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-6"}`}>
            {children}
          </div>
        ) : null}
        {footer ? (
          <div className="flex shrink-0 flex-col gap-2 border-t-2 border-game-ink bg-game-paper-2 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-5">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ tabs */

export interface StickerTab<T extends string> {
  id: T;
  label: string;
  /** A short count shown in a badge, with its meaning for screen readers. */
  badge?: { value: ReactNode; label: string };
}

/**
 * A segmented control that switches panels, as ARIA tabs: arrow keys move between them,
 * Home and End jump. Render each panel with `tabPanelProps(idPrefix, id)`.
 */
export function StickerTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className = "",
}: {
  tabs: StickerTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`grid auto-cols-fr grid-flow-col gap-1 rounded-full border-2 border-game-ink bg-game-paper p-1 shadow-[var(--game-shadow-sm)] ${ON_PAPER} ${className}`}
    >
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`relative inline-flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold pointer-coarse:h-11 ${
              selected ? "bg-game-ink text-game-paper" : "text-game-ink pointer-fine:hover:bg-game-paper-2"
            }`}
          >
            {t.label}
            {t.badge ? (
              <>
                <span
                  aria-hidden
                  className="num inline-grid h-5 min-w-5 place-items-center rounded-full border-2 border-game-ink bg-game-gold px-1 text-[11px] font-bold leading-none text-game-ink"
                >
                  {t.badge.value}
                </span>
                <span className="sr-only">, {t.badge.label}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Props for the panel a StickerTabs tab controls. */
export function tabPanelProps(idPrefix: string, id: string) {
  return { role: "tabpanel", id: `${idPrefix}-panel-${id}`, "aria-labelledby": `${idPrefix}-tab-${id}`, tabIndex: 0 } as const;
}
