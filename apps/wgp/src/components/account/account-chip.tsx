"use client";

/**
 * The account chip in the game shell's top row: "Sign in" for guests, the NEAR handle once
 * signed in. Either way it opens the account sheet. Hidden until we know who's playing.
 * The shell passes its chip look in `className`, so every top chip matches.
 *
 * `phoneIcon` makes it a round icon button on phones, its words kept as its accessible
 * name: "signed-in" in the top row (so the hero chip keeps room for the hero's name),
 * "always" on onboarding (where the step progress needs the room).
 */
import { LogIn, UserCircle } from "@/components/icons";
import { useAccount } from "@/game/store";

import { openAccountSheet } from "./sheet-state";

export function AccountChip({ className, phoneIcon }: { className: string; phoneIcon?: "signed-in" | "always" }) {
  const account = useAccount();
  if (account.status === "loading") return null;
  const me = account.me;
  const iconOnly = phoneIcon === "always" || (phoneIcon === "signed-in" && !!me);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openAccountSheet}
      className={`${className} min-w-0 gap-1.5 px-3.5 ${iconOnly ? "max-sm:w-12 max-sm:justify-center max-sm:px-0" : ""}`}
    >
      {me ? <UserCircle aria-hidden className="size-5 shrink-0" strokeWidth={2} /> : <LogIn aria-hidden className={`size-5 shrink-0 ${iconOnly ? "" : "max-[380px]:hidden"}`} strokeWidth={2} />}
      {me ? <span className="sr-only">Account: </span> : null}
      <span className={`max-w-[10rem] truncate text-[14px] font-semibold leading-5 sm:max-w-[11rem] ${iconOnly ? "max-sm:sr-only" : ""}`}>{me ? me.player.handle : "Sign in"}</span>
    </button>
  );
}
