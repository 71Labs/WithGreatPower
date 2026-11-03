/**
 * Which service "Continue with Google" uses. Safe for the browser, and tiny: the sign-in
 * sheet imports it on every /play page, so it must never import a Privy package.
 *
 *   NEXT_PUBLIC_PRIVY_APP_ID       the Privy app (Google login, NEAR embedded wallets)
 *   NEXT_PUBLIC_GOOGLE_SIGN_IN     "privy" | "near-auth"; unset: privy when the app id is set
 *
 * NEAR Auth (src/lib/near/near-auth.ts) stays in the code for when NEAR approves our
 * mainnet client: a player keeps their hero across the switch, because a sign-in with
 * either service finds the player by their verified email (docs/ARCHITECTURE.md §5).
 */

export type GoogleSignIn = "privy" | "near-auth";

/** Pure, for tests: the mode for a given app id and setting. */
export function googleSignInMode(appId: string | undefined, setting: string | undefined): GoogleSignIn {
  const choice = setting?.trim().toLowerCase();
  if (choice === "near-auth") return "near-auth";
  if (choice === "privy") return "privy";
  return appId?.trim() ? "privy" : "near-auth";
}

/** NEXT_PUBLIC_* values are inlined at build time, so each is read by its full name. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

export const GOOGLE_SIGN_IN: GoogleSignIn = googleSignInMode(PRIVY_APP_ID, process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN);
