/**
 * Invite codes and invite links, pure and shared by the browser and the server: the code's
 * shape (7 characters of Crockford base32, no I, L, O or U, matched case-insensitively),
 * reading one out of whatever a player pastes, and the "Share on X" post.
 */
import { xIntentUrl } from "@/lib/social/x";

export const INVITE_CODE_LENGTH = 7;

/** Crockford base32: 0–9 and A–Z without I, L, O and U. */
export const INVITE_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{7}$/;

export type CodeCheck = { ok: true; code: string } | { ok: false; reason: "empty" | "format" };

/**
 * A code as a player typed or pasted it: any case, with spaces or dashes, or the whole
 * invite link. Crockford's look-alikes read as the digits they stand for (O → 0, I and
 * L → 1), since real codes never hold those letters.
 */
export function normalizeInviteCode(raw: string): CodeCheck {
  let s = raw.trim();
  const fromLink = /\/invite\/([^/?#\s]+)/i.exec(s);
  if (fromLink) s = fromLink[1]!;
  s = s.replace(/[\s-]+/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!s) return { ok: false, reason: "empty" };
  return INVITE_CODE_RE.test(s) ? { ok: true, code: s } : { ok: false, reason: "format" };
}

/**
 * What the late-claim field sends: the code out of a pasted link, without spaces or
 * dashes, uppercased, 4–12 letters and numbers. Deliberately loose: the server reads
 * look-alikes (I, L, O) itself and is the one that says whether a code is real.
 */
export function claimCodeFromInput(raw: string): CodeCheck {
  let s = raw.trim();
  const fromLink = /\/invite\/([^/?#\s]+)/i.exec(s);
  if (fromLink) s = fromLink[1]!;
  s = s.replace(/[\s-]+/g, "").toUpperCase();
  if (!s) return { ok: false, reason: "empty" };
  return /^[0-9A-Z]{4,12}$/.test(s) ? { ok: true, code: s } : { ok: false, reason: "format" };
}

/** The code in a URL segment, or null when it can't be one (an unknown-code landing, no lookup). */
export function inviteCodeFromParam(param: string): string | null {
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    return null;
  }
  const check = normalizeInviteCode(decoded);
  return check.ok ? check.code : null;
}

/** The landing page for a code, on this site. */
export const invitePath = (code: string) => `/invite/${encodeURIComponent(code)}`;

/** The post "Share on X" fills in. The player sends it from their own account. */
export function inviteShareText(link: string): string {
  return `I’m swinging through With Great Power on NEAR 🕸️ Join my crew: ${link}`;
}

/** X's composer with the invite post filled in. Nothing is posted for the player. */
export const inviteShareUrl = (link: string) => xIntentUrl(inviteShareText(link));
