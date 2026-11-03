"use client";

/**
 * Everything account-shaped that floats over the game: the account sheet, the one-time
 * "bring your hero along" offer, the toast, and the chain status sync (quick play, the
 * hero's registration on chain). Mounted once by the game shell on every
 * /play screen, the full-screen patrol included, so `wgp:sign-in` works from anywhere.
 *
 * Privy (Google sign-in) mounts here too, but only once something asks for it
 * (src/lib/privy/bridge.ts): its SDK is a lazy chunk no page loads up front. A page that
 * comes back from Google with Privy's parameters asks for it straight away.
 */
import { Suspense, lazy, useEffect } from "react";

import { PrivyBridgeError, beginOAuthReturn, reportPrivyFailure, usePrivyWanted } from "@/lib/privy/bridge";
import { GOOGLE_SIGN_IN } from "@/lib/privy/config";

import { AccountSheet } from "./account-sheet";
import { ChainSync } from "./chain-sync";
import { GameToaster } from "./game-toast";
import { MigrationSheet } from "./migrate-sheet";
import { SIGN_IN_EVENT, openAccountSheet, useAccountSheetOpen } from "./sheet-state";

export { AccountChip } from "./account-chip";
export { SIGN_IN_EVENT, openAccountSheet } from "./sheet-state";

/** A chunk that fails to load (offline) reports it instead of breaking the page. */
const PrivyHost = lazy(() =>
  import("./privy-host").catch(() => {
    reportPrivyFailure(new PrivyBridgeError("Google sign-in couldn’t load", "privy_load_failed"));
    return { default: () => null };
  }),
);

/** `chrome`: the shell's chips and dock are showing (the toast sits above the dock). */
export function AccountCenter({ chrome }: { chrome: boolean }) {
  const sheetOpen = useAccountSheetOpen();
  const privyWanted = usePrivyWanted();

  useEffect(() => {
    const ask = () => openAccountSheet();
    window.addEventListener(SIGN_IN_EVENT, ask);
    return () => window.removeEventListener(SIGN_IN_EVENT, ask);
  }, []);

  // Back from Google through Privy: load Privy to finish the login; the sheet takes it from there.
  useEffect(() => {
    if (GOOGLE_SIGN_IN === "privy") beginOAuthReturn(window.location.search);
  }, []);

  return (
    <>
      <ChainSync />
      <AccountSheet />
      {/* One sheet at a time: the offer waits until the sign-in sheet has closed. */}
      <MigrationSheet blocked={sheetOpen} />
      <GameToaster raised={chrome} />
      {privyWanted ? (
        <Suspense fallback={null}>
          <PrivyHost />
        </Suspense>
      ) : null}
    </>
  );
}
