import { Check } from "@/components/icons";

/**
 * A visible checkbox or radio mark for card inputs, whose real <input> is visually
 * hidden. The mark changes shape (dot or tick), never only color. Gold when checked,
 * so it reads on a paper card and on an ink one.
 */
export function Mark({ checked, shape }: { checked: boolean; shape: "radio" | "checkbox" }) {
  const round = shape === "radio" ? "rounded-full" : "rounded-[7px]";
  return (
    <span
      aria-hidden
      className={`grid size-6 shrink-0 place-items-center border-2 border-game-ink ${round} ${checked ? "bg-game-gold text-game-ink" : "bg-game-paper"}`}
    >
      {checked ? shape === "radio" ? <span className="size-2.5 rounded-full bg-current" /> : <Check className="size-4" strokeWidth={3} /> : null}
    </span>
  );
}

/** The focus ring for a label that wraps a visually hidden input. */
export const FOCUS_WITHIN =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--vs-focus)]";

/**
 * A selectable sticker card (a <label> round a hidden input): paper with an ink rim,
 * ink when chosen, with the focus ring from its input. Add the chosen look yourself:
 * `${SELECT_CARD} ${checked ? SELECT_CARD_ON : SELECT_CARD_OFF}`.
 */
export const SELECT_CARD =
  "relative flex cursor-pointer flex-col rounded-[20px] border-2 border-game-ink text-left shadow-[var(--game-shadow-sm)] " +
  `${FOCUS_WITHIN} motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none`;
export const SELECT_CARD_ON = "bg-game-ink text-game-paper";
export const SELECT_CARD_OFF = "bg-game-paper text-game-ink pointer-fine:hover:bg-game-paper-2";
