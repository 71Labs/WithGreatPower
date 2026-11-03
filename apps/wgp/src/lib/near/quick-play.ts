/**
 * Quick play: this browser holds a session key the relayer accepts for the signed-in
 * account, so hero registration, crafting and equipping go on chain with no wallet popup.
 * Pure, so the account sheet, the suit lab and the store always agree.
 *
 * - on: the key in this browser is one of the account's live session keys.
 * - pending: an "Enable quick play" is under way here, or the key was added to the
 *   account but the server hasn't recorded it yet (finishing needs no new approval).
 * - off: no usable key in this browser.
 * - unavailable: a test sign-in (not a NEAR account), or a server without NEAR settings.
 */

export type QuickPlay =
  | { state: "unavailable"; reason: "test-account" | "not-configured" }
  | { state: "off" }
  | { state: "pending"; publicKey: string | null }
  | { state: "on"; publicKey: string };

export interface LocalKey {
  publicKey: string;
  /** The account the key was added to, once known. */
  accountId: string | null;
}

export interface QuickPlayInput {
  /** The signed-in account is a real NEAR account. */
  available: boolean;
  /** The server can relay game calls. */
  configured: boolean;
  accountId: string;
  /** Session keys the relayer accepts for this player. */
  liveKeys: readonly string[];
  /** This browser's session key, if it has one. */
  localKey: LocalKey | null;
  /** An "Enable quick play" is under way in this tab. */
  enabling: boolean;
}

export function quickPlayState(i: QuickPlayInput): QuickPlay {
  if (!i.available) return { state: "unavailable", reason: "test-account" };
  if (!i.configured) return { state: "unavailable", reason: "not-configured" };
  const key = i.localKey;
  const mine = key !== null && (key.accountId === null || key.accountId === i.accountId);
  if (key && mine && i.liveKeys.includes(key.publicKey)) return { state: "on", publicKey: key.publicKey };
  if (i.enabling) return { state: "pending", publicKey: key?.publicKey ?? null };
  if (key && key.accountId === i.accountId) return { state: "pending", publicKey: key.publicKey };
  return { state: "off" };
}

/** Words for each state, shared by every screen that shows it. */
export const QUICK_PLAY_LABEL: Record<QuickPlay["state"], string> = {
  on: "On",
  off: "Off",
  pending: "Pending",
  unavailable: "Unavailable",
};
