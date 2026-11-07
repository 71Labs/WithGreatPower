/**
 * The invite landing's lookup, for the server only (the page, its metadata and its Open
 * Graph image): the same read GET /api/invite/{code} answers (server/db/referrals.ts
 * inviteView), called directly rather than over HTTP, so a cold function or a waking database
 * can't time the card out. Deduplicated per request, so the page and its metadata share one
 * call.
 *
 *   valid        the code is real: who sent it
 *   unknown      the API said no, or the code can't be one (no request made)
 *   unavailable  the lookup couldn't answer: the page still offers the invite, and the accept
 *                route decides
 */
import { headers } from "next/headers";
import { cache } from "react";

import { getDb } from "@/server/db/client";
import { inviteView } from "@/server/db/referrals";

import type { InviteLookup, InviteReferrer } from "./api";
import { inviteCodeFromParam } from "./code";
import { landingFixture } from "./fixtures";

export type LandingInvite =
  | { state: "valid"; code: string; referrer: InviteReferrer }
  | { state: "unknown"; code: string | null }
  | { state: "unavailable"; code: string };

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** This request's origin, from its own Host (Vercel sets the forwarded pair). Null if it doesn't look like a host. */
export async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim();
  if (!HOST.test(host)) return null;
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]!.trim() || (LOCAL.test(host) ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** The lookup's answer as the landing shows it. Exported for tests. */
export function toLanding(code: string, lookup: InviteLookup | "unavailable"): LandingInvite {
  if (lookup === "unavailable") return { state: "unavailable", code };
  if (lookup.valid && lookup.referrer?.handle) return { state: "valid", code, referrer: lookup.referrer };
  return { state: "unknown", code };
}

async function lookup(code: string): Promise<InviteLookup | "unavailable"> {
  try {
    const view = await inviteView(await getDb(), code);
    if (typeof view?.valid !== "boolean") return "unavailable";
    // The save holds a suit id, the same one the API sends as JSON.
    return { valid: view.valid, referrer: (view.referrer as InviteReferrer | null) ?? null };
  } catch {
    return "unavailable";
  }
}

/**
 * What /invite/{param} shows. `fixture` (development only) skips the request:
 * landing-valid, landing-unknown or landing-unavailable.
 */
export const loadLandingInvite = cache(async (param: string, fixture?: string | null): Promise<LandingInvite> => {
  const code = inviteCodeFromParam(param);
  if (!code) return { state: "unknown", code: null };
  const canned = landingFixture(fixture ?? undefined);
  if (canned) return toLanding(code, canned);
  return toLanding(code, await lookup(code));
});
