"use client";

/**
 * Everything account-shaped that floats over the game: the account sheet, the one-time
 * "bring your hero along" offer and the toast. Mounted once by the game shell on every
 * /play screen, the full-screen patrol included, so `wgp:sign-in` works from anywhere.
 */
import { useEffect } from "react";

import { AccountSheet } from "./account-sheet";
import { GameToaster } from "./game-toast";
import { MigrationSheet } from "./migrate-sheet";
import { SIGN_IN_EVENT, openAccountSheet, useAccountSheetOpen } from "./sheet-state";

export { AccountChip } from "./account-chip";
export { SIGN_IN_EVENT, openAccountSheet } from "./sheet-state";

/** `chrome`: the shell's chips and dock are showing (the toast sits above the dock). */
export function AccountCenter({ chrome }: { chrome: boolean }) {
  const sheetOpen = useAccountSheetOpen();

  useEffect(() => {
    const ask = () => openAccountSheet();
    window.addEventListener(SIGN_IN_EVENT, ask);
    return () => window.removeEventListener(SIGN_IN_EVENT, ask);
  }, []);

  return (
    <>
      <AccountSheet />
      {/* One sheet at a time: the offer waits until the sign-in sheet has closed. */}
      <MigrationSheet blocked={sheetOpen} />
      <GameToaster raised={chrome} />
    </>
  );
}
