"use client";

/**
 * Gwei's reasoning on screen (src/lib/market/reasoning.ts writes it): the "Why this
 * price?" button with its popover, the chips for a sold-out, can't-pay or closed item,
 * and the reasoning set out in full for the trade sheet and the economy lab.
 *
 * The popover opens on hover (a mouse), on keyboard focus and on a press (tap, click,
 * Enter or Space, which also pins it open). Escape, a second press, a press anywhere
 * else or tabbing away closes it. `whyReduce` is that behaviour as a pure function.
 */
import { useEffect, useId, useReducer, useRef } from "react";

import { CircleSlash, HelpCircle, Lock, WalletMinimal } from "@/components/icons";
import type { PriceReasoning } from "@/lib/market/reasoning";

export interface WhyState {
  /** A mouse is over the button or the popover. */
  hover: boolean;
  /** The button has keyboard focus. */
  focus: boolean;
  /** Pressed open: stays until dismissed. */
  pinned: boolean;
}

export type WhyEvent = "enter" | "leave" | "focus" | "blur" | "press" | "dismiss";

export const WHY_CLOSED: WhyState = { hover: false, focus: false, pinned: false };

export const whyOpen = (s: WhyState) => s.hover || s.focus || s.pinned;

export function whyReduce(s: WhyState, e: WhyEvent): WhyState {
  switch (e) {
    case "enter":
      return { ...s, hover: true };
    case "leave":
      return { ...s, hover: false };
    case "focus":
      return { ...s, focus: true };
    case "blur":
      // Focus left the button and its popover: nothing keeps it open but a mouse.
      return { ...s, focus: false, pinned: false };
    case "press":
      // A press pins it open; pressing a pinned one closes it, whatever else held it.
      return s.pinned ? WHY_CLOSED : { ...s, pinned: true };
    case "dismiss":
      return WHY_CLOSED;
  }
}

/** The headline and reasons, as Gwei says them. */
export function Reasoning({ reasoning, className = "" }: { reasoning: PriceReasoning; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Gwei says</p>
      <p className="num text-[14px] font-semibold leading-5 [text-wrap:pretty]">“{reasoning.headline}”</p>
      <ul className="num flex list-disc flex-col gap-1.5 ps-4 text-[13px] leading-[18px] marker:text-game-muted [text-wrap:pretty]">
        {reasoning.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "Why this price?" button and its popover. Put it in a `relative` box as wide as
 * the popover may spread from; `popoverClassName` places it (`start-0` by default).
 */
export function WhyPrice({
  name,
  reasoning,
  defaultOpen = false,
  className = "",
  popoverClassName = "start-0",
}: {
  /** The item's name, for the button's accessible name. */
  name: string;
  reasoning: PriceReasoning;
  /** Starts pinned open. */
  defaultOpen?: boolean;
  className?: string;
  popoverClassName?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [state, send] = useReducer(whyReduce, defaultOpen ? { ...WHY_CLOSED, pinned: true } : WHY_CLOSED);
  const open = whyOpen(state);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) send("dismiss");
    };
    // Escape closes it wherever focus is, so a hover-opened popover can be dismissed too.
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") send("dismiss");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className={`relative ${className}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && send("enter")}
      onPointerLeave={(e) => e.pointerType === "mouse" && send("leave")}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) send("blur");
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onClick={() => send("press")}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && send("focus")}
        className="inline-flex min-h-8 items-center gap-1 rounded-[8px] text-start text-[12px] font-semibold leading-4 text-game-ink underline decoration-game-ink/40 underline-offset-[3px] [text-decoration-skip-ink:auto] focus-visible:outline-offset-2 pointer-coarse:min-h-11 pointer-fine:hover:decoration-game-ink"
      >
        <HelpCircle aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        Why this price?
        <span className="sr-only"> {name}</span>
      </button>
      {open ? (
        // The padding bridges the gap to the button, so a mouse can cross into the popover.
        <div id={id} role="tooltip" className={`absolute top-full z-30 w-[min(300px,calc(100vw-32px))] pt-1 ${popoverClassName}`}>
          <Reasoning reasoning={reasoning} className="rounded-[16px] border-2 border-game-ink bg-game-paper p-3 text-game-ink shadow-[var(--game-shadow-sm)]" />
        </div>
      ) : null}
    </div>
  );
}

const chip = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink pl-1 pr-2 text-[12px] font-bold leading-none text-game-ink";

/** What Gwei can't do with an item right now, as labelled chips; nothing when she can trade it both ways. */
export function VendorChips({ reasoning, className = "" }: { reasoning: PriceReasoning; className?: string }) {
  if (!reasoning.closed && !reasoning.soldOut && !reasoning.cantPay) return null;
  return (
    <p className={`flex flex-wrap gap-1.5 ${className}`}>
      {reasoning.closed ? (
        <span className={`${chip} bg-game-paper-2`}>
          <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Closed
        </span>
      ) : (
        <>
          {reasoning.soldOut ? (
            <span className={`${chip} bg-game-gold`}>
              <CircleSlash aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
              Sold out
            </span>
          ) : null}
          {reasoning.cantPay ? (
            <span className={`${chip} bg-game-gold`}>
              <WalletMinimal aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
              Gwei can’t pay
            </span>
          ) : null}
        </>
      )}
    </p>
  );
}
