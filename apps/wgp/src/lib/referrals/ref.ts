/**
 * The invite this browser carries, in localStorage: the code (`wgp:ref`) the invite
 * landing stored, and the inviter's handle for the welcome toast (`wgp:ref-by`). Every
 * sign-in request sends the code as `ref` (withRef; null without one), a fallback for a lost `wgp_ref`
 * cookie; the account sheet forgets both once a sign-in answers signed in. The server
 * decides whether it counts (only for a player that request created).
 *
 * Blocked storage (private modes) just means no fallback; nothing here throws.
 */
import { INVITE_CODE_RE } from "./code";

export const REF_KEY = "wgp:ref";
export const REF_BY_KEY = "wgp:ref-by";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The landing stores the code it showed, and who sent it. */
export function rememberInvite(code: string, referrer?: string | null) {
  const s = storage();
  if (!s || !INVITE_CODE_RE.test(code)) return;
  try {
    s.setItem(REF_KEY, code);
    if (referrer) s.setItem(REF_BY_KEY, referrer);
    else s.removeItem(REF_BY_KEY);
  } catch {
    // Full or blocked: the cookie still carries the invite.
  }
}

/** The stored code, if it's still a well-formed one. */
export function storedRef(): string | null {
  try {
    const code = storage()?.getItem(REF_KEY)?.trim().toUpperCase() ?? "";
    return INVITE_CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/** The inviter's handle the landing saw, for "You joined {handle}’s crew." */
export function storedReferrer(): string | null {
  try {
    const handle = storage()?.getItem(REF_BY_KEY)?.trim() ?? "";
    return handle ? handle.slice(0, 64) : null;
  } catch {
    return null;
  }
}

/** After a signed-in response: the invite has done its job (or never will). */
export function forgetInvite() {
  const s = storage();
  try {
    s?.removeItem(REF_KEY);
    s?.removeItem(REF_BY_KEY);
  } catch {}
}

/** A sign-in request's JSON body with `ref`: the invite code this browser holds, or null. */
export function withRef<T extends object>(body: T): T & { ref: string | null } {
  return { ...body, ref: storedRef() };
}
