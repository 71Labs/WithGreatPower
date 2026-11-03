/**
 * Sign-in failures in words a player can act on. Codes come from our API (`error`), from
 * NearAuthError (`code`) and from Auth0's popup errors (`error`).
 */

export interface SignInProblem {
  text: string;
  /** Google can't work here right now: point at the wallet instead. */
  googleUnavailable?: boolean;
  /** The handle field is at fault (shown next to it). */
  handle?: boolean;
}

function codeOf(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const e = error as { code?: unknown; error?: unknown };
  if (typeof e.code === "string") return e.code;
  if (typeof e.error === "string") return e.error;
  return "";
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "");

export function googleProblem(error: unknown): SignInProblem {
  const code = codeOf(error);
  switch (code) {
    case "NO_CLIENT_ID":
    case "near_not_configured":
    case "privy_not_configured":
      return { text: "Google sign-in isn’t set up on this server yet.", googleUnavailable: true };
    case "oauth_refused":
      return { text: "Google sign-in isn’t available right now. Use a NEAR wallet, or try Google again later.", googleUnavailable: true };
    case "privy_timeout":
    case "privy_load_failed":
    case "oauth_start_failed":
      return { text: "Google sign-in couldn’t start. Check your connection, then choose Continue with Google again." };
    case "oauth_failed":
    case "privy_not_signed_in":
      return { text: "Google sign-in didn’t finish. Choose Continue with Google to try again." };
    case "near_wallet_failed":
    case "near_wallet_missing":
      return { text: "Google signed you in, but your NEAR key isn’t ready yet. Choose Continue with Google to try again." };
    case "privy_user":
      return { text: "Google sign-in is having trouble on our side. Try again in a minute." };
    case "NONCE_UNSUPPORTED":
      return { text: "This version of the game can’t start Google sign-in safely.", googleUnavailable: true };
    case "popup_open":
      return { text: "Your browser blocked the Google window. Allow pop-ups for this site, then choose Continue with Google again." };
    case "cancelled":
      return { text: "The Google window closed before sign-in finished. Choose Continue with Google to try again." };
    case "timeout":
      return { text: "Google took too long to answer. Choose Continue with Google to try again." };
    case "nonce_missing":
    case "nonce_mismatch":
    case "nonce_spent":
      return { text: "That sign-in expired. Choose Continue with Google to start again." };
    case "bad_token":
      return { text: "We couldn’t verify Google’s answer. Choose Continue with Google to try again." };
    case "banned":
      return { text: "This account is suspended." };
    case "invalid_handle":
    case "reserved_handle":
    case "handle_taken":
      return { text: messageOf(error) || "Pick another handle.", handle: true };
    case "budget_exhausted":
      return { text: "New accounts are paused for today. Try again tomorrow, or use a NEAR wallet." };
    case "rate_limited":
      return { text: "Too many sign-in attempts. Wait a minute, then try again." };
    case "network":
      return { text: "Couldn’t reach the server. Check your connection and try again." };
    default:
      return { text: messageOf(error) ? `Google sign-in didn’t finish: ${messageOf(error)}` : "Google sign-in didn’t finish. Try again." };
  }
}

/** "Claim your name" failures (POST /api/auth/privy/claim). */
export function claimProblem(error: unknown): SignInProblem & { closed?: boolean; claimed?: boolean } {
  const code = codeOf(error);
  switch (code) {
    case "invalid_handle":
    case "reserved_handle":
    case "handle_taken":
      return { text: messageOf(error) || "Pick another handle.", handle: true };
    case "names_closed":
      return { text: "Names aren’t open yet. Your hero is saved; claim your name once they open.", closed: true };
    case "already_claimed":
      return { text: "Your account already has its name.", claimed: true };
    case "wallet_mismatch":
      return { text: "That Google login doesn’t match this account. Sign out, then sign in with the Google account you started with." };
    case "budget_exhausted":
      return { text: "New names are paused for today. Try again tomorrow." };
    case "rate_limited":
      return { text: "Too many tries. Wait a minute, then try again." };
    case "network":
      return { text: "Couldn’t reach the server. Check your connection and try again." };
    default:
      return { text: messageOf(error) ? `Your name wasn’t claimed: ${messageOf(error)}` : "Your name wasn’t claimed. Try again." };
  }
}

/** "Enable quick play" failures, from the wallet, NEAR Auth, Privy or POST /api/auth/wallet. */
export function quickPlayProblem(error: unknown): SignInProblem {
  const code = codeOf(error);
  const message = messageOf(error);
  switch (code) {
    case "wrong_account":
      return { text: `${message}. Switch your wallet to the account you signed in with, then choose Enable quick play again.` };
    case "key_not_found":
      return { text: "NEAR doesn’t show the new key yet. Wait a moment, then choose Finish setup." };
    case "key_revoked":
    case "key_in_use":
      return { text: "That key can’t be used anymore. Choose Start over to add a new one." };
    case "wrong_receiver":
    case "allowance":
      return { text: "Your wallet added a key the game can’t use. Choose Start over to add the right one." };
    case "near_not_configured":
      return { text: "Quick play isn’t set up on this server yet." };
    case "privy_wrong_account":
      return { text: "This account was made with another sign-in, so your Google key can’t add a key to it. Your changes are still saved." };
    case "privy_not_signed_in":
    case "privy_timeout":
      return { text: "Google needs you to sign in again here. Sign out, sign back in with Google, then choose Enable quick play." };
    case "budget_exhausted":
    case "relayer_empty":
      return { text: "The game can’t pay for new keys right now. Try again later." };
    case "network":
      return { text: "Couldn’t reach the server. Check your connection and try again." };
  }
  if (/reject|cancel|denied|closed/i.test(message)) return { text: "The approval was cancelled, so quick play stays off. Choose Enable quick play to try again." };
  if (/still loading/i.test(message)) return { text: "Wallets are still loading. Try again in a moment." };
  return { text: message ? `Quick play didn’t turn on: ${message}` : "Quick play didn’t turn on. Try again." };
}

export function walletProblem(error: unknown): SignInProblem {
  const message = messageOf(error);
  if (/reject|cancel|denied|closed/i.test(message)) return { text: "The wallet didn’t sign. Choose Use a NEAR wallet to try again." };
  if (/still loading/i.test(message)) return { text: "Wallets are still loading. Try again in a moment." };
  return { text: message ? `Wallet sign-in didn’t finish: ${message}` : "Wallet sign-in didn’t finish. Try again." };
}
